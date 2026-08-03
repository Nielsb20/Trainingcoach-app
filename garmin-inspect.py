"use strict";
/**
 * Per-session analysis. The figures shown on screen must match the ones the
 * coach is handed, so both come from this one endpoint.
 */
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/sessiondetail-selftest";
require("node:fs").rmSync("/tmp/sessiondetail-selftest", { recursive: true, force: true });
process.env.GEMINI_API_KEY = "test";

const { db, initSchema } = require("../db/db");
initSchema();
const calc = require("../lib/calculations");

db.prepare("UPDATE profile SET max_hr=185, resting_hr=49, ftp=200 WHERE id=1").run();
db.prepare("INSERT INTO weight_logs (id,date,weight_kg) VALUES (?,?,?)").run("w1","2026-07-01",74.5);

// A long ride with a clear second-half drift: HR up, power down
const profile = [];
for (let i = 0; i < 12; i++) {
  profile.push({ tMin: i * 40, gemHartslag: i < 6 ? 138 : 149, gemVermogen: i < 6 ? 128 : 110,
                 gemSnelheidKmu: 27, gemCadans: 84, hoogte: 5 });
}
const hrHist = {}; for (let b = 130; b <= 155; b++) hrHist[b] = 1200;

db.prepare(`INSERT INTO cardio_logs
  (id,date,type,duration_min,distance_km,avg_hr,max_hr,avg_power,weighted_avg_power,avg_cadence,
   elevation_gain_m,notes,profile_json,hr_histogram_json,source)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .run("strava-1","2026-07-30","Fietsen",491.3,216,143,175,119,128,84,301,
       "Fietselfstedentocht", JSON.stringify(profile), JSON.stringify(hrHist), "strava");

// Two comparable earlier rides
db.prepare("INSERT INTO cardio_logs (id,date,type,duration_min,distance_km,avg_hr,avg_power) VALUES (?,?,?,?,?,?,?)")
  .run("old1","2026-06-15","Fietsen",470,205,145,115);
db.prepare("INSERT INTO cardio_logs (id,date,type,duration_min,distance_km,avg_hr,avg_power) VALUES (?,?,?,?,?,?,?)")
  .run("old2","2026-05-20","Fietsen",455,198,147,112);
// And one that isn't comparable — far too short
db.prepare("INSERT INTO cardio_logs (id,date,type,duration_min,distance_km,avg_hr) VALUES (?,?,?,?,?,?)")
  .run("short","2026-06-01","Fietsen",45,20,130);
db.prepare("INSERT INTO events (id,name,date,type,target) VALUES (?,?,?,?,?)")
  .run("e1","Fietselfstedentocht","2026-07-30","Wielerevenement","uitrijden");

const row = db.prepare("SELECT * FROM cardio_logs WHERE id='strava-1'").get();
const { serialize } = require("./cardioLogs");
const session = serialize(row);

console.log("berekende cijfers");
const tss = calc.computeSessionTSS(session, 200, calc.computeHrZones(185, 49));
console.log(`  TSS ${tss.tss} (IF ${tss.intensityFactor}, via ${tss.method})`);
assert.ok(tss.tss > 250 && tss.tss < 400, "acht uur op 128 W NP bij FTP 200 -> ruim 300 TSS");
const wkg = calc.computeWattsPerKg(session.avg_power, 74.5);
assert.strictEqual(wkg, 1.6);
console.log(`  ${wkg} W/kg bij 74,5 kg`);
const variability = Math.round((session.weighted_avg_power / session.avg_power) * 100) / 100;
console.log(`  variabiliteit ${variability} (NP ${session.weighted_avg_power} / gem ${session.avg_power})`);

console.log("\ncardiac drift");
const points = session.profile.filter(p => p.gemHartslag);
const half = Math.floor(points.length / 2);
const avg = (a,k) => a.map(p=>p[k]).filter(x=>x!=null).reduce((x,y)=>x+y,0) / a.length;
const firstHr = avg(points.slice(0,half),"gemHartslag"), secondHr = avg(points.slice(half),"gemHartslag");
const firstP = avg(points.slice(0,half),"gemVermogen"), secondP = avg(points.slice(half),"gemVermogen");
console.log(`  eerste helft ${Math.round(firstHr)} bpm bij ${Math.round(firstP)} W`);
console.log(`  tweede helft ${Math.round(secondHr)} bpm bij ${Math.round(secondP)} W`);
assert.ok(secondHr > firstHr && secondP < firstP, "hartslag omhoog, vermogen omlaag = drift");
console.log(`  ok  drift gedetecteerd: +${Math.round(secondHr-firstHr)} bpm bij lager vermogen`);

console.log("\nvergelijkbare ritten (binnen 20% afstand)");
const comparable = db.prepare("SELECT * FROM cardio_logs WHERE type=? AND date<? AND distance_km IS NOT NULL ORDER BY date DESC")
  .all(session.type, session.date)
  .filter(r => Math.abs(r.distance_km - session.distance_km) / session.distance_km <= 0.2);
console.log(`  gevonden: ${comparable.map(c => c.distance_km + " km").join(", ")}`);
assert.strictEqual(comparable.length, 2, "205 en 198 km tellen mee, 20 km niet");
assert.ok(!comparable.some(c => c.id === "short"), "een ritje van 20 km is geen vergelijking voor 216 km");
console.log("  ok  ritje van 20 km terecht buiten de vergelijking gelaten");

console.log("\ntijd in zones uit het histogram");
const inZones = calc.timeInHrZones(hrHist, calc.computeHrZones(185, 49));
inZones.filter(z => z.minuten > 0).forEach(z => console.log(`  Z${z.zone} ${z.naam}: ${z.minuten} min`));
assert.ok(inZones.some(z => z.minuten > 0));
console.log("  ok  zoneverdeling berekend");

console.log("\nAlle tests voor sessiedetail geslaagd.");
