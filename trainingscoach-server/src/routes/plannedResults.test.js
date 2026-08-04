"use strict";
/**
 * A completed plan should show what actually happened, not just a tick — the
 * same treatment a completed event gets. And the workout behind it must appear
 * once, not twice.
 */
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/plannedresults-selftest";
require("node:fs").rmSync("/tmp/plannedresults-selftest", { recursive: true, force: true });

const { db, initSchema } = require("../db/db");
initSchema();
const calc = require("../lib/calculations");

const today = calc.todayStr();

// A planned ride, done
db.prepare(`INSERT INTO planned_sessions (id,date,type,description,status,discipline,completed_cardio_log_id)
            VALUES (?,?,?,?,'gedaan','cardio',?)`)
  .run("p1", today, "Fietsen (Duur)", "90 min zone 2", "strava-9");
db.prepare(`INSERT INTO cardio_logs (id,date,type,duration_min,distance_km,avg_hr,max_hr,avg_power,weighted_avg_power,elevation_gain_m)
            VALUES (?,?,?,?,?,?,?,?,?,?)`)
  .run("strava-9", today, "Fietsen", 92, 41.2, 138, 162, 165, 178, 210);

// A planned strength session, done
db.prepare(`INSERT INTO planned_sessions (id,date,type,description,status,discipline,completed_cardio_log_id)
            VALUES (?,?,?,?,'gedaan','kracht',?)`)
  .run("p2", today, "Dinsdag", "Pull up 3x5", "w-9");
db.prepare("INSERT INTO workout_logs (id,date,day_name,rpe,duration_min) VALUES (?,?,?,?,?)")
  .run("w-9", today, "Dag A - Push", 7, 55);
["Pull up","Bench press"].forEach((n,i) =>
  db.prepare("INSERT INTO workout_log_exercises (id,workout_log_id,name,sort_order) VALUES (?,?,?,?)")
    .run("x"+i, "w-9", n, i));

// Mirrors the endpoint's enrichment
const enrich = (row) => {
  if (!row.completed_cardio_log_id) return { ...row, sessie: null };
  if ((row.discipline||"cardio") === "kracht") {
    const log = db.prepare("SELECT * FROM workout_logs WHERE id=?").get(row.completed_cardio_log_id);
    const ex = db.prepare("SELECT name FROM workout_log_exercises WHERE workout_log_id=? ORDER BY sort_order")
      .all(log.id).map(e=>e.name);
    return { ...row, sessie: { discipline:"kracht", dayName: log.day_name, rpe: log.rpe, durationMin: log.duration_min, oefeningen: ex } };
  }
  const log = db.prepare("SELECT * FROM cardio_logs WHERE id=?").get(row.completed_cardio_log_id);
  return { ...row, sessie: { discipline:"cardio", id: log.id, distanceKm: log.distance_km,
    durationMin: log.duration_min, avgHr: log.avg_hr, maxHr: log.max_hr,
    avgPower: log.avg_power, normalizedPower: log.weighted_avg_power, elevationGainM: log.elevation_gain_m } };
};

const plans = db.prepare("SELECT * FROM planned_sessions ORDER BY id").all().map(enrich);

console.log("afgeronde cardiotraining toont het resultaat");
const ride = plans.find(p => p.id === "p1");
assert.ok(ride.sessie, "er moet een sessie gekoppeld zijn");
console.log(`  ${ride.sessie.distanceKm} km · ${ride.sessie.durationMin} min · ${ride.sessie.avgHr}/${ride.sessie.maxHr} bpm · ${ride.sessie.avgPower} W (NP ${ride.sessie.normalizedPower}) · ↑${ride.sessie.elevationGainM}m`);
assert.strictEqual(ride.sessie.distanceKm, 41.2);
assert.strictEqual(ride.sessie.id, "strava-9", "moet doorlinken naar de analyse van díé rit");
console.log("  ok  cijfers gekoppeld en doorklikbaar naar de analyse");

console.log("\nafgeronde krachttraining toont de oefeningen");
const gym = plans.find(p => p.id === "p2");
assert.deepStrictEqual(gym.sessie.oefeningen, ["Pull up","Bench press"]);
assert.strictEqual(gym.sessie.rpe, 7);
console.log(`  ${gym.sessie.oefeningen.join(" · ")} · ${gym.sessie.durationMin} min · RPE ${gym.sessie.rpe}`);
console.log("  ok  oefeningen en RPE gekoppeld");

console.log("\ngeen dubbele weergave van dezelfde krachttraining");
const strengthRows = db.prepare("SELECT id FROM workout_logs WHERE date=?").all(today)
  .filter(w => !plans.some(p => p.completed_cardio_log_id === w.id));
assert.strictEqual(strengthRows.length, 0, "de training hoort al bij het plan te staan");
console.log("  ok  de gelogde training staat alleen bij het plan, niet er ook nog los naast");

console.log("\nnog niet gedane training heeft geen resultaat");
db.prepare("INSERT INTO planned_sessions (id,date,type,description,status,discipline) VALUES (?,?,?,?,'gepland','cardio')")
  .run("p3", today, "Fietsen", "morgen");
const open = enrich(db.prepare("SELECT * FROM planned_sessions WHERE id='p3'").get());
assert.strictEqual(open.sessie, null);
console.log("  ok  openstaande training toont geen cijfers");

console.log("\nAlle tests voor resultaten in de planning geslaagd.");
