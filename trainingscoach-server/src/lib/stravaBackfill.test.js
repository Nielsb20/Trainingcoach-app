"use strict";
/**
 * Guards the backfill gap: when a new derived metric is added, activities that
 * were already imported must be re-fetched rather than skipped as "done".
 */
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/backfill-selftest";
require("node:fs").rmSync("/tmp/backfill-selftest", { recursive: true, force: true });

const { db, initSchema } = require("../db/db");
initSchema();
const strava = require("./strava");

console.log("versiebeheer van geïmporteerde activiteiten");

// An activity imported by an older version of the app (analysis_version 0)
db.prepare("INSERT INTO strava_imported_activities (strava_activity_id, cardio_log_id, analysis_version) VALUES (?,?,0)")
  .run(1001, "strava-1001");
assert.strictEqual(strava.wasImported(1001), false,
  "oude import moet als 'nog te doen' gelden zodat analyse wordt bijgewerkt");
console.log("  ok  activiteit van vóór de analysefunctie wordt NIET overgeslagen");

// Re-importing marks it at the current version
strava.markImported(1001, "strava-1001");
assert.strictEqual(strava.wasImported(1001), true, "na bijwerken moet hij wel overgeslagen worden");
console.log("  ok  na bijwerken wordt hij wel overgeslagen (geen onnodige API-calls)");

// An unknown activity is simply not imported
assert.strictEqual(strava.wasImported(9999), false);
console.log("  ok  onbekende activiteit -> niet geïmporteerd");

console.log("\noverzicht van wat nog bijgewerkt moet worden");
db.prepare("INSERT INTO strava_imported_activities (strava_activity_id, cardio_log_id, analysis_version) VALUES (?,?,0)")
  .run(1002, "strava-1002");
db.prepare("INSERT INTO strava_imported_activities (strava_activity_id, cardio_log_id, analysis_version) VALUES (?,?,0)")
  .run(1003, "strava-1003");
const outdated = strava.findOutdatedImports();
assert.strictEqual(outdated.length, 2, `verwacht 2 verouderde, kreeg ${outdated.length}`);
assert.ok(!outdated.includes(1001), "de bijgewerkte activiteit hoort er niet meer bij");
console.log(`  ok  ${outdated.length} verouderde activiteiten gevonden: ${outdated.join(", ")}`);

strava.markImported(1002, "strava-1002");
assert.strictEqual(strava.findOutdatedImports().length, 1);
console.log("  ok  lijst krimpt terwijl je bijwerkt (voortgang blijft bewaard)");

console.log("\nAlle backfill-tests geslaagd.");
