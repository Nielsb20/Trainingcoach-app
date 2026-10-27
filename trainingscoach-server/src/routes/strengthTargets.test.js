"use strict";
/**
 * De coach stelt per oefening sets, herhalingen en gewicht voor, en die moeten
 * los in de planning terechtkomen zodat het krachtloggen ze kan klaarzetten.
 * Modeluitvoer, dus: alleen oefeningen uit de schemadag, alleen redelijke getallen.
 */
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/strengthtargets-selftest";
require("node:fs").rmSync("/tmp/strengthtargets-selftest", { recursive: true, force: true });

const { db, initSchema } = require("../db/db");
initSchema();
const { normalizeStrengthTargets } = require("../lib/strengthTargets");
const { createProposalsFromCoachEntry } = require("./planned");

console.log("normaliseren van wat het model teruggeeft");
const namen = ["Bench press", "Overhead press", "Triceps pushdown"];
const doelen = normalizeStrengthTargets(
  [
    { naam: "bench press", sets: 4, herhalingen: 6, gewichtKg: 92.4 },
    { naam: "Squat", sets: 5, herhalingen: 5, gewichtKg: 120 },
    { naam: "Overhead press", sets: 3, herhalingen: 8, gewichtKg: 900 },
    { naam: "Bench press", sets: 3, herhalingen: 3, gewichtKg: 100 },
    { naam: "Triceps pushdown", sets: null, herhalingen: null, gewichtKg: null },
  ],
  namen
);
assert.deepStrictEqual(doelen, [
  { naam: "Bench press", sets: 4, herhalingen: 6, gewichtKg: 92.5 },
  { naam: "Overhead press", sets: 3, herhalingen: 8, gewichtKg: null },
]);
console.log("  ok  schemaspelling aangehouden, gewicht op een kwart afgerond");
console.log("  ok  oefening buiten de schemadag valt weg, 900 kg wordt leeg, dubbele naam telt één keer");
assert.strictEqual(normalizeStrengthTargets([], namen), null);
assert.strictEqual(normalizeStrengthTargets(undefined, namen), null);
assert.strictEqual(normalizeStrengthTargets([{ naam: "Bench press", gewichtKg: 80 }], []), null);
assert.deepStrictEqual(normalizeStrengthTargets([{ naam: "Bench press", gewichtKg: "82,5" }], namen),
  [{ naam: "Bench press", sets: null, herhalingen: null, gewichtKg: 82.5 }]);
console.log("  ok  niets bruikbaars geeft null, een komma als decimaalteken werkt");

console.log("\nvan coachantwoord naar planning");
db.prepare("INSERT INTO schema_days (id, name, sort_order) VALUES ('dA', 'Push', 0)").run();
namen.forEach((n, i) =>
  db.prepare("INSERT INTO schema_exercises (id, day_id, name, sort_order) VALUES (?, 'dA', ?, ?)").run(`e${i}`, n, i));
const morgen = new Date(); morgen.setDate(morgen.getDate() + 1);
const datum = `${morgen.getFullYear()}-${String(morgen.getMonth() + 1).padStart(2, "0")}-${String(morgen.getDate()).padStart(2, "0")}`;
db.prepare(
  `INSERT INTO coach_history (id, date, cardio_voorstel_json, kracht_voorstel_json) VALUES ('c1', ?, '[]', ?)`
).run(new Date().toISOString(), JSON.stringify([
  { dag: datum, schemaDag: "Push", invulling: "Bench 4x6 op 92,5 kg",
    oefeningen: [{ naam: "Bench press", sets: 4, herhalingen: 6, gewichtKg: 92.5 }] },
]));
const r = createProposalsFromCoachEntry("c1");
assert.strictEqual(r.kracht, 1);
assert.deepStrictEqual(r.created[0].krachtDoelen, [{ naam: "Bench press", sets: 4, herhalingen: 6, gewichtKg: 92.5 }]);
const rij = db.prepare("SELECT * FROM planned_sessions WHERE discipline = 'kracht'").get();
assert.deepStrictEqual(JSON.parse(rij.strength_targets_json)[0].gewichtKg, 92.5);
console.log("  ok  de gewichten staan los bij het krachtvoorstel in de planning");

db.prepare("UPDATE planned_sessions SET status = 'gepland' WHERE id = ?").run(rij.id);
assert.ok(db.prepare("SELECT strength_targets_json FROM planned_sessions WHERE id = ?").get(rij.id).strength_targets_json);
console.log("  ok  accepteren laat de gewichten staan");

console.log("\nAlle krachtdoel-tests geslaagd.");
