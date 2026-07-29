"use strict";

/**
 * Strava integration routes.
 *
 * Two things happen here, with different reachability requirements:
 *
 *  - OAuth (/authorize, /callback): the redirect is followed by YOUR browser,
 *    not by Strava's servers, so this works fine on a LAN address. No public
 *    exposure needed.
 *
 *  - Webhook (/webhook): Strava's servers call this directly, so this one path
 *    does need to be reachable from the internet (e.g. via a Cloudflare Tunnel).
 *    It accepts nothing but an activity ID and never returns data, so exposing
 *    just this route is low-risk compared to opening the whole app.
 */

const express = require("express");
const { db } = require("../db/db");
const strava = require("../lib/strava");

const router = express.Router();

const VERIFY_TOKEN = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN || "changeme";

/* --------------------------------- OAuth -------------------------------- */

// GET /api/strava/status
router.get("/status", (req, res) => {
  res.json(strava.connectionStatus());
});

// GET /api/strava/authorize -> redirects the browser to Strava's consent screen
router.get("/authorize", (req, res) => {
  try {
    // Build the callback from the request itself, so it works on whatever
    // address you happen to be using (LAN IP, hostname, tunnel).
    const redirectUri = `${req.protocol}://${req.get("host")}/api/strava/callback`;
    res.redirect(strava.buildAuthorizeUrl(redirectUri));
  } catch (err) {
    res.status(400).send(`Strava-configuratie onvolledig: ${err.message}`);
  }
});

// GET /api/strava/callback?code=... -> Strava sends the browser back here
router.get("/callback", async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.status(400).send(`Strava-autorisatie geweigerd: ${error}`);
  if (!code) return res.status(400).send("Geen autorisatiecode ontvangen van Strava.");

  try {
    const data = await strava.exchangeCodeForTokens(code);
    const name = `${data.athlete?.firstname || ""} ${data.athlete?.lastname || ""}`.trim();
    // Plain HTML rather than JSON: a human lands here via a browser redirect.
    res.send(`<!doctype html><html lang="nl"><head><meta charset="utf-8">
      <title>Strava gekoppeld</title>
      <style>body{font-family:system-ui,sans-serif;background:#14181C;color:#E8E6E1;
        display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
        div{text-align:center}a{color:#4FA8A0}</style></head>
      <body><div><h1>Strava gekoppeld</h1>
      <p>Verbonden als ${name || "onbekende atleet"}.</p>
      <p><a href="/">Terug naar Trainingscoach</a></p></div></body></html>`);
  } catch (err) {
    res.status(500).send(`Koppelen mislukt: ${err.message}`);
  }
});

// POST /api/strava/disconnect
router.post("/disconnect", (req, res) => {
  strava.disconnect();
  res.json({ ok: true });
});

/* ------------------------------ import core ----------------------------- */

const CARDIO_COLUMNS = [
  "id", "date", "time_of_day", "type", "duration_min", "total_duration_min", "distance_km",
  "avg_hr", "max_hr", "avg_power", "max_power", "weighted_avg_power", "avg_cadence", "max_cadence",
  "elevation_gain_m", "elevation_loss_m", "pace", "calories", "notes", "profile_json", "source",
];

function insertSession(session, source) {
  const row = {
    id: session.id,
    date: session.date,
    time_of_day: session.timeOfDay || null,
    type: session.type,
    duration_min: session.duration_min ?? null,
    total_duration_min: session.total_duration_min ?? null,
    distance_km: session.distance_km ?? null,
    avg_hr: session.avg_hr ?? null,
    max_hr: session.max_hr ?? null,
    avg_power: session.avg_power ?? null,
    max_power: session.max_power ?? null,
    weighted_avg_power: session.weighted_avg_power ?? null,
    avg_cadence: session.avg_cadence ?? null,
    max_cadence: session.max_cadence ?? null,
    elevation_gain_m: session.elevation_gain_m ?? null,
    elevation_loss_m: session.elevation_loss_m ?? null,
    pace: session.pace ?? null,
    calories: session.calories ?? null,
    notes: session.notes ?? null,
    profile_json: session.profile ? JSON.stringify(session.profile) : null,
    source,
  };
  db.prepare(
    `INSERT OR REPLACE INTO cardio_logs (${CARDIO_COLUMNS.join(", ")})
     VALUES (${CARDIO_COLUMNS.map(() => "?").join(", ")})`
  ).run(...CARDIO_COLUMNS.map((c) => row[c]));
}

/**
 * Fetches one activity (plus its streams) and stores it as a cardio session.
 * Skips strength training and anything already imported, unless forced.
 */
async function importActivity(activityId, { source = "strava", force = false } = {}) {
  if (!force && strava.wasImported(activityId)) {
    return { skipped: true, reason: "al eerder geïmporteerd" };
  }

  const activity = await strava.fetchActivity(activityId);

  if (strava.isStrengthActivity(activity.sport_type || activity.type)) {
    strava.markImported(activityId, null); // remember, so we don't re-check every time
    return { skipped: true, reason: "krachttraining, geen cardio" };
  }

  // Streams are a separate call and can fail (e.g. a manually entered activity
  // with no recorded data); the summary alone is still worth storing.
  let streams = null;
  try {
    streams = await strava.fetchStreams(activityId);
  } catch (err) {
    console.warn(`[strava] geen streams voor activiteit ${activityId}: ${err.message}`);
  }

  const session = strava.stravaToSession(activity, streams);
  insertSession(session, source);
  strava.markImported(activityId, session.id);
  return { imported: true, session };
}

/* -------------------------------- webhook ------------------------------- */

// GET /api/strava/webhook - one-time subscription verification handshake
router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("[strava] webhook-verificatie geslaagd");
    return res.json({ "hub.challenge": challenge });
  }
  console.warn("[strava] webhook-verificatie geweigerd (verkeerde verify_token)");
  res.status(403).end();
});

// POST /api/strava/webhook - activity created/updated/deleted
router.post("/webhook", (req, res) => {
  // Strava expects a fast 200 and retries if it doesn't get one, so acknowledge
  // first and do the fetching afterwards.
  res.status(200).end();

  const event = req.body || {};
  if (event.object_type !== "activity") return;

  const activityId = event.object_id;

  if (event.aspect_type === "delete") {
    const logId = `strava-${activityId}`;
    db.prepare("DELETE FROM cardio_logs WHERE id = ?").run(logId);
    db.prepare("DELETE FROM strava_imported_activities WHERE strava_activity_id = ?").run(activityId);
    console.log(`[strava] activiteit ${activityId} verwijderd`);
    return;
  }

  // 'update' events fire for things like a renamed activity, so re-import and
  // overwrite rather than skipping on the dedup check.
  const force = event.aspect_type === "update";

  importActivity(activityId, { source: "strava_webhook", force })
    .then((result) => {
      if (result.imported) console.log(`[strava] activiteit ${activityId} geïmporteerd`);
      else console.log(`[strava] activiteit ${activityId} overgeslagen: ${result.reason}`);
    })
    .catch((err) => console.error(`[strava] import van ${activityId} mislukt: ${err.message}`));
});

/* ----------------------------- manual sync ------------------------------ */

// POST /api/strava/sync  { limit?: number }
// Pulls recent activities on demand — useful for backfilling and for testing
// the connection without waiting for a webhook to fire.
router.post("/sync", async (req, res) => {
  if (!strava.isConnected()) {
    return res.status(400).json({ error: "Strava is nog niet gekoppeld." });
  }
  const limit = Math.min(Number(req.body?.limit) || 10, 50);

  try {
    const activities = await strava.fetchRecentActivities(limit);
    const results = { imported: 0, skipped: 0, failed: 0, details: [] };

    for (const summary of activities) {
      try {
        const result = await importActivity(summary.id, { source: "strava_sync" });
        if (result.imported) {
          results.imported++;
          results.details.push({ id: summary.id, name: summary.name, status: "geïmporteerd" });
        } else {
          results.skipped++;
          results.details.push({ id: summary.id, name: summary.name, status: result.reason });
        }
      } catch (err) {
        results.failed++;
        results.details.push({ id: summary.id, name: summary.name, status: `mislukt: ${err.message}` });
      }
    }
    res.json(results);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// POST /api/strava/import/:id - pull one specific activity
router.post("/import/:id", async (req, res) => {
  try {
    const result = await importActivity(Number(req.params.id), { source: "strava_manual", force: true });
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = { router, importActivity };
