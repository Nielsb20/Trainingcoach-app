"use strict";
/**
 * Filling the planner from the athlete's own fixed schedule. The important
 * property is that it only fills empty slots: running it twice, or after
 * accepting a coach proposal, must never overwrite what's already there.
 */
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/fillschema-selftest";
require("node:fs").rmSync("/tmp/fillschema-selftest", { recursive: true, force: true });

const { db, initSchema } = require("../db/db");
initSchema();
const calc = require("../lib/calculations");

// Mirrors the route's generation logic
function fillFromSchema(from, to) {
  const strengthDays = db.prepare("SELECT * FROM schema_days WHERE weekdays IS NOT NULL AND weekdays != ''").all();
  const cardioDays = db.prepare("SELECT * FROM schema_cardio_days").all();
  const existing = db.prepare(
    "SELECT date, discipline FROM planned_sessions WHERE date >= ? AND date <= ? AND status IN ('gepland','voorgesteld')"
  ).all(from, to);
  const taken = new Set(existing.map((e) => `${e.date}|${e.discipline || "cardio"}`));
  const insert = db.prepare(
    `INSERT INTO planned_sessions (id,date,weekday,type,description,status,discipline,time_of_day)
     VALUES (?,?,?,?,?,'gepland',?,?)`);
  const pad = (n) => String(n).padStart(2, "0");
  const toIso = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const created = [];
  const cursor = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  while (cursor <= end) {
    const iso = toIso(cursor);
    const weekday = calc.weekdayNameForDate(iso);
    strengthDays.forEach((d) => {
      if (!(d.weekdays || "").split(",").includes(weekday)) return;
      if (taken.has(`${iso}|kracht`)) return;
      insert.run(`k-${d.id}-${iso}`, iso, weekday, d.name, "vast schema", "kracht", d.time_of_day);
      taken.add(`${iso}|kracht`);
      created.push({ date: iso, discipline: "kracht", type: d.name });
    });
    cardioDays.forEach((c) => {
      if (c.weekday !== weekday) return;
      if (taken.has(`${iso}|cardio`)) return;
      insert.run(`c-${c.id}-${iso}`, iso, weekday, c.type, "vast schema", "cardio", c.time_of_day);
      taken.add(`${iso}|cardio`);
      created.push({ date: iso, discipline: "cardio", type: c.type });
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return created;
}

// Tuesday strength (evening), Thursday strength, Saturday ride
db.prepare("INSERT INTO schema_days (id,name,sort_order,weekdays,time_of_day) VALUES (?,?,?,?,?)")
  .run("d1", "Dag A - Push", 0, "Dinsdag", "avond");
db.prepare("INSERT INTO schema_days (id,name,sort_order,weekdays,time_of_day) VALUES (?,?,?,?,?)")
  .run("d2", "Dag B - Benen", 1, "Donderdag", "avond");
db.prepare("INSERT INTO schema_cardio_days (id,weekday,type,notes,time_of_day) VALUES (?,?,?,?,?)")
  .run("c1", "Zaterdag", "Fietsen", "lange duurrit", "ochtend");

// A full fortnight starting on a Monday
const FROM = "2026-08-03", TO = "2026-08-16";
console.log(`periode ${FROM} t/m ${TO} (start op ${calc.weekdayNameForDate(FROM)})`);

let created = fillFromSchema(FROM, TO);
console.log(`\n${created.length} sessies aangemaakt:`);
created.forEach((c) => console.log(`  ${c.date} ${calc.weekdayNameForDate(c.date).padEnd(9)} ${c.discipline.padEnd(7)} ${c.type}`));

assert.strictEqual(created.filter((c) => c.discipline === "kracht").length, 4, "2 krachtdagen x 2 weken");
assert.strictEqual(created.filter((c) => c.discipline === "cardio").length, 2, "1 cardiodag x 2 weken");
created.forEach((c) => {
  const expected = c.type.includes("Push") ? "Dinsdag" : c.type.includes("Benen") ? "Donderdag" : "Zaterdag";
  assert.strictEqual(calc.weekdayNameForDate(c.date), expected, `${c.type} hoort op ${expected}`);
});
console.log("  ok  elke sessie staat op de weekdag uit het schema");

const evening = db.prepare("SELECT time_of_day FROM planned_sessions WHERE discipline='kracht' LIMIT 1").get();
assert.strictEqual(evening.time_of_day, "avond");
console.log("  ok  tijdstip uit het schema is overgenomen");

console.log("\nnogmaals uitvoeren voegt niets dubbel toe");
const second = fillFromSchema(FROM, TO);
assert.strictEqual(second.length, 0, "alles was al gevuld");
console.log("  ok  tweede keer: 0 toegevoegd");

console.log("\neen bestaande sessie wordt nooit overschreven");
db.exec("DELETE FROM planned_sessions");
db.prepare("INSERT INTO planned_sessions (id,date,type,description,status,discipline,locked) VALUES (?,?,?,?,?,?,?)")
  .run("mijn-eigen", "2026-08-04", "Fietsen", "eigen rit die ik wil houden", "gepland", "cardio", 1);
created = fillFromSchema(FROM, TO);
const mine = db.prepare("SELECT * FROM planned_sessions WHERE id='mijn-eigen'").get();
assert.strictEqual(mine.description, "eigen rit die ik wil houden", "eigen sessie moet ongewijzigd blijven");
const onThatDay = db.prepare("SELECT * FROM planned_sessions WHERE date='2026-08-04' AND discipline='cardio'").all();
assert.strictEqual(onThatDay.length, 1, "geen tweede cardio op die dag");
console.log("  ok  bestaande (vastgezette) sessie blijft ongemoeid, geen dubbeling");

console.log("\nkracht en cardio op dezelfde dag kunnen wel naast elkaar");
db.exec("DELETE FROM planned_sessions");
db.prepare("INSERT INTO schema_cardio_days (id,weekday,type,notes,time_of_day) VALUES (?,?,?,?,?)")
  .run("c2", "Dinsdag", "Hardlopen", "", "ochtend");
created = fillFromSchema("2026-08-04", "2026-08-04"); // een dinsdag
assert.strictEqual(created.length, 2, "kracht in de avond + hardlopen in de ochtend");
console.log("  ok  ochtendloop en avondkracht op dezelfde dinsdag staan er allebei");

console.log("\nAlle tests voor aanvullen vanuit schema geslaagd.");
