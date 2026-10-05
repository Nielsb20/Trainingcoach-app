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
    // Beide velden, niet één: de server zet de korte reden in `error` en de
    // werkelijke oorzaak in `details`. Alleen de eerste tonen leverde
    // "Omzetten mislukt" op zonder dat iemand kon zien waaróm.
    let detail = "";
    try {
      const body = await res.json();
      detail = [body.error, body.details].filter(Boolean).join(" — ");
      if (body.hint) detail += ` ${body.hint}`;
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
export const updateWorkoutLog = (id, entry) =>
  request(`/workout-logs/${id}`, { method: "PUT", body: JSON.stringify(entry) });
export const deleteWorkoutLog = (id) => request(`/workout-logs/${id}`, { method: "DELETE" });

/* ------------------------------ cardio logs ---------------------------- */

export const getCardioLogs = () => request("/cardio-logs");
export const createCardioLog = (entry) => request("/cardio-logs", { method: "POST", body: JSON.stringify(entry) });
export const createCardioLogsBulk = (entries, source) =>
  request("/cardio-logs/bulk", { method: "POST", body: JSON.stringify({ entries, source }) });
export const deleteCardioLog = (id) => request(`/cardio-logs/${id}`, { method: "DELETE" });
/** The intra-session trace, fetched on demand — see serializeForList on the server. */
export const getCardioProfile = (id) => request(`/cardio-logs/${id}/profile`);

/* ------------------------------ weight logs ---------------------------- */

export const getWeightLogs = () => request("/weight-logs");
export const createWeightLog = (entry) => request("/weight-logs", { method: "POST", body: JSON.stringify(entry) });
export const deleteWeightLog = (id) => request(`/weight-logs/${id}`, { method: "DELETE" });

/* --------------------------------- events ------------------------------ */

export const getEvents = () => request("/events");
export const createEvent = (entry) => request("/events", { method: "POST", body: JSON.stringify(entry) });
export const updateEvent = (id, entry) => request(`/events/${id}`, { method: "PUT", body: JSON.stringify(entry) });
export const deleteEvent = (id) => request(`/events/${id}`, { method: "DELETE" });

/* --------------------------------- coach ------------------------------- */

export const getCoachHistory = () => request("/coach/history");
export const askCoach = (question) => request("/coach/ask", { method: "POST", body: JSON.stringify({ question }) });
export const deleteCoachEntry = (id) => request(`/coach/history/${id}`, { method: "DELETE" });

/* ---------------------- goals + coach schema proposals ------------------- */

export const getGoals = () => request("/coach/goals");
export const saveGoals = (goals) => request("/coach/goals", { method: "PUT", body: JSON.stringify(goals) });

export const getSchemaProposals = () => request("/coach/schema-proposals");
export const generateSchemaProposal = (question) =>
  request("/coach/schema-proposals", { method: "POST", body: JSON.stringify({ question }) });
/** Replaces the whole schema — reversible via undoSchemaProposal. */
export const acceptSchemaProposal = (id) => request(`/coach/schema-proposals/${id}/accept`, { method: "POST" });
export const undoSchemaProposal = (id) => request(`/coach/schema-proposals/${id}/undo`, { method: "POST" });
export const declineSchemaProposal = (id, reason) =>
  request(`/coach/schema-proposals/${id}/decline`, { method: "POST", body: JSON.stringify({ reason }) });
export const deleteSchemaProposal = (id) => request(`/coach/schema-proposals/${id}`, { method: "DELETE" });

/* ----------------------------- backup / restore ------------------------ */

export const exportAll = () => request("/export");
/** Which automatic nightly snapshots exist on the server. */
export const getBackups = () => request("/backups");
export const importAll = (data) => request("/import", { method: "POST", body: JSON.stringify(data) });

/* ------------------------------ session detail --------------------------- */

export const getSessionDetail = (id) => request(`/sessions/${id}`);
export const getSessionFeedback = (id, force = false) =>
  request(`/sessions/${id}/feedback`, { method: "POST", body: JSON.stringify({ force }) });

/* ------------------------------- automation ----------------------------- */

export const getAutomation = () => request("/automation");
export const saveAutomation = (settings) => request("/automation", { method: "PUT", body: JSON.stringify(settings) });
export const runAutomation = (type) => request("/automation/run", { method: "POST", body: JSON.stringify({ type }) });

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
export const fillPlanFromSchema = (from, to) =>
  request("/planned/from-schema", { method: "POST", body: JSON.stringify({ from, to }) });
export const movePlannedSession = (id, date) =>
  request(`/planned/${id}/move`, { method: "PATCH", body: JSON.stringify({ date }) });
export const createPlannedSession = (entry) =>
  request("/planned", { method: "POST", body: JSON.stringify(entry) });
export const updatePlannedSession = (id, status) =>
  request(`/planned/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
export const deletePlannedSession = (id) => request(`/planned/${id}`, { method: "DELETE" });
/** "Ik doe hem toch" — haalt de markering weg zonder de sessie te wijzigen. */
export const keepPlannedSession = (id) => request(`/planned/${id}/behouden`, { method: "POST" });
/** Verwijdert in één keer alle openstaande restanten van vervangen advies. */
export const cleanupStalePlanned = () => request("/planned/verouderd/opruimen", { method: "POST" });

/* ------------------------- trainingsbestanden -------------------------- */

/** Zet de omschrijving om in blokken. Nog niets opgeslagen: eerst controleren. */
export const derivePlannedStructure = (id) => request(`/planned/${id}/structuur`, { method: "POST" });
/** Legt de blokken vast zoals je ze hebt goedgekeurd (of wist ze met null). */
export const savePlannedStructure = (id, blokken, bron = "handmatig") =>
  request(`/planned/${id}/structuur`, { method: "PUT", body: JSON.stringify({ blokken, bron }) });

/**
 * Het adres van het trainingsbestand, om rechtstreeks naar te linken.
 *
 * Een gewone link in plaats van ophalen-en-blob-maken. Dat laatste werkt op
 * een desktopbrowser prima maar laat het op iOS en iPadOS regelmatig afweten,
 * en juist daar zit je: je kiest de training op de tablet die naast de trainer
 * staat. Met een echte link doet de browser het zelf, en biedt iOS meteen
 * "openen in ROUVY" aan.
 */
export const workoutFileUrl = (id, formaat = "zwo") =>
  `${BASE}/planned/${id}/trainingsbestand?formaat=${formaat}`;

/** Op welke fiets; corrigeert ook geïmporteerde historie. */
export const setCardioSubType = (id, subType) =>
  request(`/cardio-logs/${id}/ondersoort`, { method: "PATCH", body: JSON.stringify({ subType }) });
/** Waar je reed. Losse as: dezelfde MTB gaat het bos in én de weg op. */
export const setCardioSurface = (id, surface) =>
  request(`/cardio-logs/${id}/ondersoort`, { method: "PATCH", body: JSON.stringify({ surface }) });

/* --------------------------------- strava ------------------------------ */

export const getStravaStatus = () => request("/strava/status");
export const syncStrava = (limit = 20) => request("/strava/sync", { method: "POST", body: JSON.stringify({ limit }) });
export const disconnectStrava = () => request("/strava/disconnect", { method: "POST" });
export const getStravaBackfillStatus = () => request("/strava/backfill-status");
export const backfillStrava = (limit = 25) =>
  request("/strava/backfill", { method: "POST", body: JSON.stringify({ limit }) });
/** Zegt het sporttype uit Strava iets over de fiets of over de ondergrond? */
export const getStravaSportTypeMeaning = () => request("/strava/sporttype-betekenis");
export const setStravaSportTypeMeaning = (betekenis) =>
  request("/strava/sporttype-betekenis", { method: "PUT", body: JSON.stringify({ betekenis }) });
/** Je fietsen en schoenen, met het type dat eraan hangt. */
export const getStravaGear = () => request("/strava/materiaal");
/** Zegt wat voor fiets dit is, standaard ook voor je hele historie. */
export const setStravaGearSubType = (id, fiets, toepassenOpGeschiedenis = true) =>
  request(`/strava/materiaal/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ fiets, toepassenOpGeschiedenis }),
  });

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
