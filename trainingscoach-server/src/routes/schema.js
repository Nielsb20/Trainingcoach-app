"use strict";

const express = require("express");
const { db } = require("../db/db");
const calc = require("../lib/calculations");

const router = express.Router();

/**
 * De gemeten rusthartslag naast de ingetikte.
 *
 * Read-only: hij wordt nergens automatisch overgenomen. De hartslagzones
 * verschuiven ermee, en zones onder je voeten laten wegschuiven omdat een
 * meting dat zei is precies het soort verandering dat de atleet zelf hoort te
 * accepteren. De interface zet de twee naast elkaar en biedt een knop.
 */
function getMeasuredRestingHr() {
  const rows = db
    .prepare("SELECT date, resting_hr FROM wellness_logs WHERE resting_hr IS NOT NULL ORDER BY date DESC LIMIT 400")
    .all();
  const baseline = calc.computeRestingHrBaseline(rows);
  if (!baseline) return null;
  // Waar de metingen vandaan komen bepaalt hoe je het getal moet lezen: uit de
  // slaap is het strikt genomen iets lager dan een rusthartslag die je 's
  // ochtends zittend meet.
  const sources = db
    .prepare("SELECT DISTINCT source FROM wellness_logs WHERE resting_hr IS NOT NULL ORDER BY date DESC LIMIT 5")
    .all()
    .map((r) => r.source);
  return { ...baseline, bronnen: sources };
}

function getFullSchema() {
  const days = db.prepare("SELECT * FROM schema_days ORDER BY sort_order").all();
  const exercises = db.prepare("SELECT * FROM schema_exercises ORDER BY sort_order").all();
  const cardioDays = db.prepare("SELECT * FROM schema_cardio_days").all();
  const profileRow = db.prepare("SELECT * FROM profile WHERE id = 1").get();

  const daysWithExercises = days.map((d) => ({
    id: d.id,
    name: d.name,
    weekdays: d.weekdays ? d.weekdays.split(",").filter(Boolean) : [],
    timeOfDay: d.time_of_day,
    locked: !!d.locked,
    exercises: exercises
      .filter((e) => e.day_id === d.id)
      .map((e) => ({ id: e.id, name: e.name, targetSets: e.target_sets, targetReps: e.target_reps })),
  }));

  return {
    days: daysWithExercises,
    cardioDays: cardioDays.map((c) => ({
      id: c.id, weekday: c.weekday, type: c.type, notes: c.notes, timeOfDay: c.time_of_day, locked: !!c.locked,
    })),
    profile: {
      maxHr: profileRow.max_hr,
      restingHr: profileRow.resting_hr,
      ftp: profileRow.ftp,
      thresholdPaceSecPerKm: profileRow.threshold_pace_sec_per_km,
      restingHrGemeten: getMeasuredRestingHr(),
    },
  };
}

/**
 * Replaces the whole schema in one transaction.
 *
 * Shared with the coach's schema proposals rather than living inside the PUT
 * handler: accepting a proposal is the same write, and two copies of it would
 * drift the moment a column is added to either table.
 */
function replaceSchema({ days = [], cardioDays = [], profile = {} }) {
  const replaceAll = db.transaction(() => {
    db.prepare("DELETE FROM schema_exercises").run();
    db.prepare("DELETE FROM schema_days").run();
    db.prepare("DELETE FROM schema_cardio_days").run();

    const insertDay = db.prepare(
      "INSERT INTO schema_days (id, name, sort_order, weekdays, time_of_day, locked) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const insertExercise = db.prepare(
      "INSERT INTO schema_exercises (id, day_id, name, target_sets, target_reps, sort_order) VALUES (?, ?, ?, ?, ?, ?)"
    );
    days.forEach((day, dayIdx) => {
      insertDay.run(day.id, day.name, dayIdx, (day.weekdays || []).join(",") || null, day.timeOfDay || null, day.locked ? 1 : 0);
      (day.exercises || []).forEach((ex, exIdx) => {
        insertExercise.run(ex.id, day.id, ex.name, ex.targetSets || 3, ex.targetReps || 8, exIdx);
      });
    });

    const insertCardioDay = db.prepare(
      "INSERT INTO schema_cardio_days (id, weekday, type, notes, time_of_day, locked) VALUES (?, ?, ?, ?, ?, ?)"
    );
    cardioDays.forEach((c) =>
      insertCardioDay.run(c.id, c.weekday, c.type, c.notes || null, c.timeOfDay || null, c.locked ? 1 : 0)
    );

    db.prepare(
      "UPDATE profile SET max_hr = ?, resting_hr = ?, ftp = ?, threshold_pace_sec_per_km = ? WHERE id = 1"
    ).run(
      profile.maxHr ?? null,
      profile.restingHr ?? null,
      profile.ftp ?? null,
      profile.thresholdPaceSecPerKm ?? null
    );
  });

  replaceAll();
  return getFullSchema();
}

// GET /api/schema - full schema (days, exercises, cardio days, profile)
router.get("/", (req, res) => {
  res.json(getFullSchema());
});

// PUT /api/schema - replace the whole schema in one call (mirrors how the
// frontend edits it locally then saves the whole object at once)
router.put("/", (req, res) => {
  try {
    res.json(replaceSchema(req.body || {}));
  } catch (err) {
    res.status(500).json({ error: "Kon schema niet opslaan", details: err.message });
  }
});

module.exports = { router, getFullSchema, replaceSchema };
