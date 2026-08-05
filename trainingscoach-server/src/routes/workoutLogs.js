"use strict";

const express = require("express");
const { db } = require("../db/db");

const router = express.Router();

function serializeWorkoutLog(row) {
  const exercises = db
    .prepare("SELECT * FROM workout_log_exercises WHERE workout_log_id = ? ORDER BY sort_order")
    .all(row.id)
    .map((ex) => ({
      exerciseId: ex.id,
      name: ex.name,
      sets: db
        .prepare("SELECT weight, reps FROM workout_log_sets WHERE exercise_id = ? ORDER BY sort_order")
        .all(ex.id),
    }));
  return {
    id: row.id,
    date: row.date,
    timeOfDay: row.time_of_day,
    dayId: row.day_id,
    dayName: row.day_name,
    notes: row.notes,
    rpe: row.rpe,
    durationMin: row.duration_min,
    exercises,
  };
}

// GET /api/workout-logs
router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM workout_logs ORDER BY date DESC, created_at DESC").all();
  res.json(rows.map(serializeWorkoutLog));
});

// POST /api/workout-logs
router.post("/", (req, res) => {
  const entry = req.body;
  const insert = db.transaction(() => {
    db.prepare(
      "INSERT INTO workout_logs (id, date, time_of_day, day_id, day_name, notes, rpe, duration_min) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(entry.id, entry.date, entry.timeOfDay || null, entry.dayId || null, entry.dayName || null,
          entry.notes || null, entry.rpe ?? null, entry.durationMin ?? null);

    const insertExercise = db.prepare(
      "INSERT INTO workout_log_exercises (id, workout_log_id, name, sort_order) VALUES (?, ?, ?, ?)"
    );
    const insertSet = db.prepare("INSERT INTO workout_log_sets (exercise_id, weight, reps, sort_order) VALUES (?, ?, ?, ?)");

    (entry.exercises || []).forEach((ex, exIdx) => {
      // Always derive the row id from this log, never from ex.exerciseId: that
      // one identifies the exercise in the *schema* and is identical for every
      // session, so reusing it made the second log of any training day fail on
      // a duplicate primary key.
      const exerciseRowId = `${entry.id}-ex${exIdx}`;
      insertExercise.run(exerciseRowId, entry.id, ex.name, exIdx);
      (ex.sets || []).forEach((s, setIdx) => insertSet.run(exerciseRowId, s.weight, s.reps, setIdx));
    });
  });

  try {
    insert();
    res.status(201).json(serializeWorkoutLog(db.prepare("SELECT * FROM workout_logs WHERE id = ?").get(entry.id)));
  } catch (err) {
    // Include the underlying reason: "kon niet opslaan" on its own leaves the
    // athlete with nothing to act on and nothing to report.
    res.status(500).json({ error: `Kon training niet opslaan: ${err.message}` });
  }
});

// DELETE /api/workout-logs/:id
router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM workout_logs WHERE id = ?").run(req.params.id); // cascades to exercises/sets
  res.status(204).end();
});

module.exports = { router, serializeWorkoutLog };
