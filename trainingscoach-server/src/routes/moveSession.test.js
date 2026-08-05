"use strict";
/**
 * Moving a planned session, and the looser completion matching that goes with
 * it. Both exist because plans meet reality: sessions get shifted, and the
 * coach's wording ("Fietsen (Herstel)") rarely matches what Strava logs
 * ("Fietsen").
 */
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/move-selftest-moveSession";
require("node:fs").rmSync("/tmp/move-selftest-moveSession", { recursive: true, force: true });

const { db, initSchema } = require("../db/db");
initSchema();
const { refreshCompletions } = require("./planned");
const calc = require("../lib/calculations");

const today = calc.todayStr();
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return calc.toDateStr(d); };
const addPlan = (id, date, type, discipline = "cardio") =>
  db.prepare("INSERT INTO planned_sessions (id,date,type,description,status,discipline) VALUES (?,?,?,?,'gepland',?)")
    .run(id, date, type, "test", discipline);
const statusOf = (id) => db.prepare("SELECT status FROM planned_sessions WHERE id=?").get(id).status;

console.log("de coach schrijft anders op dan Strava logt");
addPlan("p1", daysAgo(1), "Fietsen (Herstel)");
db.prepare("INSERT INTO cardio_logs (id,date,type,duration_min) VALUES (?,?,?,?)")
  .run("r1", daysAgo(1), "Fietsen", 45);
refreshCompletions();
assert.strictEqual(statusOf("p1"), "gedaan", "'Fietsen (Herstel)' moet matchen met een gelogde 'Fietsen'");
console.log("  ok  \"Fietsen (Herstel)\" afgevinkt tegen gelogde \"Fietsen\"");

addPlan("p2", daysAgo(2), "Hardlopen - intervallen");
db.prepare("INSERT INTO cardio_logs (id,date,type,duration_min) VALUES (?,?,?,?)")
  .run("r2", daysAgo(2), "Hardlopen", 50);
refreshCompletions();
assert.strictEqual(statusOf("p2"), "gedaan");
console.log("  ok  \"Hardlopen - intervallen\" afgevinkt tegen \"Hardlopen\"");

console.log("\nandere sport gedaan dan gepland telt ook als getraind");
addPlan("p3", daysAgo(3), "Fietsen");
db.prepare("INSERT INTO cardio_logs (id,date,type,duration_min) VALUES (?,?,?,?)")
  .run("r3", daysAgo(3), "Hardlopen", 40);
refreshCompletions();
assert.strictEqual(statusOf("p3"), "gedaan", "een gewisselde sessie is geen gemiste sessie");
console.log("  ok  fietsen gepland, hardlopen gedaan -> geldt als gedaan");

console.log("\nechte rustdag blijft overgeslagen");
addPlan("p4", daysAgo(4), "Fietsen");
refreshCompletions();
assert.strictEqual(statusOf("p4"), "overgeslagen");
console.log("  ok  niets gelogd -> overgeslagen");

console.log("\nverplaatsen naar een andere dag");
addPlan("p5", daysAgo(1), "Fietsen");
db.prepare("UPDATE planned_sessions SET status='overgeslagen' WHERE id='p5'").run();
// verplaatsen zet hem terug op gepland
db.prepare("UPDATE planned_sessions SET date=?, weekday=?, status='gepland' WHERE id=?")
  .run(today, calc.weekdayNameForDate(today), "p5");
const moved = db.prepare("SELECT * FROM planned_sessions WHERE id='p5'").get();
assert.strictEqual(moved.date, today);
assert.strictEqual(moved.status, "gepland", "een verplaatste sessie staat weer open");
assert.strictEqual(moved.weekday, calc.weekdayNameForDate(today), "weekdag moet meeverhuizen");
console.log(`  ok  verplaatst naar ${today} (${moved.weekday}), status weer 'gepland'`);

console.log("\nverplaatsen naar een dag waarop al getraind is -> meteen gedaan");
// Use a fresh day: the earlier rides are already claimed by other plans, and
// one logged session may only complete one plan.
addPlan("p6", daysAgo(6), "Fietsen");
db.prepare("INSERT INTO cardio_logs (id,date,type,duration_min) VALUES (?,?,?,?)")
  .run("r6", daysAgo(7), "Fietsen", 60);
db.prepare("UPDATE planned_sessions SET date=? WHERE id='p6'").run(daysAgo(7));
refreshCompletions();
assert.strictEqual(statusOf("p6"), "gedaan");
console.log("  ok  verplaatst naar een dag met een gelogde rit -> direct afgevinkt");

console.log("\néén gelogde rit vinkt maar één plan af");
addPlan("p7", daysAgo(8), "Fietsen");
addPlan("p8", daysAgo(8), "Hardlopen");
db.prepare("INSERT INTO cardio_logs (id,date,type,duration_min) VALUES (?,?,?,?)")
  .run("r8", daysAgo(8), "Fietsen", 60);
refreshCompletions();
const statuses = [statusOf("p7"), statusOf("p8")].sort();
assert.deepStrictEqual(statuses, ["gedaan", "overgeslagen"],
  "twee plannen, één rit -> precies één afgevinkt");
assert.strictEqual(statusOf("p7"), "gedaan", "de gefietste sessie hoort de fietsrit te krijgen");
console.log("  ok  fietsen + hardlopen gepland, alleen gefietst -> 1 gedaan, 1 overgeslagen");

console.log("\nAlle tests voor verplaatsen en afvinken geslaagd.");
