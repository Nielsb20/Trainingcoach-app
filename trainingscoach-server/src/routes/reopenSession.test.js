"use strict";
/**
 * Undoing or moving a session has to release the workout it was tied to.
 * Leaving the link in place kept the workout marked as claimed, so the
 * automatic sweep could never match it again — the session stayed open
 * forever and eventually got marked as skipped.
 */
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/reopen-selftest";
require("node:fs").rmSync("/tmp/reopen-selftest", { recursive: true, force: true });

const { db, initSchema, repairOrphanedCompletions } = require("../db/db");
initSchema();
const { refreshCompletions } = require("./planned");
const calc = require("../lib/calculations");

const today = calc.todayStr();
const row = (id) => db.prepare("SELECT * FROM planned_sessions WHERE id=?").get(id);

db.prepare("INSERT INTO planned_sessions (id,date,type,description,status,discipline) VALUES (?,?,?,?,'gepland','cardio')")
  .run("p1", today, "Fietsen (Duur)", "90 min zone 2");
db.prepare("INSERT INTO cardio_logs (id,date,type,duration_min,distance_km) VALUES (?,?,?,?,?)")
  .run("rit", today, "Fietsen", 92, 41.2);

console.log("gereden rit wordt afgevinkt");
refreshCompletions();
assert.strictEqual(row("p1").status, "gedaan");
assert.strictEqual(row("p1").completed_cardio_log_id, "rit");
console.log("  ok  status 'gedaan', gekoppeld aan de rit");

console.log("\n'ongedaan maken' laat de rit weer los");
db.prepare("UPDATE planned_sessions SET status='gepland', completed_cardio_log_id=NULL WHERE id='p1'").run();
assert.strictEqual(row("p1").completed_cardio_log_id, null, "de koppeling moet losgelaten zijn");
console.log("  ok  koppeling losgelaten");

console.log("\nen daarna kan hij opnieuw afgevinkt worden");
refreshCompletions();
assert.strictEqual(row("p1").status, "gedaan", "dit bleef eerder hangen op 'gepland'");
console.log("  ok  opnieuw automatisch afgevinkt (was: bleef voorgoed openstaan)");

console.log("\nreparatie van rijen die al vastzaten");
db.prepare("INSERT INTO planned_sessions (id,date,type,description,status,discipline,completed_cardio_log_id) VALUES (?,?,?,?,'gepland','cardio',?)")
  .run("kapot", today, "Fietsen", "vastgelopen sessie", "rit");
assert.strictEqual(row("kapot").completed_cardio_log_id, "rit");
repairOrphanedCompletions();
assert.strictEqual(row("kapot").completed_cardio_log_id, null, "bestaande rommel moet opgeruimd worden");
console.log("  ok  bestaande vastgelopen sessie losgekoppeld bij opstarten");

console.log("\nafgeronde sessies blijven met rust gelaten");
const before = row("p1").completed_cardio_log_id;
repairOrphanedCompletions();
assert.strictEqual(row("p1").completed_cardio_log_id, before, "een 'gedaan' sessie mag niet losgekoppeld worden");
console.log("  ok  'gedaan' sessies behouden hun koppeling");

console.log("\nAlle tests voor heropenen geslaagd.");
