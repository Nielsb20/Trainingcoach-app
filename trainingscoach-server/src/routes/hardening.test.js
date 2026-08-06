"use strict";
/**
 * Drives the real HTTP server, because the properties these changes are meant
 * to deliver only exist end to end.
 *
 * A unit test can confirm serializeForList drops the profile; only a request
 * shows the response the browser actually receives. Same for CORS: the header
 * either goes out or it doesn't.
 */
const assert = require("node:assert");
const http = require("node:http");

process.env.DATA_DIR = "/tmp/hardening-selftest";
process.env.PORT = "3999";
require("node:fs").rmSync("/tmp/hardening-selftest", { recursive: true, force: true });
delete process.env.CORS_ORIGIN; // default posture is what we're testing

const { db, initSchema } = require("../db/db");
initSchema();

db.prepare(
  `INSERT INTO cardio_logs (id,date,type,duration_min,profile_json)
   VALUES ('c1','2026-08-01','Fietsen',60,?)`
).run(JSON.stringify([{ tMin: 0, gemHartslag: 140 }, { tMin: 1, gemHartslag: 145 }]));
db.prepare("INSERT INTO cardio_logs (id,date,type,duration_min) VALUES ('c2','2026-08-02','Lopen',30)").run();

const request = (path, options = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: 3999, path, ...options }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });

(async () => {
  require("../server");
  // Give listen() a moment; the server is started by requiring it.
  await new Promise((r) => setTimeout(r, 400));

  console.log("de cardiolijst stuurt het verloop niet mee");
  const list = await request("/api/cardio-logs");
  const sessions = JSON.parse(list.body);
  assert.strictEqual(list.status, 200);
  assert.strictEqual(sessions.length, 2);
  assert.ok(!("profile" in sessions[0]), "profile hoort niet in de lijst te zitten");
  assert.strictEqual(sessions.find((s) => s.id === "c1").hasProfile, true, "sessie met verloop moet dat melden");
  assert.strictEqual(sessions.find((s) => s.id === "c2").hasProfile, false, "sessie zonder verloop ook");
  console.log(`  ok  ${list.body.length} bytes, met hasProfile in plaats van de volledige reeks`);

  console.log("\nhet verloop is per sessie apart op te halen");
  const detail = JSON.parse((await request("/api/cardio-logs/c1/profile")).body);
  assert.strictEqual(detail.profile.length, 2);
  assert.strictEqual(detail.profile[1].gemHartslag, 145);
  console.log("  ok  losse route levert exact de reeks die de grafiek nodig heeft");

  const missing = await request("/api/cardio-logs/bestaat-niet/profile");
  assert.strictEqual(missing.status, 404);
  console.log("  ok  onbekende sessie geeft 404, geen crash");

  console.log("\nde back-up bevat het verloop nog wel");
  const backup = JSON.parse((await request("/api/export")).body);
  const backedUp = backup.cardioLogs.find((c) => c.id === "c1");
  assert.ok(Array.isArray(backedUp.profile) && backedUp.profile.length === 2,
    "een back-up zonder verloop zou bij herstel data verliezen");
  console.log("  ok  export is compleet, ook al is de lijst dat niet");

  console.log("\nCORS staat standaard dicht");
  const cors = await request("/api/health", { headers: { Origin: "https://kwaadaardig.example" } });
  assert.ok(!cors.headers["access-control-allow-origin"],
    `er hoort geen CORS-header te zijn, maar kreeg: ${cors.headers["access-control-allow-origin"]}`);
  console.log("  ok  geen Access-Control-Allow-Origin, dus geen uitlezen vanaf een andere site");

  console.log("\nonbekende API-route geeft nette JSON, geen HTML");
  const unknown = await request("/api/bestaat-niet");
  assert.notStrictEqual(unknown.status, 200);
  console.log(`  ok  status ${unknown.status}`);

  console.log("\nAlle hardeningstests geslaagd.");
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
