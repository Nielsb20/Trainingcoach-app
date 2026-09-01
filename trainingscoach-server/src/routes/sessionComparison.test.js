"use strict";
/**
 * Waarmee een rit vergeleken wordt.
 *
 * De vergelijking keek alleen naar afstand. Vijftig kilometer over een dijk en
 * vijftig kilometer door het heuvelland zijn dezelfde afstand en totaal
 * verschillende ritten — en dan leest "twee km/u langzamer dan vorige keer"
 * als vormverlies terwijl het gewoon het parcours was.
 */
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/session-comparison-test";
require("node:fs").rmSync("/tmp/session-comparison-test", { recursive: true, force: true });

const { db, initSchema } = require("../db/db");
initSchema();
const { findComparableSessions, climbPerKm, similarTerrain } = require("./sessionDetail");

db.prepare("UPDATE profile SET max_hr=185, resting_hr=49, ftp=250 WHERE id=1").run();
db.prepare("INSERT INTO weight_logs (id,date,weight_kg) VALUES (?,?,?)").run("w1", "2026-05-01", 75);

function addRide({ id, date, km, min, hm, avgPower = null, np = null, hr = 140 }) {
  db.prepare(
    `INSERT INTO cardio_logs (id,date,type,duration_min,distance_km,avg_hr,avg_power,weighted_avg_power,elevation_gain_m,source)
     VALUES (?,?,'Fietsen',?,?,?,?,?,?,'test')`
  ).run(id, date, min, km, hr, avgPower, np, hm);
}

/* ------------------------------ de maatstaf ------------------------------ */

console.log("hoogtemeters per kilometer als maat voor het parcours");

assert.strictEqual(climbPerKm(50, 1000), 20);
assert.strictEqual(climbPerKm(50, 100), 2);
assert.strictEqual(climbPerKm(50, null), null, "zonder hoogtemeters valt er niets te zeggen");
assert.strictEqual(climbPerKm(null, 500), null);
console.log("  ok  klim per kilometer wordt correct berekend");

assert.strictEqual(similarTerrain(1, 4), true, "1 tegen 4 hm/km is relatief een factor vier, in de benen niets");
assert.strictEqual(similarTerrain(14, 18), true, "kleine relatieve afwijking op zwaar terrein telt als vergelijkbaar");
assert.strictEqual(similarTerrain(2, 20), false, "vlak tegen bergachtig is niet vergelijkbaar");
assert.strictEqual(similarTerrain(20, null), null, "onbekend is iets anders dan vergelijkbaar");
console.log("  ok  absoluut én relatief, zodat geen van beide uitersten misleidt");

/* ------------------------- rangschikken op terrein ----------------------- */

console.log("\nvergelijkbaar betekent ook: vergelijkbaar parcours");

// De rit die we bekijken: 50 km met stevig klimwerk (20 hm/km).
addRide({ id: "heuvels-nu", date: "2026-08-10", km: 50, min: 120, hm: 1000, avgPower: 210, np: 240 });
// Recente vlakke ritten, en één oudere heuvelrit.
addRide({ id: "vlak-1", date: "2026-08-08", km: 50, min: 95, hm: 100, avgPower: 205, np: 210 });
addRide({ id: "vlak-2", date: "2026-08-06", km: 48, min: 92, hm: 80, avgPower: 200, np: 205 });
addRide({ id: "vlak-3", date: "2026-08-04", km: 52, min: 99, hm: 120, avgPower: 202, np: 208 });
addRide({ id: "heuvels-oud", date: "2026-06-01", km: 49, min: 118, hm: 950, avgPower: 205, np: 235 });
addRide({ id: "veel-verder", date: "2026-07-01", km: 200, min: 400, hm: 2000 });

const eigen = db.prepare("SELECT * FROM cardio_logs WHERE id = 'heuvels-nu'").get();
const top3 = findComparableSessions(eigen, 3);

assert.strictEqual(top3[0].id, "heuvels-oud", "de andere heuvelrit hoort bovenaan, ook al is hij twee maanden ouder");
assert.ok(!top3.some((c) => c.id === "veel-verder"), "een rit van 200 km valt nog steeds af op afstand");
console.log("  ok  de rit over vergelijkbaar terrein komt eerst, niet simpelweg de meest recente");

/* ---------------------- zonder hoogtemeters: als vanouds ----------------- */

console.log("\nzonder hoogtemeters verandert er niets");

addRide({ id: "geen-hm", date: "2026-08-09", km: 50, min: 100, hm: null });
const zonderHm = db.prepare("SELECT * FROM cardio_logs WHERE id = 'geen-hm'").get();
const volgorde = findComparableSessions(zonderHm, 3).map((c) => c.id);
assert.deepStrictEqual(volgorde, ["vlak-1", "vlak-2", "vlak-3"], "dan gewoon de meest recente eerst, zoals altijd");
console.log("  ok  een rit zonder hoogtemeters wordt niet met nepnauwkeurigheid gesorteerd");

/* ----------------- onbekend terrein telt niet als match ------------------ */

console.log("\neen rit waarvan het klimwerk onbekend is dringt niet voor");

const metOnbekend = findComparableSessions(eigen, 5).map((c) => c.id);
assert.ok(
  metOnbekend.indexOf("geen-hm") > metOnbekend.indexOf("heuvels-oud"),
  "liever een rit waarvan we wéten dat hij vergelijkbaar is"
);
console.log("  ok  onbekend klimwerk komt achteraan in plaats van vooraan");

console.log("\nAlle tests voor de sessievergelijking geslaagd.");
