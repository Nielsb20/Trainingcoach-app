"use strict";

const express = require("express");
const { db } = require("../db/db");

const router = express.Router();

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
    exercises: exercises
      .filter((e) => e.day_id === d.id)
      .map((e) => ({ id: e.id, name: e.name, targetSets: e.target_sets, targetReps: e.target_reps })),
  }));

  return {
    days: daysWithExercises,
    cardioDays: cardioDays.map((c) => ({ id: c.id, weekday: c.weekday, type: c.type, notes: c.notes, timeOfDay: c.time_of_day })),
    profile: { maxHr: profileRow.max_hr, restingHr: profileRow.resting_hr, ftp: profileRow.ftp },
  };
}

// GET /api/schema - full schema (days, exercises, cardio days, profile)
router.get("/", (req, res) => {
  res.json(getFullSchema());
});

// PUT /api/schema - replace the whole schema in one call (mirrors how the
// frontend edits it locally then saves the whole object at once)
router.put("/", (req, res) => {
  const { days = [], cardioDays = [], profile = {} } = req.body;

  const replaceAll = db.transaction(() => {
    db.prepare("DELETE FROM schema_exercises").run();
    db.prepare("DELETE FROM schema_days").run();
    db.prepare("DELETE FROM schema_cardio_days").run();

    const insertDay = db.prepare("INSERT INTO schema_days (id, name, sort_order, weekdays, time_of_day) VALUES (?, ?, ?, ?, ?)");
    const insertExercise = db.prepare(
      "INSERT INTO schema_exercises (id, day_id, name, target_sets, target_reps, sort_order) VALUES (?, ?, ?, ?, ?, ?)"
    );
    days.forEach((day, dayIdx) => {
      insertDay.run(day.id, day.name, dayIdx, (day.weekdays || []).join(",") || null, day.timeOfDay || null);
      (day.exercises || []).forEach((ex, exIdx) => {
        insertExercise.run(ex.id, day.id, ex.name, ex.targetSets || 3, ex.targetReps || 8, exIdx);
      });
    });

    const insertCardioDay = db.prepare("INSERT INTO schema_cardio_days (id, weekday, type, notes, time_of_day) VALUES (?, ?, ?, ?, ?)");
    cardioDays.forEach((c) => insertCardioDay.run(c.id, c.weekday, c.type, c.notes || null, c.timeOfDay || null));

    db.prepare("UPDATE profile SET max_hr = ?, resting_hr = ?, ftp = ? WHERE id = 1").run(
      profile.maxHr ?? null,
      profile.restingHr ?? null,
      profile.ftp ?? null
    );
  });

  try {
    replaceAll();
    res.json(getFullSchema());
  } catch (err) {
    res.status(500).json({ error: "Kon schema niet opslaan", details: err.message });
  }
});

module.exports = { router, getFullSchema };
