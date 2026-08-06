"use strict";

const express = require("express");
const { db } = require("../db/db");

const router = express.Router();

const COLUMNS = [
  "id", "date", "time_of_day", "type", "duration_min", "total_duration_min", "distance_km",
  "avg_hr", "max_hr", "avg_power", "max_power", "weighted_avg_power", "avg_cadence", "max_cadence",
  "elevation_gain_m", "elevation_loss_m", "pace", "calories", "notes", "profile_json", "source",
];

function toRow(entry, source) {
  return {
    id: entry.id,
    date: entry.date,
    time_of_day: entry.timeOfDay || null,
    type: entry.type,
    duration_min: entry.duration_min ?? null,
    total_duration_min: entry.total_duration_min ?? null,
    distance_km: entry.distance_km ?? null,
    avg_hr: entry.avg_hr ?? null,
    max_hr: entry.max_hr ?? null,
    avg_power: entry.avg_power ?? null,
    max_power: entry.max_power ?? null,
    weighted_avg_power: entry.weighted_avg_power ?? null,
    avg_cadence: entry.avg_cadence ?? null,
    max_cadence: entry.max_cadence ?? null,
    elevation_gain_m: entry.elevation_gain_m ?? null,
    elevation_loss_m: entry.elevation_loss_m ?? null,
    pace: entry.pace ?? null,
    calories: entry.calories ?? null,
    notes: entry.notes ?? null,
    profile_json: entry.profile ? JSON.stringify(entry.profile) : null,
    source: source || entry.source || "manual",
  };
}

function serialize(row) {
  return {
    id: row.id,
    date: row.date,
    timeOfDay: row.time_of_day,
    type: row.type,
    duration_min: row.duration_min,
    total_duration_min: row.total_duration_min,
    distance_km: row.distance_km,
    avg_hr: row.avg_hr,
    max_hr: row.max_hr,
    avg_power: row.avg_power,
    max_power: row.max_power,
    weighted_avg_power: row.weighted_avg_power,
    avg_cadence: row.avg_cadence,
    max_cadence: row.max_cadence,
    elevation_gain_m: row.elevation_gain_m,
    elevation_loss_m: row.elevation_loss_m,
    pace: row.pace,
    calories: row.calories,
    notes: row.notes,
    profile: row.profile_json ? JSON.parse(row.profile_json) : null,
    source: row.source,
  };
}

/**
 * The same session without its intra-session profile.
 *
 * The profile is a per-bucket trace of heart rate, speed, power, cadence and
 * elevation. It is only ever shown for one session at a time — when you expand
 * a row, or open the detail panel — but the list endpoint was sending it for
 * every session. At 493 logged rides that turned a 175 KB response into 2.9 MB,
 * downloaded on every single app start, over wifi, from a Raspberry Pi.
 *
 * Callers get `hasProfile` so the chart button can still be shown, and fetch
 * the trace itself only when it is actually going to be drawn.
 */
function serializeForList(row) {
  const { profile, ...rest } = serialize(row);
  return { ...rest, hasProfile: !!profile && profile.length > 0 };
}

const insertStmt = db.prepare(
  `INSERT INTO cardio_logs (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map(() => "?").join(", ")})`
);

function insertOne(entry, source) {
  const row = toRow(entry, source);
  insertStmt.run(...COLUMNS.map((c) => row[c]));
}

// GET /api/cardio-logs
router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM cardio_logs ORDER BY date DESC, created_at DESC").all();
  res.json(rows.map(serializeForList));
});

// GET /api/cardio-logs/:id/profile - the intra-session trace for one session,
// fetched when a row is expanded rather than shipped with the whole list.
router.get("/:id/profile", (req, res) => {
  const row = db.prepare("SELECT profile_json FROM cardio_logs WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Sessie niet gevonden" });
  res.json({ profile: row.profile_json ? JSON.parse(row.profile_json) : null });
});

// POST /api/cardio-logs - single entry (manual form or single GPX upload)
router.post("/", (req, res) => {
  try {
    insertOne(req.body, req.body.source);
    res.status(201).json(serialize(db.prepare("SELECT * FROM cardio_logs WHERE id = ?").get(req.body.id)));
  } catch (err) {
    res.status(500).json({ error: "Kon cardiosessie niet opslaan", details: err.message });
  }
});

// POST /api/cardio-logs/bulk - array of entries (CSV import or multi-file GPX batch)
router.post("/bulk", (req, res) => {
  const entries = req.body.entries || [];
  const source = req.body.source || "manual";
  const insertMany = db.transaction((items) => {
    items.forEach((entry) => insertOne(entry, source));
  });
  try {
    insertMany(entries);
    res.status(201).json({ inserted: entries.length });
  } catch (err) {
    res.status(500).json({ error: "Kon sessies niet in bulk opslaan", details: err.message });
  }
});

// DELETE /api/cardio-logs/:id
router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM cardio_logs WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

module.exports = { router, serialize, serializeForList };
