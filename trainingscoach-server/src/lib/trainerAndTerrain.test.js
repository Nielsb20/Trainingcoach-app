"use strict";
/**
 * Drie dingen die uit het gebruik kwamen.
 *
 * 1. De rusthartslag in het profiel werd één keer ingetikt en daarna vergeten,
 *    terwijl er elke nacht een meting bijkwam. De zones rekenden door met een
 *    getal van maanden terug.
 * 2. Alles wat op een fiets gebeurde was "Fietsen". Veertig kilometer MTB werd
 *    daarmee vergeleken met veertig kilometer asfalt, en dat leest als
 *    vormverlies terwijl het een andere sport is.
 * 3. Een geplande intervaltraining moest met de hand in de indoortrainer
 *    worden ingevoerd, terwijl ROUVY .zwo, .erg en .mrc leest.
 */
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/trainer-terrain-test";
require("node:fs").rmSync("/tmp/trainer-terrain-test", { recursive: true, force: true });

const { db, initSchema } = require("../db/db");
initSchema();
const calc = require("./calculations");
const wf = require("./workoutFile");
const strava = require("./strava");
const { validateCardioEntry, validateSubType } = require("./validate");

/* ------------------ rusthartslag uit de gemeten nachten ----------------- */

console.log("de rusthartslag komt uit de metingen, niet uit het geheugen");

const dag = (terug) => {
  const d = new Date(calc.todayStr() + "T00:00:00");
  d.setDate(d.getDate() - terug);
  return calc.toDateStr(d);
};

// Veertien nachten rond 46, met één uitschieter van 61 (biertje, griep, weet
// je het nog). Een gemiddelde zou daardoor omhoog kruipen.
const nachten = [46, 45, 47, 46, 44, 61, 46, 47, 45, 46, 48, 45, 46, 47].map((bpm, i) => ({
  date: dag(i + 1),
  resting_hr: bpm,
}));

const basislijn = calc.computeRestingHrBaseline(nachten);
assert.strictEqual(basislijn.bpm, 46, "de mediaan laat zich niet meetrekken door één slechte nacht");
assert.strictEqual(basislijn.nachten, 14);
assert.strictEqual(basislijn.hoogste, 61, "de uitschieter wordt wel gemeld, alleen niet meegerekend");
console.log(`  ok  mediaan ${basislijn.bpm} bpm over ${basislijn.nachten} nachten (laagste ${basislijn.laagste}, hoogste ${basislijn.hoogste})`);

// Te weinig nachten is geen basislijn maar een losse meting.
assert.strictEqual(
  calc.computeRestingHrBaseline(nachten.slice(0, 3)),
  null,
  "drie nachten leveren geen basislijn op"
);
// En nachten van lang geleden tellen niet mee.
assert.strictEqual(
  calc.computeRestingHrBaseline([{ date: dag(400), resting_hr: 46 }]),
  null,
  "een jaar oude meting valt buiten het venster"
);
console.log("  ok  te weinig of te oude nachten leveren liever niets op dan een stevig lijkend getal");

// De zones schuiven mee, en dat is precies waarom het getal moet kloppen.
const zonesOud = calc.computeHrZones(185, 58);
const zonesGemeten = calc.computeHrZones(185, 46);
assert.ok(
  zonesGemeten[3].vanBpm < zonesOud[3].vanBpm,
  "een lagere rusthartslag verlaagt de ondergrens van zone 4"
);
console.log(`  ok  drempelzone begint bij ${zonesGemeten[3].vanBpm} in plaats van ${zonesOud[3].vanBpm} bpm`);

/* ------------------------ welke fiets, welke ondergrond ----------------- */

console.log("\neen MTB-rit wordt niet meer met een wegrit vergeleken");

assert.strictEqual(strava.mapSubType("MountainBikeRide"), "mtb");
assert.strictEqual(strava.mapSubType("GravelRide"), "gravel");
assert.strictEqual(strava.mapSubType("VirtualRide"), "indoor");
assert.strictEqual(strava.mapSubType("TrailRun"), "trail");
// De kale "Ride" is het type dat iedereen laat staan voor elke rit. Daar een
// racefiets uit concluderen zou een verzinsel in de geschiedenis zetten.
assert.strictEqual(strava.mapSubType("Ride"), null, "onbekend blijft onbekend");
assert.strictEqual(strava.mapSubType("Run"), null);
console.log("  ok  Strava's eigen labels worden overgenomen, de kale Ride niet geraden");

assert.strictEqual(calc.subTypeLabel("mtb"), "Mountainbike");
assert.deepStrictEqual(calc.subTypesFor("Fietsen").map((s) => s.id), ["weg", "gravel", "mtb", "indoor", "ebike"]);
assert.strictEqual(calc.subTypesFor("Zwemmen").length, 0, "zwemmen kent deze keuze niet");
assert.strictEqual(calc.isIndoorTrainer("indoor"), true);
assert.strictEqual(calc.isIndoorTrainer("mtb"), false);
console.log("  ok  per sport de juiste keuzes, met leesbare namen");

// Onbekend is alleen gelijk aan onbekend: een rit zonder label kan alles zijn
// geweest, dus hem gelijkstellen aan een wegrit brengt de verwarring terug.
assert.strictEqual(calc.sameSubType("mtb", "mtb"), true);
assert.strictEqual(calc.sameSubType("mtb", "weg"), false);
assert.strictEqual(calc.sameSubType(null, null), true);
assert.strictEqual(calc.sameSubType(null, "weg"), false);
console.log("  ok  onbekend telt niet als 'dezelfde fiets'");

// Een ondersoort die niet bestaat, of niet bij de sport past, komt er niet in.
const rit = { id: "r1", date: "2026-10-01", type: "Fietsen", duration_min: 90, distance_km: 40 };
validateCardioEntry({ ...rit, sub_type: "mtb" }); // mag niet gooien
assert.throws(() => validateCardioEntry({ ...rit, sub_type: "bakfiets" }), /Onbekende ondersoort/);
assert.throws(() => validateSubType("mtb", "Hardlopen"), /hoort bij Fietsen/);
console.log("  ok  een onzinnige of misplaatste ondersoort wordt geweigerd");

// En wat de coach voorstelt gaat door dezelfde poort.
const { createProposalsFromCoachEntry } = require("../routes/planned");
db.prepare(
  `INSERT INTO coach_history (id, date, question, analyse, tips_json, cardio_voorstel_json)
   VALUES ('coach-t1', ?, null, 'x', '[]', ?)`
).run(
  new Date().toISOString(),
  JSON.stringify([
    {
      dag: calc.weekdayNameForDate(dag(-2)),
      type: "Fietsen",
      ondergrond: "indoor",
      invulling: "2x20 min op drempel",
      blokken: [
        { soort: "warmup", minuten: 10, pctFtp: 55, pctFtpTot: 75 },
        { soort: "interval", herhalingen: 2, aanMinuten: 20, uitMinuten: 10, aanPctFtp: 95, uitPctFtp: 55, tekst: "Rustig blijven zitten" },
        { soort: "cooldown", minuten: 10, pctFtp: 55, pctFtpTot: 40 },
      ],
    },
    {
      dag: calc.weekdayNameForDate(dag(-3)),
      type: "Fietsen",
      ondergrond: "ligfiets",
      invulling: "duurrit",
      blokken: "geen lijst",
    },
  ])
);

const resultaat = createProposalsFromCoachEntry("coach-t1");
const metStructuur = resultaat.created.find((c) => c.subType === "indoor");
assert.ok(metStructuur, "de indoorsessie moet zijn ondersoort houden");
assert.strictEqual(metStructuur.structuur.length, 3);
const verzonnen = resultaat.created.find((c) => c.description === "duurrit");
assert.strictEqual(verzonnen.subType, null, "een ondersoort die niet bestaat wordt weggelaten");
assert.strictEqual(verzonnen.structuur, null, "blokken die geen lijst zijn leveren geen structuur op");
console.log("  ok  modeluitvoer die niet klopt wordt weggelaten, niet gerepareerd");

/* ------------------------- het trainingsbestand ------------------------- */

console.log("\neen geplande training wordt een bestand voor de trainer");

const blokken = wf.normalizeStructure([
  { soort: "warmup", minuten: 10, pctFtp: 55, pctFtpTot: 75 },
  { soort: "interval", herhalingen: 4, aanMinuten: 8, uitMinuten: 4, aanPctFtp: 105, uitPctFtp: 50 },
  { soort: "cooldown", minuten: 8, pctFtp: 55, pctFtpTot: 40 },
]);
assert.strictEqual(blokken.length, 3);
assert.strictEqual(wf.totalMinutes(blokken), 10 + 4 * 12 + 8);
console.log(`  ok  ${wf.totalMinutes(blokken)} minuten in 3 blokken`);

// Wat niet te raden is wordt weggelaten, niet aangevuld.
assert.strictEqual(wf.normalizeStructure([{ soort: "duur" }]), null, "een blok zonder duur is geen blok");
assert.strictEqual(wf.normalizeStructure([{ soort: "interval", herhalingen: 4, aanMinuten: 5 }]), null);
assert.strictEqual(wf.normalizeStructure([{ soort: "sprintjes", minuten: 10, pctFtp: 90 }]), null);
assert.strictEqual(wf.normalizeStructure([]), null);
assert.strictEqual(wf.normalizeStructure("2x20 op drempel"), null, "vrije tekst wordt niet geparseerd");
console.log("  ok  een onvolledig of onbekend blok wordt niet ingevuld maar overgeslagen");

// Onmogelijke waarden worden naar het bereik getrokken in plaats van geweigerd:
// 400% FTP is een tikfout, geen reden om de hele training te laten vallen.
const geklemd = wf.normalizeStructure([{ soort: "duur", minuten: 30, pctFtp: 900 }]);
assert.strictEqual(geklemd[0].pctFtp, 200);
console.log("  ok  een onmogelijke intensiteit wordt begrensd op 200% FTP");

const zwo = wf.renderWorkoutFile(blokken, { format: "zwo", naam: "4 oktober Drempel", beschrijving: "4x8 op drempel" });
assert.strictEqual(zwo.bestandsnaam, "4-oktober-drempel.zwo");
assert.ok(zwo.inhoud.includes('<Warmup Duration="600" PowerLow="0.55" PowerHigh="0.75"'));
assert.ok(zwo.inhoud.includes('<IntervalsT Repeat="4" OnDuration="480" OffDuration="240" OnPower="1.05" OffPower="0.50"'));
assert.ok(zwo.inhoud.includes("<sportType>bike</sportType>"));
console.log("  ok  .zwo houdt een interval één blok, zoals de coach het bedoelde");

// Een tekstcue moet ontsnapt worden; een aanhalingsteken in XML breekt anders
// het hele bestand, en dat merk je pas bij het importeren.
const metCue = wf.renderWorkoutFile(
  wf.normalizeStructure([{ soort: "duur", minuten: 20, pctFtp: 90, tekst: 'Blijf "rustig" & zitten' }]),
  { format: "zwo", naam: "Cue" }
);
assert.ok(metCue.inhoud.includes("Blijf &quot;rustig&quot; &amp; zitten"));
console.log("  ok  tekst met aanhalingstekens breekt het XML niet");

// .mrc is in procenten, .erg in watt — en zonder FTP is er geen watt.
const mrc = wf.renderWorkoutFile(blokken, { format: "mrc", naam: "Drempel" });
assert.ok(mrc.inhoud.includes("MINUTES PERCENT"));
assert.ok(mrc.inhoud.includes("0.00\t55"), "de eerste regel staat op 55%");
assert.ok(mrc.inhoud.includes("10.00\t75"), "de warm-up loopt op naar 75%");

const erg = wf.renderWorkoutFile(blokken, { format: "erg", naam: "Drempel", ftp: 250 });
assert.ok(erg.inhoud.includes("MINUTES WATTS"));
assert.ok(erg.inhoud.includes("0.00\t138"), "55% van 250 W is 138 W");
assert.throws(() => wf.renderWorkoutFile(blokken, { format: "erg", naam: "x" }), /FTP/);
console.log("  ok  .mrc in procenten, .erg in watt, en zonder FTP een duidelijke melding");

// Elke herhaling wordt uitgeschreven, want deze formaten kennen geen intervallen.
const segmenten = wf.flattenToSegments(blokken);
assert.strictEqual(segmenten.length, 1 + 4 * 2 + 1, "4 herhalingen worden 8 segmenten");
console.log("  ok  intervallen worden voor .erg/.mrc per herhaling uitgeschreven");

assert.throws(() => wf.renderWorkoutFile(blokken, { format: "fit", naam: "x" }), /Onbekend formaat/);
assert.throws(() => wf.renderWorkoutFile(null, { format: "zwo", naam: "x" }), /blokkenstructuur/);
console.log("  ok  zonder structuur of met een onbekend formaat volgt een melding, geen bestand");

console.log("\nAlle tests voor rusthartslag, ondergrond en trainingsbestanden geslaagd.");
