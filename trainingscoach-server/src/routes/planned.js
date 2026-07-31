"use strict";

/**
 * Planned sessions: the coach's cardio proposals, tracked so you can see
 * whether you actually did them.
 *
 * Matching a plan to a real session is done by date + type rather than asking
 * the athlete to tick boxes: the data is already there, so making someone
 * confirm it twice is busywork. Manual override stays possible.
 */

const express = require("express");
const { db } = require("../db/db");
const calc = require("../lib/calculations");

const router = express.Router();

function serialize(row) {
  return {
    id: row.id,
    date: row.date,
    weekday: row.weekday,
    type: row.type,
    description: row.description,
    sourceCoachEntryId: row.source_coach_entry_id,
    completedCardioLogId: row.completed_cardio_log_id,
    status: row.status,
    durationMin: row.duration_min,
    intensity: row.intensity,
  };
}

/**
 * Resolves the coach's day reference ("Woensdag", "woensdag 23 juli") to a
 * concrete upcoming date. The coach is told to prefer weekday names precisely
 * because it can't reliably do calendar arithmetic, so we do it here.
 */
function resolveDate(dayText, fromDate = calc.todayStr()) {
  if (!dayText) return null;
  const text = String(dayText).toLowerCase();

  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];

  const weekdayIndex = calc.WEEKDAYS.findIndex((w) => text.includes(w.toLowerCase()));
  if (weekdayIndex === -1) return null;

  const start = new Date(fromDate + "T00:00:00");
  const startIndex = (start.getDay() + 6) % 7; // 0 = Monday
  let delta = weekdayIndex - startIndex;
  if (delta < 0) delta += 7; // always the next occurrence, today included
  const target = new Date(start);
  target.setDate(target.getDate() + delta);
  return target.toISOString().slice(0, 10);
}

/**
 * Looks for a logged cardio session that plausibly fulfils a plan: same day,
 * same sport. Returns the session id, or null.
 */
function findCompletion(plan) {
  const row = db
    .prepare("SELECT id FROM cardio_logs WHERE date = ? AND type = ? LIMIT 1")
    .get(plan.date, plan.type);
  return row?.id ?? null;
}

/** Refreshes completion status for all plans that aren't resolved yet. */
function refreshCompletions() {
  const open = db.prepare("SELECT * FROM planned_sessions WHERE status = 'gepland'").all();
  const today = calc.todayStr();
  const update = db.prepare(
    "UPDATE planned_sessions SET completed_cardio_log_id = ?, status = ? WHERE id = ?"
  );
  open.forEach((plan) => {
    const completedId = findCompletion(plan);
    if (completedId) {
      update.run(completedId, "gedaan", plan.id);
    } else if (plan.date < today) {
      // Only mark as missed once the day has actually passed.
      update.run(null, "overgeslagen", plan.id);
    }
  });
}

// GET /api/planned?weeks=4
router.get("/", (req, res) => {
  refreshCompletions();
  const weeks = Math.min(Number(req.query.weeks) || 4, 26);
  const from = new Date();
  from.setDate(from.getDate() - weeks * 7);
  const rows = db
    .prepare("SELECT * FROM planned_sessions WHERE date >= ? ORDER BY date")
    .all(from.toISOString().slice(0, 10));

  const plans = rows.map(serialize);
  const done = plans.filter((p) => p.status === "gedaan").length;
  const missed = plans.filter((p) => p.status === "overgeslagen").length;
  const upcoming = plans.filter((p) => p.status === "gepland").length;

  res.json({
    plans,
    samenvatting: {
      totaal: plans.length,
      gedaan: done,
      overgeslagen: missed,
      gepland: upcoming,
      opvolgingPercentage: done + missed > 0 ? Math.round((done / (done + missed)) * 100) : null,
    },
  });
});

/**
 * POST /api/planned/from-coach  { coachEntryId }
 *
 * Turns a coach answer's cardioVoorstel into PROPOSED sessions rather than
 * committed ones. Previously this wrote straight into the plan, so asking the
 * coach twice left you with two overlapping weeks. Now new advice supersedes
 * older advice you hadn't acted on, and anything you already accepted is
 * flagged as a conflict for you to resolve instead of being silently
 * duplicated or overwritten.
 */
router.post("/from-coach", (req, res) => {
  const { coachEntryId } = req.body;
  const entry = db.prepare("SELECT * FROM coach_history WHERE id = ?").get(coachEntryId);
  if (!entry) return res.status(404).json({ error: "Coachantwoord niet gevonden." });
  if (!entry.cardio_voorstel_json) return res.status(400).json({ error: "Dit antwoord bevat geen cardiovoorstel." });

  const proposals = JSON.parse(entry.cardio_voorstel_json);

  // Older proposals you never acted on are superseded by this newer advice.
  // Accepted plans ('gepland') and history are left alone.
  db.prepare("DELETE FROM planned_sessions WHERE status = 'voorgesteld'").run();

  const insert = db.prepare(
    `INSERT INTO planned_sessions (id, date, weekday, type, description, source_coach_entry_id, status)
     VALUES (?, ?, ?, ?, ?, ?, 'voorgesteld')`
  );
  const findConflict = db.prepare(
    "SELECT * FROM planned_sessions WHERE date = ? AND status = 'gepland'"
  );

  const created = [];
  const skipped = [];
  proposals.forEach((p, i) => {
    const date = resolveDate(p.dag);
    if (!date) {
      skipped.push({ dag: p.dag, reden: "kon er geen datum van maken" });
      return;
    }
    const id = `plan-${coachEntryId}-${i}`;
    insert.run(id, date, p.dag || null, p.type || "Anders", p.invulling || "", coachEntryId);
    const conflict = findConflict.get(date);
    created.push({
      id,
      date,
      type: p.type,
      description: p.invulling,
      conflictMet: conflict ? { id: conflict.id, type: conflict.type, description: conflict.description } : null,
    });
  });

  res.status(201).json({
    created,
    skipped,
    conflicten: created.filter((c) => c.conflictMet).length,
  });
});

/**
 * POST /api/planned/:id/accept  { replaceConflicting?: boolean }
 * Promotes a proposal to a real plan.
 */
router.post("/:id/accept", (req, res) => {
  const plan = db.prepare("SELECT * FROM planned_sessions WHERE id = ?").get(req.params.id);
  if (!plan) return res.status(404).json({ error: "Voorstel niet gevonden." });

  if (req.body?.replaceConflicting) {
    db.prepare("DELETE FROM planned_sessions WHERE date = ? AND status = 'gepland' AND id != ?")
      .run(plan.date, plan.id);
  }
  db.prepare("UPDATE planned_sessions SET status = 'gepland' WHERE id = ?").run(plan.id);
  refreshCompletions();
  res.json({ ok: true });
});

/** POST /api/planned/accept-all - accept every outstanding proposal at once. */
router.post("/accept-all", (req, res) => {
  const proposals = db.prepare("SELECT * FROM planned_sessions WHERE status = 'voorgesteld'").all();
  const replace = !!req.body?.replaceConflicting;
  const run = db.transaction(() => {
    proposals.forEach((p) => {
      if (replace) {
        db.prepare("DELETE FROM planned_sessions WHERE date = ? AND status = 'gepland' AND id != ?")
          .run(p.date, p.id);
      }
      db.prepare("UPDATE planned_sessions SET status = 'gepland' WHERE id = ?").run(p.id);
    });
  });
  run();
  refreshCompletions();
  res.json({ geaccepteerd: proposals.length });
});

/** POST /api/planned - add a session yourself, without going via the coach. */
router.post("/", (req, res) => {
  const { date, type, description, durationMin, intensity } = req.body || {};
  if (!date || !type) return res.status(400).json({ error: "Datum en type zijn verplicht." });
  const id = `plan-manual-${Date.now()}`;
  db.prepare(
    `INSERT INTO planned_sessions (id, date, weekday, type, description, duration_min, intensity, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'gepland')`
  ).run(id, date, calc.weekdayNameForDate(date), type, description || "", durationMin ?? null, intensity ?? null);
  refreshCompletions();
  res.status(201).json({ id });
});

// PATCH /api/planned/:id  { status }  - manual override
router.patch("/:id", (req, res) => {
  const { status } = req.body;
  if (!["voorgesteld", "gepland", "gedaan", "overgeslagen"].includes(status)) {
    return res.status(400).json({ error: "Ongeldige status." });
  }
  db.prepare("UPDATE planned_sessions SET status = ? WHERE id = ?").run(status, req.params.id);
  res.json({ ok: true });
});

// DELETE /api/planned/:id
router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM planned_sessions WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

/**
 * Upcoming committed sessions, for the coach payload — so new advice can build
 * on the existing plan instead of proposing a fresh week over the top of it.
 */
function getUpcomingPlan(days = 14) {
  const today = calc.todayStr();
  const until = new Date();
  until.setDate(until.getDate() + days);
  return db
    .prepare(
      "SELECT * FROM planned_sessions WHERE status = 'gepland' AND date >= ? AND date <= ? ORDER BY date"
    )
    .all(today, until.toISOString().slice(0, 10))
    .map(serialize);
}

module.exports = { router, resolveDate, refreshCompletions, getUpcomingPlan };
