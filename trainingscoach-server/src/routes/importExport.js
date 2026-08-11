"use strict";

const express = require("express");
const { db } = require("../db/db");

const router = express.Router();

// GET /api/export - full backup, same shape as the "Exporteer alles (JSON)"
// button in the artifact prototype, so a file exported there can be
// re-imported here with zero conversion.
router.get("/export", (req, res) => {
  const calc = require("../lib/calculations");
  const { buildBackup } = require("../lib/backup");

  res.setHeader(
    "Content-Disposition",
    `attachment; filename="trainingscoach-backup-${calc.todayStr()}.json"`
  );
  res.json(buildBackup());
});

// GET /api/backups - which automatic snapshots exist on disk. Surfaced in the
// interface so "is this thing actually backing up?" has a visible answer rather
// than requiring an SSH session to find out.
router.get("/backups", (req, res) => {
  const { listBackups, KEEP_BACKUPS } = require("../lib/backup");
  const backups = listBackups();
  res.json({
    backups,
    bewaartermijnDagen: KEEP_BACKUPS,
    laatste: backups[0] || null,
  });
});

// POST /api/import - restore from a backup file (from this server OR from
// the original Claude-artifact prototype's "Exporteer alles (JSON)" export)
router.post("/import", (req, res) => {
  const data = req.body;
  const { router: schemaRouter } = require("./schema"); // ensures module is loaded

  const restore = db.transaction(() => {
    db.exec("DELETE FROM workout_log_sets; DELETE FROM workout_log_exercises; DELETE FROM workout_logs;");
    db.exec("DELETE FROM cardio_logs; DELETE FROM weight_logs; DELETE FROM events; DELETE FROM coach_history;");
    db.exec("DELETE FROM schema_exercises; DELETE FROM schema_days; DELETE FROM schema_cardio_days;");
    db.exec("DELETE FROM schema_proposals;");

    const s = data.schema || { days: [], cardioDays: [], profile: {} };
    const insertDay = db.prepare("INSERT INTO schema_days (id, name, sort_order, weekdays, time_of_day) VALUES (?, ?, ?, ?, ?)");
    const insertExercise = db.prepare(
      "INSERT INTO schema_exercises (id, day_id, name, target_sets, target_reps, sort_order) VALUES (?, ?, ?, ?, ?, ?)"
    );
    (s.days || []).forEach((day, dayIdx) => {
      insertDay.run(day.id, day.name, dayIdx, (day.weekdays || []).join(",") || null, day.timeOfDay || null);
      (day.exercises || []).forEach((ex, exIdx) =>
        insertExercise.run(ex.id, day.id, ex.name, ex.targetSets || 3, ex.targetReps || 8, exIdx)
      );
    });
    const insertCardioDay = db.prepare("INSERT INTO schema_cardio_days (id, weekday, type, notes, time_of_day) VALUES (?, ?, ?, ?, ?)");
    (s.cardioDays || []).forEach((c) => insertCardioDay.run(c.id, c.weekday, c.type, c.notes || null, c.timeOfDay || null));
    db.prepare("UPDATE profile SET max_hr = ?, resting_hr = ?, ftp = ? WHERE id = 1").run(
      s.profile?.maxHr ?? null,
      s.profile?.restingHr ?? null,
      s.profile?.ftp ?? null
    );

    const insertWorkout = db.prepare(
      "INSERT INTO workout_logs (id, date, time_of_day, day_id, day_name, notes) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const insertWorkoutExercise = db.prepare(
      "INSERT INTO workout_log_exercises (id, workout_log_id, name, sort_order) VALUES (?, ?, ?, ?)"
    );
    const insertWorkoutSet = db.prepare("INSERT INTO workout_log_sets (exercise_id, weight, reps, sort_order) VALUES (?, ?, ?, ?)");
    (data.workoutLogs || []).forEach((l) => {
      insertWorkout.run(l.id, l.date, l.timeOfDay || null, l.dayId || null, l.dayName || null, l.notes || null);
      (l.exercises || []).forEach((ex, exIdx) => {
        // Derived from the log, not from ex.exerciseId: that id belongs to the
        // schema and repeats across sessions, which would collide here.
        const exId = `${l.id}-ex${exIdx}`;
        insertWorkoutExercise.run(exId, l.id, ex.name, exIdx);
        (ex.sets || []).forEach((set, setIdx) => insertWorkoutSet.run(exId, set.weight, set.reps, setIdx));
      });
    });

    const cardioCols = [
      "id", "date", "time_of_day", "type", "duration_min", "total_duration_min", "distance_km",
      "avg_hr", "max_hr", "avg_power", "max_power", "weighted_avg_power", "avg_cadence", "max_cadence",
      "elevation_gain_m", "elevation_loss_m", "pace", "calories", "notes", "profile_json", "source",
    ];
    const insertCardio = db.prepare(`INSERT INTO cardio_logs (${cardioCols.join(", ")}) VALUES (${cardioCols.map(() => "?").join(", ")})`);
    (data.cardioLogs || []).forEach((c) => {
      insertCardio.run(
        c.id, c.date, c.timeOfDay || null, c.type, c.duration_min ?? null, c.total_duration_min ?? null, c.distance_km ?? null,
        c.avg_hr ?? null, c.max_hr ?? null, c.avg_power ?? null, c.max_power ?? null, c.weighted_avg_power ?? null,
        c.avg_cadence ?? null, c.max_cadence ?? null, c.elevation_gain_m ?? null, c.elevation_loss_m ?? null,
        c.pace ?? null, c.calories ?? null, c.notes ?? null, c.profile ? JSON.stringify(c.profile) : null, c.source || "import"
      );
    });

    const insertWeight = db.prepare("INSERT INTO weight_logs (id, date, weight_kg, body_fat_pct, notes) VALUES (?, ?, ?, ?, ?)");
    (data.weightLogs || []).forEach((w) => insertWeight.run(w.id, w.date, w.weight_kg, w.body_fat_pct ?? null, w.notes ?? null));

    const insertEvent = db.prepare("INSERT INTO events (id, name, date, type, target, notes) VALUES (?, ?, ?, ?, ?, ?)");
    (data.events || []).forEach((e) => insertEvent.run(e.id, e.name, e.date, e.type ?? null, e.target ?? null, e.notes ?? null));

    // Goals and schema proposals only exist in backups written by a version
    // that has them, so an older export simply leaves them alone rather than
    // blanking what is already there.
    if (data.trainingGoals) {
      const g = data.trainingGoals;
      db.prepare(
        `UPDATE training_goals SET
           goal = ?, focus = ?, strength_days_per_week = ?, cardio_days_per_week = ?,
           session_minutes = ?, available_weekdays = ?, equipment = ?, experience = ?,
           limitations = ?, notes = ?, updated_at = ?
         WHERE id = 1`
      ).run(
        g.goal ?? null,
        g.focus ?? null,
        g.strengthDaysPerWeek ?? null,
        g.cardioDaysPerWeek ?? null,
        g.sessionMinutes ?? null,
        Array.isArray(g.availableWeekdays) ? g.availableWeekdays.join(",") || null : (g.availableWeekdays ?? null),
        g.equipment ?? null,
        g.experience ?? null,
        g.limitations ?? null,
        g.notes ?? null,
        g.updatedAt ?? null
      );
    }

    const proposalCols = [
      "id", "date", "status", "question", "goals_json", "proposal_json", "toelichting",
      "opbouw_json", "waarschuwing", "raw_feedback", "decline_reason", "applied_at", "previous_schema_json",
      "correcties_json",
    ];
    const insertProposal = db.prepare(
      `INSERT INTO schema_proposals (${proposalCols.join(", ")}) VALUES (${proposalCols.map(() => "?").join(", ")})`
    );
    (data.schemaProposals || []).forEach((p) => insertProposal.run(...proposalCols.map((c) => p[c] ?? null)));

    const insertCoach = db.prepare(
      "INSERT INTO coach_history (id, date, question, analyse, tips_json, waarschuwing, cardio_voorstel_json, raw_feedback) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    (data.coachHistory || []).forEach((c) =>
      insertCoach.run(
        c.id, c.date, c.question ?? null, c.analyse ?? null,
        c.tips ? JSON.stringify(c.tips) : (c.tips_json ?? null),
        c.waarschuwing ?? null,
        c.cardioVoorstel ? JSON.stringify(c.cardioVoorstel) : (c.cardio_voorstel_json ?? null),
        c.feedback ?? c.rawFeedback ?? c.raw_feedback ?? null
      )
    );
  });

  try {
    restore();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Kon back-up niet herstellen", details: err.message });
  }
});

module.exports = router;
