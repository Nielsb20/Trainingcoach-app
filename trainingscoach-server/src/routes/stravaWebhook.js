"use strict";

/**
 * Strava webhook receiver — SCAFFOLD ONLY, not yet wired up to a real Strava
 * API app. Fill in the TODOs once you've registered a Strava API application
 * at https://www.strava.com/settings/api and completed the OAuth flow to
 * get a user access/refresh token.
 *
 * How Strava's webhook system works, for reference:
 * 1. Strava sends a GET request to verify your callback URL when you create
 *    the subscription (one-time, via a POST to Strava's push subscription
 *    endpoint with your client_id/client_secret/callback_url/verify_token).
 * 2. After that, Strava POSTs an event here every time an activity is
 *    created/updated/deleted on the connected account.
 * 3. The POST body only contains IDs, not the full activity — you then call
 *    Strava's GET /activities/:id (and /activities/:id/streams for the
 *    detailed time-series data) using your stored access token to fetch
 *    the actual data.
 */

const express = require("express");
const router = express.Router();

const VERIFY_TOKEN = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN || "changeme";

// GET /api/strava/webhook - one-time subscription verification handshake
router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    res.json({ "hub.challenge": challenge });
  } else {
    res.status(403).end();
  }
});

// POST /api/strava/webhook - actual activity create/update/delete events
router.post("/webhook", async (req, res) => {
  // Acknowledge immediately — Strava expects a fast 200, do slow work after.
  res.status(200).end();

  const event = req.body;
  // event looks like: { object_type: 'activity', object_id, aspect_type: 'create'|'update'|'delete', owner_id, ... }

  if (event.object_type !== "activity" || event.aspect_type === "delete") return;

  // TODO 1: look up the stored Strava access token for this owner_id (refresh
  //         it via the refresh_token if expired — Strava access tokens are
  //         short-lived, refresh tokens are long-lived).
  // TODO 2: GET https://www.strava.com/api/v3/activities/{event.object_id}
  //         with Authorization: Bearer <access_token> to fetch the summary.
  // TODO 3: GET .../activities/{id}/streams?keys=time,heartrate,watts,cadence,altitude,latlng
  //         to get the detailed time series (this maps directly onto the
  //         same `profile` bucket shape used by the GPX importer).
  // TODO 4: Convert the response into the same shape as a cardio_logs row
  //         (see routes/cardioLogs.js `toRow`) and INSERT it, source='strava_webhook'.
  console.log("Strava webhook received (not yet processed — see TODOs in this file):", event);
});

module.exports = router;
