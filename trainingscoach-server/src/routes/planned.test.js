"use strict";
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/planned-selftest-planned";
require("node:fs").rmSync("/tmp/planned-selftest-planned", { recursive: true, force: true });

const { db, initSchema } = require("../db/db");
initSchema();
const { resolveDate, refreshCompletions } = require("./planned");
const calc = require("../lib/calculations");

console.log("resolveDate (coach zegt een weekdag, wij maken er een datum van)");
{
  // 2026-07-27 is a Monday
  assert.strictEqual(resolveDate("Woensdag", "2026-07-27"), "2026-07-29");
  console.log("  ok  vanaf maandag -> 'Woensdag' = 2026-07-29");
  assert.strictEqual(resolveDate("Maandag", "2026-07-27"), "2026-07-27");
  console.log("  ok  dezelfde dag telt als vandaag, niet volgende week");
  assert.strictEqual(resolveDate("Zondag", "2026-07-27"), "2026-08-02");
  console.log("  ok  'Zondag' loopt netjes door naar het weekend");
  assert.strictEqual(resolveDate("zaterdag 1 augustus", "2026-07-27"), "2026-08-01");
  console.log("  ok  weekdag met tekst eromheen werkt ook");
  assert.strictEqual(resolveDate("2026-08-15", "2026-07-27"), "2026-08-15");
  console.log("  ok  expliciete datum wordt overgenomen");
  assert.strictEqual(resolveDate("ergens deze week", "2026-07-27"), null);
  console.log("  ok  onherkenbare tekst -> null (geen gokdatum)");

  // Guard the weekday mapping against off-by-one: verify against the calculation core
  for (const d of ["2026-07-27", "2026-07-29", "2026-08-02"]) {
    const name = calc.weekdayNameForDate(d);
    assert.strictEqual(resolveDate(name, d), d, `${name} vanaf ${d} moet ${d} zelf opleveren`);
  }
  console.log("  ok  weekdagnamen komen overeen met de rekenkern (geen verschuiving)");
}

console.log("\nautomatisch afvinken");
{
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const yStr = calc.toDateStr(yesterday);
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const tStr = calc.toDateStr(tomorrow);

  const ins = db.prepare("INSERT INTO planned_sessions (id,date,type,description) VALUES (?,?,?,?)");
  ins.run("p1", yStr, "Fietsen", "duurrit 2 uur");     // gedaan
  ins.run("p2", yStr, "Hardlopen", "intervallen");      // niet gedaan
  ins.run("p3", tStr, "Fietsen", "herstelrit");         // nog in de toekomst

  db.prepare("INSERT INTO cardio_logs (id,date,type,duration_min) VALUES (?,?,?,?)")
    .run("ride-1", yStr, "Fietsen", 120);

  refreshCompletions();
  const rows = db.prepare("SELECT id,status,completed_cardio_log_id FROM planned_sessions ORDER BY id").all();
  rows.forEach(r => console.log(`  ${r.id}: ${r.status}${r.completed_cardio_log_id ? " -> " + r.completed_cardio_log_id : ""}`));

  assert.strictEqual(rows[0].status, "gedaan", "gereden rit moet als gedaan gelden");
  assert.strictEqual(rows[0].completed_cardio_log_id, "ride-1");
  assert.strictEqual(rows[1].status, "overgeslagen", "gemiste training van gisteren");
  assert.strictEqual(rows[2].status, "gepland", "toekomstige training blijft gepland");
  console.log("  ok  gedaan / overgeslagen / nog gepland correct onderscheiden");
}

console.log("\nAlle planningstests geslaagd.");
