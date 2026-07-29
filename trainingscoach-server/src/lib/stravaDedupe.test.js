"use strict";
/**
 * Guards against the duplicate-import bug: syncing Strava after having
 * imported the Strava CSV archive used to add every ride a second time,
 * because dedup only looked at Strava activity ids and not at sessions that
 * were already present from another source.
 */
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/dedupe-selftest";
require("node:fs").rmSync("/tmp/dedupe-selftest", { recursive: true, force: true });

const { db, initSchema } = require("../db/db");
initSchema();
const strava = require("./strava");

const cols = ["id", "date", "time_of_day", "type", "duration_min", "distance_km", "source"];
const ins = db.prepare(`INSERT INTO cardio_logs (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`);
ins.run("csv-1", "2026-07-20", "ochtend", "Fietsen", 161.7, 67.44, "csv_import");
ins.run("csv-2", "2026-07-20", "avond", "Fietsen", 30.0, 12.0, "csv_import");

const find = (s) => strava.findExistingSimilarSession(s);

let m = find({ id: "strava-1", date: "2026-07-20", type: "Fietsen", duration_min: 161.7, distance_km: 67.44 });
assert.strictEqual(m?.id, "csv-1", "identieke rit moet als dubbel herkend worden");
console.log("  ok  identieke rit herkend als dubbel");

m = find({ id: "strava-2", date: "2026-07-20", type: "Fietsen", duration_min: 160.2, distance_km: 67.1 });
assert.strictEqual(m?.id, "csv-1", "kleine meetverschillen tussen bronnen moeten nog matchen");
console.log("  ok  kleine meetverschillen tussen bronnen matchen nog");

m = find({ id: "strava-3", date: "2026-07-20", type: "Fietsen", duration_min: 30.0, distance_km: 12.0 });
assert.strictEqual(m?.id, "csv-2", "moet aan de juiste rit van die dag koppelen");
console.log("  ok  tweede rit dezelfde dag koppelt aan de juiste");

m = find({ id: "strava-4", date: "2026-07-20", type: "Fietsen", duration_min: 75.0, distance_km: 35.0 });
assert.strictEqual(m, null, "een echt nieuwe rit mag niet matchen");
console.log("  ok  nieuwe rit geeft geen valse match");

m = find({ id: "strava-5", date: "2026-07-20", type: "Hardlopen", duration_min: 161.7, distance_km: 67.44 });
assert.strictEqual(m, null, "ander sporttype mag niet matchen");
console.log("  ok  ander sporttype geeft geen valse match");

console.log("\nAlle dubbeldetectie-tests geslaagd.");
