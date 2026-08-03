"use strict";
/**
 * These thresholds decide when the athlete gets interrupted. Too eager and the
 * app nags after every ride; too conservative and it stays quiet through an
 * overtraining spiral. Both failure modes are tested here.
 */
const assert = require("node:assert");
const { detectSignals, shouldConsult, isWeeklySlotDue } = require("./automation");
const { weekdayNameForDate } = require("./calculations");

const TODAY = "2026-08-01";
const daysBefore = (n) => { const d = new Date(TODAY + "T00:00:00"); d.setDate(d.getDate() - n); return d.toISOString().slice(0,10); };
const loadAt = (tsb) => [{ date: TODAY, ctl: 40, atl: 40 - tsb, tsb }];

console.log("een normale week hoort NIETS te melden");
{
  const wellness = Array.from({ length: 20 }, (_, i) => ({ date: daysBefore(i), resting_hr: 48, hrv_ms: 60 }));
  const signals = detectSignals({ loadSeries: loadAt(-5), wellness, plans: [], events: [], today: TODAY });
  assert.strictEqual(signals.length, 0, `rustige week gaf toch: ${signals.map(s=>s.code)}`);
  console.log("  ok  gewone week, TSB -5, stabiel herstel -> geen signaal");
}

console.log("\nopgebouwde vermoeidheid wordt wel opgemerkt");
{
  const signals = detectSignals({ loadSeries: loadAt(-29), wellness: [], plans: [], events: [], today: TODAY });
  assert.ok(signals.some(s => s.code === "tsb_laag"));
  console.log("  ok  TSB -29 ->", signals.find(s=>s.code==="tsb_laag").reason);
}
{
  // Just below the threshold must stay quiet — no hair-trigger
  const signals = detectSignals({ loadSeries: loadAt(-24), wellness: [], plans: [], events: [], today: TODAY });
  assert.strictEqual(signals.length, 0);
  console.log("  ok  TSB -24 (net boven de grens) -> nog geen signaal");
}

console.log("\nherstel wordt tegen je eigen basislijn gemeten");
{
  // Baseline 48, last two days 54 -> clearly elevated
  const wellness = [
    { date: daysBefore(0), resting_hr: 54, hrv_ms: 60 },
    { date: daysBefore(1), resting_hr: 55, hrv_ms: 60 },
    ...Array.from({ length: 18 }, (_, i) => ({ date: daysBefore(i + 2), resting_hr: 48, hrv_ms: 60 })),
  ];
  const signals = detectSignals({ loadSeries: null, wellness, plans: [], events: [], today: TODAY });
  assert.ok(signals.some(s => s.code === "rusthartslag_hoog"));
  console.log("  ok  rusthartslag 54-55 vs basislijn 48 ->", signals.find(s=>s.code==="rusthartslag_hoog").reason);
}
{
  // One bad night is not a signal
  const wellness = [
    { date: daysBefore(0), resting_hr: 56, hrv_ms: 60 },
    ...Array.from({ length: 19 }, (_, i) => ({ date: daysBefore(i + 1), resting_hr: 48, hrv_ms: 60 })),
  ];
  const signals = detectSignals({ loadSeries: null, wellness, plans: [], events: [], today: TODAY });
  assert.ok(!signals.some(s => s.code === "rusthartslag_hoog"), "één afwijkende nacht mag geen alarm geven");
  console.log("  ok  één slechte nacht -> geen signaal (pas bij 2 dagen op rij)");
}
{
  const wellness = [
    { date: daysBefore(0), resting_hr: 48, hrv_ms: 50 },
    { date: daysBefore(1), resting_hr: 48, hrv_ms: 51 },
    ...Array.from({ length: 18 }, (_, i) => ({ date: daysBefore(i + 2), resting_hr: 48, hrv_ms: 62 })),
  ];
  const signals = detectSignals({ loadSeries: null, wellness, plans: [], events: [], today: TODAY });
  assert.ok(signals.some(s => s.code === "hrv_laag"));
  console.log("  ok  HRV 50-51 vs basislijn 62 -> signaal");
}

console.log("\nte lang uitgerust telt ook als signaal, maar pas na 10 dagen");
{
  const long = Array.from({ length: 10 }, (_, i) => ({ date: daysBefore(9-i), ctl: 30, atl: 5, tsb: 25 }));
  let signals = detectSignals({ loadSeries: long, wellness: [], plans: [], events: [], today: TODAY });
  assert.ok(signals.some(s => s.code === "tsb_hoog"));
  console.log("  ok  10 dagen TSB +25 -> ruimte om op te bouwen");
  signals = detectSignals({ loadSeries: long.slice(-4), wellness: [], plans: [], events: [], today: TODAY });
  assert.ok(!signals.some(s => s.code === "tsb_hoog"), "een paar rustdagen na een blok is normaal");
  console.log("  ok  4 rustdagen na een zwaar blok -> geen signaal");
}

console.log("\ngemiste sessies en naderende evenementen");
{
  const plans = [
    { date: daysBefore(2), status: "overgeslagen" },
    { date: daysBefore(4), status: "overgeslagen" },
    { date: daysBefore(30), status: "overgeslagen" }, // te oud, telt niet mee
  ];
  const signals = detectSignals({ loadSeries: null, wellness: [], plans, events: [], today: TODAY });
  const missed = signals.find(s => s.code === "gemiste_sessies");
  assert.ok(missed && missed.reason.includes("2 geplande"), "alleen de laatste week telt");
  console.log("  ok  2 gemiste sessies deze week ->", missed.reason);
}
{
  const events = [{ name: "Rondje IJsselmeer", date: "2026-08-10", daysUntil: 9 }];
  const signals = detectSignals({ loadSeries: null, wellness: [], plans: [], events, today: TODAY });
  assert.ok(signals.some(s => s.code === "evenement_nadert"));
  console.log("  ok  evenement over 9 dagen ->", signals.find(s=>s.code==="evenement_nadert").reason);
}

console.log("\nwachttijd voorkomt dagelijks dezelfde melding");
{
  const signals = [{ code: "tsb_laag", severity: "hoog", reason: "TSB is -29." }];
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);

  let r = shouldConsult({ signals, lastRunAt: yesterday.toISOString(), lastReason: "tsb_laag", cooldownDays: 3 });
  assert.strictEqual(r.consult, false, "zelfde signaal binnen de wachttijd -> niet opnieuw vragen");
  console.log("  ok  zelfde signaal, 1 dag later ->", r.skipped);

  const longAgo = new Date(); longAgo.setDate(longAgo.getDate() - 5);
  r = shouldConsult({ signals, lastRunAt: longAgo.toISOString(), lastReason: "tsb_laag", cooldownDays: 3 });
  assert.strictEqual(r.consult, true, "na de wachttijd mag het weer");
  console.log("  ok  zelfde signaal, 5 dagen later -> wel opnieuw vragen");

  r = shouldConsult({ signals, lastRunAt: yesterday.toISOString(), lastReason: "gemiste_sessies", cooldownDays: 3 });
  assert.strictEqual(r.consult, true, "een ander signaal is nieuw nieuws");
  console.log("  ok  ander signaal binnen wachttijd -> wel vragen (er is iets nieuws)");

  r = shouldConsult({ signals: [], lastRunAt: null, cooldownDays: 3 });
  assert.strictEqual(r.consult, false);
  console.log("  ok  geen signalen -> niets doen");
}

console.log("\nernstigste bevinding komt vooraan te staan");
{
  const signals = [
    { code: "evenement_nadert", severity: "gemiddeld", reason: "Evenement nadert." },
    { code: "tsb_laag", severity: "hoog", reason: "TSB is -29." },
  ];
  const r = shouldConsult({ signals, lastRunAt: null, cooldownDays: 3 });
  assert.ok(r.reason.startsWith("TSB is -29"), "hoge ernst eerst");
  console.log("  ok  \"" + r.reason + "\"");
}

console.log("\nwekelijkse afspraak draait één keer per week");
{
  const sunday = new Date("2026-08-02T20:00:00"); // een zondag
  assert.strictEqual(weekdayNameForDate("2026-08-02"), "Zondag");

  let due = isWeeklySlotDue({ weekday: "Zondag", hour: 19, lastRunAt: null, now: sunday, weekdayNameForDate });
  assert.strictEqual(due, true);
  console.log("  ok  zondag 20:00, ingesteld op 19:00 -> nu draaien");

  due = isWeeklySlotDue({ weekday: "Zondag", hour: 19, lastRunAt: null, now: new Date("2026-08-02T15:00:00"), weekdayNameForDate });
  assert.strictEqual(due, false);
  console.log("  ok  zondag 15:00 -> nog te vroeg");

  due = isWeeklySlotDue({ weekday: "Zondag", hour: 19, lastRunAt: "2026-08-02T19:05:00", now: new Date("2026-08-02T21:00:00"), weekdayNameForDate });
  assert.strictEqual(due, false, "een herstart van de server mag geen tweede run geven");
  console.log("  ok  al gedraaid vanavond -> niet nog een keer");

  due = isWeeklySlotDue({ weekday: "Zondag", hour: 19, lastRunAt: null, now: new Date("2026-08-03T20:00:00"), weekdayNameForDate });
  assert.strictEqual(due, false);
  console.log("  ok  maandag -> niet de ingestelde dag");
}

console.log("\nAlle automatiseringstests geslaagd.");
