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

/* --------------------------------- strava ------------------------------ */

export const getStravaStatus = () => request("/strava/status");
export const syncStrava = (limit = 20) => request("/strava/sync", { method: "POST", body: JSON.stringify({ limit }) });
export const disconnectStrava = () => request("/strava/disconnect", { method: "POST" });

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
