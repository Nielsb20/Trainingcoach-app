"use strict";
/**
 * A backup you never verified is a backup you don't have.
 *
 * The app shipped without one for months; the day it was needed there was
 * nothing to restore from. So these tests check the properties that actually
 * matter when it comes to that: the snapshot contains the data, it can be read
 * back, it doesn't pile up forever, and a half-written file never replaces a
 * good one.
 */
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const DATA_DIR = "/tmp/backup-selftest";
process.env.DATA_DIR = DATA_DIR;
fs.rmSync(DATA_DIR, { recursive: true, force: true });

const { db, initSchema } = require("../db/db");
initSchema();
const backup = require("./backup");
const calc = require("./calculations");

db.prepare("INSERT INTO workout_logs (id,date,day_name,rpe,duration_min) VALUES ('w1','2026-08-01','Dag A',8,60)").run();
db.prepare("INSERT INTO workout_log_exercises (id,workout_log_id,name,sort_order) VALUES ('w1-ex0','w1','Squat',0)").run();
db.prepare("INSERT INTO workout_log_sets (exercise_id,weight,reps,sort_order) VALUES ('w1-ex0',100,5,0)").run();
db.prepare("INSERT INTO cardio_logs (id,date,type,duration_min) VALUES ('c1','2026-08-02','Fietsen',90)").run();
db.prepare("INSERT INTO weight_logs (id,date,weight_kg) VALUES ('g1','2026-08-02',78.4)").run();

console.log("de snapshot bevat de gelogde gegevens");
const written = backup.writeBackup("2026-08-05");
const restored = JSON.parse(fs.readFileSync(written.path, "utf8"));

assert.strictEqual(restored.workoutLogs.length, 1);
assert.strictEqual(restored.workoutLogs[0].exercises[0].sets[0].weight, 100, "sets horen erin te staan");
assert.strictEqual(restored.workoutLogs[0].rpe, 8);
assert.strictEqual(restored.cardioLogs.length, 1);
assert.strictEqual(restored.weightLogs.length, 1);
assert.ok(restored.exportedAt, "een snapshot zonder tijdstempel is lastig te plaatsen");
console.log(`  ok  ${written.file} bevat kracht, cardio en gewicht (${written.bytes} bytes)`);

console.log("\nde snapshot heeft dezelfde vorm als de handmatige export");
const manual = backup.buildBackup();
assert.deepStrictEqual(
  Object.keys(restored).sort(),
  Object.keys(manual).sort(),
  "back-up en export moeten dezelfde velden hebben, anders mist een herstel iets"
);
console.log("  ok  identieke velden, dus terug te zetten via /api/import");

console.log("\nnog een back-up op dezelfde dag overschrijft, en stapelt niet");
backup.writeBackup("2026-08-05");
assert.strictEqual(backup.listBackups().filter((b) => b.date === "2026-08-05").length, 1);
console.log("  ok  één bestand per dag");

console.log("\noude snapshots worden opgeruimd");
for (let d = 1; d <= 40; d++) {
  backup.writeBackup(`2026-07-${String(d).padStart(2, "0")}`);
}
const remaining = backup.listBackups();
assert.strictEqual(remaining.length, backup.KEEP_BACKUPS, `er horen er ${backup.KEEP_BACKUPS} over te blijven`);
// De nieuwste moeten blijven staan, niet de oudste.
assert.strictEqual(remaining[0].date, "2026-08-05", "de nieuwste snapshot moet bewaard blijven");
console.log(`  ok  ${remaining.length} bewaard, oudste verwijderd`);

console.log("\neen tijdelijk bestand vervangt nooit een goede back-up");
assert.ok(
  !fs.readdirSync(backup.BACKUP_DIR).some((f) => f.endsWith(".tmp")),
  "er mag geen .tmp achterblijven"
);
console.log("  ok  geen halve bestanden achtergebleven");

console.log("\nwanneer is een back-up nodig");
const vandaag = calc.todayStr();
fs.rmSync(path.join(backup.BACKUP_DIR, `trainingscoach-backup-${vandaag}.json`), { force: true });

// Vroeg in de nacht nog niet: de datum is dan net omgeslagen.
const nacht = new Date(`${vandaag}T01:00:00`);
assert.strictEqual(backup.isBackupDue(nacht), false, "om 01:00 nog niet");

const ochtend = new Date(`${vandaag}T09:00:00`);
assert.strictEqual(backup.isBackupDue(ochtend), true, "later op de dag zonder back-up wel");

backup.writeBackup(vandaag);
assert.strictEqual(backup.isBackupDue(ochtend), false, "met een back-up van vandaag niet nogmaals");
console.log("  ok  één per dag, ook als de Pi 's nachts uit stond");

console.log("\nAlle back-uptests geslaagd.");
