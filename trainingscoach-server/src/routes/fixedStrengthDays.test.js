"use strict";
/**
 * Strength days are fixed by the athlete, not inferred by the coach. These
 * tests pin down that the weekday assignment survives a save/load round trip
 * and reaches the coach payload — without it the coach falls back to guessing
 * a rotation, which is exactly what we don't want.
 */
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/fixeddays-selftest";
require("node:fs").rmSync("/tmp/fixeddays-selftest", { recursive: true, force: true });

const { db, initSchema } = require("../db/db");
initSchema();
const { getFullSchema } = require("./schema");

function saveSchema(days) {
  db.prepare("DELETE FROM schema_exercises").run();
  db.prepare("DELETE FROM schema_days").run();
  const insertDay = db.prepare("INSERT INTO schema_days (id, name, sort_order, weekdays) VALUES (?, ?, ?, ?)");
  const insertEx = db.prepare(
    "INSERT INTO schema_exercises (id, day_id, name, target_sets, target_reps, sort_order) VALUES (?,?,?,?,?,?)");
  days.forEach((d, i) => {
    insertDay.run(d.id, d.name, i, (d.weekdays || []).join(",") || null);
    (d.exercises || []).forEach((e, j) => insertEx.run(e.id, d.id, e.name, 3, 8, j));
  });
}

console.log("vaste weekdagen overleven opslaan en terugladen");
saveSchema([
  { id: "d1", name: "Dag A - Push", weekdays: ["Dinsdag"], exercises: [{ id: "e1", name: "Bench press" }] },
  { id: "d2", name: "Dag B - Benen", weekdays: ["Donderdag"], exercises: [{ id: "e2", name: "Squat" }] },
]);
let schema = getFullSchema();
assert.deepStrictEqual(schema.days[0].weekdays, ["Dinsdag"]);
assert.deepStrictEqual(schema.days[1].weekdays, ["Donderdag"]);
console.log(`  ok  ${schema.days[0].name} -> ${schema.days[0].weekdays}`);
console.log(`  ok  ${schema.days[1].name} -> ${schema.days[1].weekdays}`);

console.log("\ndezelfde training twee keer per week");
saveSchema([{ id: "d1", name: "Full body", weekdays: ["Dinsdag", "Vrijdag"], exercises: [] }]);
schema = getFullSchema();
assert.deepStrictEqual(schema.days[0].weekdays, ["Dinsdag", "Vrijdag"]);
console.log("  ok  meerdere weekdagen per trainingsdag blijven behouden");

console.log("\ngeen weekdag ingevuld -> lege lijst, niet null of een verzonnen dag");
saveSchema([{ id: "d1", name: "Dag A", weekdays: [], exercises: [] }]);
schema = getFullSchema();
assert.deepStrictEqual(schema.days[0].weekdays, []);
console.log("  ok  lege lijst (coach mag dan zelf verdelen)");

console.log("\nwat de coach te zien krijgt");
saveSchema([
  { id: "d1", name: "Dag A - Push", weekdays: ["Dinsdag"], exercises: [{ id: "e1", name: "Bench press" }] },
  { id: "d2", name: "Dag B - Benen", weekdays: [], exercises: [{ id: "e2", name: "Squat" }] },
]);
schema = getFullSchema();
const payload = schema.days.map((d) => ({
  dag: d.name,
  vasteWeekdagen: d.weekdays && d.weekdays.length ? d.weekdays : null,
}));
assert.deepStrictEqual(payload[0].vasteWeekdagen, ["Dinsdag"], "vaste dag moet meegestuurd worden");
assert.strictEqual(payload[1].vasteWeekdagen, null, "geen vaste dag -> null, zodat de coach weet dat hij vrij is");
console.log("  ok  vaste dag -> ['Dinsdag'] | geen vaste dag -> null");

console.log("\nAlle tests voor vaste krachtdagen geslaagd.");
