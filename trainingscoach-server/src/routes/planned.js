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
    discipline: row.discipline || 'cardio',
    locked: !!row.locked,
    replacesId: row.replaces_id,
  };
}

const DUTCH_MONTHS = {
  jan: 0, feb: 1, mrt: 2, maa: 2, apr: 3, mei: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, okt: 9, nov: 10, dec: 11,
};

/**
 * Resolves the coach's day reference to a concrete date.
 *
 * Order matters here. An earlier version only looked at the weekday name and
 * took the next occurrence, which quietly collapsed "zaterdag 1 augustus" and
 * "zaterdag 8 augustus" onto the same day — turning a two-week plan into a
 * week of duplicates. So an explicit day-of-month always wins over the weekday
 * name; the weekday is only used when there's nothing more specific.
 *
 * Returns { date, warning } — warning is set when the coach's weekday and date
 * disagree, so the caller can surface that rather than silently picking one.
 */
function resolveDate(dayText, fromDate = calc.todayStr()) {
  if (!dayText) return null;
  const text = String(dayText).toLowerCase().trim();
  const today = new Date(fromDate + "T00:00:00");

  // 1. ISO date - unambiguous
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];

  // 2. Dutch "1 augustus" / "1 aug 2026" - the day number is the specific bit
  const dutch = text.match(/(\d{1,2})\s+([a-zé]+)\.?(?:\s+(\d{4}))?/i);
  if (dutch) {
    const month = DUTCH_MONTHS[dutch[2].slice(0, 3)];
    if (month !== undefined) {
      const day = Number(dutch[1]);
      let year = dutch[3] ? Number(dutch[3]) : today.getFullYear();
      let candidate = new Date(year, month, day);
      // No year given and the date already passed? The coach means next year
      // (planning "5 januari" in December).
      if (!dutch[3] && candidate < today) {
        candidate = new Date(year + 1, month, day);
      }
      return toIso(candidate);
    }
  }

  // 3. Weekday name only - next occurrence, today included
  const weekdayIndex = calc.WEEKDAYS.findIndex((w) => text.includes(w.toLowerCase()));
  if (weekdayIndex === -1) return null;
  const startIndex = (today.getDay() + 6) % 7; // 0 = Monday
  let delta = weekdayIndex - startIndex;
  if (delta < 0) delta += 7;
  const target = new Date(today);
  target.setDate(target.getDate() + delta);
  return toIso(target);
}

/** Local-date ISO string; toISOString() would shift across the UTC boundary. */
function toIso(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * True when the coach paired a weekday with a date that isn't that weekday.
 * We follow the date, but it's worth telling the user the advice was
 * internally inconsistent.
 */
function weekdayMismatch(dayText, resolvedDate) {
  if (!dayText || !resolvedDate) return null;
  const text = String(dayText).toLowerCase();
  const stated = calc.WEEKDAYS.find((w) => text.includes(w.toLowerCase()));
  if (!stated) return null;
  const actual = calc.weekdayNameForDate(resolvedDate);
  return stated === actual ? null : { genoemd: stated, werkelijk: actual };
}

/**
 * Looks for a logged cardio session that plausibly fulfils a plan: same day,
 * same sport. Returns the session id, or null.
 */
function findCompletion(plan) {
  if ((plan.discipline || "cardio") === "kracht") {
    // Any gym session that day fulfils the plan; insisting the schema day
    // matches exactly would mark a swapped A/B day as missed.
    const row = db.prepare("SELECT id FROM workout_logs WHERE date = ? LIMIT 1").get(plan.date);
    return row?.id ?? null;
  }
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

/**
 * GET /api/planned?from=YYYY-MM-DD&to=YYYY-MM-DD
 * (or ?weeks=4 for a trailing window, kept for convenience)
 *
 * An explicit range lets the planner page forwards — the coach happily plans
 * three weeks out, and a fixed two-week window would hide that.
 */
router.get("/", (req, res) => {
  refreshCompletions();

  let fromStr, toStr;
  if (req.query.from) {
    fromStr = req.query.from;
    toStr = req.query.to || null;
  } else {
    const weeks = Math.min(Number(req.query.weeks) || 4, 26);
    const from = new Date();
    from.setDate(from.getDate() - weeks * 7);
    fromStr = from.toISOString().slice(0, 10);
    toStr = null;
  }

  const rows = toStr
    ? db.prepare("SELECT * FROM planned_sessions WHERE date >= ? AND date <= ? ORDER BY date").all(fromStr, toStr)
    : db.prepare("SELECT * FROM planned_sessions WHERE date >= ? ORDER BY date").all(fromStr);

  const plans = rows.map(serialize);
  const done = plans.filter((p) => p.status === "gedaan").length;
  const missed = plans.filter((p) => p.status === "overgeslagen").length;
  const upcoming = plans.filter((p) => p.status === "gepland").length;

  // Strength sessions aren't planned here (they follow a fixed schema), but
  // they belong in the week view: a plan that hides half your training week
  // isn't much of a plan.
  const strength = (toStr
    ? db.prepare("SELECT id, date, day_name, rpe, duration_min FROM workout_logs WHERE date >= ? AND date <= ? ORDER BY date").all(fromStr, toStr)
    : db.prepare("SELECT id, date, day_name, rpe, duration_min FROM workout_logs WHERE date >= ? ORDER BY date").all(fromStr))
    .map((w) => ({
      id: w.id,
      date: w.date,
      dayName: w.day_name,
      rpe: w.rpe,
      durationMin: w.duration_min,
    }));

  res.json({
    plans,
    krachttrainingen: strength,
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
 * Turns a coach answer into proposals, classified by what they'd do to the
 * existing plan. The goal is a plan that stays stable unless there's a reason
 * to change it — an athlete shouldn't have their week rewritten every time
 * they ask a question.
 *
 *   nieuw     - the day was empty; pure addition
 *   wijziging - the day already had a session; shown side by side so you can
 *               compare rather than silently losing what you had
 *   (locked sessions are skipped entirely and never proposed over)
 */
router.post("/from-coach", (req, res) => {
  const { coachEntryId } = req.body;
  const entry = db.prepare("SELECT * FROM coach_history WHERE id = ?").get(coachEntryId);
  if (!entry) return res.status(404).json({ error: "Coachantwoord niet gevonden." });
  if (!entry.cardio_voorstel_json) return res.status(400).json({ error: "Dit antwoord bevat geen cardiovoorstel." });

  const cardioProposals = JSON.parse(entry.cardio_voorstel_json);
  const strengthProposals = entry.kracht_voorstel_json ? JSON.parse(entry.kracht_voorstel_json) : [];
  // One list, tagged by discipline, so the same conflict/lock rules apply to both.
  const proposals = [
    ...cardioProposals.map((p) => ({ ...p, discipline: "cardio", label: p.type })),
    ...strengthProposals.map((p) => ({ ...p, discipline: "kracht", label: p.schemaDag })),
  ];

  // Older proposals you never acted on are superseded by this newer advice.
  // Accepted plans, history and explicit declines are left alone.
  db.prepare("DELETE FROM planned_sessions WHERE status = 'voorgesteld'").run();

  const insert = db.prepare(
    `INSERT INTO planned_sessions
       (id, date, weekday, type, description, source_coach_entry_id, status, replaces_id, discipline)
     VALUES (?, ?, ?, ?, ?, ?, 'voorgesteld', ?, ?)`
  );
  // Conflicts are per discipline: a strength session and a ride on the same
  // day is a normal double day, not a clash.
  const existingOnDate = db.prepare(
    "SELECT * FROM planned_sessions WHERE date = ? AND status = 'gepland' AND discipline = ?"
  );

  const created = [];
  const skipped = [];
  const waarschuwingen = [];
  const usedDates = new Set();

  proposals.forEach((p, i) => {
    const date = resolveDate(p.dag);
    if (!date) {
      skipped.push({ dag: p.dag, reden: "kon er geen datum van maken" });
      return;
    }

    // Two proposals for the same discipline on one day means the advice was
    // ambiguous. Keep the first and flag it rather than stacking silently.
    const dateKey = `${date}|${p.discipline}`;
    if (usedDates.has(dateKey)) {
      skipped.push({ dag: p.dag, datum: date, reden: "er stond al een voorstel voor deze dag" });
      return;
    }
    usedDates.add(dateKey);

    const mismatch = weekdayMismatch(p.dag, date);
    if (mismatch) {
      waarschuwingen.push({
        dag: p.dag,
        datum: date,
        melding: `de coach noemde ${mismatch.genoemd}, maar ${date} is een ${mismatch.werkelijk} — de datum is aangehouden`,
      });
    }

    const existing = existingOnDate.get(date, p.discipline);

    if (existing && existing.locked) {
      skipped.push({ dag: p.dag, datum: date, reden: "deze dag staat vast en is overgeslagen" });
      return;
    }

    const id = `plan-${coachEntryId}-${i}`;
    insert.run(id, date, p.dag || null, p.label || "Anders", p.invulling || "", coachEntryId,
               existing ? existing.id : null, p.discipline);

    created.push({
      id,
      date,
      type: p.label,
      discipline: p.discipline,
      description: p.invulling,
      soort: existing ? "wijziging" : "nieuw",
      vervangt: existing
        ? { id: existing.id, type: existing.type, description: existing.description }
        : null,
    });
  });

  res.status(201).json({
    created,
    skipped,
    waarschuwingen,
    nieuw: created.filter((c) => c.soort === "nieuw").length,
    wijzigingen: created.filter((c) => c.soort === "wijziging").length,
    cardio: created.filter((c) => c.discipline === "cardio").length,
    kracht: created.filter((c) => c.discipline === "kracht").length,
  });
});

/** POST /api/planned/:id/lock  { locked } - protect a session from coach changes. */
router.post("/:id/lock", (req, res) => {
  const locked = req.body?.locked ? 1 : 0;
  db.prepare("UPDATE planned_sessions SET locked = ? WHERE id = ?").run(locked, req.params.id);
  res.json({ ok: true, locked: !!locked });
});

/**
 * POST /api/planned/:id/decline  { reason? }
 * Keeps the record instead of deleting it, so the coach can be told what was
 * turned down and why — otherwise it proposes the same thing again next time.
 */
router.post("/:id/decline", (req, res) => {
  db.prepare("UPDATE planned_sessions SET status = 'afgewezen', decline_reason = ? WHERE id = ?")
    .run(req.body?.reason || null, req.params.id);
  res.json({ ok: true });
});

/**
 * POST /api/planned/:id/accept  { replaceConflicting?: boolean }
 * Promotes a proposal to a real plan.
 */
router.post("/:id/accept", (req, res) => {
  const plan = db.prepare("SELECT * FROM planned_sessions WHERE id = ?").get(req.params.id);
  if (!plan) return res.status(404).json({ error: "Voorstel niet gevonden." });

  // A proposal that was framed as a change retires the session it replaces,
  // so accepting it swaps rather than stacks.
  if (plan.replaces_id) {
    db.prepare("DELETE FROM planned_sessions WHERE id = ? AND locked = 0").run(plan.replaces_id);
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
      if (p.replaces_id) {
        db.prepare("DELETE FROM planned_sessions WHERE id = ? AND locked = 0").run(p.replaces_id);
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
  const { date, type, description, durationMin, intensity, discipline } = req.body || {};
  if (!date || !type) return res.status(400).json({ error: "Datum en type zijn verplicht." });
  const id = `plan-manual-${Date.now()}`;
  db.prepare(
    `INSERT INTO planned_sessions (id, date, weekday, type, description, duration_min, intensity, status, discipline)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'gepland', ?)`
  ).run(id, date, calc.weekdayNameForDate(date), type, description || "", durationMin ?? null,
        intensity ?? null, discipline === "kracht" ? "kracht" : "cardio");
  refreshCompletions();
  res.status(201).json({ id });
});

// PATCH /api/planned/:id  { status }  - manual override
router.patch("/:id", (req, res) => {
  const { status } = req.body;
  if (!["voorgesteld", "gepland", "gedaan", "overgeslagen", "afgewezen"].includes(status)) {
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
function getRecentDeclines(days = 14) {
  const from = new Date();
  from.setDate(from.getDate() - days);
  return db
    .prepare("SELECT * FROM planned_sessions WHERE status = 'afgewezen' AND date >= ? ORDER BY date")
    .all(from.toISOString().slice(0, 10))
    .map((r) => ({ datum: r.date, type: r.type, voorstel: r.description, reden: r.decline_reason }));
}

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

module.exports = { router, resolveDate, weekdayMismatch, refreshCompletions, getUpcomingPlan, getRecentDeclines };
