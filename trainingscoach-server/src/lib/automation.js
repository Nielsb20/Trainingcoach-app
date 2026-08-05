"use strict";

/**
 * automation.js — decides *whether* the coach should be consulted, not what it
 * should say.
 *
 * Kept as pure functions with no database or network access, so the thresholds
 * can be tested directly. That matters: get these wrong and the app either
 * nags after every ride or stays silent through an overtraining spiral.
 *
 * The guiding principle is the same one that governs the planner — stability
 * over optimisation. A signal has to be genuinely out of the ordinary before
 * it's worth interrupting a plan the athlete already committed to.
 */

// calculations.js is equally pure (no db, no network), so leaning on it for
// date formatting keeps this module testable while avoiding a second, subtly
// different copy of the timezone-safe date logic.
const calc = require("./calculations");

const DEFAULTS = {
  // Training Stress Balance. Sustained deep negatives mean accumulated fatigue;
  // a long stretch of high positives usually means the plan has gone too easy.
  tsbOverreachingBelow: -25,
  tsbDetrainingAbove: 20,
  tsbDetrainingDays: 10,

  // Recovery markers are judged against the athlete's own baseline, never
  // against absolute numbers — a resting HR of 55 means nothing in isolation.
  restingHrAboveBaseline: 5,
  hrvBelowBaselineFactor: 0.9,
  recoveryConsecutiveDays: 2,

  // Missing the occasional session is normal; a pattern is worth discussing.
  missedSessionsIn7Days: 2,

  // Close enough to an event that the plan should be tapering.
  eventWithinDays: 14,
};

function averageOf(rows, key) {
  const values = rows.map((r) => r[key]).filter((v) => v !== null && v !== undefined && !isNaN(v));
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Evaluates every trigger and returns the ones that fired.
 *
 * @param {object} input
 * @param {Array}  input.loadSeries  - output of computeTrainingLoadSeries (may be null)
 * @param {Array}  input.wellness    - daily rows, newest first
 * @param {Array}  input.plans       - planned sessions (any status)
 * @param {Array}  input.events      - upcoming events with { name, date, daysUntil }
 * @param {string} input.today       - YYYY-MM-DD
 * @param {object} [input.thresholds]
 * @returns {Array<{code: string, reason: string, severity: 'hoog'|'gemiddeld'}>}
 */
function detectSignals({ loadSeries, wellness = [], plans = [], events = [], today, thresholds = {} }) {
  const t = { ...DEFAULTS, ...thresholds };
  const signals = [];

  /* ---------------------------- training load --------------------------- */

  if (loadSeries && loadSeries.length > 0) {
    const current = loadSeries[loadSeries.length - 1];

    if (current.tsb <= t.tsbOverreachingBelow) {
      signals.push({
        code: "tsb_laag",
        severity: "hoog",
        reason: `TSB is ${current.tsb} — dat wijst op flink opgebouwde vermoeidheid.`,
      });
    }

    // Detraining is only meaningful if it persists; a couple of rest days
    // after a hard block are exactly what should happen.
    const recent = loadSeries.slice(-t.tsbDetrainingDays);
    if (
      recent.length === t.tsbDetrainingDays &&
      recent.every((d) => d.tsb >= t.tsbDetrainingAbove)
    ) {
      signals.push({
        code: "tsb_hoog",
        severity: "gemiddeld",
        reason: `TSB ligt al ${t.tsbDetrainingDays} dagen boven +${t.tsbDetrainingAbove} — je bent uitgerust, er is ruimte om op te bouwen.`,
      });
    }
  }

  /* ------------------------------- recovery ----------------------------- */

  if (wellness.length >= 7) {
    const sorted = [...wellness].sort((a, b) => (a.date > b.date ? -1 : 1)); // newest first
    const recent = sorted.slice(0, t.recoveryConsecutiveDays);
    const baseline = sorted.slice(t.recoveryConsecutiveDays, 28);

    if (baseline.length >= 5) {
      const baseRestingHr = averageOf(baseline, "resting_hr");
      const baseHrv = averageOf(baseline, "hrv_ms");

      const recentRestingHr = recent.map((r) => r.resting_hr).filter((v) => v != null);
      if (
        baseRestingHr !== null &&
        recentRestingHr.length === t.recoveryConsecutiveDays &&
        recentRestingHr.every((v) => v >= baseRestingHr + t.restingHrAboveBaseline)
      ) {
        signals.push({
          code: "rusthartslag_hoog",
          severity: "hoog",
          reason: `Rusthartslag ligt ${t.recoveryConsecutiveDays} dagen op rij minstens ${t.restingHrAboveBaseline} slagen boven je basislijn (${Math.round(baseRestingHr)}).`,
        });
      }

      const recentHrv = recent.map((r) => r.hrv_ms).filter((v) => v != null);
      if (
        baseHrv !== null &&
        recentHrv.length === t.recoveryConsecutiveDays &&
        recentHrv.every((v) => v <= baseHrv * t.hrvBelowBaselineFactor)
      ) {
        signals.push({
          code: "hrv_laag",
          severity: "hoog",
          reason: `HRV ligt ${t.recoveryConsecutiveDays} dagen op rij onder ${Math.round(t.hrvBelowBaselineFactor * 100)}% van je basislijn (${Math.round(baseHrv)} ms).`,
        });
      }
    }
  }

  /* ----------------------------- plan adherence ------------------------- */

  const weekAgo = new Date(today + "T00:00:00");
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoStr = calc.toDateStr(weekAgo);
  const missed = plans.filter(
    (p) => p.status === "overgeslagen" && p.date >= weekAgoStr && p.date < today
  );
  if (missed.length >= t.missedSessionsIn7Days) {
    signals.push({
      code: "gemiste_sessies",
      severity: "gemiddeld",
      reason: `${missed.length} geplande sessies niet gedaan in de afgelopen week — het plan sluit misschien niet aan.`,
    });
  }

  /* -------------------------------- events ------------------------------ */

  const soon = events.filter((e) => e.daysUntil >= 0 && e.daysUntil <= t.eventWithinDays);
  if (soon.length > 0) {
    const next = soon.sort((a, b) => a.daysUntil - b.daysUntil)[0];
    signals.push({
      code: "evenement_nadert",
      severity: "gemiddeld",
      reason: `${next.name} is over ${next.daysUntil} dagen — tijd om af te bouwen.`,
    });
  }

  return signals;
}

/**
 * Applies the cooldown and decides whether to actually consult the coach.
 *
 * Without this, a genuinely low TSB would trigger every single day for a week —
 * which is exactly the churn we're trying to avoid. Re-firing is only allowed
 * once the cooldown has passed, or immediately when a *different* signal
 * appears (something new happened, so it's worth saying something).
 */
function shouldConsult({ signals, lastRunAt, lastReason, cooldownDays = 3, now = new Date() }) {
  if (signals.length === 0) return { consult: false, reason: null };

  const codes = signals.map((s) => s.code).sort().join(",");

  if (lastRunAt) {
    const daysSince = (now - new Date(lastRunAt)) / 86400000;
    const sameAsLastTime = lastReason === codes;
    if (daysSince < cooldownDays && sameAsLastTime) {
      return {
        consult: false,
        reason: null,
        skipped: `zelfde signaal als ${Math.floor(daysSince)} dag(en) geleden, binnen de wachttijd van ${cooldownDays} dagen`,
      };
    }
  }

  // Lead with the most serious finding, but mention everything.
  const ordered = [...signals].sort((a, b) => (a.severity === "hoog" ? -1 : 1));
  return {
    consult: true,
    code: codes,
    reason: ordered.map((s) => s.reason).join(" "),
    signals: ordered,
  };
}

/**
 * True when the configured weekly slot has come round and this week's run
 * hasn't happened yet. Compares by date rather than by elapsed hours so a
 * server restart can't cause a second run in the same week.
 */
function isWeeklySlotDue({ weekday, hour, lastRunAt, now = new Date(), weekdayNameForDate }) {
  const todayName = weekdayNameForDate(now.toISOString().slice(0, 10));
  if (todayName !== weekday) return false;
  if (now.getHours() < hour) return false;

  if (lastRunAt) {
    const last = new Date(lastRunAt);
    const daysSince = (now - last) / 86400000;
    if (daysSince < 6) return false; // already ran this week
  }
  return true;
}

module.exports = { detectSignals, shouldConsult, isWeeklySlotDue, DEFAULTS };
