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

/* --------------------- the athlete's available days --------------------- */

console.log("\nde coach mag niet plannen op dagen die je niet hebt aangevinkt");

// Exactly what happened in practice: maandag was never ticked, and the model
// put a training day on it anyway.
const outsideAvailability = normalizeProposal(
  {
    toelichting: "Twee krachtdagen.",
    krachtdagen: [
      { naam: "Dag A - Focus Squat", weekdagen: ["Maandag"], oefeningen: [{ naam: "Squat", sets: 3, reps: 5 }] },
      { naam: "Dag B - Bench & Deadlift", weekdagen: ["Vrijdag", "Zondag"], oefeningen: [{ naam: "Bench press", sets: 3, reps: 5 }] },
    ],
    cardiodagen: [
      { weekdag: "Woensdag", type: "Fietsen", invulling: "intervallen" },
      { weekdag: "Donderdag", type: "Fietsen", invulling: "duurrit" },
    ],
  },
  { idPrefix: "beschikbaar", availableWeekdays: ["Dinsdag", "Woensdag", "Vrijdag", "Zaterdag"] }
);

assert.deepStrictEqual(outsideAvailability.days[0].weekdays, [], "maandag mag er niet in blijven staan");
assert.deepStrictEqual(outsideAvailability.days[1].weekdays, ["Vrijdag"], "zondag eruit, vrijdag blijft");
assert.deepStrictEqual(
  outsideAvailability.cardioDays.map((c) => c.weekday),
  ["Woensdag"],
  "een cardiomoment op een niet-beschikbare dag kan nergens staan"
);
assert.strictEqual(outsideAvailability.correcties.length, 3, "elke verwijdering wordt gemeld");
assert.match(outsideAvailability.correcties[0], /Maandag .*"Dag A - Focus Squat"/);
assert.match(outsideAvailability.correcties[0], /zonder vaste weekdag/, "een dag die niets overhoudt vraagt om actie");
assert.match(outsideAvailability.correcties[2], /donderdag/);
console.log("  ok  niet-beschikbare dagen worden verwijderd en elke verwijdering wordt gemeld");

const unrestricted = normalizeProposal(
  {
    krachtdagen: [{ naam: "Full body", weekdagen: ["Maandag"], oefeningen: [{ naam: "Squat", sets: 3, reps: 5 }] }],
    cardiodagen: [{ weekdag: "Donderdag", type: "Fietsen", invulling: "duurrit" }],
  },
  { idPrefix: "vrij", availableWeekdays: [] }
);
assert.deepStrictEqual(unrestricted.days[0].weekdays, ["Maandag"], "geen aangevinkte dagen = geen beperking");
assert.strictEqual(unrestricted.cardioDays.length, 1);
assert.deepStrictEqual(unrestricted.correcties, []);
console.log("  ok  vink je niets aan, dan blijft de coach vrij om zelf te verdelen");

/* ------------------------- locked training days ------------------------- */

console.log("\nvaste afspraken worden niet verzet");

// Tuesday evening in the gym and Saturday morning on the bike are arranged at
// home. The coach may decide what happens then; it may not decide when.
const currentWithLocks = {
  days: [
    {
      id: "vast1", name: "Dinsdag", weekdays: ["Dinsdag"], timeOfDay: "avond", locked: true,
      exercises: [{ id: "x1", name: "Pavel row", targetSets: 3, targetReps: 8 }],
    },
    {
      id: "los1", name: "Vrijdag", weekdays: ["Vrijdag"], timeOfDay: null, locked: false,
      exercises: [{ id: "x2", name: "Bench press", targetSets: 3, targetReps: 8 }],
    },
  ],
  cardioDays: [
    { id: "c1", weekday: "Zaterdag", type: "Fietsen", timeOfDay: "ochtend", notes: "clubrit", locked: true },
    { id: "c2", weekday: "Woensdag", type: "Fietsen", timeOfDay: null, notes: "intervallen", locked: false },
  ],
};

const ignoringLocks = normalizeProposal(
  {
    toelichting: "Alles opnieuw ingedeeld.",
    krachtdagen: [
      { naam: "Dag A", weekdagen: ["Woensdag"], oefeningen: [{ naam: "Squat", sets: 3, reps: 5 }] },
      { naam: "Dag B", weekdagen: ["Vrijdag"], oefeningen: [{ naam: "Bench press", sets: 3, reps: 5 }] },
    ],
    // The locked Saturday ride moved to Sunday, which is what a coach optimising
    // recovery would happily do and a household would not.
    cardiodagen: [{ weekdag: "Zondag", type: "Fietsen", invulling: "lange duurrit" }],
  },
  { idPrefix: "vast", currentSchema: currentWithLocks }
);

const restoredDay = ignoringLocks.days.find((d) => d.weekdays.includes("Dinsdag"));
assert.ok(restoredDay, "de vastgezette dinsdag moet terug zijn gezet");
assert.strictEqual(restoredDay.name, "Dinsdag");
assert.strictEqual(restoredDay.timeOfDay, "avond", "ook het afgesproken tijdstip hoort terug");
assert.strictEqual(restoredDay.locked, true, "en blijft vastgezet na overnemen");
assert.deepStrictEqual(restoredDay.exercises.map((e) => e.name), ["Pavel row"], "met de oefeningen die erop stonden");

const restoredRide = ignoringLocks.cardioDays.find((c) => c.weekday === "Zaterdag");
assert.ok(restoredRide, "de vastgezette zaterdagrit moet terug zijn gezet");
assert.strictEqual(restoredRide.timeOfDay, "ochtend");
assert.strictEqual(restoredRide.locked, true);
assert.ok(
  ignoringLocks.cardioDays.some((c) => c.weekday === "Zondag"),
  "wat de coach er zelf bij bedacht mag blijven staan"
);
assert.strictEqual(ignoringLocks.correcties.length, 2, "beide verschuivingen worden gemeld");
assert.match(ignoringLocks.correcties.join(" "), /vaste afspraak/i);
console.log("  ok  een verzette of geschrapte vaste afspraak wordt teruggezet en gemeld");

const respectingLocks = normalizeProposal(
  {
    krachtdagen: [
      // Same day, different workout: that is exactly what the coach is for.
      { naam: "Dag A - Onderlichaam", weekdagen: ["Dinsdag"], moment: "avond", oefeningen: [{ naam: "Squat", sets: 4, reps: 5 }] },
    ],
    cardiodagen: [{ weekdag: "Zaterdag", type: "Fietsen", moment: "ochtend", invulling: "clubrit, rustig aan" }],
  },
  { idPrefix: "netjes", currentSchema: currentWithLocks }
);
assert.deepStrictEqual(respectingLocks.correcties, [], "de dag invullen is geen overtreding");
assert.strictEqual(respectingLocks.days.length, 1, "er wordt niets dubbel teruggezet");
assert.deepStrictEqual(respectingLocks.days[0].exercises.map((e) => e.name), ["Squat"], "de nieuwe invulling blijft staan");
assert.strictEqual(respectingLocks.days[0].locked, true, "het slot verhuist mee naar wat er nu op die dag staat");
assert.strictEqual(respectingLocks.cardioDays[0].locked, true);
console.log("  ok  dezelfde dag anders invullen mag, en het slot blijft behouden");

const wrongTime = normalizeProposal(
  {
    krachtdagen: [{ naam: "Dag A", weekdagen: ["Dinsdag"], moment: "ochtend", oefeningen: [{ naam: "Squat", sets: 3, reps: 5 }] }],
    cardiodagen: [],
  },
  { idPrefix: "tijd", currentSchema: currentWithLocks }
);
assert.strictEqual(wrongTime.days[0].timeOfDay, "avond", "een vastgezet tijdstip wordt teruggezet");
assert.match(wrongTime.correcties.join(" "), /tijdstip is teruggezet/);
console.log("  ok  ook het tijdstip van een vaste afspraak ligt vast");

// A locked day the athlete forgot to tick as available must not be stripped by
// the availability filter and then restored — that would fight itself.
const lockedOutsideAvailability = normalizeProposal(
  {
    krachtdagen: [{ naam: "Dag A", weekdagen: ["Dinsdag"], moment: "avond", oefeningen: [{ naam: "Squat", sets: 3, reps: 5 }] }],
    cardiodagen: [{ weekdag: "Zaterdag", type: "Fietsen", moment: "ochtend", invulling: "clubrit" }],
  },
  { idPrefix: "conflict", currentSchema: currentWithLocks, availableWeekdays: ["Woensdag", "Vrijdag"] }
);
assert.deepStrictEqual(lockedOutsideAvailability.days[0].weekdays, ["Dinsdag"]);
assert.deepStrictEqual(lockedOutsideAvailability.correcties, [], "een vastgezette dag telt als beschikbaar");
console.log("  ok  een vastgezette dag wint van een niet-aangevinkt vakje");

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

// A ride that shifts to another day used to be invisible here: the count stayed
// 1 either way, so you found out after accepting.
const movedCardio = summarizeChanges(
  getFullSchema(),
  normalizeProposal(
    {
      krachtdagen: [{ naam: "Dag A – Push", weekdagen: ["Maandag"], oefeningen: [{ naam: "Bench press", sets: 3, reps: 8 }] }],
      cardiodagen: [{ weekdag: "Zondag", type: "Fietsen", invulling: "duurrit" }],
    },
    { idPrefix: "cardiodiff" }
  )
);
assert.deepStrictEqual(movedCardio.vervallenCardiomomenten, ["Zaterdag Fietsen"]);
assert.deepStrictEqual(movedCardio.nieuweCardiomomenten, ["Zondag Fietsen"]);
console.log("  ok  een verplaatst cardiomoment is zichtbaar vóór je accepteert");

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
