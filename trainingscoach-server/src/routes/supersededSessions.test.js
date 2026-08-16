"use strict";
/**
 * Wat een nieuw coachadvies achterlaat.
 *
 * Een advies raakt alleen de dagen die het zelf noemt — bewust, want een plan
 * dat bij elke vraag herschreven wordt is geen plan. Het gevolg was wel dat een
 * training uit een ouder advies bleef staan op een dag die het nieuwe advies
 * leeg liet. Je volgt dan keurig het nieuwe plan en er staat nog een rit op
 * maandag die nergens meer bij hoort.
 *
 * Zulke restanten worden gemarkeerd, niet verwijderd: ze blijven staan waar ze
 * stonden, maar zijn herkenbaar en met één klik weg te halen.
 */
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/superseded-test";
require("node:fs").rmSync("/tmp/superseded-test", { recursive: true, force: true });

const { db, initSchema } = require("../db/db");
initSchema();
const calc = require("../lib/calculations");

const dayAfter = (n) => {
  const d = new Date(calc.todayStr() + "T00:00:00");
  d.setDate(d.getDate() + n);
  return calc.toDateStr(d);
};

function addSession({ id, date, status = "gepland", coachEntry = null, locked = 0, discipline = "cardio", type = "Fietsen", description = "x" }) {
  db.prepare(
    `INSERT INTO planned_sessions (id, date, weekday, type, description, source_coach_entry_id, status, locked, discipline)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, date, calc.weekdayNameForDate(date), type, description, coachEntry, status, locked, discipline);
}

// Wat de accept-all route doet, zonder een draaiende server.
const { markSupersededSessions } = require("./planned");

/* ----------------------- het restant wordt gevonden ---------------------- */

console.log("een training uit een ouder advies blijft staan en valt op");

// Vorig advies vulde maandag en woensdag.
addSession({ id: "oud-ma", date: dayAfter(1), coachEntry: "coach-oud", description: "Losrijden (Limburg)" });
addSession({ id: "oud-wo", date: dayAfter(3), coachEntry: "coach-oud", description: "Intervallen" });
// Nieuw advies vult dinsdag t/m zaterdag, maar niet maandag.
addSession({ id: "nieuw-di", date: dayAfter(2), coachEntry: "coach-nieuw" });
addSession({ id: "nieuw-za", date: dayAfter(6), coachEntry: "coach-nieuw" });

const gemarkeerd = markSupersededSessions(["nieuw-di", "nieuw-za"], "coach-nieuw");
assert.deepStrictEqual(gemarkeerd.map((s) => s.id).sort(), ["oud-ma", "oud-wo"], "beide restanten van het oude advies");
assert.ok(gemarkeerd.every((s) => s.verouderd), "en ze zijn als verouderd herkenbaar");
console.log("  ok  wat het nieuwe advies niet noemt wordt gemarkeerd als restant");

const nogSteedsGepland = db.prepare("SELECT status FROM planned_sessions WHERE id = ?").get("oud-ma");
assert.strictEqual(nogSteedsGepland.status, "gepland", "markeren mag de sessie niet uit de planning halen");
console.log("  ok  markeren verandert niets aan de planning zelf");

/* --------------------------- wat er niet telt --------------------------- */

console.log("\nwat met rust wordt gelaten");

db.exec("DELETE FROM planned_sessions");
addSession({ id: "vast", date: dayAfter(1), coachEntry: "coach-oud", locked: 1 });
addSession({ id: "eigen", date: dayAfter(1), coachEntry: null, description: "uit mijn eigen schema" });
addSession({ id: "gedaan", date: dayAfter(1), coachEntry: "coach-oud", status: "gedaan" });
addSession({ id: "verleden", date: dayAfter(-3), coachEntry: "coach-oud" });
addSession({ id: "verweg", date: dayAfter(30), coachEntry: "coach-oud" });
addSession({ id: "nieuw", date: dayAfter(5), coachEntry: "coach-nieuw" });

const tweedeRonde = markSupersededSessions(["nieuw"], "coach-nieuw");
assert.deepStrictEqual(tweedeRonde.map((s) => s.id), [], "hier valt niets te markeren");
console.log("  ok  vastgezet, zelf gepland, al gedaan, in het verleden of ver buiten het plan: allemaal ongemoeid");

/* ------------------------ opruimen en laten staan ------------------------ */

console.log("\nopruimen of laten staan is jouw keuze");

db.exec("DELETE FROM planned_sessions");
addSession({ id: "rest1", date: dayAfter(1), coachEntry: "coach-oud" });
addSession({ id: "rest2", date: dayAfter(2), coachEntry: "coach-oud" });
addSession({ id: "blijft", date: dayAfter(3), coachEntry: "coach-nieuw" });
markSupersededSessions(["blijft"], "coach-nieuw");

// "Ik doe hem toch" — de markering verdwijnt, de sessie blijft.
db.prepare("UPDATE planned_sessions SET superseded_by = NULL WHERE id = ?").run("rest2");

const opgeruimd = db
  .prepare("DELETE FROM planned_sessions WHERE superseded_by IS NOT NULL AND status = 'gepland' AND locked = 0")
  .run();
assert.strictEqual(opgeruimd.changes, 1, "alleen het restant dat je niet behield");
const over = db.prepare("SELECT id FROM planned_sessions ORDER BY id").all().map((r) => r.id);
assert.deepStrictEqual(over, ["blijft", "rest2"], "het behouden restant en het nieuwe plan blijven staan");
console.log("  ok  opruimen haalt alleen de restanten weg die je niet expliciet hebt behouden");

console.log("\nAlle tests voor verouderde sessies geslaagd.");
