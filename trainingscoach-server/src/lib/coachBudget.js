"use strict";

/**
 * coachBudget.js — keeps a runaway loop from spending an API quota.
 *
 * Every coach answer is a paid model call. Nothing stopped the app from making
 * them back to back: a scheduler that retried on failure, or an impatient
 * double-click, would go straight through. The damage from that is money and a
 * burnt quota, discovered afterwards.
 *
 * Two limits, both deliberately generous — this should only ever catch a bug or
 * a stuck finger, never normal use:
 *
 *   - a minimum gap between calls, which stops bursts
 *   - a daily ceiling, which stops a slow loop running all night
 *
 * The gap is short on purpose. Asking for feedback on three sessions in a row
 * while reviewing a week is entirely reasonable, and a limit that blocked it
 * would be a worse bug than the one it guards against. Stopping a double-click
 * and a tight retry loop is all it needs to do; the daily ceiling is what
 * actually protects the quota.
 *
 * State is in memory. A restart clears it, which is the right trade for a
 * single-user self-hosted app: the case worth defending against is a loop
 * inside one running process, and persisting counters would mean a schema
 * migration for something that guards against a bug.
 */

const MIN_SECONDS_BETWEEN_CALLS = Number(process.env.COACH_MIN_SECONDS_BETWEEN) || 5;
const MAX_CALLS_PER_DAY = Number(process.env.COACH_MAX_CALLS_PER_DAY) || 50;

let lastCallAt = null;
let dayKey = null;
let callsToday = 0;

function currentDayKey(now) {
  const calc = require("./calculations");
  return calc.toDateStr(now);
}

/**
 * Throws when a call would exceed a limit; records it otherwise.
 *
 * The error carries `status` 429 so the route layer turns it into a normal
 * refusal rather than a server error, and a message the athlete can act on —
 * "wacht nog 12 seconden" beats a generic failure.
 */
function claim(now = new Date()) {
  const today = currentDayKey(now);
  if (dayKey !== today) {
    dayKey = today;
    callsToday = 0;
  }

  if (lastCallAt) {
    const secondsSince = (now - lastCallAt) / 1000;
    if (secondsSince < MIN_SECONDS_BETWEEN_CALLS) {
      const wait = Math.ceil(MIN_SECONDS_BETWEEN_CALLS - secondsSince);
      const err = new Error(`De coach is net geraadpleegd — probeer het over ${wait} seconden nog eens.`);
      err.status = 429;
      throw err;
    }
  }

  if (callsToday >= MAX_CALLS_PER_DAY) {
    const err = new Error(
      `Dagelijkse limiet van ${MAX_CALLS_PER_DAY} coachaanvragen bereikt. ` +
        "Dat wijst meestal op een vastgelopen automatische taak; verhoog COACH_MAX_CALLS_PER_DAY als het klopt."
    );
    err.status = 429;
    throw err;
  }

  lastCallAt = now;
  callsToday += 1;
}

/** Current usage, for the automation panel. */
function status(now = new Date()) {
  const today = currentDayKey(now);
  return {
    aanvragenVandaag: dayKey === today ? callsToday : 0,
    dagmaximum: MAX_CALLS_PER_DAY,
    minimumTussentijdSeconden: MIN_SECONDS_BETWEEN_CALLS,
    laatsteAanvraag: lastCallAt ? lastCallAt.toISOString() : null,
  };
}

/** Test seam — production never needs this. */
function reset() {
  lastCallAt = null;
  dayKey = null;
  callsToday = 0;
}

module.exports = { claim, status, reset, MIN_SECONDS_BETWEEN_CALLS, MAX_CALLS_PER_DAY };
