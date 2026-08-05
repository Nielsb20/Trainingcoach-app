"use strict";
/**
 * Two things are covered here.
 *
 * 1. sRPE must survive the *real* serialisation path. The existing
 *    strengthContext test re-implements the payload builder against raw SQLite
 *    rows (snake_case), which is precisely why it never noticed that coach.js
 *    read `duration_min` off an object that only carries `durationMin`. Every
 *    assertion below therefore runs through serializeWorkoutLog, exactly like
 *    the coach does.
 *
 * 2. Editing a logged session must not detach it from the plan it completed.
 */
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/strength-selftest-workoutLogEditing";
require("node:fs").rmSync("/tmp/strength-selftest-workoutLogEditing", { recursive: true, force: true });

const { db, initSchema } = require("../db/db");
initSchema();
const { serializeWorkoutLog, replaceWorkoutLog } = require("./workoutLogs");
const calc = require("../lib/calculations");

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

function addWorkout(id, date, { rpe = null, duration = null, exercises = [] } = {}) {
  db.prepare("INSERT INTO workout_logs (id,date,day_id,day_name,rpe,duration_min) VALUES (?,?,?,?,?,?)")
    .run(id, date, "day-a", "Dag A", rpe, duration);
  exercises.forEach((ex, i) => {
    const exId = `${id}-ex${i}`;
    db.prepare("INSERT INTO workout_log_exercises (id,workout_log_id,name,sort_order) VALUES (?,?,?,?)")
      .run(exId, id, ex.name, i);
    (ex.sets || []).forEach((s, j) =>
      db.prepare("INSERT INTO workout_log_sets (exercise_id,weight,reps,sort_order) VALUES (?,?,?,?)")
        .run(exId, s.weight, s.reps, j)
    );
  });
}

const load = (id) => serializeWorkoutLog(db.prepare("SELECT * FROM workout_logs WHERE id = ?").get(id));

/* ------------------------------------------------------------------ */
console.log("sRPE wordt berekend op het object dat de coach echt krijgt");

addWorkout("w1", daysAgo(1), {
  rpe: 8,
  duration: 60,
  exercises: [{ name: "Squat", sets: [{ weight: 100, reps: 5 }, { weight: 100, reps: 5 }] }],
});

const serialized = load("w1");
assert.strictEqual(serialized.durationMin, 60, "serializer levert camelCase durationMin");
assert.strictEqual(
  calc.computeSessionRpe(serialized),
  480,
  "sRPE moet 8 x 60 = 480 zijn op het geserialiseerde object — dit is de regressie die de coach maandenlang null gaf"
);
console.log("  ok  8 x 60 = 480 sRPE via serializeWorkoutLog");

// De helper moet ook de ruwe SQLite-vorm aankunnen, want planned.js leest die rechtstreeks.
assert.strictEqual(calc.computeSessionRpe({ rpe: 7, duration_min: 45 }), 315, "snake_case moet ook werken");
console.log("  ok  snake_case (ruwe db-rij) geeft hetzelfde resultaat");

console.log("\nzonder RPE of duur blijft het null, geen verzonnen getal");
assert.strictEqual(calc.computeSessionRpe({ rpe: 8, durationMin: null }), null);
assert.strictEqual(calc.computeSessionRpe({ rpe: null, durationMin: 60 }), null);
assert.strictEqual(calc.computeSessionRpe(null), null);
console.log("  ok  ontbrekende invoer -> null");

/* ------------------------------------------------------------------ */
console.log("\nweekbelasting bundelt per maandag-week");

// Bewust vaste datums: met daysAgo() hangt het van de weekdag van vandaag af
// of twee sessies in dezelfde week vallen, en dan is de test op maandag stuk.
// 1 juni 2026 is een maandag, 14 juni een zondag.
const weekly = calc.computeWeeklyStrengthLoad([
  { date: "2026-06-01", rpe: 8, durationMin: 60 }, // ma, 480
  { date: "2026-06-03", rpe: 6, durationMin: 50 }, // wo, 300
  { date: "2026-06-08", rpe: 9, durationMin: 70 }, // ma, 630
  { date: "2026-06-09", rpe: null, durationMin: null }, // di, niet beoordeeld
  { date: "2026-06-14", rpe: 5, durationMin: 40 }, // zo -> hoort bij de week van 8 juni
], 12);

assert.strictEqual(weekly.length, 2, "vijf sessies verdeeld over precies twee weken");

const weekOne = weekly[0];
assert.strictEqual(weekOne.weekStart, "2026-06-01");
assert.strictEqual(weekOne.sRpe, 780, "480 + 300");
assert.strictEqual(weekOne.sessions, 2);
console.log(`  ok  week van 1 juni: ${weekOne.sRpe} sRPE uit ${weekOne.sessions} sessies`);

const weekTwo = weekly[1];
assert.strictEqual(weekTwo.weekStart, "2026-06-08");
assert.strictEqual(weekTwo.sessions, 3, "de zondag hoort bij deze week, niet bij de volgende");
assert.strictEqual(weekTwo.sessionsRated, 2);
assert.strictEqual(weekTwo.sRpe, 830, "630 + 200; de onbeoordeelde sessie telt niet mee in sRPE");
console.log("  ok  zondag valt in de maandag-week; onbeoordeelde sessie telt wel als sessie, niet in sRPE");

console.log("\neen week waarin niets is beoordeeld geeft null, niet 0");
const onlyUnrated = calc.computeWeeklyStrengthLoad([{ date: daysAgo(0), rpe: null, durationMin: null }], 12);
assert.strictEqual(onlyUnrated[0].sRpe, null, "0 zou 'rustweek' suggereren, wat onwaar is");
assert.strictEqual(onlyUnrated[0].sessions, 1);
console.log("  ok  niets beoordeeld -> sRPE null met sessions 1");

/* ------------------------------------------------------------------ */
console.log("\neen gelogde training corrigeren");

const before = load("w1");
assert.strictEqual(before.exercises[0].sets[1].reps, 5);

const updated = replaceWorkoutLog("w1", {
  date: before.date,
  timeOfDay: "avond",
  dayId: before.dayId,
  dayName: before.dayName,
  notes: "reps gecorrigeerd",
  rpe: 8,
  durationMin: 65,
  exercises: [{ name: "Squat", sets: [{ weight: 100, reps: 5 }, { weight: 100, reps: 3 }] }],
});

assert.strictEqual(updated.id, "w1", "het id moet behouden blijven");
assert.strictEqual(updated.exercises[0].sets[1].reps, 3, "de foute herhaling is gecorrigeerd");
assert.strictEqual(updated.exercises[0].sets.length, 2, "geen dubbele sets na het herschrijven");
assert.strictEqual(updated.durationMin, 65);
assert.strictEqual(updated.timeOfDay, "avond");
console.log("  ok  herhalingen, duur en moment aangepast, id ongewijzigd");

const setCount = db.prepare(
  "SELECT COUNT(*) AS n FROM workout_log_sets WHERE exercise_id IN (SELECT id FROM workout_log_exercises WHERE workout_log_id = 'w1')"
).get().n;
assert.strictEqual(setCount, 2, "oude sets moeten zijn opgeruimd, niet opgestapeld");
console.log("  ok  geen weessets achtergebleven");

console.log("\nde koppeling met een afgeronde planning blijft intact");
db.prepare(
  "INSERT INTO planned_sessions (id,date,type,description,status,discipline,completed_cardio_log_id) VALUES (?,?,?,?,?,?,?)"
).run("p1", before.date, "Kracht", "Dag A", "gedaan", "kracht", "w1");

replaceWorkoutLog("w1", {
  date: before.date,
  dayId: before.dayId,
  dayName: before.dayName,
  rpe: 9,
  durationMin: 70,
  exercises: [{ name: "Squat", sets: [{ weight: 105, reps: 5 }] }],
});

const plan = db.prepare("SELECT status, completed_cardio_log_id FROM planned_sessions WHERE id = 'p1'").get();
assert.strictEqual(plan.completed_cardio_log_id, "w1", "de planning wijst nog steeds naar dezelfde log");
assert.strictEqual(plan.status, "gedaan", "een correctie mag 'gedaan' niet ongedaan maken");
console.log("  ok  planning blijft afgevinkt en gekoppeld na bewerken");

console.log("\neen training leeg opslaan wordt geweigerd");
assert.throws(
  () => replaceWorkoutLog("w1", { date: before.date, exercises: [] }),
  /minstens één set/,
  "leegmaken moet een fout geven in plaats van de log te wissen"
);
assert.ok(load("w1"), "de training bestaat nog steeds");
console.log("  ok  lege training geweigerd, bestaande log ongemoeid");

console.log("\neen onbekende training geeft een nette 404");
const missing = (() => {
  try { replaceWorkoutLog("bestaat-niet", { exercises: [{ name: "X", sets: [{ weight: 1, reps: 1 }] }] }); }
  catch (e) { return e; }
})();
assert.strictEqual(missing.status, 404);
console.log("  ok  onbekend id -> status 404");

console.log("\nalle tests geslaagd");
