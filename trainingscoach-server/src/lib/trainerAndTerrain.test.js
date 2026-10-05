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
const { validateCardioEntry, validateSubType, validateSurface } = require("./validate");

/* ------------------ rusthartslag uit de gemeten nachten ----------------- */

console.log("de rusthartslag komt uit de metingen, niet uit het geheugen");

const dag = (terug) => {
  const d = new Date(calc.todayStr() + "T00:00:00");
  d.setDate(d.getDate() - terug);
  return calc.toDateStr(d);
};

// Veertien nachten rond 52, met één uitschieter van 67 (biertje, griep, weet
// je het nog). Een gemiddelde zou daardoor omhoog kruipen.
const nachtwaarden = [52, 51, 53, 52, 50, 67, 52, 53, 51, 52, 54, 51, 52, 53];
const nachten = nachtwaarden.map((bpm, i) => ({
  date: dag(i + 1),
  sleeping_hr: bpm,
  // De dagwaarde van het horloge ligt lager: dat is een minimum over het hele
  // etmaal, de nachtwaarde is een gemiddelde over het slaapvenster.
  resting_hr: bpm - 6,
}));

const basislijn = calc.computeRestingHrBaseline(nachten);
assert.strictEqual(basislijn.bpm, 52, "de mediaan laat zich niet meetrekken door één slechte nacht");
assert.strictEqual(basislijn.bron, "slaap", "de nachtwaarde gaat voor op de dagwaarde");
assert.strictEqual(basislijn.nachten, 14);
assert.strictEqual(basislijn.hoogste, 67, "de uitschieter wordt wel gemeld, alleen niet meegerekend");
console.log(`  ok  mediaan ${basislijn.bpm} bpm over ${basislijn.nachten} nachten (laagste ${basislijn.laagste}, hoogste ${basislijn.hoogste})`);

// Zonder nachtmetingen is de dagwaarde de terugval — maar dan staat erbij dat
// het de dagwaarde is, want die kan gedurende de dag nog zakken.
const alleenDag = nachten.map(({ date, resting_hr }) => ({ date, resting_hr }));
const terugval = calc.computeRestingHrBaseline(alleenDag);
assert.strictEqual(terugval.bron, "dagwaarde");
assert.strictEqual(terugval.bpm, 46);
assert.strictEqual(terugval.nachtmetingen, 0);
console.log(`  ok  zonder nachtmetingen valt hij terug op de dagwaarde (${terugval.bpm} bpm), met vermelding`);

// En de twee worden nooit door elkaar gemiddeld: een gemiddelde over de nacht
// en een minimum over het etmaal zijn verschillende grootheden.
const gemengd = nachten.map((n, i) => (i < 4 ? { date: n.date, resting_hr: n.resting_hr } : n));
const gemengdeBasislijn = calc.computeRestingHrBaseline(gemengd);
assert.strictEqual(gemengdeBasislijn.bron, "slaap");
assert.strictEqual(gemengdeBasislijn.nachten, 10, "alleen de nachten met een nachtmeting tellen mee");
assert.ok(gemengdeBasislijn.bpm >= 51, "de lagere dagwaarden mogen de nachtbasislijn niet omlaag trekken");
console.log("  ok  nacht- en dagwaarden worden nooit samen gemiddeld");

// Vandaag telt niet mee: zolang de dag loopt kan de dagwaarde nog zakken, en
// een basislijn die 's avonds anders is dan 's ochtends is geen basislijn.
const metVandaag = [{ date: calc.todayStr(), sleeping_hr: 90 }, ...nachten];
assert.strictEqual(
  calc.computeRestingHrBaseline(metVandaag).nachten,
  14,
  "de lopende dag hoort niet in de basislijn"
);
console.log("  ok  de lopende dag blijft buiten de basislijn");

// Te weinig nachten is geen basislijn maar een losse meting.
assert.strictEqual(
  calc.computeRestingHrBaseline(nachten.slice(0, 3)),
  null,
  "drie nachten leveren geen basislijn op"
);
// En nachten van lang geleden tellen niet mee.
assert.strictEqual(
  calc.computeRestingHrBaseline([{ date: dag(400), sleeping_hr: 46 }]),
  null,
  "een jaar oude meting valt buiten het venster"
);
console.log("  ok  te weinig of te oude nachten leveren liever niets op dan een stevig lijkend getal");

// De zones schuiven mee, en dat is precies waarom het getal moet kloppen.
const zonesOud = calc.computeHrZones(185, 58);
const zonesGemeten = calc.computeHrZones(185, 46);
// En het maakt uit wélke maat je neemt: nachtwaarde en dagwaarde liggen een
// paar slagen uit elkaar, dus door elkaar halen verschuift de zones ook.
assert.notStrictEqual(
  calc.computeHrZones(185, 52)[3].vanBpm,
  calc.computeHrZones(185, 46)[3].vanBpm,
  "nacht- en dagwaarde leveren verschillende zones op"
);
assert.ok(
  zonesGemeten[3].vanBpm < zonesOud[3].vanBpm,
  "een lagere rusthartslag verlaagt de ondergrens van zone 4"
);
console.log(`  ok  drempelzone begint bij ${zonesGemeten[3].vanBpm} in plaats van ${zonesOud[3].vanBpm} bpm`);

/* ------------------------ welke fiets, welke ondergrond ----------------- */

console.log("\nfiets en ondergrond zijn twee losse dingen");

// Wat het sporttype betekent hangt af van hoe de sporter zijn profielen
// gebruikt, en dat kan de app niet raden. Dus twee standen.
//
// Stand 'fiets': het profiel zegt waar je op zat.
assert.strictEqual(strava.mapSubType("MountainBikeRide", "fiets"), "mtb");
assert.strictEqual(strava.mapSubType("GravelRide", "fiets"), "gravel");
assert.strictEqual(strava.mapSubType("VirtualRide", "fiets"), "indoor");
assert.strictEqual(strava.mapSubType("Ride", "fiets"), null, "een kale Ride zegt niet welke fiets");
// Hier zat de fout: in deze stand zegt "MountainBikeRide" wélke fiets, niet
// wáár. Wie zijn MTB 's winters op de weg gebruikt logt dat net zo goed als
// MountainBikeRide.
assert.strictEqual(strava.mapSurface("MountainBikeRide", "fiets"), null, "een MTB-rit hoeft niet door het bos te gaan");
assert.strictEqual(strava.mapSurface("GravelRide", "fiets"), null);
assert.strictEqual(strava.mapSurface("Ride", "fiets"), null);
assert.strictEqual(strava.mapSurface("VirtualRide", "fiets"), "binnen", "virtueel is wél met zekerheid binnen");
console.log("  ok  stand 'fiets': het profiel levert de fiets, en alleen virtueel ook de ondergrond");

// Stand 'ondergrond': het profiel zegt waar je reed, en de fiets komt uit de
// koppeling met je Strava-materiaal.
assert.strictEqual(strava.mapSurface("MountainBikeRide", "ondergrond"), "onverhard");
assert.strictEqual(strava.mapSurface("GravelRide", "ondergrond"), "gemengd");
assert.strictEqual(strava.mapSurface("Ride", "ondergrond"), "asfalt", "wegfietsen betekent dan asfalt");
assert.strictEqual(strava.mapSurface("VirtualRide", "ondergrond"), "binnen");
assert.strictEqual(strava.mapSurface("TrailRun", "ondergrond"), "onverhard");
assert.strictEqual(
  strava.mapSubType("MountainBikeRide", "ondergrond"), null,
  "in deze stand zegt het profiel niets over de fiets"
);
console.log("  ok  stand 'ondergrond': het profiel levert het parcours, niet de fiets");

// En dat is precies het geval waar het om begonnen is: dezelfde mountainbike,
// 's zomers het bos in en 's winters over de weg.
db.prepare("INSERT INTO strava_gear (id,name,sub_type) VALUES ('mtb-gear','Santa Cruz','mtb')").run();
db.prepare("UPDATE profile SET strava_sport_type_means='ondergrond' WHERE id=1").run();
const maakRit = (sport) => strava.stravaToSession(
  { id: Math.random(), sport_type: sport, moving_time: 3600, distance: 30000,
    start_date_local: "2026-01-10T09:00:00Z",
    gear_id: "mtb-gear", gear: { id: "mtb-gear", name: "Santa Cruz" } },
  null
);
const winterWegrit = maakRit("Ride");
const zomerBosrit = maakRit("MountainBikeRide");
assert.strictEqual(winterWegrit.sub_type, "mtb", "allebei op dezelfde fiets");
assert.strictEqual(zomerBosrit.sub_type, "mtb");
assert.strictEqual(winterWegrit.surface, "asfalt", "maar niet over dezelfde ondergrond");
assert.strictEqual(zomerBosrit.surface, "onverhard");
db.prepare("UPDATE profile SET strava_sport_type_means='fiets' WHERE id=1").run();
console.log("  ok  dezelfde MTB op de weg en in het bos komt binnen als twee verschillende dingen");

// Een kale "Ride" zegt niets, dus dan vult de gekoppelde fiets de leegte.
db.prepare("INSERT INTO strava_gear (id, name, sub_type) VALUES ('b999', 'Canyon Grail', 'gravel')").run();
const metFiets = strava.stravaToSession(
  { id: 1, sport_type: "Ride", moving_time: 3600, distance: 40000,
    start_date_local: "2026-10-01T09:00:00Z", gear_id: "b999", gear: { id: "b999", name: "Canyon Grail" } },
  null
);
assert.strictEqual(metFiets.sub_type, "gravel", "bij een kale Ride vult de koppeling aan");
assert.strictEqual(metFiets.surface, null, "en zegt niets over waar je reed");
assert.strictEqual(metFiets.gear_name, "Canyon Grail");

// Maar een expliciet sporttype gaat vóór de koppeling, en dat is de
// belangrijke kant. Wie met een Garmin rijdt kiest het profiel vóór vertrek
// en dat reist mee naar Strava; de fiets in Strava staat veel vaker nog op de
// standaardfiets, omdat Garmin zijn eigen materiaal niet meestuurt. Zou de
// koppeling winnen, dan kreeg elke mountainbikerit het label van de racefiets.
db.prepare("INSERT INTO strava_gear (id, name, sub_type) VALUES ('b555', 'Standaardfiets', 'racefiets')").run();
const garminMtb = strava.stravaToSession(
  { id: 4, sport_type: "MountainBikeRide", moving_time: 3600, distance: 30000,
    start_date_local: "2026-10-01T09:00:00Z", gear_id: "b555", gear: { id: "b555", name: "Standaardfiets" } },
  null
);
assert.strictEqual(
  garminMtb.sub_type, "mtb",
  "een standaardfiets in Strava mag een expliciet sporttype niet overschrijven"
);

const ongekoppeld = strava.stravaToSession(
  { id: 2, sport_type: "MountainBikeRide", moving_time: 3600, distance: 30000,
    start_date_local: "2026-10-01T09:00:00Z", gear_id: "b777", gear: { id: "b777", nickname: "Hightower" } },
  null
);
assert.strictEqual(ongekoppeld.sub_type, "mtb", "zonder koppeling telt het sporttype");
assert.strictEqual(
  db.prepare("SELECT name FROM strava_gear WHERE id='b777'").get().name,
  "Hightower",
  "een onbekende fiets wordt onthouden om later te koppelen"
);
console.log("  ok  een expliciet sporttype wint; de koppeling vult alleen een kale Ride aan");

// De twee assen apart: materiaal bij fietsen, ondergrond bij allebei.
assert.deepStrictEqual(calc.subTypesFor("Fietsen").map((s) => s.id), ["racefiets", "gravel", "mtb", "ebike", "indoor"]);
assert.strictEqual(calc.subTypesFor("Hardlopen").length, 0, "welke schoen je aanhad verandert je tempo niet");
assert.deepStrictEqual(calc.surfacesFor("Fietsen").map((s) => s.id), ["asfalt", "onverhard", "gemengd", "binnen"]);
assert.ok(calc.surfacesFor("Hardlopen").some((s) => s.id === "baan"), "een baan bestaat alleen bij hardlopen");
assert.strictEqual(calc.subTypeLabel("mtb"), "Mountainbike");
assert.strictEqual(calc.surfaceLabel("onverhard"), "Onverhard");
assert.strictEqual(calc.isIndoorTrainer("mtb", "binnen"), true, "een MTB op de rollen is ook binnen");
assert.strictEqual(calc.isIndoorTrainer("mtb", "onverhard"), false);
console.log("  ok  per sport de juiste assen, met leesbare namen");

// Waar het allemaal om begonnen is: dezelfde mountainbike, twee ondergronden.
const winterWeg = { subType: "mtb", surface: "asfalt" };
const zomerBos = { subType: "mtb", surface: "onverhard" };
const racefiets = { subType: "racefiets", surface: "asfalt" };
assert.strictEqual(calc.comparabilityRank(winterWeg, winterWeg), 0, "gelijk op beide assen is perfect");
assert.strictEqual(calc.comparabilityRank(winterWeg, zomerBos), 1, "zelfde fiets, ander terrein");
assert.strictEqual(calc.comparabilityRank(winterWeg, racefiets), 2, "andere fiets weegt zwaarder");
assert.ok(
  calc.comparabilityRank(winterWeg, zomerBos) < calc.comparabilityRank(winterWeg, racefiets),
  "een bosrit op je eigen MTB is beter vergelijkbaar dan een racefietsrit op asfalt"
);
console.log("  ok  dezelfde MTB op de weg en in het bos blijft beter vergelijkbaar dan een andere fiets");

// Onbekend hoort alleen bij onbekend, op allebei de assen.
assert.strictEqual(calc.sameSubType("mtb", "mtb"), true);
assert.strictEqual(calc.sameSubType(null, "racefiets"), false);
assert.strictEqual(calc.sameSurface(null, null), true);
assert.strictEqual(calc.sameSurface(null, "asfalt"), false);
console.log("  ok  onbekend telt niet als 'hetzelfde'");

// Een waarde die niet bestaat of niet bij de sport past komt er niet in.
const rit = { id: "r1", date: "2026-10-01", type: "Fietsen", duration_min: 90, distance_km: 40 };
validateCardioEntry({ ...rit, sub_type: "mtb", surface: "asfalt" }); // mag niet gooien
assert.throws(() => validateCardioEntry({ ...rit, sub_type: "bakfiets" }), /Onbekend materiaal/);
assert.throws(() => validateCardioEntry({ ...rit, surface: "maanstof" }), /Onbekende ondergrond/);
assert.throws(() => validateSubType("mtb", "Hardlopen"), /hoort niet bij Hardlopen/);
assert.throws(() => validateSurface("baan", "Fietsen"), /hoort niet bij Fietsen/);
console.log("  ok  een onzinnige of misplaatste waarde wordt geweigerd");

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
      fiets: "indoor",
      ondergrond: "binnen",
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
      fiets: "ligfiets",
      ondergrond: "maanstof",
      invulling: "duurrit",
      blokken: "geen lijst",
    },
  ])
);

const resultaat = createProposalsFromCoachEntry("coach-t1");
const metStructuur = resultaat.created.find((c) => c.subType === "indoor");
assert.ok(metStructuur, "de indoorsessie moet zijn fiets houden");
assert.strictEqual(metStructuur.surface, "binnen");
assert.strictEqual(metStructuur.structuur.length, 3);
const verzonnen = resultaat.created.find((c) => c.description === "duurrit");
assert.strictEqual(verzonnen.subType, null, "een fiets die niet bestaat wordt weggelaten");
assert.strictEqual(verzonnen.surface, null, "en een ondergrond die niet bestaat ook");
assert.strictEqual(verzonnen.structuur, null, "blokken die geen lijst zijn leveren geen structuur op");
console.log("  ok  modeluitvoer die niet klopt wordt weggelaten, niet gerepareerd");

/* ---------------------- koppelen van Strava-materiaal ------------------- */

console.log("\nje fiets koppelen werkt met terugwerkende kracht");

const { koppelMateriaal } = require("../routes/strava");

// Zoals het er in de praktijk uitziet: een racefiets met jaren ritten, een
// mountainbike met één, en een paar hardloopschoenen in dezelfde Strava-lijst.
for (let i = 0; i < 3; i += 1) {
  db.prepare(
    "INSERT INTO cardio_logs (id,date,type,duration_min,distance_km,source,gear_id,gear_name) VALUES (?,?,'Fietsen',90,40,'strava_sync','cube','Cube Agree')"
  ).run(`cube-${i}`, `2026-09-0${i + 1}`);
}
db.prepare(
  "INSERT INTO cardio_logs (id,date,type,duration_min,distance_km,source,gear_id,gear_name) VALUES ('bulls','2026-10-04','Fietsen',95,37,'strava_sync','bulls','Bulls Sharptail')"
).run();
db.prepare(
  "INSERT INTO cardio_logs (id,date,type,duration_min,distance_km,source,gear_id,gear_name) VALUES ('asics','2026-06-01','Hardlopen',40,8,'strava_sync','asics','ASICS GP 2000')"
).run();

assert.strictEqual(koppelMateriaal("cube", "racefiets"), 3, "alle ritten op die fiets in één keer");
assert.strictEqual(koppelMateriaal("bulls", "mtb"), 1);
// Schoenen raken geen enkele fietssessie, ook niet als je er per ongeluk een
// fietstype aan hangt.
assert.strictEqual(koppelMateriaal("asics", "racefiets"), 0, "schoenen laten hardloopsessies met rust");

const gelabeld = db.prepare("SELECT id, sub_type FROM cardio_logs WHERE gear_id IN ('cube','bulls','asics')").all();
assert.strictEqual(gelabeld.filter((r) => r.sub_type === "racefiets").length, 3);
assert.strictEqual(gelabeld.find((r) => r.id === "bulls").sub_type, "mtb");
assert.strictEqual(gelabeld.find((r) => r.id === "asics").sub_type, null);
console.log("  ok  3 ritten op de racefiets, 1 op de mtb, de hardloopschoenen onaangeroerd");

// Loskoppelen moet ook kunnen: dan gaan de labels er weer af.
assert.strictEqual(koppelMateriaal("cube", null), 3);
assert.strictEqual(
  db.prepare("SELECT COUNT(*) AS n FROM cardio_logs WHERE gear_id='cube' AND sub_type IS NOT NULL").get().n,
  0,
  "een koppeling weghalen maakt de labels ook weer leeg"
);
// En zonder toepassen blijft de geschiedenis staan zoals hij was.
assert.strictEqual(koppelMateriaal("cube", "gravel", { toepassen: false }), 0);
assert.strictEqual(
  db.prepare("SELECT COUNT(*) AS n FROM cardio_logs WHERE gear_id='cube' AND sub_type IS NOT NULL").get().n,
  0,
  "zonder toepassen verandert er niets aan wat er al ligt"
);
console.log("  ok  loskoppelen wist de labels, en zonder toepassen blijft de historie ongemoeid");

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
