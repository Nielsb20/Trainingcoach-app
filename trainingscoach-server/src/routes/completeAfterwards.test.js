"use strict";
/**
 * Een training van gisteren alsnog afvinken.
 *
 * Dat kon niet. De planner bood bij een overgeslagen sessie alleen "ongedaan
 * maken", en die zet hem terug op gepland — waarna de automaat hem meteen weer
 * op overgeslagen zette, want de dag was voorbij en er stond niets gelogd. Je
 * kwam er dus niet uit.
 *
 * En wie maandag reed maar pas woensdag synchroniseerde, had hetzelfde
 * probleem andersom: het bewijs kwam alsnog binnen, maar de sessie stond al
 * als gemist weggezet en geen enkele import kreeg dat nog rechtgezet.
 */
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/complete-afterwards-test";
require("node:fs").rmSync("/tmp/complete-afterwards-test", { recursive: true, force: true });

const { db, initSchema } = require("../db/db");
initSchema();
const calc = require("../lib/calculations");
const { refreshCompletions } = require("./planned");

const daysAgo = (n) => {
  const d = new Date(calc.todayStr() + "T00:00:00");
  d.setDate(d.getDate() - n);
  return calc.toDateStr(d);
};

function addPlan(id, date, status = "gepland", type = "Fietsen") {
  db.prepare(
    `INSERT INTO planned_sessions (id, date, weekday, type, description, status, discipline)
     VALUES (?, ?, ?, ?, 'x', ?, 'cardio')`
  ).run(id, date, calc.weekdayNameForDate(date), type, status);
}
const rowOf = (id) => db.prepare("SELECT * FROM planned_sessions WHERE id = ?").get(id);

// Wat de route doet bij een handmatige statuswijziging.
function setStatusManually(id, status) {
  db.prepare("UPDATE planned_sessions SET status = ?, auto_skipped = 0 WHERE id = ?").run(status, id);
}

/* ---------------------- handmatig alsnog op gedaan ----------------------- */

console.log("een training van eergisteren alsnog afvinken");

addPlan("p1", daysAgo(2));
refreshCompletions();
assert.strictEqual(rowOf("p1").status, "overgeslagen", "niets gelogd en de dag is voorbij");
assert.strictEqual(rowOf("p1").auto_skipped, 1, "en dat deed de automaat, niet de sporter");

setStatusManually("p1", "gedaan");
refreshCompletions();
assert.strictEqual(rowOf("p1").status, "gedaan", "jouw keuze blijft staan, ook na een nieuwe controleronde");
assert.strictEqual(rowOf("p1").auto_skipped, 0);
console.log("  ok  handmatig op gedaan zetten houdt stand");

/* ------------------- de oude valkuil: ongedaan maken ---------------------- */

console.log("\nwaarom 'ongedaan maken' alleen niet genoeg was");

addPlan("p2", daysAgo(3));
refreshCompletions();
db.prepare("UPDATE planned_sessions SET status = 'gepland', completed_cardio_log_id = NULL, auto_skipped = 0 WHERE id = ?").run("p2");
refreshCompletions();
assert.strictEqual(rowOf("p2").status, "overgeslagen", "terugzetten naar gepland levert meteen weer een overslaan op");
console.log("  ok  bevestigd: via 'ongedaan maken' kwam je er nooit, vandaar de knop 'toch gedaan'");

/* --------------------- later gesynchroniseerd bewijs ---------------------- */

console.log("\nmaandag gereden, woensdag pas gesynchroniseerd");

addPlan("p3", daysAgo(2), "gepland", "Fietsen");
refreshCompletions();
assert.strictEqual(rowOf("p3").status, "overgeslagen", "eerst als gemist weggezet");

db.prepare("INSERT INTO cardio_logs (id,date,type,duration_min,distance_km,source) VALUES (?,?,?,?,?,'strava')")
  .run("laat-1", daysAgo(2), "Fietsen", 90, 45);
refreshCompletions();
assert.strictEqual(rowOf("p3").status, "gedaan", "het bewijs is er alsnog, dus de sessie telt");
assert.strictEqual(rowOf("p3").completedCardioLogId ?? rowOf("p3").completed_cardio_log_id, "laat-1");
console.log("  ok  een latere import zet een automatisch overslaan alsnog recht");

/* ------------------ een eigen beslissing blijft staan -------------------- */

console.log("\nmaar jouw eigen keuze wint van de automaat");

addPlan("p4", daysAgo(1), "gepland");
setStatusManually("p4", "overgeslagen"); // "deze sla ik bewust over"
db.prepare("INSERT INTO cardio_logs (id,date,type,duration_min,distance_km,source) VALUES (?,?,?,?,?,'strava')")
  .run("laat-2", daysAgo(1), "Fietsen", 60, 30);
refreshCompletions();
assert.strictEqual(rowOf("p4").status, "overgeslagen", "zelf overslaan is een beslissing, geen gebrek aan gegevens");
console.log("  ok  een handmatig overslaan wordt niet door een gelogde rit overruled");

/* ------------------- open sessies hebben nog voorrang -------------------- */

console.log("\neen nog openstaande sessie claimt de rit eerst");

addPlan("p5", daysAgo(4), "gepland");
refreshCompletions();
assert.strictEqual(rowOf("p5").status, "overgeslagen");
addPlan("p6", calc.todayStr(), "gepland"); // vandaag, nog open
db.prepare("INSERT INTO cardio_logs (id,date,type,duration_min,distance_km,source) VALUES (?,?,?,?,?,'strava')")
  .run("vandaag-1", calc.todayStr(), "Fietsen", 60, 30);
refreshCompletions();
assert.strictEqual(rowOf("p6").status, "gedaan", "de rit van vandaag hoort bij de sessie van vandaag");
assert.strictEqual(rowOf("p5").status, "overgeslagen", "en niet bij die van vier dagen terug");
console.log("  ok  een openstaande sessie gaat voor op een al weggezette");

console.log("\nAlle tests voor alsnog voltooien geslaagd.");
