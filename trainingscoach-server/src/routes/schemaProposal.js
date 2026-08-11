"use strict";

/**
 * schemaProposal.js — goals, and the coach designing a schema around them.
 *
 * The rest of the coach works inside the schema the athlete built: it fills in
 * the weeks, proposes sessions, comments on load. This route covers the layer
 * underneath — which training days exist, on which weekdays, with which
 * exercises — and does it from the athlete's stated goals plus the training
 * history that is already in the database.
 *
 * A proposal is never applied on its own. It is stored, previewed against the
 * current schema, and only written when the athlete accepts it; the schema it
 * replaced is snapshotted first so accepting can be undone. That matters more
 * here than anywhere else in the app: the schema is the reference every logged
 * session is entered against.
 */

const express = require("express");
const { db } = require("../db/db");
const { getFullSchema, replaceSchema } = require("./schema");
const { serializeWorkoutLogs } = require("./workoutLogs");
const { serialize: serializeCardioLog } = require("./cardioLogs");
const calc = require("../lib/calculations");
const { callCoachModel } = require("../lib/llmProvider");
const {
  buildSchemaProposalSystemPrompt,
  SCHEMA_PROPOSAL_RESPONSE_SCHEMA,
  normalizeProposal,
  summarizeChanges,
} = require("../lib/schemaProposal");

const router = express.Router();

const FOCUS_VALUES = ["kracht", "cardio", "combi"];

function stripJsonFences(text) {
  return text.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "").trim();
}

function timeOfDayLabel(id) {
  const map = { ochtend: "Ochtend", middag: "Middag", avond: "Avond" };
  return map[id] || null;
}

/* --------------------------------- goals -------------------------------- */

function serializeGoals(row) {
  if (!row) return null;
  return {
    goal: row.goal,
    focus: row.focus,
    strengthDaysPerWeek: row.strength_days_per_week,
    cardioDaysPerWeek: row.cardio_days_per_week,
    sessionMinutes: row.session_minutes,
    availableWeekdays: row.available_weekdays ? row.available_weekdays.split(",").filter(Boolean) : [],
    equipment: row.equipment,
    experience: row.experience,
    limitations: row.limitations,
    notes: row.notes,
    updatedAt: row.updated_at,
  };
}

function getGoals() {
  return serializeGoals(db.prepare("SELECT * FROM training_goals WHERE id = 1").get());
}

/** Are the goals filled in enough to design a schema around? */
function goalsAreUsable(goals) {
  return !!(goals && (goals.goal || goals.focus || goals.strengthDaysPerWeek || goals.cardioDaysPerWeek));
}

function clampOrNull(value, min, max) {
  if (value === null || value === undefined || value === "") return null;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

// GET /api/coach/goals
router.get("/goals", (req, res) => {
  res.json(getGoals());
});

// PUT /api/coach/goals
router.put("/goals", (req, res) => {
  const g = req.body || {};
  const focus = FOCUS_VALUES.includes(g.focus) ? g.focus : null;
  const weekdays = Array.isArray(g.availableWeekdays)
    ? g.availableWeekdays.filter((w) => calc.WEEKDAYS.includes(w))
    : [];

  try {
    db.prepare(
      `UPDATE training_goals SET
         goal = ?, focus = ?, strength_days_per_week = ?, cardio_days_per_week = ?,
         session_minutes = ?, available_weekdays = ?, equipment = ?, experience = ?,
         limitations = ?, notes = ?, updated_at = ?
       WHERE id = 1`
    ).run(
      g.goal?.trim() || null,
      focus,
      clampOrNull(g.strengthDaysPerWeek, 0, 7),
      clampOrNull(g.cardioDaysPerWeek, 0, 14),
      clampOrNull(g.sessionMinutes, 10, 300),
      weekdays.join(",") || null,
      g.equipment?.trim() || null,
      g.experience?.trim() || null,
      g.limitations?.trim() || null,
      g.notes?.trim() || null,
      new Date().toISOString()
    );
    res.json(getGoals());
  } catch (err) {
    res.status(500).json({ error: "Kon doelen niet opslaan", details: err.message });
  }
});

/* ------------------------------- proposals ------------------------------ */

function serializeProposal(row) {
  const proposal = row.proposal_json ? JSON.parse(row.proposal_json) : { days: [], cardioDays: [] };
  return {
    id: row.id,
    date: row.date,
    status: row.status,
    question: row.question,
    goals: row.goals_json ? JSON.parse(row.goals_json) : null,
    voorstel: proposal,
    toelichting: row.toelichting,
    opbouw: row.opbouw_json ? JSON.parse(row.opbouw_json) : [],
    correcties: row.correcties_json ? JSON.parse(row.correcties_json) : [],
    waarschuwing: row.waarschuwing,
    rawFeedback: row.raw_feedback,
    declineReason: row.decline_reason,
    appliedAt: row.applied_at,
    kanTerugdraaien: row.status === "geaccepteerd" && !!row.previous_schema_json,
    // Recomputed on read rather than stored: the schema moves on after a
    // proposal is made, and a diff against a schema that no longer exists
    // would quietly mislead.
    wijzigingen: row.status === "voorgesteld" ? summarizeChanges(getFullSchema(), proposal) : null,
  };
}

/**
 * Everything the coach needs to design a schema.
 *
 * Deliberately lighter than the consultation payload in coach.js: schema
 * design is about patterns over months, so per-session traces and the day to
 * day planner state are noise here — while the goals, the constraints and what
 * the athlete has actually managed to sustain are the whole point.
 */
function buildProposalPayload({ question = null } = {}) {
  const schema = getFullSchema();
  const goals = getGoals();
  const workoutLogs = serializeWorkoutLogs(
    db.prepare("SELECT * FROM workout_logs ORDER BY date DESC, created_at DESC").all()
  );
  const cardioLogs = db
    .prepare("SELECT * FROM cardio_logs ORDER BY date DESC, created_at DESC")
    .all()
    .map(serializeCardioLog);
  const weightLogs = db.prepare("SELECT * FROM weight_logs ORDER BY date ASC").all();
  const wellnessLogs = db.prepare("SELECT * FROM wellness_logs ORDER BY date DESC LIMIT 28").all();
  const events = db.prepare("SELECT * FROM events ORDER BY date ASC").all();

  const hrZones = schema.profile.maxHr ? calc.computeHrZones(schema.profile.maxHr, schema.profile.restingHr) : null;
  const trainingLoadSeries = calc.computeTrainingLoadSeries(cardioLogs, schema.profile.ftp, hrZones);
  const currentLoad = trainingLoadSeries ? trainingLoadSeries[trainingLoadSeries.length - 1] : null;

  const today = calc.todayStr();
  const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
  const within = (rows, days) => rows.filter((l) => daysBetween(l.date, today) <= days);

  // What the athlete actually sustains, as opposed to what they intend to.
  // A schema with five strength days is worthless to someone who has managed
  // two a week for the last two months, and the coach cannot see that from
  // the schema alone.
  const realiteit = {
    krachtsessiesPerWeekLaatste8Weken: workoutLogs.length
      ? Math.round((within(workoutLogs, 56).length / 8) * 10) / 10
      : 0,
    cardiosessiesPerWeekLaatste8Weken: cardioLogs.length
      ? Math.round((within(cardioLogs, 56).length / 8) * 10) / 10
      : 0,
    getraindeWeekdagenLaatste8Weken: [...workoutLogs, ...cardioLogs]
      .filter((l) => daysBetween(l.date, today) <= 56)
      .reduce((counts, l) => {
        const day = calc.weekdayNameForDate(l.date);
        if (day) counts[day] = (counts[day] || 0) + 1;
        return counts;
      }, {}),
  };

  const declined = db
    .prepare("SELECT * FROM schema_proposals WHERE status = 'afgewezen' ORDER BY date DESC LIMIT 3")
    .all();

  const latestWeight = weightLogs.length ? weightLogs[weightLogs.length - 1] : null;
  const avg = (rows, key) => {
    const vals = rows.map((r) => r[key]).filter((v) => v !== null && v !== undefined);
    return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
  };

  return {
    vandaag: today,
    vandaagWeekdag: calc.weekdayNameForDate(today),
    doelen: goals
      ? {
          doel: goals.goal,
          focus: goals.focus,
          krachtdagenPerWeek: goals.strengthDaysPerWeek,
          cardiodagenPerWeek: goals.cardioDaysPerWeek,
          sessieMinuten: goals.sessionMinutes,
          beschikbareWeekdagen: goals.availableWeekdays.length ? goals.availableWeekdays : null,
          materiaal: goals.equipment,
          ervaring: goals.experience,
          beperkingen: goals.limitations,
          overig: goals.notes,
        }
      : null,
    huidigSchema: {
      krachtdagen: schema.days.map((d) => ({
        naam: d.name,
        vasteWeekdagen: d.weekdays && d.weekdays.length ? d.weekdays : null,
        moment: d.timeOfDay ? timeOfDayLabel(d.timeOfDay) : null,
        // Agreed with someone else: the coach fills it in, but never moves it.
        vast: !!d.locked,
        oefeningen: d.exercises.map((e) => ({ naam: e.name, doel: `${e.targetSets}x${e.targetReps}` })),
      })),
      cardiodagen: schema.cardioDays.map((c) => ({
        dag: c.weekday,
        type: c.type,
        moment: c.timeOfDay ? timeOfDayLabel(c.timeOfDay) : null,
        vast: !!c.locked,
        notities: c.notes,
      })),
    },
    watDeClientEchtDoet: realiteit,
    langetermijnSamenvattingKracht: calc.computeStrengthHistorySummary(workoutLogs),
    langetermijnSamenvattingCardio: calc.computeCardioHistorySummary(cardioLogs),
    recenteKrachttrainingen: workoutLogs.slice(0, 5).map((l) => ({
      datum: l.date,
      dag: l.dayName,
      rpe: l.rpe ?? null,
      durationMin: l.durationMin ?? null,
      oefeningen: l.exercises.map((e) => ({
        naam: e.name,
        sets: e.sets.map((s) => `${s.weight}kg x ${s.reps}`),
      })),
    })),
    trainingsbelasting: currentLoad
      ? {
          ctlFitness: currentLoad.ctl,
          atlVermoeidheid: currentLoad.atl,
          tsbVorm: currentLoad.tsb,
          methode: schema.profile.ftp ? "vermogen (FTP-gebaseerd, nauwkeurig)" : "hartslag (schatting)",
        }
      : null,
    herstel: wellnessLogs.length
      ? {
          laatste7Dagen: {
            gemRusthartslag: avg(wellnessLogs.slice(0, 7), "resting_hr"),
            gemHrvMs: avg(wellnessLogs.slice(0, 7), "hrv_ms"),
            gemSlaapMinuten: avg(wellnessLogs.slice(0, 7), "sleep_minutes"),
          },
          basislijn8tot28Dagen: wellnessLogs.length > 7
            ? {
                gemRusthartslag: avg(wellnessLogs.slice(7, 28), "resting_hr"),
                gemHrvMs: avg(wellnessLogs.slice(7, 28), "hrv_ms"),
                gemSlaapMinuten: avg(wellnessLogs.slice(7, 28), "sleep_minutes"),
              }
            : null,
        }
      : null,
    hartslagzones: hrZones ? hrZones.map((z) => ({ zone: z.zone, naam: z.naam, van: z.vanBpm, tot: z.totBpm })) : null,
    lichaamsgewicht: latestWeight
      ? { huidigGewichtKg: latestWeight.weight_kg, datumLaatsteMeting: latestWeight.date }
      : null,
    geplandeEvenementen: events
      .filter((e) => calc.daysUntil(e.date) >= 0)
      .slice(0, 5)
      // Notes included: "2500 hoogtemeters, veel grind" says more about what to
      // train for than the event's name and date ever will.
      .map((e) => ({
        naam: e.name,
        datum: e.date,
        overDagen: calc.daysUntil(e.date),
        type: e.type,
        doel: e.target,
        notities: e.notes,
      })),
    eerderAfgewezenSchemas: declined.map((d) => ({
      datum: d.date,
      reden: d.decline_reason,
      voorstel: d.proposal_json
        ? JSON.parse(d.proposal_json).days.map((day) => ({
            naam: day.name,
            weekdagen: day.weekdays,
            oefeningen: day.exercises.map((e) => e.name),
          }))
        : null,
    })),
    vraagVanGebruiker: question,
  };
}

/**
 * POST /api/coach/schema-proposals  { question?: string }
 *
 * Asks the coach for a schema. Any proposal still waiting is marked
 * 'vervangen': two open schema proposals would mean two competing answers to
 * "what should I be doing", which is exactly the instability the planner was
 * fixed for.
 */
router.post("/schema-proposals", async (req, res) => {
  const question = req.body?.question?.trim() || null;
  const goals = getGoals();

  if (!goalsAreUsable(goals)) {
    return res.status(400).json({
      error:
        "Vul eerst je doelen in — zonder doel valt er geen schema op maat te maken. " +
        "Een zin als 'sterker worden en in september een gravelrit van 150 km rijden' is al genoeg.",
    });
  }

  const payload = buildProposalPayload({ question });

  let rawText;
  try {
    ({ rawText } = await callCoachModel({
      systemPrompt: buildSchemaProposalSystemPrompt(),
      userContent: JSON.stringify(payload),
      // A full schema with per-exercise reasoning is several times the size of
      // a weekly consultation, and a truncated one is worthless.
      maxTokens: 2500,
      responseSchema: SCHEMA_PROPOSAL_RESPONSE_SCHEMA,
    }));
  } catch (err) {
    return res.status(err.status === 429 ? 429 : 502).json({ error: err.message });
  }

  const id = `schema-${Date.now()}`;
  let parsed = null;
  try {
    parsed = JSON.parse(stripJsonFences(rawText));
  } catch {
    parsed = null;
  }

  let normalized = null;
  let normalizeError = null;
  if (parsed) {
    try {
      normalized = normalizeProposal(parsed, {
        idPrefix: id,
        // The constraints the athlete set are enforced here, not left to the
        // model's good intentions.
        availableWeekdays: goals.availableWeekdays,
        currentSchema: getFullSchema(),
      });
    } catch (err) {
      normalizeError = err.message;
    }
  }

  // An unusable answer is still stored, with the raw text: it is the only way
  // to tell "the model is misbehaving" apart from "the request never ran". It
  // gets its own status rather than counting as a rejection — a rejection is
  // fed back into the next request as something the athlete turned down, which
  // a garbled answer is not.
  db.prepare(
    `INSERT INTO schema_proposals
       (id, date, status, question, goals_json, proposal_json, toelichting, opbouw_json, waarschuwing, raw_feedback, correcties_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    new Date().toISOString(),
    normalized ? "voorgesteld" : "mislukt",
    question,
    JSON.stringify(goals),
    normalized ? JSON.stringify({ days: normalized.days, cardioDays: normalized.cardioDays }) : null,
    normalized ? normalized.toelichting : null,
    normalized ? JSON.stringify(normalized.opbouw) : null,
    normalized ? normalized.waarschuwing : null,
    normalized ? null : rawText,
    normalized && normalized.correcties.length ? JSON.stringify(normalized.correcties) : null
  );

  if (!normalized) {
    return res.status(502).json({
      error:
        normalizeError ||
        "Het model gaf geen geldig schemavoorstel terug. Probeer het opnieuw; blijft het misgaan, controleer dan het ingestelde model in .env.",
    });
  }

  db.prepare("UPDATE schema_proposals SET status = 'vervangen' WHERE status = 'voorgesteld' AND id != ?").run(id);

  res.status(201).json(serializeProposal(db.prepare("SELECT * FROM schema_proposals WHERE id = ?").get(id)));
});

// GET /api/coach/schema-proposals - newest first, open proposal included
router.get("/schema-proposals", (req, res) => {
  const rows = db.prepare("SELECT * FROM schema_proposals ORDER BY date DESC LIMIT 20").all();
  res.json(rows.map(serializeProposal));
});

/**
 * POST /api/coach/schema-proposals/:id/accept
 *
 * Writes the proposal into the schema, after snapshotting what was there. The
 * profile (max HR, resting HR, FTP) is carried over untouched: it is measured
 * data about the athlete, not part of what the coach designs.
 */
router.post("/schema-proposals/:id/accept", (req, res) => {
  const row = db.prepare("SELECT * FROM schema_proposals WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Voorstel niet gevonden." });
  if (row.status !== "voorgesteld") {
    return res.status(409).json({ error: `Dit voorstel is al verwerkt (status: ${row.status}).` });
  }
  if (!row.proposal_json) return res.status(409).json({ error: "Dit voorstel bevat geen schema." });

  const proposal = JSON.parse(row.proposal_json);
  const previous = getFullSchema();

  try {
    const applied = db.transaction(() => {
      db.prepare(
        "UPDATE schema_proposals SET status = 'geaccepteerd', applied_at = ?, previous_schema_json = ? WHERE id = ?"
      ).run(new Date().toISOString(), JSON.stringify(previous), row.id);
      return replaceSchema({
        days: proposal.days,
        cardioDays: proposal.cardioDays,
        profile: previous.profile,
      });
    })();
    res.json({ schema: applied, voorstel: serializeProposal(db.prepare("SELECT * FROM schema_proposals WHERE id = ?").get(row.id)) });
  } catch (err) {
    res.status(500).json({ error: "Kon het schema niet toepassen", details: err.message });
  }
});

/**
 * POST /api/coach/schema-proposals/:id/undo
 *
 * Puts the previous schema back. Without this, "accept" is a one-way door on
 * the one thing every logged session refers to — and knowing you can step back
 * out is what makes trying a proposal reasonable at all.
 */
router.post("/schema-proposals/:id/undo", (req, res) => {
  const row = db.prepare("SELECT * FROM schema_proposals WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Voorstel niet gevonden." });
  if (row.status !== "geaccepteerd" || !row.previous_schema_json) {
    return res.status(409).json({ error: "Dit voorstel is niet toegepast, dus er valt niets terug te draaien." });
  }

  const previous = JSON.parse(row.previous_schema_json);
  try {
    const restored = db.transaction(() => {
      db.prepare("UPDATE schema_proposals SET status = 'teruggedraaid' WHERE id = ?").run(row.id);
      return replaceSchema(previous);
    })();
    res.json({ schema: restored });
  } catch (err) {
    res.status(500).json({ error: "Kon het oude schema niet terugzetten", details: err.message });
  }
});

/**
 * POST /api/coach/schema-proposals/:id/decline  { reason?: string }
 *
 * The reason is the point: it goes back into the next request, so a rejected
 * plan does not come back unchanged next week.
 */
router.post("/schema-proposals/:id/decline", (req, res) => {
  const row = db.prepare("SELECT * FROM schema_proposals WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Voorstel niet gevonden." });
  if (row.status !== "voorgesteld") {
    return res.status(409).json({ error: `Dit voorstel is al verwerkt (status: ${row.status}).` });
  }

  db.prepare("UPDATE schema_proposals SET status = 'afgewezen', decline_reason = ? WHERE id = ?").run(
    req.body?.reason?.trim() || null,
    row.id
  );
  res.json(serializeProposal(db.prepare("SELECT * FROM schema_proposals WHERE id = ?").get(row.id)));
});

// DELETE /api/coach/schema-proposals/:id
router.delete("/schema-proposals/:id", (req, res) => {
  db.prepare("DELETE FROM schema_proposals WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

module.exports = router;
module.exports.buildProposalPayload = buildProposalPayload;
module.exports.getGoals = getGoals;
module.exports.serializeProposal = serializeProposal;
