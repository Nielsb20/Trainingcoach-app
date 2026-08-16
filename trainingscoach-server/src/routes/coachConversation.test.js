"use strict";
/**
 * Wat de coach van een vorig gesprek weet.
 *
 * Elke consultatie was een losstaande aanroep: de vraag ging met een berg
 * trainingsdata naar het model en verder niets. Een vervolgvraag als "waarom
 * stelde je dat voor?" had daardoor geen aanknopingspunt, en het model
 * antwoordde iets aannemelijks in plaats van iets kloppends. De antwoorden
 * stonden er al die tijd al — ze gingen alleen nooit terug mee.
 */
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/coach-conversation-test";
require("node:fs").rmSync("/tmp/coach-conversation-test", { recursive: true, force: true });

const { db, initSchema } = require("../db/db");
initSchema();
const calc = require("../lib/calculations");
const { buildCoachPayload, getRecentConversation } = require("./coach");

const daysAgo = (n) => {
  const d = new Date(calc.todayStr() + "T12:00:00");
  d.setDate(d.getDate() - n);
  return d.toISOString();
};

function addAnswer({ id, dagenGeleden, question, analyse, tips = [], cardio = [], kracht = [], triggerType = "handmatig", triggerReason = null }) {
  db.prepare(
    `INSERT INTO coach_history (id, date, question, analyse, tips_json, cardio_voorstel_json, kracht_voorstel_json, trigger_type, trigger_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, daysAgo(dagenGeleden), question, analyse,
    JSON.stringify(tips), JSON.stringify(cardio), JSON.stringify(kracht), triggerType, triggerReason
  );
}

/* ------------------------- het gesprek gaat mee ------------------------- */

console.log("een vervolgvraag heeft iets om naar te verwijzen");

addAnswer({
  id: "c1", dagenGeleden: 6,
  question: "Wat moet ik dinsdag doen?",
  analyse: "Je herstel is prima, er kan een prikkel bij.",
  tips: ["Houd woensdag rustig"],
  cardio: [{ dag: "Dinsdag", type: "Fietsen", invulling: "4x8 min in zone 4, 5 min rust ertussen" }],
});
addAnswer({
  id: "c2", dagenGeleden: 2,
  question: null,
  analyse: "Je rusthartslag ligt 7 slagen boven je basislijn.",
  triggerType: "signaal", triggerReason: "verhoogde rusthartslag",
  kracht: [{ dag: "Donderdag", schemaDag: "Dag A", invulling: "een set minder per oefening" }],
});

const gesprek = getRecentConversation();
assert.strictEqual(gesprek.length, 2);
assert.deepStrictEqual(gesprek.map((g) => g.datum), [daysAgo(6).slice(0, 10), daysAgo(2).slice(0, 10)], "oudste eerst — een gesprek leest vooruit");
assert.strictEqual(gesprek[0].vraagVanDeCliënt, "Wat moet ik dinsdag doen?");
assert.match(gesprek[0].jouwVoorstellen[0], /Dinsdag: Fietsen — 4x8 min in zone 4/, "wat je voorstelde hoort erbij, anders is 'dat' nog steeds niets");
console.log("  ok  eerdere vragen, antwoorden en voorstellen gaan mee, chronologisch");

assert.strictEqual(gesprek[1].vraagVanDeCliënt, null);
assert.strictEqual(gesprek[1].aanleiding, "verhoogde rusthartslag", "een automatische run is herkenbaar als iets dat de app aankaartte");
assert.match(gesprek[1].jouwVoorstellen[0], /Donderdag \(Dag A\)/);
console.log("  ok  automatische adviezen tellen mee, met hun aanleiding erbij");

/* ------------------------------- begrenzing ----------------------------- */

console.log("\nhet gesprek blijft behapbaar");

addAnswer({ id: "oud", dagenGeleden: 40, question: "Iets van vorige maand", analyse: "Lang geleden." });
assert.ok(
  !getRecentConversation().some((g) => g.vraagVanDeCliënt === "Iets van vorige maand"),
  "een antwoord van zes weken terug is geen lopend gesprek meer"
);
console.log("  ok  antwoorden ouder dan drie weken vallen af");

for (let i = 0; i < 8; i++) {
  addAnswer({ id: `bulk-${i}`, dagenGeleden: 1, question: `Vraag ${i}`, analyse: "x" });
}
assert.strictEqual(getRecentConversation().length, 5, "vijf beurten, anders groeit elke vraag uit tot een maandoverzicht");
console.log("  ok  hooguit vijf beurten gaan mee");

addAnswer({
  id: "lang", dagenGeleden: 0,
  question: "En nu?",
  analyse: "L".repeat(900),
  tips: ["t".repeat(300), "tweede", "derde", "vierde"],
  cardio: [{ dag: "Zaterdag", type: "Fietsen", invulling: "i".repeat(400) }],
});
const laatste = getRecentConversation().at(-1);
assert.ok(laatste.jouwAnalyse.length < 450, "een lange analyse wordt ingekort");
assert.ok(laatste.jouwAnalyse.endsWith("…"), "en dat is zichtbaar afgekapt, niet stilletjes");
assert.strictEqual(laatste.jouwTips.length, 3, "hooguit drie tips per beurt");
assert.ok(laatste.jouwVoorstellen[0].length < 200);
console.log("  ok  lange antwoorden worden ingekort in plaats van integraal meegestuurd");

/* --------------------------- in de payload zelf -------------------------- */

console.log("\nde payload die de coach krijgt");

const payload = buildCoachPayload({ question: "En als ik dat nou naar woensdag verplaats?" });
assert.ok(Array.isArray(payload.eerderGesprek), "eerderGesprek hoort in de payload te staan");
assert.ok(payload.eerderGesprek.length > 0);
assert.strictEqual(payload.vraagVanGebruiker, "En als ik dat nou naar woensdag verplaats?");
// De harde cijfers blijven leidend; het gesprek komt er alleen naast te staan.
assert.ok("trainingsbelasting" in payload && "huidigePlanning" in payload, "het gesprek vervangt de berekende gegevens niet");
console.log("  ok  het gesprek staat naast de berekende gegevens, niet in plaats daarvan");

console.log("\nAlle gesprekstests geslaagd.");
