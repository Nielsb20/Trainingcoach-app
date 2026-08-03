"use strict";
/**
 * An event you've ridden should show its result, not sit in the planner as an
 * unconnected flag. Matching is by date: an event is a one-off on a known day,
 * so the ride logged that day is the ride.
 */
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/eventdone-selftest";
require("node:fs").rmSync("/tmp/eventdone-selftest", { recursive: true, force: true });

const { db, initSchema } = require("../db/db");
initSchema();

const linkEvents = (events) => events.map((e) => {
  const log = db.prepare(
    `SELECT id, type, duration_min, distance_km, avg_hr, max_hr, avg_power,
            weighted_avg_power, elevation_gain_m
     FROM cardio_logs WHERE date = ? ORDER BY COALESCE(distance_km,0) DESC LIMIT 1`).get(e.date);
  return { ...e, voltooid: !!log, sessie: log || null };
});

console.log("het echte geval: Fietselfstedentocht op 30 juli");
db.prepare("INSERT INTO events (id,name,date,type,target) VALUES (?,?,?,?,?)")
  .run("e1", "Fietselfstedentocht", "2026-07-30", "Wielerevenement", "uitrijden");
db.prepare(`INSERT INTO cardio_logs (id,date,type,duration_min,distance_km,avg_hr,max_hr,avg_power,weighted_avg_power,elevation_gain_m)
            VALUES (?,?,?,?,?,?,?,?,?,?)`)
  .run("strava-1", "2026-07-30", "Fietsen", 491.3, 216, 143, 175, 119, 128, 301);

let linked = linkEvents(db.prepare("SELECT * FROM events").all());
assert.strictEqual(linked[0].voltooid, true, "de rit van die dag hoort gekoppeld te worden");
assert.strictEqual(linked[0].sessie.distance_km, 216);
console.log(`  ok  gekoppeld: ${linked[0].sessie.distance_km} km, ${Math.round(linked[0].sessie.duration_min)} min, ↑${linked[0].sessie.elevation_gain_m}m`);

console.log("\nmeerdere ritten die dag -> de langste telt als het evenement");
db.prepare("INSERT INTO cardio_logs (id,date,type,duration_min,distance_km) VALUES (?,?,?,?,?)")
  .run("strava-2", "2026-07-30", "Fietsen", 20, 8);
linked = linkEvents(db.prepare("SELECT * FROM events").all());
assert.strictEqual(linked[0].sessie.id, "strava-1", "216 km wint van een uitrolritje van 8 km");
console.log("  ok  216 km gekozen boven het ritje van 8 km ernaast");

console.log("\ntoekomstig evenement blijft onvoltooid");
db.prepare("INSERT INTO events (id,name,date,type) VALUES (?,?,?,?)")
  .run("e2", "Rondje IJsselmeer", "2026-09-15", "Wielerevenement");
linked = linkEvents(db.prepare("SELECT * FROM events WHERE id='e2'").all());
assert.strictEqual(linked[0].voltooid, false);
assert.strictEqual(linked[0].sessie, null);
console.log("  ok  nog te rijden evenement -> geen sessie gekoppeld");

console.log("\nevenement zonder rit (afgezegd) blijft ook onvoltooid");
db.prepare("INSERT INTO events (id,name,date,type) VALUES (?,?,?,?)")
  .run("e3", "Afgezegde tocht", "2026-07-25", "Wielerevenement");
linked = linkEvents(db.prepare("SELECT * FROM events WHERE id='e3'").all());
assert.strictEqual(linked[0].voltooid, false);
console.log("  ok  geen rit op die datum -> niet als volbracht gemarkeerd");

console.log("\nAlle tests voor evenement-koppeling geslaagd.");
