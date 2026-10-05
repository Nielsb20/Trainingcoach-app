"use strict";

const express = require("express");
const { db } = require("../db/db");
const { validateCardioEntry, validateCardioBulk, validateSubType, validateSurface } = require("../lib/validate");

const router = express.Router();

const COLUMNS = [
  "id", "date", "time_of_day", "type", "sub_type", "surface", "duration_min", "total_duration_min", "distance_km",
  "avg_hr", "max_hr", "avg_power", "max_power", "weighted_avg_power", "avg_cadence", "max_cadence",
  "elevation_gain_m", "elevation_loss_m", "pace", "calories", "notes", "profile_json", "source",
];

function toRow(entry, source) {
  return {
    id: entry.id,
    date: entry.date,
    time_of_day: entry.timeOfDay || null,
    type: entry.type,
    sub_type: entry.sub_type ?? entry.subType ?? null,
    surface: entry.surface ?? null,
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
    subType: row.sub_type,
    surface: row.surface,
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
    validateCardioEntry(req.body);
    insertOne(req.body, req.body.source);
    res.status(201).json(serialize(db.prepare("SELECT * FROM cardio_logs WHERE id = ?").get(req.body.id)));
  } catch (err) {
    // Een afgewezen invoer is geen serverfout: 400 met wat er mis is, zodat de
    // interface het kan tonen in plaats van "er ging iets mis".
    res.status(err.status === 400 ? 400 : 500).json({
      error: err.status === 400 ? err.message : "Kon cardiosessie niet opslaan",
      details: err.status === 400 ? undefined : err.message,
    });
  }
});

/**
 * PATCH /api/cardio-logs/:id/ondersoort — welke fiets het was.
 *
 * Bestaat omdat de import het vaak niet weet: Strava's kale "Ride" zegt niets
 * over de ondergrond, en jaren geschiedenis zijn zo geïmporteerd. Zonder deze
 * route zou het label alleen op nieuwe ritten zitten en nooit op de ritten
 * waar je het aan wil kunnen zien.
 *
 * Alleen dit ene veld: de rest van een sessie is gemeten, en gemeten waarden
 * hoor je niet achteraf bij te stellen.
 */
router.patch("/:id/ondersoort", (req, res) => {
  const row = db.prepare("SELECT id, type FROM cardio_logs WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Sessie niet gevonden" });

  // Twee onafhankelijke velden, allebei optioneel. Wat niet in het verzoek
  // staat blijft wat het was: een rit waarvan je alleen de ondergrond
  // bijstelt hoort zijn fiets te houden.
  const heeftFiets = "subType" in (req.body || {}) || "sub_type" in (req.body || {});
  const heeftOndergrond = "surface" in (req.body || {});
  const subType = req.body?.subType ?? req.body?.sub_type ?? null;
  const surface = req.body?.surface ?? null;

  try {
    if (heeftFiets) validateSubType(subType, row.type);
    if (heeftOndergrond) validateSurface(surface, row.type);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (heeftFiets) db.prepare("UPDATE cardio_logs SET sub_type = ? WHERE id = ?").run(subType || null, row.id);
  if (heeftOndergrond) db.prepare("UPDATE cardio_logs SET surface = ? WHERE id = ?").run(surface || null, row.id);
  res.json(serialize(db.prepare("SELECT * FROM cardio_logs WHERE id = ?").get(row.id)));
});

// POST /api/cardio-logs/bulk - array of entries (CSV import or multi-file GPX batch)
router.post("/bulk", (req, res) => {
  const entries = req.body.entries || [];
  const source = req.body.source || "manual";
  const insertMany = db.transaction((items) => {
    items.forEach((entry) => insertOne(entry, source));
  });
  try {
    // Vóór de transactie: één slechte rij halverwege een import van duizend
    // sessies moet niet de helft geïmporteerd achterlaten.
    validateCardioBulk(entries);
    insertMany(entries);
    res.status(201).json({ inserted: entries.length });
  } catch (err) {
    res.status(err.status === 400 ? 400 : 500).json({
      error: err.status === 400 ? err.message : "Kon sessies niet in bulk opslaan",
      details: err.status === 400 ? undefined : err.message,
    });
  }
});

/**
 * DELETE /api/cardio-logs/:id
 *
 * De rit weghalen betekent ook: de geplande sessie die erdoor was afgevinkt
 * staat weer open. Dat gebeurde niet, waardoor die sessie op "gedaan" bleef
 * staan met een rit die niet meer bestond — een vinkje zonder dekking, dat
 * bovendien meetelde in je opvolgingspercentage.
 *
 * Na het loskoppelen draait de controleronde opnieuw: misschien is er die dag
 * nog een andere rit die de sessie alsnog invult, en anders komt hij netjes
 * als overgeslagen terug.
 */
router.delete("/:id", (req, res) => {
  const { refreshCompletions } = require("./planned");
  const remove = db.transaction(() => {
    db.prepare("UPDATE planned_sessions SET completed_cardio_log_id = NULL, status = 'gepland' WHERE completed_cardio_log_id = ?")
      .run(req.params.id);
    db.prepare("DELETE FROM cardio_logs WHERE id = ?").run(req.params.id);
  });
  remove();
  refreshCompletions();
  res.status(204).end();
});

module.exports = { router, serialize, serializeForList };
