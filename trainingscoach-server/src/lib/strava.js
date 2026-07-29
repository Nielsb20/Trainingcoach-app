"use strict";

/**
 * strava.js — everything that talks to the Strava API.
 *
 * Two separate concerns live here:
 *  1. OAuth token lifecycle. Strava access tokens expire after ~6 hours; the
 *     refresh token is long-lived. Every outbound call goes through
 *     getValidAccessToken(), which transparently refreshes when needed.
 *  2. Converting a Strava activity + its streams into the same cardio session
 *     shape the GPX importer produces, so downstream code (charts, TSS, the
 *     coach payload) doesn't care where a session came from.
 */

const { db } = require("../db/db");
const calc = require("./calculations");

const STRAVA_API = "https://www.strava.com/api/v3";
const STRAVA_OAUTH = "https://www.strava.com/oauth";

/* ------------------------------- tokens -------------------------------- */

function getStoredTokens() {
  return db.prepare("SELECT * FROM strava_tokens WHERE id = 1").get();
}

function saveTokens({ access_token, refresh_token, expires_at, athlete }) {
  const existing = getStoredTokens();
  db.prepare(
    `UPDATE strava_tokens
     SET access_token = ?, refresh_token = ?, expires_at = ?,
         athlete_id = ?, athlete_name = ?, connected_at = ?
     WHERE id = 1`
  ).run(
    access_token,
    refresh_token,
    expires_at,
    athlete?.id ?? existing?.athlete_id ?? null,
    athlete ? `${athlete.firstname || ""} ${athlete.lastname || ""}`.trim() : existing?.athlete_name ?? null,
    existing?.connected_at || new Date().toISOString()
  );
}

function isConnected() {
  const t = getStoredTokens();
  return !!(t && t.refresh_token);
}

function connectionStatus() {
  const t = getStoredTokens();
  const hasCredentials = !!(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET);
  if (!hasCredentials) {
    return { connected: false, configured: false, reason: "STRAVA_CLIENT_ID/STRAVA_CLIENT_SECRET ontbreken in .env" };
  }
  if (!t || !t.refresh_token) {
    return { connected: false, configured: true, reason: "Nog niet gekoppeld — doorloop de autorisatie." };
  }
  return {
    connected: true,
    configured: true,
    athleteName: t.athlete_name,
    athleteId: t.athlete_id,
    connectedAt: t.connected_at,
    accessTokenExpiresAt: t.expires_at,
  };
}

function disconnect() {
  db.prepare(
    "UPDATE strava_tokens SET access_token = NULL, refresh_token = NULL, expires_at = NULL, athlete_id = NULL, athlete_name = NULL, connected_at = NULL WHERE id = 1"
  ).run();
}

function requireCredentials() {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("STRAVA_CLIENT_ID en STRAVA_CLIENT_SECRET moeten in .env staan.");
  }
  return { clientId, clientSecret };
}

/** Builds the URL the user's browser should visit to authorise the app. */
function buildAuthorizeUrl(redirectUri) {
  const { clientId } = requireCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    // activity:read_all also covers activities the athlete marked private.
    scope: "read,activity:read_all",
  });
  return `${STRAVA_OAUTH}/authorize?${params.toString()}`;
}

/** One-time exchange of the ?code= from the OAuth redirect for real tokens. */
async function exchangeCodeForTokens(code) {
  const { clientId, clientSecret } = requireCredentials();
  const res = await fetch(`${STRAVA_OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Strava tokenuitwisseling mislukt (${res.status})`);
  saveTokens(data);
  return data;
}

/**
 * Returns a usable access token, refreshing it first if it's expired or about
 * to be. The 60-second margin avoids a token expiring mid-request.
 */
async function getValidAccessToken() {
  const tokens = getStoredTokens();
  if (!tokens || !tokens.refresh_token) {
    throw new Error("Strava is nog niet gekoppeld.");
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (tokens.access_token && tokens.expires_at && tokens.expires_at > nowSec + 60) {
    return tokens.access_token;
  }

  const { clientId, clientSecret } = requireCredentials();
  const res = await fetch(`${STRAVA_OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Strava tokenvernieuwing mislukt (${res.status})`);
  saveTokens(data);
  return data.access_token;
}

async function stravaGet(path) {
  const token = await getValidAccessToken();
  const res = await fetch(`${STRAVA_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 429) {
    throw new Error("Strava rate limit bereikt — probeer het over een kwartier opnieuw.");
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Strava API gaf status ${res.status} voor ${path}`);
  return data;
}

const fetchActivity = (id) => stravaGet(`/activities/${id}`);

const STREAM_KEYS = ["time", "heartrate", "watts", "cadence", "altitude", "velocity_smooth"];
const fetchStreams = (id) => stravaGet(`/activities/${id}/streams?keys=${STREAM_KEYS.join(",")}&key_by_type=true`);

const fetchRecentActivities = (perPage = 30, page = 1) =>
  stravaGet(`/athlete/activities?per_page=${perPage}&page=${page}`);

/* ---------------------------- conversion ------------------------------- */

/** Strava's sport_type vocabulary -> our cardio types. */
function mapSportType(sportType) {
  const s = String(sportType || "").toLowerCase();
  if (s.includes("weighttraining") || s.includes("workout") || s.includes("crossfit")) return "Anders";
  if (s.includes("run")) return "Hardlopen";
  if (s.includes("ride") || s.includes("bike") || s.includes("cycl")) return "Fietsen";
  if (s.includes("swim")) return "Zwemmen";
  if (s.includes("walk") || s.includes("hike")) return "Wandelen";
  return "Anders";
}

/** True for activity types that aren't cardio and shouldn't be auto-imported. */
function isStrengthActivity(sportType) {
  const s = String(sportType || "").toLowerCase();
  return s.includes("weighttraining") || s.includes("crossfit");
}

function timeOfDayFromIso(iso) {
  const hour = new Date(iso).getHours();
  if (hour < 12) return "ochtend";
  if (hour < 18) return "middag";
  return "avond";
}

function averageOf(values) {
  const clean = values.filter((v) => v !== null && v !== undefined && !isNaN(v));
  if (!clean.length) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

/**
 * Buckets the per-second streams into the same shape the GPX importer
 * produces, so the session-detail chart and the coach payload work
 * identically regardless of source.
 *
 * Resolution matters more than it looks: with buckets that are too wide, an
 * interval session averages out to a flat line (a 2-minute bucket over
 * 1-on/1-off intervals shows the mean, hiding the structure entirely). So we
 * aim for ~30-second buckets on short sessions, widening only when a long
 * ride would otherwise produce hundreds of points.
 */
function bucketCountFor(totalSeconds) {
  const TARGET_BUCKET_SECONDS = 30;
  const MAX_BUCKETS = 60; // keeps the coach payload and chart manageable
  const MIN_BUCKETS = 4;
  const byResolution = Math.round(totalSeconds / TARGET_BUCKET_SECONDS);
  return Math.max(MIN_BUCKETS, Math.min(MAX_BUCKETS, byResolution));
}

function buildProfile(streams, durationMinutes) {
  const time = streams?.time?.data;
  if (!Array.isArray(time) || time.length < 2) return null;

  const hr = streams?.heartrate?.data || [];
  const watts = streams?.watts?.data || [];
  const cadence = streams?.cadence?.data || [];
  const altitude = streams?.altitude?.data || [];
  const velocity = streams?.velocity_smooth?.data || []; // m/s

  const totalSec = time[time.length - 1];
  if (!totalSec) return null;

  const numBuckets = bucketCountFor(totalSec);
  const bucketSec = totalSec / numBuckets;

  const profile = [];
  for (let b = 0; b < numBuckets; b++) {
    const start = b * bucketSec;
    const end = (b + 1) * bucketSec;
    const idx = [];
    for (let i = 0; i < time.length; i++) {
      if (time[i] >= start && time[i] < end) idx.push(i);
    }
    const pick = (arr) => idx.map((i) => arr[i]).filter((v) => v !== null && v !== undefined);

    const avgSpeedMs = averageOf(pick(velocity));
    const avgHr = averageOf(pick(hr));
    const avgW = averageOf(pick(watts));
    const avgCad = averageOf(pick(cadence));
    const avgAlt = averageOf(pick(altitude));

    profile.push({
      tMin: Math.round((start / 60) * 10) / 10,
      gemHartslag: avgHr !== null ? Math.round(avgHr) : null,
      gemSnelheidKmu: avgSpeedMs !== null ? Math.round(avgSpeedMs * 3.6 * 10) / 10 : null,
      gemVermogen: avgW !== null ? Math.round(avgW) : null,
      gemCadans: avgCad !== null ? Math.round(avgCad) : null,
      hoogte: avgAlt !== null ? Math.round(avgAlt) : null,
    });
  }
  return profile;
}

/**
 * Converts a Strava activity (+ optional streams) into our cardio session
 * shape. Summary fields come straight from Strava rather than being
 * recomputed, so the numbers match what the athlete sees in the Strava app.
 */
function stravaToSession(activity, streams) {
  const movingMin = activity.moving_time ? Math.round((activity.moving_time / 60) * 10) / 10 : null;
  const elapsedMin = activity.elapsed_time ? Math.round((activity.elapsed_time / 60) * 10) / 10 : null;

  let profile = null;
  let normalizedPower = activity.weighted_average_watts ?? null;

  if (streams) {
    profile = buildProfile(streams, movingMin || elapsedMin || 0);

    // Strava only reports weighted_average_watts for some activities; when it's
    // missing we can derive it ourselves from the power stream.
    if (normalizedPower === null && Array.isArray(streams?.watts?.data) && Array.isArray(streams?.time?.data)) {
      const points = streams.time.data.map((t, i) => ({ tSec: t, power: streams.watts.data[i] }));
      normalizedPower = calc.computeNormalizedPower(points);
    }
  }

  return {
    id: `strava-${activity.id}`,
    date: (activity.start_date_local || activity.start_date || "").slice(0, 10),
    timeOfDay: timeOfDayFromIso(activity.start_date_local || activity.start_date),
    type: mapSportType(activity.sport_type || activity.type),
    duration_min: movingMin,
    total_duration_min: elapsedMin,
    distance_km: activity.distance ? Math.round((activity.distance / 1000) * 100) / 100 : null,
    avg_hr: activity.average_heartrate ? Math.round(activity.average_heartrate) : null,
    max_hr: activity.max_heartrate ? Math.round(activity.max_heartrate) : null,
    avg_power: activity.average_watts ? Math.round(activity.average_watts) : null,
    max_power: activity.max_watts ? Math.round(activity.max_watts) : null,
    weighted_avg_power: normalizedPower !== null ? Math.round(normalizedPower) : null,
    avg_cadence: activity.average_cadence ? Math.round(activity.average_cadence) : null,
    max_cadence: null, // not provided in Strava's activity summary
    elevation_gain_m: activity.total_elevation_gain ? Math.round(activity.total_elevation_gain) : null,
    elevation_loss_m: null, // Strava reports gain only
    pace: null,
    calories: activity.calories ? Math.round(activity.calories) : null,
    notes: activity.name || "",
    profile,
  };
}

/* --------------------------- deduplication ----------------------------- */

const wasImported = (stravaActivityId) =>
  !!db.prepare("SELECT 1 FROM strava_imported_activities WHERE strava_activity_id = ?").get(stravaActivityId);

const markImported = (stravaActivityId, cardioLogId) =>
  db
    .prepare("INSERT OR REPLACE INTO strava_imported_activities (strava_activity_id, cardio_log_id) VALUES (?, ?)")
    .run(stravaActivityId, cardioLogId);

/** True when two optional numbers are both absent, or both present and within tolerance. */
function withinTolerance(a, b, fraction) {
  if (a === null || a === undefined || b === null || b === undefined) return true; // unknown -> don't block a match
  if (a === 0 && b === 0) return true;
  const larger = Math.max(Math.abs(a), Math.abs(b));
  if (larger === 0) return true;
  return Math.abs(a - b) / larger <= fraction;
}

/**
 * Finds a session already in the database that describes the same workout as
 * `session`, even though it arrived from a different source (CSV bulk import
 * or GPX upload) and therefore carries a different id.
 *
 * Without this, syncing Strava after having imported the Strava CSV archive
 * silently duplicates every ride: one workout, two rows, and every weekly
 * total counted twice.
 *
 * Matching is deliberately conservative — same day, same sport, and both
 * distance and duration within 5% — so two genuinely different rides on the
 * same day aren't collapsed into one.
 */
function findExistingSimilarSession(session, excludeId = null) {
  const candidates = db
    .prepare("SELECT * FROM cardio_logs WHERE date = ? AND type = ?")
    .all(session.date, session.type)
    .filter((row) => row.id !== excludeId && row.id !== session.id);

  return (
    candidates.find(
      (row) =>
        withinTolerance(row.distance_km, session.distance_km, 0.05) &&
        withinTolerance(row.duration_min, session.duration_min, 0.05)
    ) || null
  );
}

module.exports = {
  // connection
  isConnected,
  connectionStatus,
  disconnect,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  getValidAccessToken,
  // api
  fetchActivity,
  fetchStreams,
  fetchRecentActivities,
  // conversion
  stravaToSession,
  mapSportType,
  isStrengthActivity,
  buildProfile,
  bucketCountFor,
  // dedup
  wasImported,
  markImported,
  findExistingSimilarSession,
  withinTolerance,
};
