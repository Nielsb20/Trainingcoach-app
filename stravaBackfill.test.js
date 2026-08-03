"use strict";
const assert = require("node:assert");
const calc = require("./calculations");

console.log("computeHistogram");
{
  // 100 seconds at 150 bpm, then 100 seconds at 160 bpm
  const time = [], hr = [];
  for (let t = 0; t <= 200; t++) { time.push(t); hr.push(t < 100 ? 150 : 160); }
  const hist = calc.computeHistogram(time, hr, 1);
  assert.strictEqual(hist["150"], 100, `150 bpm zou 100s moeten zijn, was ${hist["150"]}`);
  assert.strictEqual(hist["160"], 100, `160 bpm zou 100s moeten zijn, was ${hist["160"]}`);
  console.log("  ok  seconden per hartslagwaarde kloppen");
  assert.strictEqual(calc.histogramTotalSeconds(hist), 200);
  console.log("  ok  totaal = 200s");
}
{
  // A 5-minute gap (auto-pause) must not be charged to the preceding value
  const hist = calc.computeHistogram([0, 10, 310, 320], [100, 100, 100, 100], 1);
  assert.strictEqual(calc.histogramTotalSeconds(hist), 20, "gat van 300s moet genegeerd worden");
  console.log("  ok  lange onderbreking (auto-pauze) wordt niet meegeteld");
}

console.log("\ntimeInHrZones");
{
  const zones = calc.computeHrZones(185, 52);
  console.log("  zones:", zones.map(z => `Z${z.zone} ${z.vanBpm}-${z.totBpm}`).join(" | "));
  const time = [], hr = [];
  // 60s in zone 2, 120s in zone 4
  for (let t = 0; t < 60; t++) { time.push(t); hr.push(zones[1].vanBpm + 2); }
  for (let t = 60; t <= 180; t++) { time.push(t); hr.push(zones[3].vanBpm + 2); }
  const hist = calc.computeHistogram(time, hr, 1);
  const inZones = calc.timeInHrZones(hist, zones);
  inZones.forEach(z => { if (z.seconden > 0) console.log(`  Z${z.zone} ${z.naam}: ${z.seconden}s`); });
  assert.ok(inZones[1].seconden >= 55 && inZones[1].seconden <= 65, "zone 2 rond 60s");
  assert.ok(inZones[3].seconden >= 115, "zone 4 rond 120s");
  console.log("  ok  tijd verdeeld over de juiste zones");
}
{
  // The same histogram must re-bucket when zones change - the whole point of storing histograms
  const hist = calc.computeHistogram([0,1,2,3,4,5], [150,150,150,150,150,150], 1);
  const a = calc.timeInHrZones(hist, calc.computeHrZones(185, 52));
  const b = calc.timeInHrZones(hist, calc.computeHrZones(200, 52));
  const zoneA = a.findIndex(z => z.seconden > 0);
  const zoneB = b.findIndex(z => z.seconden > 0);
  assert.notStrictEqual(zoneA, zoneB, "andere max HR hoort in een andere zone te vallen");
  console.log(`  ok  150 bpm valt in Z${zoneA+1} bij max 185, in Z${zoneB+1} bij max 200 (herberekening werkt)`);
}

console.log("\ncomputePowerCurve");
{
  // 10 min at 200 W with a single 30-second 400 W burst in the middle
  const time = [], watts = [];
  for (let t = 0; t <= 600; t++) { time.push(t); watts.push(t >= 300 && t < 330 ? 400 : 200); }
  const curve = calc.computePowerCurve(time, watts);
  console.log("  curve:", Object.entries(curve).map(([d,w]) => `${d}s=${w}W`).join(" "));
  assert.strictEqual(curve[5], 400, "beste 5s moet de piek van 400W zijn");
  assert.strictEqual(curve[30], 400, "beste 30s moet precies de 400W-blok zijn");
  assert.ok(curve[60] > 200 && curve[60] < 400, "beste 60s ligt tussen piek en basis");
  assert.ok(curve[300] > 200 && curve[300] < 250, "beste 5min iets boven de basis");
  console.log("  ok  pieken correct gevonden per tijdsduur");
}

console.log("\nestimateFtpFromCurve");
{
  assert.strictEqual(calc.estimateFtpFromCurve({ 1200: 300 }).ftp, 285, "95% van 300 = 285");
  console.log("  ok  20-min basis -> FTP", calc.estimateFtpFromCurve({ 1200: 300 }).ftp, "W");
  assert.strictEqual(calc.estimateFtpFromCurve({ 3600: 260, 1200: 300 }).ftp, 260, "echte 60min wint");
  console.log("  ok  gemeten 60 minuten krijgt voorrang boven schatting");
  assert.strictEqual(calc.estimateFtpFromCurve(null), null);
  console.log("  ok  geen data -> null (geen verzonnen getal)");
}

console.log("\nmergePowerCurves");
{
  const merged = calc.mergePowerCurves([{ 5: 400, 1200: 280 }, { 5: 380, 1200: 305 }, null]);
  assert.strictEqual(merged[5], 400);
  assert.strictEqual(merged[1200], 305);
  console.log("  ok  beste waarde per duur over meerdere ritten:", JSON.stringify(merged));
}

console.log("\nAlle analysetests geslaagd.");
