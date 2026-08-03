"use strict";
/**
 * Manually skipping a session must stick: the automatic sweep should never
 * quietly undo a decision the athlete made, and an accidental skip has to be
 * correctable.
 */
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/skip-selftest-skipSession";
require("node:fs").rmSync("/tmp/skip-selftest-skipSession", { recursive: true, force: true });

const { db, initSchema } = require("../db/db");
initSchema();
const { refreshCompletions } = require("./planned");
const calc = require("../lib/calculations");

const today = calc.todayStr();
const addPlan = (id, date, status = "gepland") =>
  db.prepare("INSERT INTO planned_sessions (id,date,type,description,status,discipline) VALUES (?,?,?,?,?,'cardio')")
    .run(id, date, "Fietsen", "duurrit", status);
const statusOf = (id) => db.prepare("SELECT status FROM planned_sessions WHERE id=?").get(id).status;

console.log("vandaag alvast overslaan blijft staan");
addPlan("p1", today, "overgeslagen");
refreshCompletions();
assert.strictEqual(statusOf("p1"), "overgeslagen", "handmatige keuze mag niet worden teruggedraaid");
console.log("  ok  overgeslagen sessie van vandaag blijft overgeslagen");

console.log("\nde automaat overschrijft een handmatige keuze niet, ook niet als je toch traint");
db.prepare("INSERT INTO cardio_logs (id,date,type,duration_min) VALUES (?,?,?,?)").run("r1", today, "Fietsen", 60);
refreshCompletions();
assert.strictEqual(statusOf("p1"), "overgeslagen", "jouw beslissing wint van de automaat");
console.log("  ok  ondanks een gelogde rit blijft de handmatige keuze staan");

console.log("\nongedaan maken laat de automaat het wel weer oppakken");
db.prepare("UPDATE planned_sessions SET status='gepland' WHERE id='p1'").run();
refreshCompletions();
assert.strictEqual(statusOf("p1"), "gedaan", "na terugzetten wordt de rit alsnog herkend");
console.log("  ok  terugzetten naar gepland -> automatisch afgevinkt als gedaan");

console.log("\ngemiste dag in het verleden wordt nog steeds vanzelf gemarkeerd");
const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
addPlan("p2", yesterday.toISOString().slice(0,10));
refreshCompletions();
assert.strictEqual(statusOf("p2"), "overgeslagen");
console.log("  ok  gisteren gepland, niets gelogd -> automatisch overgeslagen");

console.log("\nAlle tests voor overslaan geslaagd.");
