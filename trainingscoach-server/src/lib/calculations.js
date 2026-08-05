/**
 * calculations.js
 *
 * Pure, deterministic training-science calculations — no React, no browser APIs,
 * no dependency on Express or the database. This is the same logic that was
 * built and tested inside the Claude-artifact prototype, extracted so it's
 * directly reusable and independently testable in the server.
 *
 * Every function here is a pure function: same input -> same output, no
 * side effects. Keep it that way — this module is the "hard math" layer that
 * the AI coach is instructed to defer to rather than re-derive itself.
 */

"use strict";

/* ---------------------------------------------------------------------- */
/* Dates / weekdays                                                       */
/* ---------------------------------------------------------------------- */

const WEEKDAYS = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag", "Zondag"];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function weekdayNameForDate(dateStr) {
  const jsDay = new Date(dateStr + "T00:00:00").getDay(); // 0=Sunday..6=Saturday
  const idx = (jsDay + 6) % 7; // remap to 0=Monday..6=Sunday
  return WEEKDAYS[idx];
}

function daysUntil(dateStr) {
  const today = new Date(todayStr() + "T00:00:00");
  const target = new Date(dateStr + "T00:00:00");
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

/* ---------------------------------------------------------------------- */
/* Heart rate zones                                                       */
/* ---------------------------------------------------------------------- */

const HR_ZONE_DEFS = [
  { zone: 1, naam: "Herstel", van: 0.5, tot: 0.6 },
  { zone: 2, naam: "Duurtraining", van: 0.6, tot: 0.7 },
  { zone: 3, naam: "Tempo", van: 0.7, tot: 0.8 },
  { zone: 4, naam: "Drempel", van: 0.8, tot: 0.9 },
  { zone: 5, naam: "Maximaal", van: 0.9, tot: 1.0 },
];

/**
 * Uses the Karvonen (heart rate reserve) method when resting HR is known,
 * which is more personalized than a flat percentage of max HR; falls back
 * to %max if resting HR is missing.
 */
function computeHrZones(maxHr, restingHr) {
  if (!maxHr) return null;
  const hasReserve = !!restingHr && restingHr < maxHr;
  return HR_ZONE_DEFS.map((z) => {
    if (hasReserve) {
      const reserve = maxHr - restingHr;
      return { ...z, vanBpm: Math.round(restingHr + reserve * z.van), totBpm: Math.round(restingHr + reserve * z.tot) };
    }
    return { ...z, vanBpm: Math.round(maxHr * z.van), totBpm: Math.round(maxHr * z.tot) };
  });
}

function zoneForHr(hr, zones) {
  if (!hr || !zones) return null;
  const match = zones.find((z) => hr >= z.vanBpm && hr <= z.totBpm);
  if (match) return match.zone;
  if (hr < zones[0].vanBpm) return 0;
  return 5;
}

/* ---------------------------------------------------------------------- */
/* Power zones (Coggan 7-zone model)                                      */
/* ---------------------------------------------------------------------- */

const POWER_ZONE_DEFS = [
  { zone: 1, naam: "Actief herstel", van: 0, tot: 0.55 },
  { zone: 2, naam: "Duurtraining", van: 0.55, tot: 0.75 },
  { zone: 3, naam: "Tempo", van: 0.76, tot: 0.9 },
  { zone: 4, naam: "Drempel", van: 0.91, tot: 1.05 },
  { zone: 5, naam: "VO2max", van: 1.06, tot: 1.2 },
  { zone: 6, naam: "Anaeroob", van: 1.21, tot: 1.5 },
  { zone: 7, naam: "Neuromusculair/sprint", van: 1.51, tot: 3.0 },
];

function computePowerZones(ftp) {
  if (!ftp) return null;
  return POWER_ZONE_DEFS.map((z) => ({
    ...z,
    vanW: Math.round(ftp * z.van),
    totW: z.tot >= 3.0 ? null : Math.round(ftp * z.tot),
  }));
}

/* ---------------------------------------------------------------------- */
/* Speed / distance                                                       */
/* ---------------------------------------------------------------------- */

function computeAvgSpeedKmh(distanceKm, durationMin) {
  if (!distanceKm || !durationMin) return null;
  const hours = durationMin / 60;
  if (hours <= 0) return null;
  return Math.round((distanceKm / hours) * 10) / 10;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ---------------------------------------------------------------------- */
/* Normalized Power                                                       */
/* ---------------------------------------------------------------------- */

/**
 * Standard "Normalized Power" algorithm: 30s rolling average of power,
 * raised to the 4th power, averaged, then 4th-rooted. Weights sustained
 * high efforts more heavily than a plain average — better reflects the
 * physiological cost of variable/interval efforts.
 *
 * @param {Array<{tSec: number, power: number|null}>} points - time-ordered samples
 */
function computeNormalizedPower(points) {
  const withPower = points.filter((p) => p.power !== null && p.power !== undefined && p.power >= 0);
  if (withPower.length < 10) return null;
  const totalSec = Math.floor(points[points.length - 1].tSec);
  if (totalSec < 30) return null;

  const resampled = new Array(totalSec + 1).fill(0);
  let pi = 0;
  for (let t = 0; t <= totalSec; t++) {
    while (pi < withPower.length - 1 && withPower[pi + 1].tSec <= t) pi++;
    resampled[t] = withPower[pi].tSec <= t ? withPower[pi].power : 0;
  }

  const windowSize = 30;
  const rolling = [];
  let sum = 0;
  const buffer = [];
  for (let t = 0; t < resampled.length; t++) {
    buffer.push(resampled[t]);
    sum += resampled[t];
    if (buffer.length > windowSize) sum -= buffer.shift();
    if (buffer.length === windowSize) rolling.push(sum / windowSize);
  }
  if (rolling.length === 0) return null;
  const meanFourthPower = rolling.reduce((a, b) => a + b ** 4, 0) / rolling.length;
  return Math.round(meanFourthPower ** 0.25);
}

/* ---------------------------------------------------------------------- */
/* TSS / CTL / ATL / TSB (Performance Management Chart model)             */
/* ---------------------------------------------------------------------- */

/**
 * TSS (Training Stress Score): 100 = one hour at exactly FTP. Prefers
 * power-based TSS (using Normalized Power when available, else plain avg
 * power) since that's the established standard formula. Falls back to an
 * hrTSS-style approximation using the heart-rate zone-4 boundary as an
 * estimated threshold HR when no power data is available — a rougher
 * estimate, clearly labeled as such via the `method` field.
 *
 * @param {{duration_min: number, avg_power?: number, weighted_avg_power?: number, avg_hr?: number}} session
 * @param {number|null} ftp
 * @param {Array|null} hrZones - result of computeHrZones()
 */
function computeSessionTSS(session, ftp, hrZones) {
  const durationHours = (session.duration_min || 0) / 60;
  if (durationHours <= 0) return null;

  const powerForTss = session.weighted_avg_power || session.avg_power;
  if (ftp && powerForTss) {
    const intensityFactor = powerForTss / ftp;
    return {
      tss: Math.round(durationHours * intensityFactor * intensityFactor * 100),
      intensityFactor: Math.round(intensityFactor * 100) / 100,
      method: "vermogen",
    };
  }

  if (hrZones && session.avg_hr) {
    const thresholdHr = hrZones[3].vanBpm; // lower bound of zone 4 ("Drempel") as an estimated threshold HR
    const hrIntensityFactor = session.avg_hr / thresholdHr;
    return {
      tss: Math.round(durationHours * hrIntensityFactor * hrIntensityFactor * 100),
      intensityFactor: Math.round(hrIntensityFactor * 100) / 100,
      method: "hartslag (schatting)",
    };
  }

  return null;
}

/**
 * CTL (Chronic Training Load / "Fitness"): 42-day exponentially weighted
 * average of daily TSS.
 * ATL (Acute Training Load / "Fatigue"): 7-day exponentially weighted
 * average of daily TSS.
 * TSB (Training Stress Balance / "Form") = CTL - ATL.
 *
 * This is the standard Performance Management Chart model used by
 * TrainingPeaks/WKO — pure arithmetic, computed once per day across the
 * full history, independent of the AI.
 *
 * @param {Array} cardioLogs - all cardio sessions (any date range)
 * @param {number|null} ftp
 * @param {Array|null} hrZones
 * @returns {Array<{date, label, ctl, atl, tsb, tss}>|null}
 */
function computeTrainingLoadSeries(cardioLogs, ftp, hrZones) {
  if (!cardioLogs || cardioLogs.length === 0) return null;
  const tssByDate = {};
  cardioLogs.forEach((c) => {
    const result = computeSessionTSS(c, ftp, hrZones);
    if (result) tssByDate[c.date] = (tssByDate[c.date] || 0) + result.tss;
  });
  const dates = Object.keys(tssByDate).sort();
  if (dates.length === 0) return null;

  const startDate = new Date(dates[0] + "T00:00:00");
  const endDate = new Date(todayStr() + "T00:00:00");
  let ctl = 0;
  let atl = 0;
  const series = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    const tss = tssByDate[dateStr] || 0;
    ctl = ctl + (tss - ctl) / 42;
    atl = atl + (tss - atl) / 7;
    series.push({
      date: dateStr,
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      tsb: Math.round((ctl - atl) * 10) / 10,
      tss,
    });
  }
  return series;
}

/* ---------------------------------------------------------------------- */
/* Body weight                                                            */
/* ---------------------------------------------------------------------- */

/**
 * Finds the weight that applied AT THE TIME of a given session — the most
 * recent weight log on or before that date — not the current/latest weight.
 * Falls back to the earliest known weight if the session predates all logs.
 */
function getWeightAtDate(weightLogs, dateStr) {
  if (!weightLogs || weightLogs.length === 0) return null;
  const onOrBefore = weightLogs.filter((w) => w.date <= dateStr).sort((a, b) => (a.date > b.date ? -1 : 1));
  if (onOrBefore.length > 0) return onOrBefore[0].weight_kg;
  const sorted = [...weightLogs].sort((a, b) => (a.date > b.date ? 1 : -1));
  return sorted[0].weight_kg;
}

function computeWattsPerKg(avgPowerW, weightKg) {
  if (!avgPowerW || !weightKg) return null;
  return Math.round((avgPowerW / weightKg) * 100) / 100;
}

/* ---------------------------------------------------------------------- */
/* Elevation                                                              */
/* ---------------------------------------------------------------------- */

/**
 * Computes total elevation gain/loss from a series of elevation samples,
 * ignoring changes smaller than the noise threshold so GPS/barometric
 * jitter doesn't inflate the total climb on flat terrain.
 *
 * @param {number[]} elevations - ordered elevation samples in meters
 */
function computeElevationGainLoss(elevations, noiseThresholdM = 1) {
  if (!elevations || elevations.length < 2) return { gain: 0, loss: 0 };
  let gain = 0;
  let loss = 0;
  let smoothed = elevations[0];
  for (let i = 1; i < elevations.length; i++) {
    const delta = elevations[i] - smoothed;
    if (Math.abs(delta) >= noiseThresholdM) {
      if (delta > 0) gain += delta;
      else loss += -delta;
      smoothed = elevations[i];
    }
  }
  return { gain: Math.round(gain), loss: Math.round(loss) };
}

/* ---------------------------------------------------------------------- */
/* Long-term history summaries                                            */
/* ---------------------------------------------------------------------- */

function avgOf(arr, getter) {
  const vals = arr.map(getter).filter((v) => v !== null && v !== undefined && !isNaN(v));
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}

function formatDateNL(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
}

function computeCardioHistorySummary(cardioLogs) {
  if (!cardioLogs || cardioLogs.length === 0) return null;
  const sorted = [...cardioLogs].sort((a, b) => (a.date < b.date ? -1 : 1));
  const today = new Date(todayStr() + "T00:00:00");
  const cutoffRecent = new Date(today);
  cutoffRecent.setDate(cutoffRecent.getDate() - 28);
  const cutoffPrev = new Date(today);
  cutoffPrev.setDate(cutoffPrev.getDate() - 56);
  const inRange = (dateStr, start, end) => {
    const d = new Date(dateStr + "T00:00:00");
    return d > start && d <= end;
  };
  const recent = cardioLogs.filter((c) => inRange(c.date, cutoffRecent, today));
  const prev = cardioLogs.filter((c) => inRange(c.date, cutoffPrev, cutoffRecent));
  const sumKm = (arr) => Math.round(arr.reduce((s, c) => s + (c.distance_km || 0), 0) * 10) / 10;
  const sumMin = (arr) => Math.round(arr.reduce((s, c) => s + (c.duration_min || 0), 0));
  const sumM = (arr) => Math.round(arr.reduce((s, c) => s + (c.elevation_gain_m || 0), 0));
  const byType = {};
  cardioLogs.forEach((c) => {
    byType[c.type] = (byType[c.type] || 0) + 1;
  });
  const periodStats = (arr) => ({
    sessies: arr.length,
    km: sumKm(arr),
    minuten: sumMin(arr),
    hoogtemetersTotaal: sumM(arr),
    gemHartslag: avgOf(arr, (c) => c.avg_hr),
    gemMaxHartslag: avgOf(arr, (c) => c.max_hr),
    gemSnelheidKmu: avgOf(arr, (c) => computeAvgSpeedKmh(c.distance_km, c.duration_min)),
    gemVermogen: avgOf(arr, (c) => c.avg_power),
  });
  return {
    totaalAantalSessiesOoit: cardioLogs.length,
    periode: `${formatDateNL(sorted[0].date)} t/m ${formatDateNL(sorted[sorted.length - 1].date)}`,
    verdelingPerType: byType,
    laatste4Weken: periodStats(recent),
    voorgaande4Weken: periodStats(prev),
  };
}

function computeStrengthHistorySummary(workoutLogs) {
  if (!workoutLogs || workoutLogs.length === 0) return null;
  const sorted = [...workoutLogs].sort((a, b) => (a.date < b.date ? -1 : 1));
  const exerciseNames = new Set();
  workoutLogs.forEach((l) => l.exercises.forEach((e) => e.sets.length && exerciseNames.add(e.name)));
  const voortgang = [];
  exerciseNames.forEach((name) => {
    const logsWithEx = sorted.filter((l) => l.exercises.some((e) => e.name === name && e.sets.length));
    if (logsWithEx.length < 2) return;
    const first = logsWithEx[0].exercises.find((e) => e.name === name);
    const last = logsWithEx[logsWithEx.length - 1].exercises.find((e) => e.name === name);
    const firstMax = Math.max(...first.sets.map((s) => s.weight));
    const lastMax = Math.max(...last.sets.map((s) => s.weight));
    voortgang.push({ oefening: name, eersteLog: firstMax, laatsteLog: lastMax, verschil: Math.round((lastMax - firstMax) * 10) / 10 });
  });
  return {
    totaalAantalSessiesOoit: workoutLogs.length,
    periode: `${formatDateNL(sorted[0].date)} t/m ${formatDateNL(sorted[sorted.length - 1].date)}`,
    voortgangPerOefeningSindsEersteLog: voortgang,
  };
}

/**
 * Session-RPE: duration x perceived exertion, the accepted way to quantify gym
 * work when there is no power meter. Returns null unless both are present —
 * a missing value must stay missing rather than become a quietly invented one.
 *
 * Accepts both the camelCase shape the API serializes (`durationMin`) and the
 * snake_case shape read straight from SQLite (`duration_min`). Reading only one
 * of the two is exactly the bug that kept sRPE permanently null in the coach
 * payload, so both are handled here in one place instead of at each call site.
 */
function computeSessionRpe(log) {
  if (!log) return null;
  const duration = log.durationMin ?? log.duration_min;
  if (!log.rpe || !duration) return null;
  return log.rpe * duration;
}

/**
 * Weekly strength load, as ISO weeks (Monday-based) of summed sRPE.
 *
 * Deliberately kept apart from computeTrainingLoadSeries: sRPE and TSS are not
 * the same unit and must never be added together or drawn on a shared axis.
 * This is the gym counterpart to the cardio-only PMC chart, not an extension
 * of it.
 *
 * Weeks in which sessions were logged without RPE/duration report sRPE null
 * but still count their sessions, so "trained but didn't rate it" stays
 * visible instead of looking like a rest week.
 */
function computeWeeklyStrengthLoad(workoutLogs, weeks = 12) {
  if (!workoutLogs || workoutLogs.length === 0) return null;

  const mondayOf = (dateStr) => {
    const d = new Date(dateStr + "T00:00:00");
    // getDay(): 0 = Sunday. Shift so Monday starts the week.
    const offset = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - offset);
    return d.toISOString().slice(0, 10);
  };

  const buckets = new Map();
  workoutLogs.forEach((log) => {
    if (!log.date) return;
    const week = mondayOf(log.date);
    if (!buckets.has(week)) buckets.set(week, { weekStart: week, sRpe: 0, rated: 0, sessions: 0 });
    const bucket = buckets.get(week);
    bucket.sessions += 1;
    const sRpe = computeSessionRpe(log);
    if (sRpe !== null) {
      bucket.sRpe += sRpe;
      bucket.rated += 1;
    }
  });

  return Array.from(buckets.values())
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1))
    .slice(-weeks)
    .map((b) => ({
      weekStart: b.weekStart,
      label: formatDateNL(b.weekStart),
      sessions: b.sessions,
      sessionsRated: b.rated,
      sRpe: b.rated > 0 ? b.sRpe : null,
    }));
}


/* ---------------------------------------------------------------------- */
/* Histograms, power curve, time-in-zone                                  */
/* ---------------------------------------------------------------------- */

/**
 * Builds a histogram of seconds spent at each value, from parallel
 * time/value arrays (as produced by a Strava stream or a GPX track).
 *
 * Storing a histogram rather than the raw per-second series is a deliberate
 * trade-off: it's a few hundred numbers instead of tens of thousands, and —
 * crucially — time-in-zone can be recomputed from it for ANY zone definition.
 * So when you later adjust your FTP or max heart rate, historical sessions
 * re-bucket correctly instead of being stuck with whatever zones applied on
 * the day they were imported.
 *
 * @param {number[]} timeSec - seconds since start, ascending
 * @param {Array<number|null>} values
 * @param {number} binSize - bucket width (1 for bpm, 5 or 10 for watts)
 * @returns {Object<string, number>} bin lower bound -> seconds
 */
function computeHistogram(timeSec, values, binSize = 1) {
  if (!Array.isArray(timeSec) || !Array.isArray(values) || timeSec.length < 2) return null;
  const hist = {};
  let counted = 0;
  for (let i = 0; i < timeSec.length - 1; i++) {
    const v = values[i];
    if (v === null || v === undefined || isNaN(v)) continue;
    // Gaps (auto-pause, lost signal) would otherwise be charged to whatever
    // value happened to precede them, so ignore implausibly long steps.
    const dt = timeSec[i + 1] - timeSec[i];
    if (!(dt > 0) || dt > 30) continue;
    const bin = Math.floor(v / binSize) * binSize;
    hist[bin] = (hist[bin] || 0) + dt;
    counted += dt;
  }
  return counted > 0 ? hist : null;
}

/** Total seconds represented by a histogram. */
function histogramTotalSeconds(hist) {
  if (!hist) return 0;
  return Object.values(hist).reduce((a, b) => a + b, 0);
}

/**
 * Distributes a histogram over zone definitions, returning seconds per zone.
 * Works for both heart rate zones (computeHrZones) and power zones
 * (computePowerZones) — pass the matching bound accessor.
 */
function timeInZones(hist, zones, lowerKey, upperKey) {
  if (!hist || !zones) return null;
  const result = zones.map((z) => ({ zone: z.zone, naam: z.naam, seconden: 0 }));
  Object.entries(hist).forEach(([binStr, seconds]) => {
    const value = Number(binStr);
    let idx = zones.findIndex(
      (z) => value >= z[lowerKey] && (z[upperKey] === null || value <= z[upperKey])
    );
    // Anything under zone 1 counts as zone 1; anything above the top zone as the top zone.
    if (idx === -1) idx = value < zones[0][lowerKey] ? 0 : zones.length - 1;
    result[idx].seconden += seconds;
  });
  return result.map((r) => ({ ...r, minuten: Math.round((r.seconden / 60) * 10) / 10 }));
}

const timeInHrZones = (hist, hrZones) => timeInZones(hist, hrZones, "vanBpm", "totBpm");
const timeInPowerZones = (hist, powerZones) => timeInZones(hist, powerZones, "vanW", "totW");

/** Durations (seconds) the power curve is sampled at — the conventional set. */
const POWER_CURVE_DURATIONS = [1, 5, 15, 30, 60, 120, 300, 480, 720, 1200, 1800, 3600];

/**
 * Mean maximal power: for each duration, the best average power sustained over
 * any window of that length. This is the standard way to track cycling
 * progress, and the 20-minute figure is what FTP is usually estimated from.
 *
 * Uses a prefix-sum so each duration costs one linear pass rather than
 * re-summing every window.
 */
function computePowerCurve(timeSec, watts) {
  if (!Array.isArray(timeSec) || !Array.isArray(watts) || timeSec.length < 2) return null;

  // Resample onto a 1 Hz grid: Strava streams are usually 1 Hz already, but
  // smart recording and GPX exports are not, and the windowing below assumes
  // evenly spaced samples.
  const totalSec = Math.floor(timeSec[timeSec.length - 1]);
  if (totalSec < 1) return null;
  const series = new Array(totalSec + 1).fill(null);
  let idx = 0;
  for (let t = 0; t <= totalSec; t++) {
    while (idx < timeSec.length - 1 && timeSec[idx + 1] <= t) idx++;
    const v = watts[idx];
    series[t] = v === null || v === undefined || isNaN(v) ? 0 : v;
  }

  const prefix = new Array(series.length + 1).fill(0);
  for (let i = 0; i < series.length; i++) prefix[i + 1] = prefix[i] + series[i];

  const curve = {};
  for (const d of POWER_CURVE_DURATIONS) {
    if (d > series.length) break;
    let best = 0;
    for (let start = 0; start + d <= series.length; start++) {
      const avg = (prefix[start + d] - prefix[start]) / d;
      if (avg > best) best = avg;
    }
    if (best > 0) curve[d] = Math.round(best);
  }
  return Object.keys(curve).length > 0 ? curve : null;
}

/**
 * Estimates FTP from a power curve. Prefers a real 60-minute effort when one
 * exists, otherwise falls back to the conventional 95% of best 20-minute
 * power. Returns null when there's nothing long enough to judge from.
 */
function estimateFtpFromCurve(curve) {
  if (!curve) return null;
  if (curve[3600]) return { ftp: curve[3600], basis: "60 minuten (gemeten)" };
  if (curve[1200]) return { ftp: Math.round(curve[1200] * 0.95), basis: "95% van beste 20 minuten" };
  if (curve[480]) return { ftp: Math.round(curve[480] * 0.9), basis: "90% van beste 8 minuten (ruwe schatting)" };
  return null;
}

/** Best value per duration across many sessions — the all-time power curve. */
function mergePowerCurves(curves) {
  const merged = {};
  curves.filter(Boolean).forEach((curve) => {
    Object.entries(curve).forEach(([d, w]) => {
      if (!merged[d] || w > merged[d]) merged[d] = w;
    });
  });
  return Object.keys(merged).length > 0 ? merged : null;
}

module.exports = {
  WEEKDAYS,
  todayStr,
  weekdayNameForDate,
  daysUntil,
  computeHrZones,
  zoneForHr,
  computePowerZones,
  computeAvgSpeedKmh,
  haversineKm,
  computeNormalizedPower,
  computeSessionTSS,
  computeTrainingLoadSeries,
  getWeightAtDate,
  computeWattsPerKg,
  computeElevationGainLoss,
  formatDateNL,
  avgOf,
  computeCardioHistorySummary,
  computeStrengthHistorySummary,
  computeSessionRpe,
  computeWeeklyStrengthLoad,
  computeHistogram,
  histogramTotalSeconds,
  timeInZones,
  timeInHrZones,
  timeInPowerZones,
  computePowerCurve,
  estimateFtpFromCurve,
  mergePowerCurves,
  POWER_CURVE_DURATIONS,
};
