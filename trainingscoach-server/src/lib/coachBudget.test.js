"use strict";
/**
 * The budget only earns its place if it actually refuses. These tests drive it
 * against a controlled clock rather than sleeping, so they stay fast and don't
 * depend on wall-clock timing.
 */
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/coachbudget-selftest";
require("node:fs").rmSync("/tmp/coachbudget-selftest", { recursive: true, force: true });

const budget = require("./coachBudget");

const at = (iso) => new Date(iso);

console.log("een enkele aanvraag gaat gewoon door");
budget.reset();
budget.claim(at("2026-08-05T10:00:00"));
assert.strictEqual(budget.status(at("2026-08-05T10:00:00")).aanvragenVandaag, 1);
console.log("  ok  eerste aanvraag toegestaan");

console.log("\ntwee aanvragen vlak achter elkaar worden geweigerd");
assert.throws(
  () => budget.claim(at("2026-08-05T10:00:02")),
  (err) => err.status === 429 && /seconden/.test(err.message),
  "binnen de minimumtussentijd hoort een 429 te komen"
);
console.log("  ok  burst tegengehouden met een 429 en een wachttijd in de melding");

console.log("\nna de wachttijd mag het weer");
budget.claim(at("2026-08-05T10:00:20"));
assert.strictEqual(budget.status(at("2026-08-05T10:00:20")).aanvragenVandaag, 2);
console.log("  ok  ruim na de tussentijd weer toegestaan");

console.log("\neen vastgelopen lus loopt tegen het dagmaximum aan");
budget.reset();
let minute = 0;
let toegestaan = 0;
let geweigerd = null;
for (let i = 0; i < budget.MAX_CALLS_PER_DAY + 10; i++) {
  // Ruim uit elkaar, zodat alleen het dagmaximum kan afgaan en niet de tussentijd.
  const tijd = new Date(`2026-08-05T00:00:00`);
  tijd.setMinutes(minute++);
  try {
    budget.claim(tijd);
    toegestaan++;
  } catch (err) {
    geweigerd = err;
    break;
  }
}
assert.strictEqual(toegestaan, budget.MAX_CALLS_PER_DAY, `er horen er ${budget.MAX_CALLS_PER_DAY} door te komen`);
assert.strictEqual(geweigerd.status, 429);
assert.match(geweigerd.message, /automatische taak/, "de melding hoort te wijzen op de waarschijnlijke oorzaak");
console.log(`  ok  gestopt na ${toegestaan} aanvragen op één dag`);

console.log("\nde volgende dag begint met een schone lei");
budget.claim(at("2026-08-06T09:00:00"));
assert.strictEqual(budget.status(at("2026-08-06T09:00:00")).aanvragenVandaag, 1);
console.log("  ok  teller loopt per dag, niet per proces");

console.log("\nAlle budgettests geslaagd.");
