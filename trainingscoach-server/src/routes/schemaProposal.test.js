"use strict";
/**
 * The coach designing a schema, rather than filling one in.
 *
 * Two things are being defended here. First, everything the model returns is
 * untrusted: accepting a proposal replaces the schema every logged session is
 * entered against, so a bad weekday or a 500-rep set must never get that far.
 * Second, accepting has to be reversible — that is what makes trying a
 * proposal a reasonable thing to do at all.
 */
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/proposal-test-schema";
require("node:fs").rmSync("/tmp/proposal-test-schema", { recursive: true, force: true });

const { db, initSchema } = require("../db/db");
initSchema();

const { normalizeProposal, summarizeChanges } = require("../lib/schemaProposal");
const { getFullSchema, replaceSchema } = require("./schema");

/* ------------------------- validating the model ------------------------- */

console.log("wat het model teruggeeft wordt niet blind vertrouwd");

const messy = normalizeProposal(
  {
    toelichting: "  Opbouw richting je gravelrit.  ",
    waarschuwing: null,
    opbouw: ["Week 1-3 opbouwen", "", "Week 4 rustiger"],
    krachtdagen: [
      {
        naam: "Dag A – Onderlichaam",
        weekdagen: ["maandag", "MAANDAG", "Funday", "Donderdag"],
        moment: "Ochtend",
        oefeningen: [
          { naam: "Squat", sets: 4, reps: 5, toelichting: "start op 100 kg" },
          { naam: "  ", sets: 3, reps: 8 },
          { naam: "Romanian deadlift", sets: 99, reps: 500 },
          { naam: "Leg press", sets: "drie", reps: null },
        ],
      },
      { naam: "Lege dag", weekdagen: ["Vrijdag"], oefeningen: [] },
      { naam: "   ", weekdagen: ["Zaterdag"], oefeningen: [{ naam: "Bench", sets: 3, reps: 8 }] },
    ],
    cardiodagen: [
      { weekdag: "Woensdag", type: "fietsen", moment: "avond", invulling: "zone 2, 90 min" },
      { weekdag: "Someday", type: "Fietsen", invulling: "duurrit" },
      { weekdag: "Zondag", type: "Roeien", invulling: "60 min rustig" },
    ],
  },
  { idPrefix: "test1" }
);

assert.strictEqual(messy.days.length, 1, "dagen zonder naam of zonder oefeningen vallen af");
assert.deepStrictEqual(
  messy.days[0].weekdays,
  ["Maandag", "Donderdag"],
  "onbekende weekdagen eruit, dubbele ontdubbeld, hoofdletters genormaliseerd"
);
assert.strictEqual(messy.days[0].timeOfDay, "ochtend");
assert.strictEqual(messy.days[0].exercises.length, 3, "de naamloze oefening valt af");
assert.strictEqual(messy.days[0].exercises[1].targetSets, 12, "99 sets wordt teruggebracht tot het maximum");
assert.strictEqual(messy.days[0].exercises[1].targetReps, 100);
assert.strictEqual(messy.days[0].exercises[2].targetSets, 3, "onleesbare sets vallen terug op de standaard");
assert.strictEqual(messy.days[0].exercises[2].targetReps, 8);
assert.deepStrictEqual(messy.opbouw, ["Week 1-3 opbouwen", "Week 4 rustiger"]);
console.log("  ok  ongeldige dagen, weekdagen, sets en reps worden opgeschoond");

assert.strictEqual(messy.cardioDays.length, 2, "een cardiomoment zonder geldige weekdag kan nergens staan");
assert.strictEqual(messy.cardioDays[0].type, "Fietsen", "type wordt op de bekende lijst gelegd");
assert.strictEqual(messy.cardioDays[1].type, "Anders", "een onbekende sport belandt in Anders");
assert.match(messy.cardioDays[1].notes, /Roeien/, "maar het woord van de coach blijft in de notitie staan");
console.log("  ok  cardiomomenten worden op de bekende types gelegd zonder informatie te verliezen");

const ids = messy.days.flatMap((d) => [d.id, ...d.exercises.map((e) => e.id)]);
assert.strictEqual(new Set(ids).size, ids.length, "id's moeten uniek zijn, anders overschrijft een oefening een andere");
console.log("  ok  id's worden hier gegenereerd en zijn uniek");

assert.throws(
  () => normalizeProposal({ krachtdagen: [], cardiodagen: [] }, { idPrefix: "leeg" }),
  /geen bruikbare trainingsdagen/,
  "een leeg voorstel mag het schema niet wissen"
);
assert.throws(() => normalizeProposal(null), /geen bruikbaar schemavoorstel/);
console.log("  ok  een leeg voorstel wordt geweigerd in plaats van het schema te wissen");

/* ------------------------------ the preview ----------------------------- */

console.log("\nvoor accepteren zie je wat er verandert");

replaceSchema({
  days: [
    {
      id: "d1",
      name: "Dag A – Push",
      weekdays: ["Maandag"],
      timeOfDay: null,
      exercises: [
        { id: "e1", name: "Bench press", targetSets: 3, targetReps: 8 },
        { id: "e2", name: "Triceps pushdown", targetSets: 3, targetReps: 12 },
      ],
    },
    {
      id: "d2",
      name: "Dag B – Pull",
      weekdays: ["Donderdag"],
      timeOfDay: null,
      exercises: [{ id: "e3", name: "Barbell row", targetSets: 3, targetReps: 8 }],
    },
  ],
  cardioDays: [{ id: "c1", weekday: "Zaterdag", type: "Fietsen", notes: "duurrit" }],
  profile: { maxHr: 185, restingHr: 52, ftp: 250 },
});

const proposal = normalizeProposal(
  {
    toelichting: "Push blijft staan, pull krijgt meer volume.",
    krachtdagen: [
      {
        naam: "Dag A – Push",
        weekdagen: ["Maandag"],
        oefeningen: [
          { naam: "Bench press", sets: 3, reps: 8 },
          { naam: "Triceps pushdown", sets: 3, reps: 12 },
        ],
      },
      {
        naam: "Dag B – Pull",
        weekdagen: ["Donderdag", "Zondag"],
        oefeningen: [
          { naam: "Barbell row", sets: 4, reps: 6 },
          { naam: "Pull-up", sets: 3, reps: 8 },
        ],
      },
    ],
    cardiodagen: [{ weekdag: "Zaterdag", type: "Fietsen", invulling: "duurrit 3 uur" }],
  },
  { idPrefix: "test2" }
);

const changes = summarizeChanges(getFullSchema(), proposal);
assert.deepStrictEqual(changes.nieuweDagen, [], "geen nieuwe dagen: beide namen bestonden al");
assert.deepStrictEqual(changes.vervallenDagen, []);
assert.deepStrictEqual(changes.gewijzigdeDagen, ["Dag B – Pull"], "alleen de dag die echt verandert wordt gemeld");
assert.deepStrictEqual(changes.nieuweOefeningen, ["Pull-up"]);
assert.deepStrictEqual(changes.vervallenOefeningen, []);
assert.strictEqual(changes.krachtsessiesPerWeek, 3, "twee weekdagen op één trainingsdag telt als twee sessies");
console.log("  ok  het verschil met het huidige schema klopt, inclusief dubbel ingeplande dagen");

const stripped = summarizeChanges(getFullSchema(), normalizeProposal(
  {
    krachtdagen: [{ naam: "Full body", weekdagen: ["Dinsdag"], oefeningen: [{ naam: "Squat", sets: 3, reps: 5 }] }],
    cardiodagen: [],
  },
  { idPrefix: "test3" }
));
assert.deepStrictEqual(stripped.vervallenDagen, ["Dag A – Push", "Dag B – Pull"]);
assert.deepStrictEqual(
  stripped.vervallenOefeningen.sort(),
  ["Barbell row", "Bench press", "Triceps pushdown"],
  "oefeningen die uit het schema verdwijnen moet je vooraf zien"
);
console.log("  ok  verdwijnende dagen en oefeningen worden expliciet benoemd");

/* --------------------------- accepting and undo -------------------------- */

console.log("\naccepteren is omkeerbaar");

const before = getFullSchema();
const id = "schema-test-1";
db.prepare(
  "INSERT INTO schema_proposals (id, date, status, proposal_json, toelichting) VALUES (?, ?, 'voorgesteld', ?, ?)"
).run(id, new Date().toISOString(), JSON.stringify({ days: proposal.days, cardioDays: proposal.cardioDays }), proposal.toelichting);

// What the accept route does, without needing a live HTTP server.
function accept(proposalId) {
  const row = db.prepare("SELECT * FROM schema_proposals WHERE id = ?").get(proposalId);
  const previous = getFullSchema();
  const parsed = JSON.parse(row.proposal_json);
  db.prepare("UPDATE schema_proposals SET status = 'geaccepteerd', applied_at = ?, previous_schema_json = ? WHERE id = ?")
    .run(new Date().toISOString(), JSON.stringify(previous), proposalId);
  return replaceSchema({ days: parsed.days, cardioDays: parsed.cardioDays, profile: previous.profile });
}
function undo(proposalId) {
  const row = db.prepare("SELECT * FROM schema_proposals WHERE id = ?").get(proposalId);
  assert.ok(row.previous_schema_json, "zonder momentopname valt er niets terug te draaien");
  db.prepare("UPDATE schema_proposals SET status = 'teruggedraaid' WHERE id = ?").run(proposalId);
  return replaceSchema(JSON.parse(row.previous_schema_json));
}

const applied = accept(id);
assert.strictEqual(applied.days.length, 2);
assert.strictEqual(applied.days[1].exercises.length, 2, "Pull-up is toegevoegd");
assert.deepStrictEqual(applied.days[1].weekdays, ["Donderdag", "Zondag"]);
assert.deepStrictEqual(
  applied.profile,
  before.profile,
  "max. hartslag en FTP zijn meetgegevens van de sporter, geen onderdeel van het voorstel"
);
console.log("  ok  het voorstel staat in het schema, het profiel is ongemoeid gelaten");

const restored = undo(id);
assert.deepStrictEqual(
  restored.days.map((d) => ({ naam: d.name, weekdagen: d.weekdays, oefeningen: d.exercises.map((e) => e.name) })),
  before.days.map((d) => ({ naam: d.name, weekdagen: d.weekdays, oefeningen: d.exercises.map((e) => e.name) })),
  "terugdraaien geeft exact het oude schema terug"
);
assert.strictEqual(db.prepare("SELECT status FROM schema_proposals WHERE id = ?").get(id).status, "teruggedraaid");
console.log("  ok  terugdraaien herstelt het schema zoals het was");

/* --------------------------- rejection feedback -------------------------- */

console.log("\neen afgewezen schema komt niet ongewijzigd terug");

db.prepare("UPDATE schema_proposals SET status = 'afgewezen', decline_reason = ? WHERE id = ?")
  .run("Te veel dagen, ik haal er hooguit drie", id);

const { buildProposalPayload } = require("./schemaProposal");
db.prepare(
  `UPDATE training_goals SET goal = ?, focus = ?, strength_days_per_week = ?, available_weekdays = ? WHERE id = 1`
).run("Sterker worden en in september 150 km gravel rijden", "combi", 3, "Maandag,Woensdag,Zaterdag");

const payload = buildProposalPayload({ question: null });
assert.strictEqual(payload.doelen.doel, "Sterker worden en in september 150 km gravel rijden");
assert.deepStrictEqual(payload.doelen.beschikbareWeekdagen, ["Maandag", "Woensdag", "Zaterdag"]);
assert.strictEqual(payload.eerderAfgewezenSchemas.length, 1, "de afwijzing hoort in de volgende aanvraag");
assert.match(payload.eerderAfgewezenSchemas[0].reden, /hooguit drie/);
assert.ok(payload.huidigSchema.krachtdagen.length > 0, "het huidige schema gaat mee zodat er niet nodeloos herschreven wordt");
assert.ok("watDeClientEchtDoet" in payload, "wat er werkelijk getraind wordt hoort erbij, niet alleen de bedoeling");
console.log("  ok  doelen, huidig schema en eerdere afwijzingen zitten in de aanvraag");

console.log("\nAlle schemavoorstel-tests geslaagd.");
