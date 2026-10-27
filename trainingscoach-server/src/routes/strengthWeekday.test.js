"use strict";
/**
 * Een krachtdag die vastligt op een weekdag hoort op die weekdag in de
 * planning, ook als de coach een andere datum noemt. Aanleiding: de schemadag
 * "Vrijdag" stond op zaterdag 31 oktober.
 */
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/strengthweekday-selftest";
require("node:fs").rmSync("/tmp/strengthweekday-selftest", { recursive: true, force: true });

const { db, initSchema } = require("../db/db");
initSchema();
const calc = require("../lib/calculations");
const { createProposalsFromCoachEntry, opVasteWeekdag, vasteWeekdagenVan } = require("./planned");

console.log("vaste weekdagen van een schemadag");
assert.deepStrictEqual(vasteWeekdagenVan({ name: "Push", weekdays: "Maandag,Donderdag" }), ["Maandag", "Donderdag"]);
assert.deepStrictEqual(vasteWeekdagenVan({ name: " vrijdag ", weekdays: null }), ["Vrijdag"]);
assert.deepStrictEqual(vasteWeekdagenVan({ name: "Vrijdag", weekdays: "Zaterdag" }), ["Zaterdag"]);
assert.deepStrictEqual(vasteWeekdagenVan({ name: "Benen", weekdays: "" }), []);
console.log("  ok  ingevulde weekdagen gaan voor, anders telt een weekdagnaam als vaste dag");

console.log("\ndatum naar de vaste weekdag");
// 2026-10-27 is een dinsdag; vrijdag is de 30e, zaterdag de 31e.
const di = "2026-10-27";
assert.strictEqual(opVasteWeekdag("2026-10-31", ["Vrijdag"], di), "2026-10-30");
assert.strictEqual(opVasteWeekdag("2026-10-30", ["Vrijdag"], di), "2026-10-30");
assert.strictEqual(opVasteWeekdag("2026-10-31", [], di), "2026-10-31");
console.log("  ok  zaterdag 31 okt wordt vrijdag 30 okt; wat al klopt blijft staan");
// Woensdag 28 met vaste dagen maandag en vrijdag: maandag ligt achter ons.
assert.strictEqual(opVasteWeekdag("2026-10-28", ["Maandag", "Vrijdag"], di), "2026-10-30");
// Coach zegt vandaag (dinsdag), vaste dag maandag: niet terug naar gisteren.
assert.strictEqual(opVasteWeekdag("2026-10-27", ["Maandag"], di), "2026-11-02");
// Gelijke afstand (woensdag tussen dinsdag en donderdag): de latere dag.
assert.strictEqual(opVasteWeekdag("2026-11-04", ["Dinsdag", "Donderdag"], di), "2026-11-05");
console.log("  ok  dichtstbijzijnde vaste dag, nooit in het verleden, bij gelijke stand later");

console.log("\nvan coachantwoord naar planning");
const iso = (d) => calc.toDateStr(d);
const vandaag = new Date(calc.todayStr() + "T00:00:00");
// De eerstvolgende vrijdag minstens twee dagen vooruit, en de zaterdag erna.
const vr = new Date(vandaag);
do { vr.setDate(vr.getDate() + 1); } while (vr.getDay() !== 5 || (vr - vandaag) / 864e5 < 2);
const za = new Date(vr); za.setDate(za.getDate() + 1);

db.prepare("INSERT INTO schema_days (id, name, sort_order) VALUES ('dV', 'Vrijdag', 0)").run();
db.prepare("INSERT INTO schema_days (id, name, sort_order) VALUES ('dB', 'Benen', 1)").run();
db.prepare(
  `INSERT INTO coach_history (id, date, cardio_voorstel_json, kracht_voorstel_json) VALUES ('c1', ?, '[]', ?)`
).run(new Date().toISOString(), JSON.stringify([
  { dag: `zaterdag ${iso(za)}`, schemaDag: "Vrijdag", invulling: "Bench 45 kg", oefeningen: [] },
  { dag: iso(za), schemaDag: "Benen", invulling: "Squat", oefeningen: [] },
]));
const r = createProposalsFromCoachEntry("c1");
const vrijdag = r.created.find((c) => c.type === "Vrijdag");
const benen = r.created.find((c) => c.type === "Benen");
assert.strictEqual(vrijdag.date, iso(vr));
assert.strictEqual(benen.date, iso(za));
assert.ok(r.waarschuwingen.some((w) => /Vrijdag ligt vast op vrijdag/.test(w.melding)));
console.log("  ok  schemadag Vrijdag komt op vrijdag, met een melding; een dag zonder vaste dag blijft waar de coach hem zette");

console.log("\nalle tests geslaagd");
