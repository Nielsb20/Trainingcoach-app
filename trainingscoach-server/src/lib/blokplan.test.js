"use strict";
/**
 * Het blokplan is modeluitvoer van 8 tot 12 weken. Het moet op maandagen
 * staan, verleden weken laten vallen, en het laatst gegeven plan blijft gelden
 * zolang de coach geen nieuw plan geeft.
 */
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/blokplan-selftest";
require("node:fs").rmSync("/tmp/blokplan-selftest", { recursive: true, force: true });

const { db, initSchema } = require("../db/db");
initSchema();
const { normalizeBlokplan, huidigBlokplan } = require("./blokplan");
const { naarJsonSchema, COACH_RESPONSE_SCHEMA } = require("./llmProvider");

// 2026-11-25 is een woensdag; die week begint op maandag 23 november.
const VANDAAG = "2026-11-25";

console.log("normaliseren");
const plan = normalizeBlokplan({
  doel: "  Veluwerit in februari  ",
  weken: [
    { weekVan: "2026-12-02", fase: "Opbouw", focus: "duur uitbreiden", cardioUren: "6,3", krachtSessies: 2,
      kernsessies: ["lange duurrit 3 uur", "", "2x20 sweetspot"] },
    { weekVan: "2026-11-25", fase: "Opbouw", focus: "start blok", cardioUren: 5, krachtSessies: 9, kernsessies: [] },
    { weekVan: "2026-11-16", fase: "Oud", focus: "voorbij", kernsessies: [] },
    { weekVan: "2026-11-30", fase: "Dubbel", focus: "zelfde week als 2 dec", kernsessies: [] },
    { weekVan: "geen datum", fase: "Kapot", focus: "x", kernsessies: [] },
    { weekVan: "2026-12-07", fase: "", focus: "", kernsessies: [] },
  ],
}, VANDAAG);
assert.strictEqual(plan.doel, "Veluwerit in februari");
assert.deepStrictEqual(plan.weken.map((w) => w.weekVan), ["2026-11-23", "2026-11-30"]);
assert.strictEqual(plan.weken[0].krachtSessies, null, "9 krachtsessies in een week is geen plan");
assert.strictEqual(plan.weken[1].cardioUren, 6.5);
assert.deepStrictEqual(plan.weken[1].kernsessies, ["lange duurrit 3 uur", "2x20 sweetspot"]);
console.log("  ok  weken op maandag, verleden en dubbele weken weg, getallen begrensd, lege tekst weg");
assert.strictEqual(normalizeBlokplan(null, VANDAAG), null);
assert.strictEqual(normalizeBlokplan({ weken: [] }, VANDAAG), null);
assert.strictEqual(normalizeBlokplan({ weken: [{ weekVan: "2026-01-05", fase: "Oud", focus: "x" }] }, VANDAAG), null);
console.log("  ok  niets bruikbaars geeft null, zodat het vorige blokplan blijft gelden");

console.log("\nhet geldende blokplan");
const zet = (id, date, json) =>
  db.prepare("INSERT INTO coach_history (id, date, blokplan_json) VALUES (?, ?, ?)").run(id, date, json);
assert.strictEqual(huidigBlokplan(db, VANDAAG), null);
zet("c1", "2026-11-20T10:00:00Z", JSON.stringify(plan));
zet("c2", "2026-11-24T10:00:00Z", null);
const nu = huidigBlokplan(db, VANDAAG);
assert.strictEqual(nu.coachEntryId, "c1", "een antwoord zonder blokplan laat het vorige staan");
assert.strictEqual(nu.weken.length, 2);
assert.strictEqual(huidigBlokplan(db, "2026-12-01").weken.length, 1, "voorbije weken vallen eraf");
assert.strictEqual(huidigBlokplan(db, "2026-12-08"), null, "een afgelopen plan geldt niet meer");
console.log("  ok  laatste niet-lege plan geldt, vanaf de huidige week");

console.log("\nschema voor Anthropic");
const js = naarJsonSchema(COACH_RESPONSE_SCHEMA);
assert.deepStrictEqual(js.properties.blokplan.type, ["object", "null"]);
assert.ok(!js.required.includes("blokplan"));
console.log("  ok  blokplan is optioneel en mag null zijn");

console.log("\nAlle blokplantests geslaagd.");
