"use strict";
/**
 * Pins down the duplicate-dates bug: an earlier version resolved a day
 * reference by weekday name alone, so "zaterdag 1 augustus" and
 * "zaterdag 8 augustus" both landed on the first Saturday — collapsing a
 * two-week plan into a week of duplicates.
 */
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/dates-selftest-dateResolution";
require("node:fs").rmSync("/tmp/dates-selftest-dateResolution", { recursive: true, force: true });

const { initSchema } = require("../db/db");
initSchema();
const { resolveDate, weekdayMismatch } = require("./planned");
const calc = require("../lib/calculations");

const TODAY = "2026-07-31"; // a Friday

console.log(`vandaag = ${TODAY} (${calc.weekdayNameForDate(TODAY)})`);
console.log("het echte geval uit de app:");
const proposals = [
  "Zaterdag 1 augustus",
  "Woensdag 5 augustus",
  "Zaterdag 8 augustus",
  "Maandag 10 augustus",
  "Woensdag 12 augustus",
];
const expected = ["2026-08-01", "2026-08-05", "2026-08-08", "2026-08-10", "2026-08-12"];

const resolved = proposals.map((p) => resolveDate(p, TODAY));
proposals.forEach((p, i) => {
  const weekday = calc.weekdayNameForDate(resolved[i]);
  const ok = resolved[i] === expected[i] ? "ok " : "FOUT";
  console.log(`  ${ok} "${p}" -> ${resolved[i]} (${weekday})`);
  assert.strictEqual(resolved[i], expected[i], `${p} zou ${expected[i]} moeten geven`);
});

const unique = new Set(resolved);
assert.strictEqual(unique.size, proposals.length, "elk voorstel hoort een eigen datum te krijgen");
console.log(`  ok  ${unique.size} unieke datums uit ${proposals.length} voorstellen (was: 3, met dubbelingen)`);

console.log("de weekdagen die de coach noemde kloppen ook echt:");
proposals.forEach((p, i) => {
  const mismatch = weekdayMismatch(p, resolved[i]);
  assert.strictEqual(mismatch, null, `${p} zou geen conflict moeten geven`);
});
console.log("  ok  geen enkele weekdag/datum-combinatie is tegenstrijdig");

console.log("overige formaten:");
const cases = [
  ["2026-09-15", "2026-09-15", "expliciete ISO-datum"],
  ["10 aug", "2026-08-10", "afgekorte maand"],
  ["1 augustus 2027", "2027-08-01", "expliciet jaar"],
  ["Woensdag", "2026-08-05", "alleen weekdag -> eerstvolgende"],
  ["Vrijdag", "2026-07-31", "vandaag telt mee"],
  ["ergens deze week", null, "onherkenbaar -> null, geen gokdatum"],
];
cases.forEach(([input, exp, label]) => {
  const actual = resolveDate(input, TODAY);
  assert.strictEqual(actual, exp, `"${input}": verwacht ${exp}, kreeg ${actual}`);
  console.log(`  ok  "${input}" -> ${actual}  (${label})`);
});

console.log("jaargrens:");
assert.strictEqual(resolveDate("5 januari", "2026-12-20"), "2027-01-05");
console.log("  ok  '5 januari' vanuit december -> volgend jaar");

console.log("tegenstrijdige combinatie wordt gemeld:");
const bad = resolveDate("Maandag 12 augustus", TODAY);
const mismatch = weekdayMismatch("Maandag 12 augustus", bad);
assert.strictEqual(bad, "2026-08-12", "de datum wint, want die is specifieker");
assert.ok(mismatch, "maar het conflict moet wel gesignaleerd worden");
console.log(`  ok  datum ${bad} gevolgd; gemeld: coach zei ${mismatch.genoemd}, is ${mismatch.werkelijk}`);

console.log("Alle datumtests geslaagd.");
