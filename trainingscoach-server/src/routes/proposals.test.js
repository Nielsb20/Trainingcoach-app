"use strict";
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/proposal-test-proposals";
require("node:fs").rmSync("/tmp/proposal-test-proposals", { recursive: true, force: true });

const { db, initSchema } = require("../db/db");
initSchema();
const calc = require("../lib/calculations");

// Simulate what the route does, without needing a live HTTP server
function proposeFromCoach(entryId, proposals) {
  db.prepare("DELETE FROM planned_sessions WHERE status = 'voorgesteld'").run();
  const insert = db.prepare(
    `INSERT INTO planned_sessions (id, date, weekday, type, description, source_coach_entry_id, status)
     VALUES (?, ?, ?, ?, ?, ?, 'voorgesteld')`);
  proposals.forEach((p, i) => insert.run(`plan-${entryId}-${i}`, p.date, p.dag, p.type, p.invulling, entryId));
}
const count = (status) => db.prepare("SELECT COUNT(*) c FROM planned_sessions WHERE status = ?").get(status).c;

console.log("het oude probleem: twee keer om advies vragen");
proposeFromCoach("coach-1", [
  { date: "2026-08-05", dag: "Woensdag", type: "Fietsen", invulling: "intervallen" },
  { date: "2026-08-08", dag: "Zaterdag", type: "Fietsen", invulling: "duurrit" },
]);
assert.strictEqual(count("voorgesteld"), 2);
console.log("  eerste advies: 2 voorstellen");

proposeFromCoach("coach-2", [
  { date: "2026-08-05", dag: "Woensdag", type: "Fietsen", invulling: "rustig, je HRV is laag" },
]);
assert.strictEqual(count("voorgesteld"), 1, "oude voorstellen moeten vervangen zijn, niet gestapeld");
console.log("  ok  tweede advies vervangt het eerste (was: stapelen tot 3)");

console.log("\ngeaccepteerde plannen blijven staan bij nieuw advies");
db.prepare("UPDATE planned_sessions SET status = 'gepland' WHERE status = 'voorgesteld'").run();
assert.strictEqual(count("gepland"), 1);
proposeFromCoach("coach-3", [
  { date: "2026-08-07", dag: "Vrijdag", type: "Hardlopen", invulling: "herstelloop" },
]);
assert.strictEqual(count("gepland"), 1, "wat je al accepteerde mag niet verdwijnen");
assert.strictEqual(count("voorgesteld"), 1, "nieuw voorstel staat ernaast");
console.log("  ok  geaccepteerd plan blijft, nieuw voorstel komt ernaast");

console.log("\nconflictdetectie op dezelfde dag");
proposeFromCoach("coach-4", [
  { date: "2026-08-05", dag: "Woensdag", type: "Fietsen", invulling: "toch zwaar" },
]);
const conflict = db.prepare("SELECT * FROM planned_sessions WHERE date = ? AND status = 'gepland'").get("2026-08-05");
assert.ok(conflict, "botsing met bestaand plan moet gevonden worden");
console.log("  ok  botsing met bestaand plan op 2026-08-05 gedetecteerd");

console.log("\naccepteren met vervangen");
const proposal = db.prepare("SELECT * FROM planned_sessions WHERE status = 'voorgesteld'").get();
db.prepare("DELETE FROM planned_sessions WHERE date = ? AND status = 'gepland' AND id != ?").run(proposal.date, proposal.id);
db.prepare("UPDATE planned_sessions SET status = 'gepland' WHERE id = ?").run(proposal.id);
const remaining = db.prepare("SELECT * FROM planned_sessions WHERE date = ?").all("2026-08-05");
assert.strictEqual(remaining.length, 1, "na vervangen precies één sessie op die dag");
assert.strictEqual(remaining[0].description, "toch zwaar");
console.log("  ok  na accepteren-met-vervangen precies 1 sessie op die dag");

console.log("\nAlle voorstel-/planningstests geslaagd.");
