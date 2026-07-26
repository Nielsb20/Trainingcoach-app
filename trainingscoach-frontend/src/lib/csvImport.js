/**
 * csvImport.js — parsing helpers for Strava/Garmin CSV activity exports.
 *
 * Deliberately index-based rather than header-object-based: Dutch Strava
 * exports reuse column names (e.g. "Afstand" appears twice — once in km,
 * once in meters) and contain a stray empty "Type" column that shadows the
 * real "Activiteitstype". Looking columns up by index, using an explicit
 * ordered candidate list, is the only reliable approach we found against
 * real export files.
 */

import { CARDIO_TYPES, DUTCH_MONTHS } from "./constants";
import { todayStr } from "./calculations";
import { guessTimeOfDayFromDate } from "./gpxParser";


// Finds the first column index whose header exactly matches (case/whitespace-insensitive)
// one of the candidates, trying candidates in priority order. Using indices (rather than
// building a row object) is essential because Strava's Dutch export reuses column names
// like "Afstand" multiple times (once in km, once in meters) - we need the FIRST occurrence.
export function firstIndexOfExact(headers, candidates) {
  const lower = headers.map((h) => String(h).toLowerCase().trim());
  for (const c of candidates) {
    const idx = lower.indexOf(c);
    if (idx !== -1) return idx;
  }
  return -1;
}

export function toNum(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(String(raw).trim().replace(",", "."));
  return isNaN(n) ? null : n;
}

export function parseDurationToMinutes(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const s = String(raw).trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    // plain number: seconds (Strava/Garmin elapsed or moving time)
    const n = Number(s);
    return n > 0 ? Math.round((n / 60) * 10) / 10 : null;
  }
  const parts = s.split(":").map((p) => Number(p));
  if (parts.some((p) => isNaN(p))) return null;
  if (parts.length === 3) return Math.round((parts[0] * 60 + parts[1] + parts[2] / 60) * 10) / 10;
  if (parts.length === 2) return Math.round((parts[0] + parts[1] / 60) * 10) / 10;
  return null;
}

export function parseDistanceToKm(raw) {
  const n = toNum(raw);
  if (n === null) return null;
  // heuristic: values over 400 are almost certainly meters, not km
  if (n > 400) return Math.round((n / 1000) * 100) / 100;
  return Math.round(n * 100) / 100;
}

export function isNonCardioType(raw) {
  if (!raw) return false;
  return String(raw).toLowerCase().includes("kracht");
}

export function guessCardioType(raw) {
  if (!raw) return CARDIO_TYPES[4];
  const s = String(raw).toLowerCase();
  if (s.includes("kracht")) return CARDIO_TYPES[4]; // Krachttraining: not cardio, flagged separately
  if (s.includes("hardloop") || s.includes("run")) return "Hardlopen";
  if (s.includes("fiets") || s.includes("ride") || s.includes("bike") || s.includes("cycl")) return "Fietsen";
  if (s.includes("zwem") || s.includes("swim")) return "Zwemmen";
  if (s.includes("wandel") || s.includes("walk") || s.includes("hik")) return "Wandelen";
  return "Anders";
}

export function parseImportedDate(raw) {
  if (!raw) return todayStr();
  const s = String(raw).trim();
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // Dutch Strava format: "1 jul 2026, 16:52:24"
  const dutch = s.match(/(\d{1,2})\s+([a-zA-Zé]+)\.?\s+(\d{4})/i);
  if (dutch) {
    const month = DUTCH_MONTHS[dutch[2].toLowerCase().slice(0, 3)];
    if (month !== undefined) {
      const mm = String(month + 1).padStart(2, "0");
      const dd = String(Number(dutch[1])).padStart(2, "0");
      return `${dutch[3]}-${mm}-${dd}`;
    }
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return todayStr();
}


/**
 * Maps a parsed CSV (array-of-arrays, first row = headers) onto our cardio
 * session shape. Returns { rows } on success or { error } with a
 * user-facing message.
 *
 * Strength-training rows are included but pre-unchecked (`include: false`),
 * since they aren't cardio — the user can still opt them in.
 */
export function mapActivitiesCsv(data) {
  if (!data || data.length < 2) {
    return { error: "Dit bestand bevat geen activiteiten." };
  }
  const headers = data[0];
  const idx = {
    date: firstIndexOfExact(headers, ["datum van activiteit", "activity date", "date"]),
    type: firstIndexOfExact(headers, ["activiteitstype", "activity type"]),
    name: firstIndexOfExact(headers, ["naam activiteit", "activity name", "title", "naam", "name"]),
    dist: firstIndexOfExact(headers, ["afstand", "distance"]),
    duration: firstIndexOfExact(headers, ["beweegtijd", "moving time", "verstreken tijd", "elapsed time", "time", "duration"]),
    hr: firstIndexOfExact(headers, ["gemiddelde hartslag", "average heart rate", "avg hr", "heart rate"]),
    maxHr: firstIndexOfExact(headers, ["max. hartslag", "max heart rate", "maximale hartslag", "max hr"]),
    avgPower: firstIndexOfExact(headers, ["gemiddeld wattage", "average watts", "avg power", "average power"]),
    maxPower: firstIndexOfExact(headers, ["maximaal wattage", "max watts", "max power", "maximum power"]),
    np: firstIndexOfExact(headers, ["gewogen gemiddeld vermogen", "weighted average power", "normalized power"]),
    avgCadence: firstIndexOfExact(headers, ["gemiddelde cadans", "average cadence", "avg cadence"]),
    maxCadence: firstIndexOfExact(headers, ["max. cadans", "max cadence", "maximum cadence"]),
    elevGain: firstIndexOfExact(headers, ["totale stijging", "elevation gain", "total elevation gain"]),
    elevLoss: firstIndexOfExact(headers, ["totale daling", "elevation loss", "total elevation loss"]),
    pace: firstIndexOfExact(headers, ["gemiddelde tempo", "avg pace", "pace"]),
    cal: firstIndexOfExact(headers, ["calorieën", "calorieen", "calories"]),
  };

  if (idx.date === -1 && idx.type === -1) {
    return {
      error: "Geen herkenbare activiteiten gevonden in dit bestand. Controleer of het een Strava- of Garmin-export is.",
    };
  }

  const at = (row, i) => (i !== -1 ? row[i] : null);
  const numAt = (row, i) => (i !== -1 ? toNum(row[i]) : null);
  const roundOrNull = (v) => (v !== null ? Math.round(v) : null);

  const rows = data
    .slice(1)
    .filter((r) => r.length > 1)
    .map((r) => {
      const rawDate = at(r, idx.date);
      const rawType = at(r, idx.type) || "";
      return {
        include: !isNonCardioType(rawType),
        date: parseImportedDate(rawDate),
        timeOfDay: guessTimeOfDayFromDate(rawDate),
        type: guessCardioType(rawType),
        duration_min: idx.duration !== -1 ? parseDurationToMinutes(r[idx.duration]) : null,
        distance_km: idx.dist !== -1 ? parseDistanceToKm(r[idx.dist]) : null,
        avg_hr: roundOrNull(numAt(r, idx.hr)),
        max_hr: roundOrNull(numAt(r, idx.maxHr)),
        avg_power: roundOrNull(numAt(r, idx.avgPower)),
        max_power: roundOrNull(numAt(r, idx.maxPower)),
        weighted_avg_power: roundOrNull(numAt(r, idx.np)),
        avg_cadence: roundOrNull(numAt(r, idx.avgCadence)),
        max_cadence: roundOrNull(numAt(r, idx.maxCadence)),
        elevation_gain_m: roundOrNull(numAt(r, idx.elevGain)),
        elevation_loss_m: roundOrNull(numAt(r, idx.elevLoss)),
        pace: at(r, idx.pace) || null,
        calories: roundOrNull(numAt(r, idx.cal)),
        notes: at(r, idx.name) || "",
      };
    });

  if (rows.length === 0) return { error: "Geen activiteiten gevonden in dit bestand." };
  return { rows };
}
