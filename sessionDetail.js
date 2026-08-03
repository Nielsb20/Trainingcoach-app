"use strict";
/**
 * Events belong in the planner. An event three weeks out falls outside the
 * visible fortnight, which is exactly when it's easiest to forget — so it has
 * to surface as a countdown regardless of the range being viewed.
 */
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/events-selftest-eventsInPlanner";
require("node:fs").rmSync("/tmp/events-selftest-eventsInPlanner", { recursive: true, force: true });

const { db, initSchema } = require("../db/db");
initSchema();
const calc = require("../lib/calculations");

const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0,10); };
const addEvent = (id, days, name) =>
  db.prepare("INSERT INTO events (id,name,date,type,target) VALUES (?,?,?,?,?)")
    .run(id, name, inDays(days), "Wielerevenement", "uitrijden");

addEvent("e1", 19, "HBO Fietstocht");        // buiten het zichtbare venster
addEvent("e2", 40, "Rondje IJsselmeer");     // nog verder weg

console.log("evenement binnen het zichtbare venster");
const from = calc.todayStr(), to = inDays(13);
let visible = db.prepare("SELECT * FROM events WHERE date >= ? AND date <= ? ORDER BY date").all(from, to);
assert.strictEqual(visible.length, 0, "over 19 dagen valt buiten een venster van 14 dagen");
console.log("  ok  evenement over 19 dagen staat (terecht) niet in de zichtbare twee weken");

console.log("\nmaar het aftellen toont hem wel");
const next = db.prepare("SELECT * FROM events WHERE date >= ? ORDER BY date LIMIT 1").get(calc.todayStr());
assert.strictEqual(next.name, "HBO Fietstocht", "het eerstvolgende evenement moet gevonden worden");
const days = calc.daysUntil(next.date);
assert.strictEqual(days, 19);
console.log(`  ok  "${next.name}" over ${days} dagen wordt bovenaan getoond`);

console.log("\nbladeren naar de juiste periode toont hem in de week");
visible = db.prepare("SELECT * FROM events WHERE date >= ? AND date <= ? ORDER BY date").all(inDays(14), inDays(27));
assert.strictEqual(visible.length, 1);
assert.strictEqual(visible[0].name, "HBO Fietstocht");
console.log("  ok  na één keer 'Volgende' staat hij gewoon op zijn dag");

console.log("\nhet dichtstbijzijnde evenement wint");
const order = db.prepare("SELECT name FROM events WHERE date >= ? ORDER BY date").all(calc.todayStr());
assert.strictEqual(order[0].name, "HBO Fietstocht");
assert.strictEqual(order[1].name, "Rondje IJsselmeer");
console.log("  ok  volgorde klopt: eerst HBO Fietstocht, dan Rondje IJsselmeer");

console.log("\nAlle tests voor evenementen in de planning geslaagd.");
