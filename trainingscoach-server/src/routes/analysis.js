"use strict";

/**
 * Derived-analysis endpoints. These read the histograms and power curves
 * stored at import time and combine them with the athlete's current zones —
 * so adjusting your FTP or max heart rate immediately re-buckets the whole
 * history, rather than leaving old sessions stuck in stale zones.
 */

const express = require("express");
const { db } = require("../db/db");
const calc = require("../lib/calculations");

const router = express.Router();

function getProfile() {
  const row = db.prepare("SELECT * FROM profile WHERE id = 1").get();
  return { maxHr: row?.max_hr ?? null, restingHr: row?.resting_hr ?? null, ftp: row?.ftp ?? null };
}

/** ISO week key (e.g. "2026-W31") — weeks start on Monday. */
function isoWeekKey(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - day + 3); // nearest Thursday decides the year
  const firstThursday = new Date(d.getFullYear(), 0, 4);
  const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * GET /api/analysis/zones?weeks=8&metric=hr|power
 * Time spent per training zone, grouped by week.
 */
router.get("/zones", (req, res) => {
  const weeks = Math.min(Number(req.query.weeks) || 8, 52);
  const metric = req.query.metric === "power" ? "power" : "hr";
  const profile = getProfile();

  const zones =
    metric === "power"
      ? profile.ftp
        ? calc.computePowerZones(profile.ftp)
        : null
      : profile.maxHr
      ? calc.computeHrZones(profile.maxHr, profile.restingHr)
      : null;

  if (!zones) {
    return res.json({
      available: false,
      reason:
        metric === "power"
          ? "Vul je FTP in bij Schema → Persoonlijk profiel om vermogenszones te berekenen."
          : "Vul je max. hartslag in bij Schema → Persoonlijk profiel om hartslagzones te berekenen.",
      zones: null,
      weken: [],
    });
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - weeks * 7);
  const cutoffStr = calc.toDateStr(cutoff);

  const column = metric === "power" ? "power_histogram_json" : "hr_histogram_json";
  const rows = db
    .prepare(`SELECT date, ${column} AS hist FROM cardio_logs WHERE date >= ? ORDER BY date`)
    .all(cutoffStr);

  const byWeek = new Map();
  let sessionsWithData = 0;

  rows.forEach((row) => {
    if (!row.hist) return;
    sessionsWithData++;
    const hist = JSON.parse(row.hist);
    const inZones = metric === "power" ? calc.timeInPowerZones(hist, zones) : calc.timeInHrZones(hist, zones);
    const key = isoWeekKey(row.date);
    if (!byWeek.has(key)) {
      byWeek.set(key, { week: key, eersteDag: row.date, zones: zones.map((z) => ({ zone: z.zone, naam: z.naam, minuten: 0 })) });
    }
    const bucket = byWeek.get(key);
    inZones.forEach((z, i) => {
      bucket.zones[i].minuten += z.minuten;
    });
  });

  const weken = Array.from(byWeek.values())
    .sort((a, b) => (a.eersteDag > b.eersteDag ? 1 : -1))
    .map((w) => ({
      ...w,
      zones: w.zones.map((z) => ({ ...z, minuten: Math.round(z.minuten) })),
      totaalMinuten: Math.round(w.zones.reduce((s, z) => s + z.minuten, 0)),
    }));

  res.json({
    available: weken.length > 0,
    metric,
    zones: zones.map((z) => ({
      zone: z.zone,
      naam: z.naam,
      van: metric === "power" ? z.vanW : z.vanBpm,
      tot: metric === "power" ? z.totW : z.totBpm,
    })),
    sessiesMetData: sessionsWithData,
    totaalSessies: rows.length,
    weken,
  });
});

/**
 * GET /api/analysis/power-curve?days=90
 * All-time best power per duration, plus the same for a recent window, so you
 * can see whether current form is at, above or below your historical best.
 */
router.get("/power-curve", (req, res) => {
  const days = Math.min(Number(req.query.days) || 90, 3650);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = calc.toDateStr(cutoff);

  const all = db.prepare("SELECT date, power_curve_json FROM cardio_logs WHERE power_curve_json IS NOT NULL").all();
  if (all.length === 0) {
    return res.json({
      available: false,
      reason:
        "Nog geen vermogensdata met verloop. Synchroniseer met Strava — de curve wordt bij het importeren berekend.",
    });
  }

  const parse = (rows) => rows.map((r) => JSON.parse(r.power_curve_json));
  const allTime = calc.mergePowerCurves(parse(all));
  const recentRows = all.filter((r) => r.date >= cutoffStr);
  const recent = recentRows.length ? calc.mergePowerCurves(parse(recentRows)) : null;

  const durations = calc.POWER_CURVE_DURATIONS.filter((d) => allTime[d] !== undefined);
  const profile = getProfile();
  const weightRow = db.prepare("SELECT weight_kg FROM weight_logs ORDER BY date DESC LIMIT 1").get();
  const weightKg = weightRow?.weight_kg ?? null;

  res.json({
    available: true,
    sessies: all.length,
    sessiesRecent: recentRows.length,
    dagenRecent: days,
    punten: durations.map((d) => ({
      duurSeconden: d,
      label: d < 60 ? `${d}s` : `${d / 60}min`,
      altijd: allTime[d] ?? null,
      recent: recent?.[d] ?? null,
      altijdWattPerKg: weightKg && allTime[d] ? Math.round((allTime[d] / weightKg) * 100) / 100 : null,
    })),
    ftpSchatting: calc.estimateFtpFromCurve(recent || allTime),
    ingevuldeFtp: profile.ftp,
  });
});

module.exports = router;
