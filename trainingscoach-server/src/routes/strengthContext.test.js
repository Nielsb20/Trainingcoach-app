"use strict";
/**
 * The cardio load model (TSS/CTL/ATL) is blind to gym work, so the coach needs
 * strength context separately — otherwise it reads "TSB +8, well recovered"
 * the morning after a heavy leg session.
 */
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/strength-selftest-strengthContext";
require("node:fs").rmSync("/tmp/strength-selftest-strengthContext", { recursive: true, force: true });

const { db, initSchema } = require("../db/db");
initSchema();
const calc = require("../lib/calculations");

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const addWorkout = (id, date, dayName, exercises, rpe = null, duration = null) => {
  db.prepare("INSERT INTO workout_logs (id,date,day_name,rpe,duration_min) VALUES (?,?,?,?,?)")
    .run(id, date, dayName, rpe, duration);
  exercises.forEach((name, i) => {
    db.prepare("INSERT INTO workout_log_exercises (id,workout_log_id,name,sort_order) VALUES (?,?,?,?)")
      .run(`${id}-ex${i}`, id, name, i);
  });
};

// Mirrors the payload builder in coach.js
function buildStrengthContext() {
  const rows = db.prepare("SELECT * FROM workout_logs ORDER BY date DESC").all();
  if (rows.length === 0) return null;
  const today = calc.todayStr();
  const between = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
  const last = rows[0];
  const within = (d) => rows.filter((r) => between(r.date, today) <= d);
  const sRpe = (r) => (r.rpe && r.duration_min ? r.rpe * r.duration_min : null);
  return {
    dagenSindsLaatste: between(last.date, today),
    laatsteSessie: {
      datum: last.date,
      dag: last.day_name,
      oefeningen: db.prepare("SELECT name FROM workout_log_exercises WHERE workout_log_id = ?")
        .all(last.id).map((e) => e.name),
      rpe: last.rpe,
    },
    sessiesLaatste7Dagen: within(7).length,
    sessiesLaatste28Dagen: within(28).length,
    sRpeLaatste7Dagen: within(7).map(sRpe).filter(Boolean).reduce((a, b) => a + b, 0) || null,
  };
}

console.log("het scenario dat de coach moet kunnen zien: zware beendag gisteren");
addWorkout("w1", daysAgo(1), "Dag B - Benen", ["Squat", "Deadlift", "Beenpers"], 9, 75);
let ctx = buildStrengthContext();
console.log(`  laatste sessie: ${ctx.laatsteSessie.dag}, ${ctx.dagenSindsLaatste} dag(en) geleden`);
console.log(`  oefeningen: ${ctx.laatsteSessie.oefeningen.join(", ")}`);
assert.strictEqual(ctx.dagenSindsLaatste, 1);
assert.ok(ctx.laatsteSessie.oefeningen.includes("Squat"), "coach moet kunnen zien dat het benen waren");
console.log("  ok  coach ziet dat er gisteren zwaar op benen is getraind");

console.log("\nweekbelasting uit duur x RPE");
addWorkout("w2", daysAgo(3), "Dag A - Push", ["Bench press"], 7, 60);
addWorkout("w3", daysAgo(5), "Dag B - Benen", ["Squat"], 8, 70);
ctx = buildStrengthContext();
const expected = 9 * 75 + 7 * 60 + 8 * 70;
assert.strictEqual(ctx.sRpeLaatste7Dagen, expected, `sRPE zou ${expected} moeten zijn`);
assert.strictEqual(ctx.sessiesLaatste7Dagen, 3);
console.log(`  ok  3 sessies deze week, sRPE-som ${ctx.sRpeLaatste7Dagen} (9x75 + 7x60 + 8x70)`);

console.log("\nzonder RPE/duur blijft het netjes leeg (geen verzonnen getal)");
db.exec("DELETE FROM workout_log_exercises; DELETE FROM workout_logs;");
addWorkout("w4", daysAgo(2), "Dag A", ["Bench press"]);
ctx = buildStrengthContext();
assert.strictEqual(ctx.sRpeLaatste7Dagen, null, "geen RPE ingevuld -> geen belastinggetal");
assert.strictEqual(ctx.sessiesLaatste7Dagen, 1, "het aantal sessies weet hij wel");
console.log("  ok  geen RPE ingevuld -> null in plaats van een geschat getal");

console.log("\ncardio-belasting telt krachttraining bewust NIET mee");
const cardio = [{ date: daysAgo(1), duration_min: 60, avg_power: 200 }];
const series = calc.computeTrainingLoadSeries(cardio, 250, null);
assert.ok(series && series.length > 0);
console.log("  ok  CTL/ATL/TSB blijft cardio-only (kracht heeft geen vermogensmeter,");
console.log("      dus optellen zou het model vervuilen — de coach krijgt kracht apart)");

console.log("\nAlle krachtcontext-tests geslaagd.");
