/**
 * calculations.js — SHARED CALCULATION CORE (frontend copy)
 *
 * IMPORTANT: this file is an exact functional copy of
 * `server/src/lib/calculations.js`. Keep the two in sync when changing
 * anything here — the server uses its copy to build the AI coach payload,
 * the frontend uses this one to render charts and tables without a
 * round-trip. The server's copy is the source of truth for anything the
 * coach sees.
 *
 * Everything here is a pure function: same input -> same output, no side
 * effects, no React, no DOM.
 */


/* ---------------------------------------------------------------------- */
/* Dates / weekdays                                                       */
/* ---------------------------------------------------------------------- */

export const WEEKDAYS = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag", "Zondag"];

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function weekdayNameForDate(dateStr) {
  const jsDay = new Date(dateStr + "T00:00:00").getDay(); // 0=Sunday..6=Saturday
  const idx = (jsDay + 6) % 7; // remap to 0=Monday..6=Sunday
  return WEEKDAYS[idx];
}

export function daysUntil(dateStr) {
  const today = new Date(todayStr() + "T00:00:00");
  const target = new Date(dateStr + "T00:00:00");
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

/* ---------------------------------------------------------------------- */
/* Heart rate zones                                                       */
/* ---------------------------------------------------------------------- */

export const HR_ZONE_DEFS = [
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
export function computeHrZones(maxHr, restingHr) {
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

export function zoneForHr(hr, zones) {
  if (!hr || !zones) return null;
  const match = zones.find((z) => hr >= z.vanBpm && hr <= z.totBpm);
  if (match) return match.zone;
  if (hr < zones[0].vanBpm) return 0;
  return 5;
}

/* ---------------------------------------------------------------------- */
/* Power zones (Coggan 7-zone model)                                      */
/* ---------------------------------------------------------------------- */

export const POWER_ZONE_DEFS = [
  { zone: 1, naam: "Actief herstel", van: 0, tot: 0.55 },
  { zone: 2, naam: "Duurtraining", van: 0.55, tot: 0.75 },
  { zone: 3, naam: "Tempo", van: 0.76, tot: 0.9 },
  { zone: 4, naam: "Drempel", van: 0.91, tot: 1.05 },
  { zone: 5, naam: "VO2max", van: 1.06, tot: 1.2 },
  { zone: 6, naam: "Anaeroob", van: 1.21, tot: 1.5 },
  { zone: 7, naam: "Neuromusculair/sprint", van: 1.51, tot: 3.0 },
];

export function computePowerZones(ftp) {
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

export function computeAvgSpeedKmh(distanceKm, durationMin) {
  if (!distanceKm || !durationMin) return null;
  const hours = durationMin / 60;
  if (hours <= 0) return null;
  return Math.round((distanceKm / hours) * 10) / 10;
}

export function haversineKm(lat1, lon1, lat2, lon2) {
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
export function computeNormalizedPower(points) {
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
export function computeSessionTSS(session, ftp, hrZones) {
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
export function computeTrainingLoadSeries(cardioLogs, ftp, hrZones) {
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
export function getWeightAtDate(weightLogs, dateStr) {
  if (!weightLogs || weightLogs.length === 0) return null;
  const onOrBefore = weightLogs.filter((w) => w.date <= dateStr).sort((a, b) => (a.date > b.date ? -1 : 1));
  if (onOrBefore.length > 0) return onOrBefore[0].weight_kg;
  const sorted = [...weightLogs].sort((a, b) => (a.date > b.date ? 1 : -1));
  return sorted[0].weight_kg;
}

export function computeWattsPerKg(avgPowerW, weightKg) {
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
export function computeElevationGainLoss(elevations, noiseThresholdM = 1) {
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

export function avgOf(arr, getter) {
  const vals = arr.map(getter).filter((v) => v !== null && v !== undefined && !isNaN(v));
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}

export function formatDateNL(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
}

export function computeCardioHistorySummary(cardioLogs) {
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

export function computeStrengthHistorySummary(workoutLogs) {
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


/* ---------------------------------------------------------------------- */
/* Frontend-only helpers                                                  */
/* ---------------------------------------------------------------------- */

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function defaultTimeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return "ochtend";
  if (h < 18) return "middag";
  return "avond";
}

export function timeOfDayLabel(id) {
  const map = { ochtend: "Ochtend", middag: "Middag", avond: "Avond" };
  return map[id] || null;
}
