"use strict";
/**
 * Strength sessions are planned alongside cardio. The two disciplines must not
 * be treated as conflicting on the same day (a gym session plus a ride is a
 * normal double day), and completion has to match against the right log table.
 */
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/strengthplan-selftest-strengthPlanning";
require("node:fs").rmSync("/tmp/strengthplan-selftest-strengthPlanning", { recursive: true, force: true });

const { db, initSchema } = require("../db/db");
initSchema();
const { refreshCompletions } = require("./planned");
const calc = require("../lib/calculations");

const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return calc.toDateStr(d); };
const addPlan = (id, date, type, discipline, status = "gepland") =>
  db.prepare("INSERT INTO planned_sessions (id,date,type,description,status,discipline) VALUES (?,?,?,?,?,?)")
    .run(id, date, type, "test", status, discipline);

console.log("kracht en cardio op dezelfde dag botsen niet");
const day = daysAgo(1);
addPlan("c1", day, "Fietsen", "cardio");
addPlan("k1", day, "Dag A - Push", "kracht");
const both = db.prepare("SELECT * FROM planned_sessions WHERE date = ?").all(day);
assert.strictEqual(both.length, 2, "beide disciplines mogen naast elkaar staan");
const cardioClash = db.prepare("SELECT * FROM planned_sessions WHERE date=? AND status='gepland' AND discipline=?").all(day, "cardio");
assert.strictEqual(cardioClash.length, 1, "conflictcheck kijkt alleen binnen dezelfde discipline");
console.log("  ok  fietsen + krachttraining op één dag = normale dubbele dag, geen botsing");

console.log("\nafvinken kijkt naar de juiste logtabel");
db.prepare("INSERT INTO workout_logs (id,date,day_name) VALUES (?,?,?)").run("w1", day, "Dag A - Push");
refreshCompletions();
let k1 = db.prepare("SELECT * FROM planned_sessions WHERE id='k1'").get();
let c1 = db.prepare("SELECT * FROM planned_sessions WHERE id='c1'").get();
assert.strictEqual(k1.status, "gedaan", "krachtplan moet matchen met workout_logs");
assert.strictEqual(k1.completed_cardio_log_id, "w1");
assert.strictEqual(c1.status, "overgeslagen", "cardioplan zonder rit blijft niet 'gedaan'");
console.log("  ok  krachtplan afgevinkt tegen workout_logs, cardioplan niet ten onrechte");

console.log("\ncardio wordt afgevinkt tegen cardio_logs");
const day2 = daysAgo(2);
addPlan("c2", day2, "Fietsen", "cardio");
db.prepare("INSERT INTO cardio_logs (id,date,type,duration_min) VALUES (?,?,?,?)").run("r1", day2, "Fietsen", 60);
refreshCompletions();
const c2 = db.prepare("SELECT * FROM planned_sessions WHERE id='c2'").get();
assert.strictEqual(c2.status, "gedaan");
assert.strictEqual(c2.completed_cardio_log_id, "r1");
console.log("  ok  cardioplan afgevinkt tegen de gereden rit");

console.log("\ngewisselde schemadag telt ook als gedaan");
const day3 = daysAgo(3);
addPlan("k2", day3, "Dag B - Benen", "kracht");
db.prepare("INSERT INTO workout_logs (id,date,day_name) VALUES (?,?,?)").run("w2", day3, "Dag A - Push");
refreshCompletions();
assert.strictEqual(db.prepare("SELECT status FROM planned_sessions WHERE id='k2'").get().status, "gedaan");
console.log("  ok  wie Dag A doet terwijl Dag B gepland stond, wordt niet als gemist gemarkeerd");

console.log("\nAlle krachtplanning-tests geslaagd.");
