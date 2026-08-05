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

/**
 * Replaces a logged session in place.
 *
 * The row id is deliberately the caller-supplied one and is never taken from
 * the body: planned_sessions.completed_cardio_log_id points at workout_logs.id
 * for strength sessions, so re-creating the log under a new id would silently
 * detach it from the plan it completed. Correcting a typo in a rep count must
 * not undo "afgerond" in the planner.
 *
 * Throws an Error carrying a `status` so the route can map it to a response
 * without the caller having to know about HTTP.
 */
function replaceWorkoutLog(id, entry) {
  const existing = db.prepare("SELECT id FROM workout_logs WHERE id = ?").get(id);
  if (!existing) {
    const err = new Error("Training niet gevonden");
    err.status = 404;
    throw err;
  }

  const exercises = (entry.exercises || []).filter((ex) => (ex.sets || []).length > 0);
  if (exercises.length === 0) {
    // Saving an empty session would wipe the log while leaving an orphan row
    // behind; deleting is a separate, explicit action.
    const err = new Error("Een training moet minstens één set bevatten.");
    err.status = 400;
    throw err;
  }

  const update = db.transaction(() => {
    db.prepare(
      "UPDATE workout_logs SET date = ?, time_of_day = ?, day_id = ?, day_name = ?, notes = ?, rpe = ?, duration_min = ? WHERE id = ?"
    ).run(entry.date, entry.timeOfDay || null, entry.dayId || null, entry.dayName || null,
          entry.notes || null, entry.rpe ?? null, entry.durationMin ?? null, id);

    // Rewrite the children wholesale rather than diffing set by set: sets have
    // no stable identity of their own, so a diff would be guesswork.
    db.prepare("DELETE FROM workout_log_exercises WHERE workout_log_id = ?").run(id); // cascades to sets

    const insertExercise = db.prepare(
      "INSERT INTO workout_log_exercises (id, workout_log_id, name, sort_order) VALUES (?, ?, ?, ?)"
    );
    const insertSet = db.prepare("INSERT INTO workout_log_sets (exercise_id, weight, reps, sort_order) VALUES (?, ?, ?, ?)");

    exercises.forEach((ex, exIdx) => {
      const exerciseRowId = `${id}-ex${exIdx}`;
      insertExercise.run(exerciseRowId, id, ex.name, exIdx);
      (ex.sets || []).forEach((s, setIdx) => insertSet.run(exerciseRowId, s.weight, s.reps, setIdx));
    });
  });

  update();
  return serializeWorkoutLog(db.prepare("SELECT * FROM workout_logs WHERE id = ?").get(id));
}

// PUT /api/workout-logs/:id
router.put("/:id", (req, res) => {
  try {
    res.json(replaceWorkoutLog(req.params.id, req.body));
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      error: status === 500 ? `Kon training niet bijwerken: ${err.message}` : err.message,
    });
  }
});

// DELETE /api/workout-logs/:id
router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM workout_logs WHERE id = ?").run(req.params.id); // cascades to exercises/sets
  res.status(204).end();
});

module.exports = { router, serializeWorkoutLog, replaceWorkoutLog };
