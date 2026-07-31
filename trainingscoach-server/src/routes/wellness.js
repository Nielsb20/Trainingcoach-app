"use strict";

/**
 * Daily wellness / recovery metrics: resting heart rate, HRV, sleep.
 *
 * Source-agnostic by design. The Garmin auto-fetch is the fragile part of this
 * feature (Garmin broke the unofficial auth ecosystem in March 2026), so
 * everything here works identically whether a row arrived automatically, via
 * a CSV export, or was typed in by hand. If the fetcher stops working, the
 * feature degrades to manual entry rather than disappearing.
 */

const express = require("express");
const { db } = require("../db/db");

const router = express.Router();

const FIELDS = [
  "resting_hr", "hrv_ms", "sleep_minutes", "sleep_score",
  "body_battery_max", "body_battery_min", "stress_avg", "notes",
];

function serialize(row) {
  return {
    date: row.date,
    restingHr: row.resting_hr,
    hrvMs: row.hrv_ms,
    sleepMinutes: row.sleep_minutes,
    sleepScore: row.sleep_score,
    bodyBatteryMax: row.body_battery_max,
    bodyBatteryMin: row.body_battery_min,
    stressAvg: row.stress_avg,
    notes: row.notes,
    source: row.source,
  };
}

function toRow(entry) {
  return {
    date: entry.date,
    resting_hr: entry.restingHr ?? null,
    hrv_ms: entry.hrvMs ?? null,
    sleep_minutes: entry.sleepMinutes ?? null,
    sleep_score: entry.sleepScore ?? null,
    body_battery_max: entry.bodyBatteryMax ?? null,
    body_battery_min: entry.bodyBatteryMin ?? null,
    stress_avg: entry.stressAvg ?? null,
    notes: entry.notes ?? null,
    source: entry.source || "manual",
  };
}

/**
 * Upsert on date. Deliberately only overwrites fields that carry a value, so
 * a partial update (e.g. a Garmin fetch that only returns sleep) doesn't wipe
 * a resting HR that was entered by hand.
 */
function upsertWellness(entry) {
  const row = toRow(entry);
  const existing = db.prepare("SELECT * FROM wellness_logs WHERE date = ?").get(row.date);

  if (!existing) {
    db.prepare(
      `INSERT INTO wellness_logs (date, ${FIELDS.join(", ")}, source)
       VALUES (?, ${FIELDS.map(() => "?").join(", ")}, ?)`
    ).run(row.date, ...FIELDS.map((f) => row[f]), row.source);
    return { created: true };
  }

  const merged = {};
  FIELDS.forEach((f) => {
    merged[f] = row[f] !== null && row[f] !== undefined ? row[f] : existing[f];
  });
  db.prepare(
    `UPDATE wellness_logs SET ${FIELDS.map((f) => `${f} = ?`).join(", ")},
     source = ?, updated_at = datetime('now') WHERE date = ?`
  ).run(...FIELDS.map((f) => merged[f]), row.source, row.date);
  return { updated: true };
}

// GET /api/wellness?days=90
router.get("/", (req, res) => {
  const days = Math.min(Number(req.query.days) || 90, 3650);
  const from = new Date();
  from.setDate(from.getDate() - days);
  const rows = db
    .prepare("SELECT * FROM wellness_logs WHERE date >= ? ORDER BY date")
    .all(from.toISOString().slice(0, 10));
  res.json(rows.map(serialize));
});

// POST /api/wellness  (single entry, upsert on date)
router.post("/", (req, res) => {
  if (!req.body?.date) return res.status(400).json({ error: "Datum is verplicht." });
  try {
    const result = upsertWellness(req.body);
    res.status(201).json({ ...result, entry: serialize(db.prepare("SELECT * FROM wellness_logs WHERE date = ?").get(req.body.date)) });
  } catch (err) {
    res.status(500).json({ error: "Kon niet opslaan", details: err.message });
  }
});

// POST /api/wellness/bulk  { entries: [...] }
router.post("/bulk", (req, res) => {
  const entries = req.body?.entries || [];
  const run = db.transaction((items) => items.forEach(upsertWellness));
  try {
    run(entries);
    res.status(201).json({ verwerkt: entries.length });
  } catch (err) {
    res.status(500).json({ error: "Bulk-opslag mislukt", details: err.message });
  }
});

// DELETE /api/wellness/:date
router.delete("/:date", (req, res) => {
  db.prepare("DELETE FROM wellness_logs WHERE date = ?").run(req.params.date);
  res.status(204).end();
});

module.exports = { router, upsertWellness, serialize };
