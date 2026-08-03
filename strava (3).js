"use strict";
/**
 * The plan should stay stable unless there's a reason to change it. These
 * tests pin down the three mechanisms that make that true: locking, treating
 * a proposal as a change rather than a competitor, and remembering declines.
 */
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/stability-selftest-planStability";
require("node:fs").rmSync("/tmp/stability-selftest-planStability", { recursive: true, force: true });

const { db, initSchema } = require("../db/db");
initSchema();

const insertPlan = (id, date, type, desc, status = "gepland", locked = 0) =>
  db.prepare(`INSERT INTO planned_sessions (id,date,type,description,status,locked) VALUES (?,?,?,?,?,?)`)
    .run(id, date, type, desc, status, locked);

/** Mirrors the route's classification logic. */
function propose(entryId, items) {
  db.prepare("DELETE FROM planned_sessions WHERE status = 'voorgesteld'").run();
  const existingOnDate = db.prepare("SELECT * FROM planned_sessions WHERE date = ? AND status = 'gepland'");
  const out = { created: [], skipped: [] };
  items.forEach((p, i) => {
    const existing = existingOnDate.get(p.date);
    if (existing && existing.locked) {
      out.skipped.push({ datum: p.date, reden: "vast" });
      return;
    }
    const id = `plan-${entryId}-${i}`;
    db.prepare(`INSERT INTO planned_sessions (id,date,type,description,status,replaces_id)
                VALUES (?,?,?,?,'voorgesteld',?)`)
      .run(id, p.date, p.type, p.invulling, existing ? existing.id : null);
    out.created.push({ id, soort: existing ? "wijziging" : "nieuw", vervangt: existing?.id || null });
  });
  return out;
}

console.log("vaste afspraken worden met rust gelaten");
insertPlan("club-rit", "2026-08-08", "Fietsen", "clubrit, vaste afspraak", "gepland", 1);
let result = propose("coach-1", [{ date: "2026-08-08", type: "Fietsen", invulling: "intervallen" }]);
assert.strictEqual(result.created.length, 0, "voor een vaste dag mag niets voorgesteld worden");
assert.strictEqual(result.skipped.length, 1);
assert.ok(db.prepare("SELECT 1 FROM planned_sessions WHERE id='club-rit'").get(), "clubrit moet blijven staan");
console.log("  ok  coach stelt niets voor op een vastgezette dag");

console.log("\nwijziging versus nieuwe sessie");
insertPlan("bestaand", "2026-08-05", "Fietsen", "rustige duurrit");
result = propose("coach-2", [
  { date: "2026-08-05", type: "Fietsen", invulling: "toch intervallen, je herstel is goed" },
  { date: "2026-08-06", type: "Hardlopen", invulling: "herstelloop" },
]);
assert.strictEqual(result.created[0].soort, "wijziging", "dag met sessie -> wijziging");
assert.strictEqual(result.created[0].vervangt, "bestaand");
assert.strictEqual(result.created[1].soort, "nieuw", "lege dag -> nieuw");
console.log("  ok  bestaande dag = wijziging (met verwijzing), lege dag = nieuw");

console.log("\naccepteren van een wijziging vervangt in plaats van stapelt");
const change = db.prepare("SELECT * FROM planned_sessions WHERE replaces_id = 'bestaand'").get();
db.prepare("DELETE FROM planned_sessions WHERE id = ? AND locked = 0").run(change.replaces_id);
db.prepare("UPDATE planned_sessions SET status='gepland' WHERE id = ?").run(change.id);
const onThatDay = db.prepare("SELECT * FROM planned_sessions WHERE date='2026-08-05' AND status='gepland'").all();
assert.strictEqual(onThatDay.length, 1, "precies één sessie op die dag");
assert.ok(onThatDay[0].description.includes("intervallen"));
console.log("  ok  na accepteren precies 1 sessie, de oude is vervangen");

console.log("\nnegeren van een voorstel laat het bestaande plan intact");
insertPlan("blijft", "2026-08-12", "Fietsen", "duurrit die ik wil houden");
propose("coach-3", [{ date: "2026-08-12", type: "Fietsen", invulling: "iets anders" }]);
const stillThere = db.prepare("SELECT * FROM planned_sessions WHERE id='blijft'").get();
assert.strictEqual(stillThere.status, "gepland", "niets accepteren mag het plan niet aantasten");
console.log("  ok  een voorstel negeren verandert niets aan je planning");

console.log("\nafwijzingen worden onthouden");
const proposal = db.prepare("SELECT * FROM planned_sessions WHERE status='voorgesteld'").get();
db.prepare("UPDATE planned_sessions SET status='afgewezen', decline_reason=? WHERE id=?")
  .run("te zwaar na werk", proposal.id);
const declines = db.prepare("SELECT * FROM planned_sessions WHERE status='afgewezen'").all();
assert.strictEqual(declines.length, 1);
assert.strictEqual(declines[0].decline_reason, "te zwaar na werk");
console.log("  ok  afwijzing bewaard mét reden (coach krijgt dit mee)");

console.log("\nnieuw advies wist afwijzingen en vaste afspraken niet");
propose("coach-4", [{ date: "2026-08-20", type: "Fietsen", invulling: "nieuwe rit" }]);
assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM planned_sessions WHERE status='afgewezen'").get().c, 1);
assert.ok(db.prepare("SELECT 1 FROM planned_sessions WHERE id='club-rit'").get());
console.log("  ok  afwijzingen en vaste afspraken overleven nieuw advies");

console.log("\nAlle stabiliteitstests geslaagd.");
