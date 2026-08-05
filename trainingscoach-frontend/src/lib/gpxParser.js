/**
 * gpxParser.js — browser-only GPX parsing.
 *
 * Stays client-side because the user picks files in the browser; the
 * parsed result is then POSTed to the API as a normal cardio session.
 * Uses DOMParser and DecompressionStream, both native browser APIs.
 */

import { haversineKm, computeNormalizedPower } from "./calculations";
import { defaultTimeOfDay } from "./uiHelpers";

// GPX extensions use varying namespace prefixes (gpxtpx:hr, ns3:hr, plain hr, ...)
// depending on the device/exporter, so match by local tag name rather than a
// fixed namespace-qualified name.
function findByLocalName(el, name) {
  const all = el.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName && all[i].localName.toLowerCase() === name.toLowerCase()) return all[i];
  }
  return null;
}

export function guessTimeOfDayFromDate(raw) {
  if (!raw) return defaultTimeOfDay();
  const s = String(raw);
  const m = s.match(/(\d{1,2}):(\d{2})(:\d{2})?\s*(AM|PM|am|pm)?/);
  if (!m) return defaultTimeOfDay();
  let h = Number(m[1]);
  const ampm = m[4];
  if (ampm) {
    if (/pm/i.test(ampm) && h < 12) h += 12;
    if (/am/i.test(ampm) && h === 12) h = 0;
  }
  if (h < 12) return "ochtend";
  if (h < 18) return "middag";
  return "avond";
}


/**
 * Parses a GPX file's trackpoints into a session object plus a time-bucketed
 * profile of heart rate, speed, power, cadence and elevation — so structure
 * *within* a session (e.g. intervals) is visible, not just one average.
 *
 * Returns null if the file has no usable timestamped track points.
 */
export function parseGpxToSession(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return null;
  const trkpts = Array.from(doc.getElementsByTagName("trkpt"));
  if (trkpts.length < 2) return null;

  const trkEl = doc.getElementsByTagName("trk")[0];
  const typeEl = trkEl ? trkEl.getElementsByTagName("type")[0] : null;
  const guessedType = typeEl ? typeEl.textContent : null;

  const rawPoints = trkpts
    .map((pt) => {
      const lat = parseFloat(pt.getAttribute("lat"));
      const lon = parseFloat(pt.getAttribute("lon"));
      const timeEl = pt.getElementsByTagName("time")[0];
      const time = timeEl ? new Date(timeEl.textContent).getTime() : NaN;
      const eleEl = pt.getElementsByTagName("ele")[0];
      const ele = eleEl ? Number(eleEl.textContent) : null;
      const hrEl = findByLocalName(pt, "hr");
      const hr = hrEl ? Number(hrEl.textContent) : null;
      const powerEl = findByLocalName(pt, "power");
      const power = powerEl ? Number(powerEl.textContent) : null;
      const cadEl = findByLocalName(pt, "cad");
      const cadence = cadEl ? Number(cadEl.textContent) : null;
      return { lat, lon, time, ele, hr, power, cadence };
    })
    .filter((p) => !isNaN(p.time) && !isNaN(p.lat) && !isNaN(p.lon));

  if (rawPoints.length < 2) return null;

  const MOVING_SPEED_THRESHOLD_KMH = 1.5; // below this, treat as stopped/paused (matches how Strava/Garmin compute "moving time")
  const ELEVATION_NOISE_THRESHOLD_M = 1; // ignore elevation jitter smaller than this per step, to avoid GPS/barometric noise inflating total climb

  const startTime = rawPoints[0].time;
  let cumDistKm = 0;
  let movingDurationSec = 0;
  let elevationGainM = 0;
  let elevationLossM = 0;
  let smoothedEle = rawPoints[0].ele !== null && !isNaN(rawPoints[0].ele) ? rawPoints[0].ele : null;
  const points = rawPoints.map((p, i) => {
    let speedKmh = null;
    if (i > 0) {
      const prev = rawPoints[i - 1];
      const segKm = haversineKm(prev.lat, prev.lon, p.lat, p.lon);
      const segSec = (p.time - prev.time) / 1000;
      const segHours = segSec / 3600;
      cumDistKm += segKm;
      if (segHours > 0) {
        const s = segKm / segHours;
        speedKmh = s < 80 ? s : null; // discard GPS-noise spikes from the displayed/plotted speed
        if (s >= MOVING_SPEED_THRESHOLD_KMH) movingDurationSec += segSec; // still counts toward moving time even if s > 80 (real fast movement)
      }
      if (p.ele !== null && !isNaN(p.ele) && smoothedEle !== null) {
        const delta = p.ele - smoothedEle;
        if (Math.abs(delta) >= ELEVATION_NOISE_THRESHOLD_M) {
          if (delta > 0) elevationGainM += delta;
          else elevationLossM += -delta;
          smoothedEle = p.ele;
        }
      } else if (p.ele !== null && !isNaN(p.ele) && smoothedEle === null) {
        smoothedEle = p.ele;
      }
    }
    return { tSec: (p.time - startTime) / 1000, ele: p.ele, hr: p.hr, speedKmh, power: p.power, cadence: p.cadence };
  });

  const totalDurationMin = (rawPoints[rawPoints.length - 1].time - startTime) / 1000 / 60;
  if (totalDurationMin <= 0) return null;
  const movingDurationMin = movingDurationSec / 60;

  const hrs = points.map((p) => p.hr).filter((h) => h !== null && h > 0);
  const avgHr = hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null;
  const maxHr = hrs.length ? Math.max(...hrs) : null;

  const powers = points.map((p) => p.power).filter((w) => w !== null && w >= 0);
  const avgPower = powers.length ? Math.round(powers.reduce((a, b) => a + b, 0) / powers.length) : null;
  const maxPower = powers.length ? Math.max(...powers) : null;
  const weightedAvgPower = computeNormalizedPower(points);

  const cadences = points.map((p) => p.cadence).filter((c) => c !== null && c >= 0);
  const avgCadence = cadences.length ? Math.round(cadences.reduce((a, b) => a + b, 0) / cadences.length) : null;
  const maxCadence = cadences.length ? Math.max(...cadences) : null;

  // Resolution matters more than it looks: with buckets that are too wide, an
  // interval session averages out to a flat line (a 2-minute bucket over
  // 1-on/1-off intervals shows only the mean, hiding the structure entirely).
  // Aim for ~30-second buckets, widening only when a long ride would otherwise
  // produce hundreds of points.
  const TARGET_BUCKET_SECONDS = 30;
  const numBuckets = Math.max(4, Math.min(60, Math.round((totalDurationMin * 60) / TARGET_BUCKET_SECONDS)));
  const bucketSec = (totalDurationMin * 60) / numBuckets;
  const profile = [];
  for (let b = 0; b < numBuckets; b++) {
    const startSec = b * bucketSec;
    const endSec = (b + 1) * bucketSec;
    const inBucket = points.filter((p) => p.tSec >= startSec && p.tSec < endSec);
    const bHrs = inBucket.map((p) => p.hr).filter((h) => h !== null && h > 0);
    const bSpeeds = inBucket.map((p) => p.speedKmh).filter((s) => s !== null && s > 0);
    const bPowers = inBucket.map((p) => p.power).filter((w) => w !== null && w >= 0);
    const bCadences = inBucket.map((p) => p.cadence).filter((c) => c !== null && c >= 0);
    const bEles = inBucket.map((p) => p.ele).filter((el) => el !== null && !isNaN(el));
    profile.push({
      tMin: Math.round((startSec / 60) * 10) / 10,
      gemHartslag: bHrs.length ? Math.round(bHrs.reduce((a, b) => a + b, 0) / bHrs.length) : null,
      gemSnelheidKmu: bSpeeds.length ? Math.round((bSpeeds.reduce((a, b) => a + b, 0) / bSpeeds.length) * 10) / 10 : null,
      gemVermogen: bPowers.length ? Math.round(bPowers.reduce((a, b) => a + b, 0) / bPowers.length) : null,
      gemCadans: bCadences.length ? Math.round(bCadences.reduce((a, b) => a + b, 0) / bCadences.length) : null,
      hoogte: bEles.length ? Math.round(bEles.reduce((a, b) => a + b, 0) / bEles.length) : null,
    });
  }

  const startDate = new Date(startTime);
  const dateStr = startDate.toISOString().slice(0, 10);
  return {
    date: dateStr,
    timeOfDay: guessTimeOfDayFromDate(startDate.toISOString()),
    duration_min: Math.round(movingDurationMin * 10) / 10,
    total_duration_min: Math.round(totalDurationMin * 10) / 10,
    distance_km: Math.round(cumDistKm * 100) / 100,
    avg_hr: avgHr,
    max_hr: maxHr,
    avg_power: avgPower,
    max_power: maxPower,
    weighted_avg_power: weightedAvgPower,
    avg_cadence: avgCadence,
    max_cadence: maxCadence,
    elevation_gain_m: Math.round(elevationGainM),
    elevation_loss_m: Math.round(elevationLossM),
    guessedType: guessedType,
    profile,
  };
}


/**
 * Uses the browser's native DecompressionStream to unzip .gpx.gz files,
 * which is how Strava's bulk archive stores individual activity files.
 */
async function decompressGzipToText(file) {
  const stream = file.stream().pipeThrough(new DecompressionStream("gzip"));
  const response = new Response(stream);
  return await response.text();
}

/** Dispatches on file extension; throws a user-facing message for unsupported types. */
export async function readGpxFileAsText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".gpx.gz")) return await decompressGzipToText(file);
  if (name.endsWith(".gpx")) return await file.text();
  if (name.endsWith(".fit") || name.endsWith(".fit.gz")) {
    throw new Error(
      "FIT-bestanden worden niet ondersteund (alleen GPX). Exporteer als GPX in plaats van FIT, of gebruik een online FIT-naar-GPX-converter."
    );
  }
  throw new Error("Onbekend bestandstype — verwacht .gpx of .gpx.gz.");
}
