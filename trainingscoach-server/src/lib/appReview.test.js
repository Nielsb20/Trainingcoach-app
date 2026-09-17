"use strict";
/**
 * Drie dingen die uit de doorlichting van de app kwamen.
 *
 * 1. Een verwijderde training liet de geplande sessie op "gedaan" staan, met
 *    een rit die niet meer bestond: een vinkje zonder dekking dat wel meetelde
 *    in het opvolgingspercentage.
 * 2. De schrijfroutes namen alles aan wat binnenkwam. Modeluitvoer werd al als
 *    onbetrouwbaar behandeld, invoer van de client niet.
 * 3. Hardlopen viel terug op de hartslagschatting, terwijl tempo voor een
 *    hardloper is wat vermogen voor een wielrenner is.
 */
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/app-review-test";
require("node:fs").rmSync("/tmp/app-review-test", { recursive: true, force: true });

const { db, initSchema, repairOrphanedCompletions } = require("../db/db");
initSchema();
const calc = require("../lib/calculations");
const { refreshCompletions } = require("../routes/planned");
const {
  validateCardioEntry,
  validateCardioBulk,
  validateWeightEntry,
  validateWorkoutEntry,
} = require("./validate");

const gisteren = (() => {
  const d = new Date(calc.todayStr() + "T00:00:00");
  d.setDate(d.getDate() - 1);
  return calc.toDateStr(d);
})();

/* ------------------- een verwijderde rit laat geen vinkje na ------------- */

console.log("een verwijderde training laat geen vinkje zonder dekking achter");

db.prepare("INSERT INTO cardio_logs (id,date,type,duration_min,distance_km,source) VALUES (?,?,?,?,?,'test')")
  .run("rit-1", gisteren, "Fietsen", 60, 30);
db.prepare(
  `INSERT INTO planned_sessions (id,date,weekday,type,description,status,discipline)
   VALUES ('plan-1',?,?,'Fietsen','x','gepland','cardio')`
).run(gisteren, calc.weekdayNameForDate(gisteren));

refreshCompletions();
const afgevinkt = db.prepare("SELECT * FROM planned_sessions WHERE id='plan-1'").get();
assert.strictEqual(afgevinkt.status, "gedaan");
assert.strictEqual(afgevinkt.completed_cardio_log_id, "rit-1");
console.log("  ok  de rit vinkt de geplande sessie af");

// Wat de verwijderroute doet: eerst loskoppelen, dan pas weg.
db.prepare("UPDATE planned_sessions SET completed_cardio_log_id = NULL, status = 'gepland' WHERE completed_cardio_log_id = ?")
  .run("rit-1");
db.prepare("DELETE FROM cardio_logs WHERE id = ?").run("rit-1");
refreshCompletions();

const naVerwijderen = db.prepare("SELECT * FROM planned_sessions WHERE id='plan-1'").get();
assert.strictEqual(naVerwijderen.status, "overgeslagen", "zonder rit is de sessie niet gedaan");
assert.strictEqual(naVerwijderen.completed_cardio_log_id, null);
console.log("  ok  na het verwijderen staat de sessie niet meer ten onrechte op gedaan");

// En wat er vóór deze fix is ontstaan wordt bij het opstarten opgeruimd.
db.prepare("UPDATE planned_sessions SET status='gedaan', completed_cardio_log_id='weg-1' WHERE id='plan-1'").run();
repairOrphanedCompletions();
const opgeruimd = db.prepare("SELECT * FROM planned_sessions WHERE id='plan-1'").get();
assert.strictEqual(opgeruimd.completed_cardio_log_id, null, "koppeling naar een verdwenen rij wordt losgelaten");
assert.strictEqual(opgeruimd.status, "gepland");
console.log("  ok  oude gevallen worden bij het opstarten rechtgezet");

/* ----------------------------- invoervalidatie --------------------------- */

console.log("\nwat binnenkomt wordt gecontroleerd");

const geldig = { id: "c1", date: "2026-08-01", type: "Fietsen", duration_min: 60, distance_km: 30 };
validateCardioEntry(geldig); // mag niet gooien

assert.throws(() => validateCardioEntry({ ...geldig, date: "01-08-2026" }), /geldige datum/);
assert.throws(() => validateCardioEntry({ ...geldig, id: undefined }), /mist een id/);
assert.throws(() => validateCardioEntry({ ...geldig, duration_min: null, distance_km: null }), /geen duur en geen afstand/);
console.log("  ok  een rij zonder datum, id of inhoud wordt geweigerd");

// De klassieke importfout: meters waar kilometers worden verwacht.
assert.throws(() => validateCardioEntry({ ...geldig, distance_km: 30000 }), /buiten het aannemelijke bereik/);
assert.throws(() => validateCardioEntry({ ...geldig, avg_hr: 950 }), /buiten het aannemelijke bereik/);
console.log("  ok  een verwisselde eenheid wordt herkend en benoemd");

assert.throws(() => validateCardioBulk([]), /Geen sessies/);
assert.throws(() => validateCardioBulk(new Array(6000).fill(geldig)), /te veel/);
assert.throws(() => validateCardioBulk([geldig, { ...geldig, id: "c2", date: "fout" }]), /rij 2/);
console.log("  ok  een bulkimport wordt begrensd en wijst de foute rij aan");

assert.throws(() => validateWeightEntry({ id: "w", date: "2026-08-01", weight_kg: 7400 }), /klopt niet/);
assert.throws(() => validateWorkoutEntry({ id: "wl", date: "2026-08-01", exercises: [{ name: "Squat", sets: [{ weight: 5000, reps: 5 }] }] }), /klopt niet/);
console.log("  ok  ook gewicht en krachtsets worden op onmogelijke waarden gecontroleerd");

/* ------------------------------ hardlopen -------------------------------- */

console.log("\nhardlopen krijgt een eigen maatstaf");

const zones = calc.computePaceZones(300); // drempeltempo 5:00 per km
assert.strictEqual(zones.length, 6);
assert.strictEqual(zones[3].naam, "Drempel");
assert.ok(zones[3].totSec < zones[3].vanSec, "sneller is een lager getal: de grenzen staan omgekeerd");
assert.strictEqual(calc.zoneForPace(300, zones), 4, "precies op drempeltempo is zone 4");
assert.strictEqual(calc.zoneForPace(400, zones), 1, "ruim langzamer is een hersteltempo");
console.log("  ok  tempozones rond het drempeltempo, met de juiste richting");

const uurOpDrempel = calc.computeSessionTSS(
  { type: "Hardlopen", duration_min: 60, distance_km: 12 }, null, null, 300
);
assert.strictEqual(uurOpDrempel.method, "tempo");
assert.strictEqual(uurOpDrempel.tss, 100, "een uur op drempeltempo is per definitie 100 TSS");
console.log("  ok  een uur op drempeltempo levert 100 TSS, net als bij vermogen");

const hrZones = calc.computeHrZones(185, 50);
const zonderDrempel = calc.computeSessionTSS(
  { type: "Hardlopen", duration_min: 60, distance_km: 12, avg_hr: 150 }, null, hrZones, null
);
assert.strictEqual(zonderDrempel.method, "hartslag (schatting)", "zonder drempeltempo verandert er niets");

const fietsen = calc.computeSessionTSS(
  { type: "Fietsen", duration_min: 60, avg_power: 250 }, 250, hrZones, 300
);
assert.strictEqual(fietsen.method, "vermogen", "gemeten vermogen gaat altijd voor");
console.log("  ok  vermogen blijft eerste keus, hartslag de terugval");

assert.strictEqual(calc.isRunning("Hardlopen"), true);
assert.strictEqual(calc.isRunning("Trailrun"), true);
assert.strictEqual(calc.isRunning("Fietsen"), false);
assert.strictEqual(calc.formatPace(275), "4:35");
console.log("  ok  hardloopsessies worden herkend en tempo leest als 4:35");

console.log("\nAlle tests uit de doorlichting geslaagd.");
