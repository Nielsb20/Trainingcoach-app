"use strict";
/**
 * Moving a session is a deliberate act. The day it left must not be treated as
 * simply free — otherwise the coach refills it and quietly undoes the
 * reorganisation the athlete just made.
 */
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/moves-selftest";
require("node:fs").rmSync("/tmp/moves-selftest", { recursive: true, force: true });

const { db, initSchema } = require("../db/db");
initSchema();
const { getRecentMoves, getUpcomingPlan } = require("./planned");
const calc = require("../lib/calculations");

const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0,10); };

console.log("het echte geval: woensdagrit naar maandag, dinsdagkracht naar woensdag");
db.prepare(`INSERT INTO planned_sessions (id,date,type,description,status,discipline,moved_from,moved_at)
            VALUES (?,?,?,?,'gepland','cardio',?,?)`)
  .run("rit", inDays(0), "Fietsen", "90 min zone 2", inDays(2), new Date().toISOString());
db.prepare(`INSERT INTO planned_sessions (id,date,type,description,status,discipline,moved_from,moved_at)
            VALUES (?,?,?,?,'gepland','kracht',?,?)`)
  .run("kracht", inDays(2), "Dinsdag", "Pull up 3x5", inDays(1), new Date().toISOString());

const moves = getRecentMoves(14);
assert.strictEqual(moves.length, 2, "beide verplaatsingen moeten doorgegeven worden");
moves.forEach(m => console.log(`  ${m.discipline.padEnd(7)} ${m.type.padEnd(10)} ${m.vanDatum} -> ${m.naarDatum}`));

const rit = moves.find(m => m.type === "Fietsen");
assert.strictEqual(rit.vanDatum, inDays(2), "de coach moet zien dat woensdag is leeggemaakt");
assert.strictEqual(rit.naarDatum, inDays(0));
console.log("  ok  de coach ziet dat woensdag bewust is vrijgemaakt");

console.log("\nde nieuwe dag staat gewoon in de planning");
const plan = getUpcomingPlan(14);
const onWednesday = plan.filter(p => p.date === inDays(2));
assert.strictEqual(onWednesday.length, 1);
assert.strictEqual(onWednesday[0].discipline, "kracht");
console.log("  ok  woensdag bevat nu de krachttraining, niet de rit");

console.log("\nverplaatsing blijft geregistreerd na afvinken");
db.prepare("UPDATE planned_sessions SET status='gedaan' WHERE id='rit'").run();
assert.strictEqual(getRecentMoves(14).length, 2, "een uitgevoerde verplaatsing telt nog steeds mee");
console.log("  ok  ook na 'gedaan' weet de coach nog dat er verplaatst is");

console.log("\noude verplaatsingen vervallen na twee weken");
db.prepare("UPDATE planned_sessions SET moved_at=? WHERE id='kracht'")
  .run(new Date(Date.now() - 20*86400000).toISOString());
assert.strictEqual(getRecentMoves(14).length, 1, "een verplaatsing van 20 dagen terug is niet meer relevant");
console.log("  ok  verplaatsing van 20 dagen geleden telt niet meer mee");

console.log("\nAlle tests voor verplaatsingen geslaagd.");
