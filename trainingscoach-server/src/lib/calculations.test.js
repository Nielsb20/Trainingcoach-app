/**
 * Minimal smoke tests for calculations.js — no test framework dependency,
 * just plain Node assertions so this runs with `node calculations.test.js`
 * with zero npm install required.
 */
"use strict";

const assert = require("node:assert");
const calc = require("./calculations");

let passed = 0;
function check(label, actual, expected) {
  assert.strictEqual(actual, expected, `${label}: expected ${expected}, got ${actual}`);
  passed++;
  console.log(`  ok  ${label} = ${actual}`);
}

console.log("weekdayNameForDate");
check("2026-07-20", calc.weekdayNameForDate("2026-07-20"), "Maandag");
check("2026-07-23", calc.weekdayNameForDate("2026-07-23"), "Donderdag");
check("2026-07-30", calc.weekdayNameForDate("2026-07-30"), "Donderdag");

console.log("computeHrZones (Karvonen, max 185 / rust 52)");
const hrZones = calc.computeHrZones(185, 52);
check("zone3.vanBpm", hrZones[2].vanBpm, 145);
check("zone3.totBpm", hrZones[2].totBpm, 158);

console.log("computePowerZones (FTP 250)");
const powerZones = calc.computePowerZones(250);
check("zone4.vanW", powerZones[3].vanW, 228);
check("zone4.totW", powerZones[3].totW, 263);

console.log("computeAvgSpeedKmh");
check("50.94km / 110.15min", calc.computeAvgSpeedKmh(50.94, 110.15), 27.7);

console.log("computeSessionTSS (power-based)");
const tss1 = calc.computeSessionTSS({ duration_min: 60, avg_power: 250 }, 250, null);
check("1u op exact FTP -> TSS", tss1.tss, 100);

console.log("computeTrainingLoadSeries (build-up then rest week)");
const days = [];
for (let w = 0; w < 4; w++) {
  for (let d = 0; d < 7; d++) days.push({ date: "", tss: d < 5 ? 80 : 0 });
}
for (let d = 0; d < 7; d++) days.push({ date: "", tss: 0 });
// build synthetic cardioLogs with real dates counting back from today
const today = new Date();
const cardioLogs = [];
days.forEach((d, i) => {
  const date = new Date(today);
  date.setDate(date.getDate() - (days.length - 1 - i));
  const dateStr = calc.toDateStr(date);
  if (d.tss > 0) cardioLogs.push({ date: dateStr, duration_min: 60, avg_power: Math.round(Math.sqrt(d.tss / 100) * 250) });
});
const series = calc.computeTrainingLoadSeries(cardioLogs, 250, null);
const last = series[series.length - 1];
console.log(`  latest CTL/ATL/TSB: ${JSON.stringify(last)}`);
assert.ok(series.length > 0, "training load series should not be empty");
passed++;

console.log("computeElevationGainLoss (climb + noise)");
const elevations = [];
for (let i = 0; i <= 50; i++) elevations.push(i * 2 + (Math.random() * 0.6 - 0.3));
const elev = calc.computeElevationGainLoss(elevations);
console.log(`  gain=${elev.gain} loss=${elev.loss} (expect gain ~100, loss ~0)`);
assert.ok(elev.gain > 95 && elev.gain < 105, "elevation gain should be close to 100m");
passed++;

console.log("getWeightAtDate (historical weight, not latest)");
const weightLogs = [
  { id: "a", date: "2026-06-01", weight_kg: 80 },
  { id: "b", date: "2026-07-01", weight_kg: 76 },
];
check("weight on 2026-06-15", calc.getWeightAtDate(weightLogs, "2026-06-15"), 80);
check("weight on 2026-07-15", calc.getWeightAtDate(weightLogs, "2026-07-15"), 76);

console.log(`\nAll ${passed} checks passed.`);
