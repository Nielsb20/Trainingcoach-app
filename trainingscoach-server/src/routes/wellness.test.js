"use strict";
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/wellness-selftest-wellness";
require("node:fs").rmSync("/tmp/wellness-selftest-wellness", { recursive: true, force: true });

const { db, initSchema } = require("../db/db");
initSchema();
const { upsertWellness, serialize } = require("./wellness");

const get = (d) => serialize(db.prepare("SELECT * FROM wellness_logs WHERE date = ?").get(d));

console.log("upsert per datum");
upsertWellness({ date: "2026-07-28", restingHr: 48, sleepMinutes: 450, source: "garmin" });
let row = get("2026-07-28");
assert.strictEqual(row.restingHr, 48);
assert.strictEqual(row.sleepMinutes, 450);
console.log("  ok  nieuwe dag aangemaakt");

console.log("\ngedeeltelijke update mag bestaande velden niet wissen");
upsertWellness({ date: "2026-07-28", hrvMs: 62, source: "garmin" });
row = get("2026-07-28");
assert.strictEqual(row.hrvMs, 62, "nieuw veld moet gezet zijn");
assert.strictEqual(row.restingHr, 48, "bestaande rusthartslag mag niet gewist zijn");
assert.strictEqual(row.sleepMinutes, 450, "bestaande slaap mag niet gewist zijn");
console.log("  ok  Garmin vult HRV aan zonder handmatige invoer te overschrijven");

console.log("\nhandmatige correctie overschrijft wel");
upsertWellness({ date: "2026-07-28", restingHr: 50, source: "manual" });
row = get("2026-07-28");
assert.strictEqual(row.restingHr, 50, "expliciete waarde moet winnen");
assert.strictEqual(row.hrvMs, 62, "andere velden blijven staan");
console.log("  ok  expliciete waarde wint, rest blijft intact");

console.log("\néén rij per dag");
const count = db.prepare("SELECT COUNT(*) c FROM wellness_logs WHERE date = ?").get("2026-07-28").c;
assert.strictEqual(count, 1, "mag geen dubbele rijen opleveren");
console.log("  ok  na 3 updates nog steeds 1 rij");

console.log("\nAlle welzijnstests geslaagd.");
