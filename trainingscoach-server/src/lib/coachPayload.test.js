"use strict";
/**
 * Twee dingen rond wat de coach krijgt en teruggeeft.
 *
 * 1. Het verloop binnen een sessie ging integraal mee: zevenennegentig procent
 *    van de payload, om twee dingen te laten aflezen die uit te rekenen zijn.
 * 2. De Anthropic-route dwong het antwoordformaat niet af, terwijl de
 *    Gemini-route dat wel deed. Overstappen betekende dus overstappen naar
 *    iets zwakkers.
 */
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/coach-payload-test";
require("node:fs").rmSync("/tmp/coach-payload-test", { recursive: true, force: true });

const { db, initSchema } = require("../db/db");
initSchema();
const calc = require("./calculations");

/* ------------------- het verloop wordt samengevat ----------------------- */

console.log("het verloop binnen een sessie gaat samengevat mee");

const rit = Array.from({ length: 240 }, (_, i) => ({
  tMin: i * 0.5,
  gemHartslag: 140 + (i >= 120 ? 9 : 0), // tweede helft duidelijk hoger
  gemVermogen: 210,                      // bij gelijk vermogen: drift
  hoogte: 10 + (i % 40),
}));

const samenvatting = calc.summarizeSessionProfile(rit, { avgPower: 210, normalizedPower: 238 });
assert.strictEqual(samenvatting.driftBpm, 9, "hartslag loopt op bij gelijkblijvend vermogen");
assert.strictEqual(samenvatting.eersteHelftVermogen, samenvatting.tweedeHelftVermogen);
assert.strictEqual(samenvatting.variabiliteit, 1.13, "NP gedeeld door het gemiddelde");
assert.strictEqual(samenvatting.hoogteverschilM, 39, "zodat terrein de drift kan verklaren");
console.log(`  ok  drift ${samenvatting.driftBpm} bpm, variabiliteit ${samenvatting.variabiliteit}, hoogteverschil ${samenvatting.hoogteverschilM} m`);

// Te weinig punten is geen verloop; dan liever niets dan een getal uit lucht.
assert.strictEqual(calc.summarizeSessionProfile(rit.slice(0, 3), {}), null);
assert.strictEqual(calc.summarizeSessionProfile(null, {}), null);
console.log("  ok  een te korte of ontbrekende reeks levert niets op");

// En het scheelt orden van grootte in wat de coach moet lezen.
const { buildCoachPayload } = require("../routes/coach");
for (let i = 0; i < 8; i += 1) {
  db.prepare(
    `INSERT INTO cardio_logs (id,date,type,duration_min,distance_km,avg_hr,avg_power,weighted_avg_power,source,profile_json)
     VALUES (?,?,'Fietsen',120,57,148,210,238,'strava',?)`
  ).run(`r${i}`, `2026-10-${String(12 + i).padStart(2, "0")}`, JSON.stringify(rit));
}
const payload = JSON.stringify(buildCoachPayload({ question: "Hoe gaat het?" }));
const tokens = Math.round(payload.length / 4);
assert.ok(tokens < 5000, `payload is ${tokens} tokens; de hele tijdreeks zat er weer in`);
assert.ok(!payload.includes("verloopBinnenSessie"), "het oude veld hoort weg te zijn");
assert.ok(payload.includes("driftBpm"), "maar de conclusie eruit moet er wel in");
console.log(`  ok  acht ritten met verloop passen in ~${tokens} tokens in plaats van ~47.000`);

/* ------------- het antwoordformaat wordt bij beide afgedwongen ---------- */

console.log("\nhet antwoordformaat wordt bij beide providers afgedwongen");

const { naarJsonSchema, COACH_RESPONSE_SCHEMA } = require("./llmProvider");

const vertaald = naarJsonSchema(COACH_RESPONSE_SCHEMA);
assert.strictEqual(vertaald.type, "object", "hoofdletters worden kleine letters");
assert.deepStrictEqual(vertaald.required, ["analyse", "tips", "cardioVoorstel", "krachtVoorstel"]);
assert.strictEqual(vertaald.properties.tips.type, "array");
assert.strictEqual(vertaald.properties.tips.items.type, "string");
// nullable bestaat niet in JSON Schema; dat wordt een unie.
assert.deepStrictEqual(vertaald.properties.waarschuwing.type, ["string", "null"]);
assert.strictEqual(vertaald.additionalProperties, false, "geen velden buiten het contract");
console.log("  ok  Gemini's schema vertaalt naar geldig JSON Schema");

const cardio = vertaald.properties.cardioVoorstel.items;
assert.strictEqual(cardio.type, "object");
assert.deepStrictEqual(cardio.required, ["dag", "type", "invulling"]);
assert.deepStrictEqual(cardio.properties.fiets.type, ["string", "null"]);
assert.strictEqual(cardio.properties.blokken.type, "array", "geneste lijsten gaan mee");
assert.strictEqual(cardio.properties.blokken.items.properties.soort.type, "string");
console.log("  ok  de geneste voorstellen en blokken vertalen mee");

console.log("\nAlle tests rond de coachpayload geslaagd.");
