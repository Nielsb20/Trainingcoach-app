#!/usr/bin/env node
"use strict";

/**
 * Manage the Strava push subscription (the webhook registration).
 *
 * Strava allows exactly one subscription per API application, so this is a
 * one-off setup step rather than something the app does at boot.
 *
 * Usage:
 *   node scripts/strava-subscription.js status
 *   node scripts/strava-subscription.js create https://jouw-tunnel.example.com
 *   node scripts/strava-subscription.js delete
 *
 * The callback URL must be reachable from the public internet: when you
 * create a subscription, Strava immediately calls it back to verify it.
 * A Cloudflare Tunnel pointed at this server is the usual way to do that.
 */

require("dotenv").config({ path: require("node:path").join(__dirname, "..", ".env") });

const API = "https://www.strava.com/api/v3/push_subscriptions";

const clientId = process.env.STRAVA_CLIENT_ID;
const clientSecret = process.env.STRAVA_CLIENT_SECRET;
const verifyToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN || "changeme";

if (!clientId || !clientSecret) {
  console.error("STRAVA_CLIENT_ID en STRAVA_CLIENT_SECRET moeten in .env staan.");
  process.exit(1);
}

const creds = `client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`;

async function status() {
  const res = await fetch(`${API}?${creds}`);
  const data = await res.json();
  if (!res.ok) {
    console.error("Fout:", data);
    process.exit(1);
  }
  if (!Array.isArray(data) || data.length === 0) {
    console.log("Geen actief webhook-abonnement.");
    return;
  }
  data.forEach((sub) => {
    console.log(`Abonnement #${sub.id}`);
    console.log(`  callback: ${sub.callback_url}`);
    console.log(`  aangemaakt: ${sub.created_at}`);
  });
}

async function create(baseUrl) {
  if (!baseUrl) {
    console.error("Geef de publieke basis-URL mee, bijv:");
    console.error("  node scripts/strava-subscription.js create https://jouw-tunnel.example.com");
    process.exit(1);
  }
  const callbackUrl = `${baseUrl.replace(/\/$/, "")}/api/strava/webhook`;
  console.log(`Abonnement aanmaken met callback: ${callbackUrl}`);
  console.log("Strava roept deze URL nu direct aan ter verificatie — de server moet dus draaien en publiek bereikbaar zijn.\n");

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    callback_url: callbackUrl,
    verify_token: verifyToken,
  });

  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("Aanmaken mislukt:", JSON.stringify(data, null, 2));
    console.error("\nVeelvoorkomende oorzaken:");
    console.error("  - de callback-URL is niet publiek bereikbaar (tunnel draait niet?)");
    console.error("  - de server draait niet, of niet op de poort waar de tunnel naartoe wijst");
    console.error("  - STRAVA_WEBHOOK_VERIFY_TOKEN in .env verschilt van wat de server gebruikt");
    console.error("  - er bestaat al een abonnement (verwijder het eerst met 'delete')");
    process.exit(1);
  }
  console.log("Gelukt. Abonnement-ID:", data.id);
}

async function remove() {
  const listRes = await fetch(`${API}?${creds}`);
  const subs = await listRes.json();
  if (!Array.isArray(subs) || subs.length === 0) {
    console.log("Geen abonnement om te verwijderen.");
    return;
  }
  for (const sub of subs) {
    const res = await fetch(`${API}/${sub.id}?${creds}`, { method: "DELETE" });
    if (res.ok || res.status === 204) console.log(`Abonnement #${sub.id} verwijderd.`);
    else console.error(`Verwijderen van #${sub.id} mislukt (status ${res.status})`);
  }
}

const [command, arg] = process.argv.slice(2);
const commands = { status, create: () => create(arg), delete: remove };

if (!commands[command]) {
  console.log("Gebruik: node scripts/strava-subscription.js <status|create <url>|delete>");
  process.exit(1);
}

commands[command]().catch((err) => {
  console.error("Onverwachte fout:", err.message);
  process.exit(1);
});
