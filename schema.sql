"use strict";

/**
 * scheduler.js — runs the automatic coach consultations.
 *
 * Deliberately a plain interval rather than a cron dependency: the timing needs
 * here are coarse (a weekly slot and a daily signal check), and adding a
 * scheduling library for that would be more moving parts than the problem
 * warrants.
 *
 * Everything it produces is a *proposal*. Nothing is auto-accepted, nothing
 * already committed is overwritten, and locked sessions are untouched — the
 * same rules that apply when the athlete asks a question themselves.
 */

const { db } = require("../db/db");
const calc = require("./calculations");
const { detectSignals, shouldConsult, isWeeklySlotDue } = require("./automation");

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // every 15 minutes is plenty for this
let timer = null;

function getSettings() {
  return db.prepare("SELECT * FROM coach_automation WHERE id = 1").get();
}

function recordError(message) {
  db.prepare("UPDATE coach_automation SET last_error = ? WHERE id = 1").run(message || null);
}

/**
 * Gathers everything the trigger logic needs. Kept separate from detection so
 * the thresholds stay testable without a database.
 */
function gatherState() {
  const profile = db.prepare("SELECT * FROM profile WHERE id = 1").get();
  const hrZones = profile?.max_hr ? calc.computeHrZones(profile.max_hr, profile.resting_hr) : null;

  const cardioLogs = db.prepare("SELECT * FROM cardio_logs ORDER BY date DESC").all();
  const loadSeries = calc.computeTrainingLoadSeries(cardioLogs, profile?.ftp, hrZones);

  const wellness = db.prepare("SELECT * FROM wellness_logs ORDER BY date DESC LIMIT 30").all();
  const plans = db.prepare("SELECT * FROM planned_sessions").all();
  const events = db
    .prepare("SELECT * FROM events ORDER BY date")
    .all()
    .map((e) => ({ name: e.name, date: e.date, daysUntil: calc.daysUntil(e.date) }));

  return { loadSeries, wellness, plans, events, today: calc.todayStr() };
}

/**
 * Asks the coach and turns the answer into proposals.
 *
 * Imported lazily: routes/coach.js pulls in the whole payload builder, and
 * requiring it at module load would create a cycle with the route registry.
 */
async function consultCoach({ question, triggerType, triggerReason }) {
  const { runCoachConsultation } = require("../routes/coach");
  const { createProposalsFromCoachEntry } = require("../routes/planned");

  const entry = await runCoachConsultation({ question, triggerType, triggerReason });
  const result = createProposalsFromCoachEntry(entry.id);
  return { entry, proposals: result };
}

async function runWeekly(settings) {
  const question =
    "Plan mijn komende week in op basis van mijn schema, recente trainingen, herstel en trainingsbelasting. " +
    "Houd rekening met wat er al gepland staat en wijzig dat alleen als daar een duidelijke reden voor is.";

  const { entry, proposals } = await consultCoach({
    question,
    triggerType: "wekelijks",
    triggerReason: "Wekelijkse planning",
  });

  db.prepare("UPDATE coach_automation SET last_weekly_run = ?, last_error = NULL WHERE id = 1")
    .run(new Date().toISOString());

  console.log(
    `[coach] wekelijkse planning uitgevoerd — ${proposals.created.length} voorstel(len), antwoord ${entry.id}`
  );
}

async function runSignalCheck(settings) {
  const state = gatherState();
  const signals = detectSignals(state);
  const decision = shouldConsult({
    signals,
    lastRunAt: settings.last_signal_run,
    lastReason: settings.last_signal_reason,
    cooldownDays: settings.cooldown_days,
  });

  if (!decision.consult) {
    if (decision.skipped) console.log(`[coach] signaal genegeerd: ${decision.skipped}`);
    return;
  }

  const question =
    `Er is iets veranderd in mijn gegevens: ${decision.reason} ` +
    "Bekijk of mijn planning voor de komende dagen aangepast moet worden. Laat staan wat kan blijven staan.";

  const { entry, proposals } = await consultCoach({
    question,
    triggerType: "signaal",
    triggerReason: decision.reason,
  });

  db.prepare(
    "UPDATE coach_automation SET last_signal_run = ?, last_signal_reason = ?, last_error = NULL WHERE id = 1"
  ).run(new Date().toISOString(), decision.code);

  console.log(
    `[coach] signaal "${decision.code}" — ${proposals.created.length} voorstel(len), antwoord ${entry.id}`
  );
}

async function tick() {
  let settings;
  try {
    settings = getSettings();
  } catch (err) {
    return; // database not ready yet
  }
  if (!settings) return;

  try {
    if (settings.weekly_enabled) {
      const due = isWeeklySlotDue({
        weekday: settings.weekly_weekday,
        hour: settings.weekly_hour,
        lastRunAt: settings.last_weekly_run,
        weekdayNameForDate: calc.weekdayNameForDate,
      });
      if (due) {
        await runWeekly(settings);
        return; // one consultation per tick is enough
      }
    }

    if (settings.signals_enabled) {
      await runSignalCheck(getSettings());
    }
  } catch (err) {
    // A failing automatic run must never take the server down, and the athlete
    // should be able to see why nothing happened.
    console.error(`[coach] automatische raadpleging mislukt: ${err.message}`);
    recordError(`${new Date().toISOString()}: ${err.message}`);
  }
}

function start() {
  if (timer) return;
  timer = setInterval(tick, CHECK_INTERVAL_MS);
  if (timer.unref) timer.unref(); // don't hold the process open in tests
  console.log("[coach] automatische planning actief (controle elke 15 minuten)");
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick, gatherState, runWeekly, runSignalCheck };
