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
    timeOfDay: row.time_of_day,
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
/**
 * Extracts the sport from a plan's type. The coach writes things like
 * "Fietsen (Herstel)" or "Fietsen - intervallen", while Strava logs a plain
 * "Fietsen" — matching on the full string meant real sessions were marked as
 * missed because the wording differed.
 */
function baseSport(type) {
  if (!type) return "";
  return String(type)
    .split(/[(\-–—]/)[0]
    .trim()
    .toLowerCase();
}

/**
 * Finds the logged session that fulfils a plan.
 *
 * `claimed` holds log ids already matched to another plan in this sweep: one
 * ride can only tick off one planned session. Without that, planning a ride
 * and a run on the same day and then only riding would mark both as done.
 */
function findCompletion(plan, claimed = new Set()) {
  if ((plan.discipline || "cardio") === "kracht") {
    // Any gym session that day fulfils the plan; insisting the schema day
    // matches exactly would mark a swapped A/B day as missed.
    const row = db
      .prepare("SELECT id FROM workout_logs WHERE date = ?")
      .all(plan.date)
      .find((r) => !claimed.has(r.id));
    return row?.id ?? null;
  }

  const sameDay = db
    .prepare("SELECT id, type FROM cardio_logs WHERE date = ?")
    .all(plan.date)
    .filter((log) => !claimed.has(log.id));
  if (sameDay.length === 0) return null;

  // Same sport first, tolerating the coach's wording: "Fietsen (Herstel)"
  // should match a plain "Fietsen" from Strava.
  const wanted = baseSport(plan.type);
  const match = sameDay.find((log) => baseSport(log.type) === wanted);
  if (match) return match.id;

  // Nothing of the planned sport, but something else was logged and no other
  // plan has claimed it: treat that as a swapped session rather than a miss.
  return sameDay[0].id;
}

/** Refreshes completion status for all plans that aren't resolved yet. */
function refreshCompletions() {
  const open = db.prepare("SELECT * FROM planned_sessions WHERE status = 'gepland'").all();
  const today = calc.todayStr();
  const update = db.prepare(
    "UPDATE planned_sessions SET completed_cardio_log_id = ?, status = ? WHERE id = ?"
  );
  // Sessions already tied to a plan, so one workout can't satisfy two.
  const claimed = new Set(
    db.prepare("SELECT completed_cardio_log_id AS id FROM planned_sessions WHERE completed_cardio_log_id IS NOT NULL")
      .all()
      .map((r) => r.id)
  );

  // Same-sport matches take priority: check plans whose sport was actually
  // logged before letting a leftover session count as a swap.
  const ordered = [...open].sort((a, b) => {
    const logged = (plan) =>
      db.prepare("SELECT 1 FROM cardio_logs WHERE date = ? AND LOWER(type) LIKE ?")
        .get(plan.date, baseSport(plan.type) + "%") ? 0 : 1;
    return logged(a) - logged(b);
  });

  ordered.forEach((plan) => {
    const completedId = findCompletion(plan, claimed);
    if (completedId) {
      claimed.add(completedId);
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

  // Events belong in the week view: a plan that hides the race you're building
  // towards is missing the thing that gives it shape.
  const events = (toStr
    ? db.prepare("SELECT * FROM events WHERE date >= ? AND date <= ? ORDER BY date").all(fromStr, toStr)
    : db.prepare("SELECT * FROM events WHERE date >= ? ORDER BY date").all(fromStr))
    .map((e) => ({
      id: e.id,
      date: e.date,
      name: e.name,
      type: e.type,
      target: e.target,
      notes: e.notes,
      daysUntil: calc.daysUntil(e.date),
    }));

  // Link each event to the session that was actually ridden that day. An event
  // you've completed shouldn't sit in the planner as an unconnected flag —
  // and the ride's numbers are the most interesting thing about it afterwards.
  const eventsWithLogs = events.map((e) => {
    const log = db
      .prepare(
        `SELECT id, type, duration_min, distance_km, avg_hr, max_hr, avg_power,
                weighted_avg_power, elevation_gain_m
         FROM cardio_logs WHERE date = ?
         ORDER BY COALESCE(distance_km, 0) DESC LIMIT 1`
      )
      .get(e.date);
    return {
      ...e,
      voltooid: !!log,
      sessie: log
        ? {
            id: log.id,
            type: log.type,
            durationMin: log.duration_min,
            distanceKm: log.distance_km,
            avgHr: log.avg_hr,
            maxHr: log.max_hr,
            avgPower: log.avg_power,
            normalizedPower: log.weighted_avg_power,
            elevationGainM: log.elevation_gain_m,
          }
        : null,
    };
  });

  // The next event regardless of the visible range: three weeks out it won't
  // appear in the fortnight on screen, which is precisely when it's easy to
  // forget it's coming.
  const nextEventRow = db
    .prepare("SELECT * FROM events WHERE date >= ? ORDER BY date LIMIT 1")
    .get(calc.todayStr());
  const volgendEvenement = nextEventRow
    ? {
        id: nextEventRow.id,
        name: nextEventRow.name,
        date: nextEventRow.date,
        type: nextEventRow.type,
        target: nextEventRow.target,
        daysUntil: calc.daysUntil(nextEventRow.date),
      }
    : null;

  res.json({
    plans,
    krachttrainingen: strength,
    evenementen: eventsWithLogs,
    volgendEvenement,
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
/**
 * Turns a coach answer into proposals. Extracted from the route so automatic
 * runs can use exactly the same path as a manual "Zet in planning" click —
 * same conflict handling, same respect for locked sessions, no second code
 * path that could drift out of step.
 */
function createProposalsFromCoachEntry(coachEntryId) {
  const entry = db.prepare("SELECT * FROM coach_history WHERE id = ?").get(coachEntryId);
  if (!entry) throw new Error("Coachantwoord niet gevonden.");
  if (!entry.cardio_voorstel_json) return { created: [], skipped: [], waarschuwingen: [], nieuw: 0, wijzigingen: 0, cardio: 0, kracht: 0 };

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

  return {
    created,
    skipped,
    waarschuwingen,
    nieuw: created.filter((c) => c.soort === "nieuw").length,
    wijzigingen: created.filter((c) => c.soort === "wijziging").length,
    cardio: created.filter((c) => c.discipline === "cardio").length,
    kracht: created.filter((c) => c.discipline === "kracht").length,
  };
}

router.post("/from-coach", (req, res) => {
  try {
    res.status(201).json(createProposalsFromCoachEntry(req.body.coachEntryId));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
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

/**
 * POST /api/planned/from-schema  { from, to }
 *
 * Fills a date range with the athlete's own fixed schedule — the strength days
 * and cardio slots they set up under Schema. No AI involved: if you've already
 * decided you train Tuesday and Thursday, waiting for a coach answer to see
 * that in your planner is backwards.
 *
 * Existing sessions are never overwritten; only empty slots are filled, so
 * running this twice is harmless and it can't clobber a coach proposal you
 * accepted or a session you locked.
 */
router.post("/from-schema", (req, res) => {
  const from = req.body?.from || calc.todayStr();
  const to = req.body?.to;
  if (!to) return res.status(400).json({ error: "Geef een einddatum mee." });

  const strengthDays = db.prepare("SELECT * FROM schema_days WHERE weekdays IS NOT NULL AND weekdays != ''").all();
  // Describe the session by its exercises rather than a placeholder, so the
  // planner is useful on its own without waiting for a coach answer.
  const exercisesFor = db.prepare(
    "SELECT name, target_sets, target_reps FROM schema_exercises WHERE day_id = ? ORDER BY sort_order"
  );
  const describeStrengthDay = (dayId) => {
    const rows = exercisesFor.all(dayId);
    if (rows.length === 0) return "volgens je vaste schema";
    return rows.map((e) => `${e.name} ${e.target_sets}x${e.target_reps}`).join(" · ");
  };
  const cardioDays = db.prepare("SELECT * FROM schema_cardio_days").all();

  if (strengthDays.length === 0 && cardioDays.length === 0) {
    return res.status(400).json({
      error: "Er staan nog geen vaste dagen in je schema. Vink bij Schema per trainingsdag de weekdag(en) aan.",
    });
  }

  const existing = db.prepare(
    "SELECT date, discipline FROM planned_sessions WHERE date >= ? AND date <= ? AND status IN ('gepland','voorgesteld')"
  ).all(from, to);
  const taken = new Set(existing.map((e) => `${e.date}|${e.discipline || "cardio"}`));

  const insert = db.prepare(
    `INSERT INTO planned_sessions (id, date, weekday, type, description, status, discipline, time_of_day)
     VALUES (?, ?, ?, ?, ?, 'gepland', ?, ?)`
  );

  const created = [];
  const cursor = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");

  // Sessions generated by an earlier version carry a placeholder description.
  // Repair those in place rather than leaving them uninformative — scoped to
  // rows this endpoint created, so nothing the athlete or coach wrote is touched.
  const bijgewerkt = [];
  const placeholders = db
    .prepare(
      `SELECT id, type FROM planned_sessions
       WHERE date >= ? AND date <= ? AND discipline = 'kracht'
         AND description = 'volgens je vaste schema' AND id LIKE 'plan-schema-%'`
    )
    .all(from, to);
  placeholders.forEach((row) => {
    const day = strengthDays.find((d) => d.name === row.type);
    if (!day) return;
    const description = describeStrengthDay(day.id);
    if (description === "volgens je vaste schema") return;
    db.prepare("UPDATE planned_sessions SET description = ? WHERE id = ?").run(description, row.id);
    bijgewerkt.push(row.id);
  });

  while (cursor <= end) {
    const iso = toIso(cursor);
    const weekday = calc.weekdayNameForDate(iso);

    strengthDays.forEach((d) => {
      const days = (d.weekdays || "").split(",").filter(Boolean);
      if (!days.includes(weekday)) return;
      if (taken.has(`${iso}|kracht`)) return;
      const id = `plan-schema-k-${d.id}-${iso}`;
      insert.run(id, iso, weekday, d.name, describeStrengthDay(d.id), "kracht", d.time_of_day || null);
      taken.add(`${iso}|kracht`);
      created.push({ date: iso, discipline: "kracht", type: d.name });
    });

    cardioDays.forEach((c) => {
      if (c.weekday !== weekday) return;
      if (taken.has(`${iso}|cardio`)) return;
      const id = `plan-schema-c-${c.id}-${iso}`;
      insert.run(id, iso, weekday, c.type, c.notes || "volgens je vaste schema", "cardio", c.time_of_day || null);
      taken.add(`${iso}|cardio`);
      created.push({ date: iso, discipline: "cardio", type: c.type });
    });

    cursor.setDate(cursor.getDate() + 1);
  }

  refreshCompletions();
  res.status(201).json({
    aangemaakt: created.length,
    bijgewerkt: bijgewerkt.length,
    kracht: created.filter((c) => c.discipline === "kracht").length,
    cardio: created.filter((c) => c.discipline === "cardio").length,
    details: created,
  });
});

/**
 * PATCH /api/planned/:id/move  { date }
 *
 * Moves a session to another day. Life happens: a ride gets rained off, work
 * runs late. Deleting and re-creating would lose the coach's description and
 * the link to the answer it came from, so move it instead.
 */
router.patch("/:id/move", (req, res) => {
  const { date } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Geef een geldige datum (JJJJ-MM-DD)." });
  }

  const plan = db.prepare("SELECT * FROM planned_sessions WHERE id = ?").get(req.params.id);
  if (!plan) return res.status(404).json({ error: "Training niet gevonden." });

  const clash = db
    .prepare(
      "SELECT * FROM planned_sessions WHERE date = ? AND discipline = ? AND status = 'gepland' AND id != ?"
    )
    .get(date, plan.discipline || "cardio", plan.id);

  db.prepare("UPDATE planned_sessions SET date = ?, weekday = ?, status = 'gepland' WHERE id = ?")
    .run(date, calc.weekdayNameForDate(date), plan.id);

  // Moving onto a day that's already trained should count as done straight away.
  refreshCompletions();

  res.json({
    ok: true,
    date,
    // Reported rather than blocked: two sessions in a day is a legitimate
    // choice, and the athlete can see it in the planner.
    waarschuwing: clash
      ? `Er stond al een ${clash.discipline === "kracht" ? "krachttraining" : "cardiosessie"} op ${date}.`
      : null,
  });
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

module.exports = { router, resolveDate, weekdayMismatch, refreshCompletions, getUpcomingPlan, getRecentDeclines, createProposalsFromCoachEntry };
