"use strict";
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/stravatest";
process.env.STRAVA_CLIENT_ID = "12345";
process.env.STRAVA_CLIENT_SECRET = "secret";

const { initSchema } = require("../db/db");
initSchema();
const strava = require("./strava");

const now = () => Math.floor(Date.now() / 1000);

console.log("Status vóór koppelen:");
console.log(" ", JSON.stringify(strava.connectionStatus()));
assert.strictEqual(strava.isConnected(), false);

// --- authorize URL ---
const url = strava.buildAuthorizeUrl("http://192.168.1.121:3001/api/strava/callback");
console.log("\nAutorisatie-URL:");
console.log(" ", url.slice(0, 100) + "...");
assert.ok(url.includes("client_id=12345"));
assert.ok(url.includes("activity%3Aread_all"), "scope activity:read_all moet meegestuurd worden");
console.log("  ok  client_id en scope aanwezig");

// --- code exchange ---
let lastCall = null;
global.fetch = async (u, opts) => {
  lastCall = { url: u, body: JSON.parse(opts.body) };
  return { ok: true, json: async () => ({
    access_token: "access-1", refresh_token: "refresh-1",
    expires_at: now() + 21600,
    athlete: { id: 999, firstname: "Niels", lastname: "B" },
  })};
};
(async () => {
  await strava.exchangeCodeForTokens("thecode");
  console.log("\nNa koppelen:");
  const status = strava.connectionStatus();
  console.log(" ", JSON.stringify(status));
  assert.strictEqual(status.connected, true);
  assert.strictEqual(status.athleteName, "Niels B");
  assert.strictEqual(lastCall.body.grant_type, "authorization_code");
  console.log("  ok  tokens opgeslagen, atleet herkend");

  // --- valid token: should NOT refresh ---
  let refreshCalls = 0;
  global.fetch = async (u, opts) => {
    const body = JSON.parse(opts.body);
    if (body.grant_type === "refresh_token") refreshCalls++;
    return { ok: true, json: async () => ({
      access_token: "access-2", refresh_token: "refresh-2", expires_at: now() + 21600 })};
  };
  let token = await strava.getValidAccessToken();
  assert.strictEqual(token, "access-1", "geldig token moet hergebruikt worden");
  assert.strictEqual(refreshCalls, 0);
  console.log("  ok  geldig token wordt hergebruikt (geen onnodige vernieuwing)");

  // --- expired token: SHOULD refresh ---
  const { db } = require("../db/db");
  db.prepare("UPDATE strava_tokens SET expires_at = ? WHERE id = 1").run(now() - 10);
  token = await strava.getValidAccessToken();
  assert.strictEqual(token, "access-2", "verlopen token moet vernieuwd worden");
  assert.strictEqual(refreshCalls, 1);
  console.log("  ok  verlopen token wordt automatisch vernieuwd");

  // --- token expiring within the 60s margin should also refresh ---
  db.prepare("UPDATE strava_tokens SET expires_at = ?, access_token = 'access-2' WHERE id = 1").run(now() + 30);
  token = await strava.getValidAccessToken();
  assert.strictEqual(refreshCalls, 2, "token dat bijna verloopt moet ook vernieuwd worden");
  console.log("  ok  bijna-verlopen token wordt vooraf vernieuwd (60s marge)");

  // --- rate limit surfaces a clear message ---
  global.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
  try {
    await strava.fetchActivity(1);
    console.log("  FOUT: rate limit gaf geen fout");
  } catch (e) {
    assert.ok(e.message.includes("rate limit"));
    console.log("  ok  rate limit ->", e.message);
  }

  // --- dedup ---
  assert.strictEqual(strava.wasImported(555), false);
  strava.markImported(555, "strava-555");
  assert.strictEqual(strava.wasImported(555), true);
  console.log("  ok  dubbele import wordt herkend");

  // --- disconnect ---
  strava.disconnect();
  assert.strictEqual(strava.isConnected(), false);
  console.log("  ok  ontkoppelen wist de tokens");

  console.log("\nAlle token- en verbindingstests geslaagd.");
})();
