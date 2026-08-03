"use strict";

/**
 * Settings for automatic coach consultation, plus a manual trigger so the
 * athlete can test the setup without waiting for Sunday evening.
 */

const express = require("express");
const { db } = require("../db/db");
const scheduler = require("../lib/scheduler");
const { detectSignals, shouldConsult } = require("../lib/automation");

const router = express.Router();

function serialize(row) {
  return {
    weeklyEnabled: !!row.weekly_enabled,
    weeklyWeekday: row.weekly_weekday,
    weeklyHour: row.weekly_hour,
    signalsEnabled: !!row.signals_enabled,
    cooldownDays: row.cooldown_days,
    lastWeeklyRun: row.last_weekly_run,
    lastSignalRun: row.last_signal_run,
    lastError: row.last_error,
  };
}

const getRow = () => db.prepare("SELECT * FROM coach_automation WHERE id = 1").get();

// GET /api/automation
router.get("/", (req, res) => {
  const settings = serialize(getRow());
  // Show what the signal check sees right now, so the athlete can judge
  // whether the thresholds suit them before switching anything on.
  const state = scheduler.gatherState();
  const signals = detectSignals(state);
  res.json({ settings, huidigeSignalen: signals });
});

// PUT /api/automation
router.put("/", (req, res) => {
  const b = req.body || {};
  const current = getRow();
  db.prepare(
    `UPDATE coach_automation
     SET weekly_enabled = ?, weekly_weekday = ?, weekly_hour = ?,
         signals_enabled = ?, cooldown_days = ?
     WHERE id = 1`
  ).run(
    b.weeklyEnabled ? 1 : 0,
    b.weeklyWeekday || current.weekly_weekday,
    Number.isInteger(b.weeklyHour) ? b.weeklyHour : current.weekly_hour,
    b.signalsEnabled ? 1 : 0,
    Number(b.cooldownDays) || current.cooldown_days
  );
  res.json(serialize(getRow()));
});

/**
 * POST /api/automation/run  { type: 'wekelijks' | 'signaal' }
 * Runs a consultation now — useful for checking the setup works rather than
 * discovering on Sunday that it doesn't.
 */
router.post("/run", async (req, res) => {
  const type = req.body?.type === "signaal" ? "signaal" : "wekelijks";
  try {
    if (type === "wekelijks") {
      await scheduler.runWeekly(getRow());
      return res.json({ ok: true, type });
    }

    const state = scheduler.gatherState();
    const signals = detectSignals(state);
    if (signals.length === 0) {
      return res.json({ ok: true, type, overgeslagen: "Er zijn op dit moment geen signalen." });
    }
    // A manual run ignores the cooldown — the athlete explicitly asked for it.
    await scheduler.runSignalCheck({ ...getRow(), last_signal_run: null, last_signal_reason: null });
    res.json({ ok: true, type, signalen: signals });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
