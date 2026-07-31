/**
 * client.js — the single place where the frontend talks to the backend.
 *
 * This replaces the artifact prototype's `window.storage` calls. Everything
 * that used to be "save to Claude's artifact storage" is now an HTTP call
 * to your own server.
 *
 * Base URL comes from VITE_API_URL at build time; in dev it defaults to a
 * relative /api, which Vite proxies to the backend (see vite.config.js).
 */

const BASE = import.meta.env.VITE_API_URL || "/api";

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });

  if (!res.ok) {
    // Try to surface the server's own error message rather than a bare status code
    let detail = "";
    try {
      const body = await res.json();
      detail = body.error || body.details || "";
    } catch {
      /* response wasn't JSON — fall through to the generic message */
    }
    throw new Error(detail || `Serverfout (${res.status}) bij ${path}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

/* -------------------------------- schema ------------------------------- */

export const getSchema = () => request("/schema");
export const saveSchema = (schema) => request("/schema", { method: "PUT", body: JSON.stringify(schema) });

/* ----------------------------- workout logs ---------------------------- */

export const getWorkoutLogs = () => request("/workout-logs");
export const createWorkoutLog = (entry) => request("/workout-logs", { method: "POST", body: JSON.stringify(entry) });
export const deleteWorkoutLog = (id) => request(`/workout-logs/${id}`, { method: "DELETE" });

/* ------------------------------ cardio logs ---------------------------- */

export const getCardioLogs = () => request("/cardio-logs");
export const createCardioLog = (entry) => request("/cardio-logs", { method: "POST", body: JSON.stringify(entry) });
export const createCardioLogsBulk = (entries, source) =>
  request("/cardio-logs/bulk", { method: "POST", body: JSON.stringify({ entries, source }) });
export const deleteCardioLog = (id) => request(`/cardio-logs/${id}`, { method: "DELETE" });

/* ------------------------------ weight logs ---------------------------- */

export const getWeightLogs = () => request("/weight-logs");
export const createWeightLog = (entry) => request("/weight-logs", { method: "POST", body: JSON.stringify(entry) });
export const deleteWeightLog = (id) => request(`/weight-logs/${id}`, { method: "DELETE" });

/* --------------------------------- events ------------------------------ */

export const getEvents = () => request("/events");
export const createEvent = (entry) => request("/events", { method: "POST", body: JSON.stringify(entry) });
export const deleteEvent = (id) => request(`/events/${id}`, { method: "DELETE" });

/* --------------------------------- coach ------------------------------- */

export const getCoachHistory = () => request("/coach/history");
export const askCoach = (question) => request("/coach/ask", { method: "POST", body: JSON.stringify({ question }) });
export const deleteCoachEntry = (id) => request(`/coach/history/${id}`, { method: "DELETE" });

/* ----------------------------- backup / restore ------------------------ */

export const exportAll = () => request("/export");
export const importAll = (data) => request("/import", { method: "POST", body: JSON.stringify(data) });

/* -------------------------------- wellness ------------------------------ */

export const getWellnessLogs = (days = 120) => request(`/wellness?days=${days}`);
export const saveWellnessLog = (entry) => request("/wellness", { method: "POST", body: JSON.stringify(entry) });
export const deleteWellnessLog = (date) => request(`/wellness/${date}`, { method: "DELETE" });

/* -------------------------------- analysis ------------------------------ */

export const getZoneDistribution = (weeks = 12, metric = "hr") =>
  request(`/analysis/zones?weeks=${weeks}&metric=${metric}`);
export const getPowerCurve = (days = 90) => request(`/analysis/power-curve?days=${days}`);

/* -------------------------------- planned ------------------------------- */

export const getPlannedSessions = (weeks = 4) => request(`/planned?weeks=${weeks}`);
export const getPlannedRange = (from, to) => request(`/planned?from=${from}&to=${to}`);
export const createPlanFromCoach = (coachEntryId) =>
  request("/planned/from-coach", { method: "POST", body: JSON.stringify({ coachEntryId }) });
export const acceptProposal = (id, replaceConflicting = false) =>
  request(`/planned/${id}/accept`, { method: "POST", body: JSON.stringify({ replaceConflicting }) });
export const acceptAllProposals = (replaceConflicting = false) =>
  request("/planned/accept-all", { method: "POST", body: JSON.stringify({ replaceConflicting }) });
export const lockPlannedSession = (id, locked) =>
  request(`/planned/${id}/lock`, { method: "POST", body: JSON.stringify({ locked }) });
export const declineProposal = (id, reason) =>
  request(`/planned/${id}/decline`, { method: "POST", body: JSON.stringify({ reason }) });
export const createPlannedSession = (entry) =>
  request("/planned", { method: "POST", body: JSON.stringify(entry) });
export const updatePlannedSession = (id, status) =>
  request(`/planned/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
export const deletePlannedSession = (id) => request(`/planned/${id}`, { method: "DELETE" });

/* --------------------------------- strava ------------------------------ */

export const getStravaStatus = () => request("/strava/status");
export const syncStrava = (limit = 20) => request("/strava/sync", { method: "POST", body: JSON.stringify({ limit }) });
export const disconnectStrava = () => request("/strava/disconnect", { method: "POST" });
export const getStravaBackfillStatus = () => request("/strava/backfill-status");
export const backfillStrava = (limit = 25) =>
  request("/strava/backfill", { method: "POST", body: JSON.stringify({ limit }) });

/* --------------------------------- health ------------------------------ */

export const health = () => request("/health");

/**
 * Loads everything the app needs in one go. Used on startup and by the
 * "Ververs gegevens" button.
 */
export async function loadAll() {
  const [schema, workoutLogs, cardioLogs, weightLogs, events, coachHistory] = await Promise.all([
    getSchema(),
    getWorkoutLogs(),
    getCardioLogs(),
    getWeightLogs(),
    getEvents(),
    getCoachHistory(),
  ]);
  return { schema, workoutLogs, cardioLogs, weightLogs, events, coachHistory };
}
