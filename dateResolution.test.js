"use strict";
// Test the Strava -> session conversion with a realistic interval workout.
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/stravatest-strava";
require("node:fs").rmSync("/tmp/stravatest-strava", { recursive: true, force: true });
const strava = require("./strava");

// --- sport type mapping ---
const mappings = [
  ["Ride", "Fietsen"], ["VirtualRide", "Fietsen"], ["Run", "Hardlopen"],
  ["TrailRun", "Hardlopen"], ["Swim", "Zwemmen"], ["Walk", "Wandelen"],
  ["Hike", "Wandelen"], ["WeightTraining", "Anders"],
];
console.log("Sport-type mapping:");
for (const [input, expected] of mappings) {
  const actual = strava.mapSportType(input);
  assert.strictEqual(actual, expected, `${input} -> verwacht ${expected}, kreeg ${actual}`);
  console.log(`  ok  ${input.padEnd(16)} -> ${actual}`);
}
assert.strictEqual(strava.isStrengthActivity("WeightTraining"), true);
assert.strictEqual(strava.isStrengthActivity("Ride"), false);
console.log("  ok  krachttraining wordt herkend");

// --- build a synthetic 20-minute interval ride: 5x (1min @350W / 1min @100W) ---
const time = [], watts = [], hr = [], cadence = [], altitude = [], velocity = [];
for (let cycle = 0; cycle < 10; cycle++) {
  const hard = cycle % 2 === 0;
  for (let s = 0; s < 60; s++) {
    time.push(cycle * 60 + s);
    watts.push(hard ? 350 : 100);
    hr.push(hard ? 170 : 130);
    cadence.push(hard ? 95 : 75);
    altitude.push(10 + cycle * 2);
    velocity.push(hard ? 11.1 : 6.9); // m/s
  }
}
const streams = {
  time: { data: time }, watts: { data: watts }, heartrate: { data: hr },
  cadence: { data: cadence }, altitude: { data: altitude }, velocity_smooth: { data: velocity },
};

const activity = {
  id: 987654321,
  name: "Intervaltraining",
  sport_type: "Ride",
  start_date_local: "2026-07-28T07:30:00Z",
  moving_time: 600,      // 10 min
  elapsed_time: 720,     // 12 min (2 min stilstand)
  distance: 5400,        // meters
  total_elevation_gain: 42,
  average_heartrate: 150,
  max_heartrate: 175,
  average_watts: 225,
  max_watts: 350,
  average_cadence: 85,
  calories: 180,
  // weighted_average_watts bewust weggelaten -> moet zelf berekend worden
};

const session = strava.stravaToSession(activity, streams);

console.log("\nOmzetting naar sessie:");
console.log(`  id:              ${session.id}`);
console.log(`  datum:           ${session.date}`);
console.log(`  moment:          ${session.timeOfDay}`);
console.log(`  type:            ${session.type}`);
console.log(`  duur (bewegen):  ${session.duration_min} min`);
console.log(`  duur (totaal):   ${session.total_duration_min} min`);
console.log(`  afstand:         ${session.distance_km} km`);
console.log(`  hartslag:        ${session.avg_hr}/${session.max_hr} bpm`);
console.log(`  vermogen:        ${session.avg_power}/${session.max_power} W`);
console.log(`  NP (berekend):   ${session.weighted_avg_power} W`);
console.log(`  cadans:          ${session.avg_cadence}`);
console.log(`  hoogtemeters:    ${session.elevation_gain_m} m`);
console.log(`  profiel-punten:  ${session.profile.length}`);

assert.strictEqual(session.id, "strava-987654321");
assert.strictEqual(session.date, "2026-07-28");
assert.strictEqual(session.type, "Fietsen");
assert.strictEqual(session.duration_min, 10);
assert.strictEqual(session.total_duration_min, 12);
assert.strictEqual(session.distance_km, 5.4);
assert.ok(session.profile.length >= 4, "profiel moet buckets bevatten");

// NP of a 350/100 alternating effort must land well above the 225 W plain average
assert.ok(session.weighted_avg_power > 250,
  `NP (${session.weighted_avg_power}) hoort duidelijk boven het gemiddelde van 225 te liggen`);
console.log(`  ok  NP ${session.weighted_avg_power} W > gemiddelde 225 W (intervalkarakter herkend)`);

// The profile should show the interval structure alternating
const powers = session.profile.map(p => p.gemVermogen);
console.log(`\nVermogensverloop per bucket: ${powers.join(", ")} W`);
const spread = Math.max(...powers) - Math.min(...powers);
assert.ok(spread > 100, `verloop moet wisselend zijn, spreiding was ${spread}`);
console.log(`  ok  spreiding ${spread} W -> intervalpatroon zichtbaar in het verloop`);

// Speed conversion m/s -> km/h
const speeds = session.profile.map(p => p.gemSnelheidKmu);
console.log(`Snelheidsverloop: ${speeds.join(", ")} km/u`);
assert.ok(Math.max(...speeds) > 35 && Math.max(...speeds) < 45, "11.1 m/s hoort ~40 km/u te zijn");
console.log("  ok  m/s correct omgerekend naar km/u");

console.log("\nAlle Strava-conversietests geslaagd.");
