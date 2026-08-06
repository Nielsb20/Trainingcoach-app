"use strict";
/**
 * End-to-end check of an automatic run, with the language model stubbed out.
 * The properties that matter: an automatic run produces *proposals* (never
 * committed sessions), records why it ran, and leaves anything already
 * committed or locked alone.
 */
const assert = require("node:assert");
process.env.DATA_DIR = "/tmp/scheduler-selftest-scheduler";
process.env.GEMINI_API_KEY = "test";
require("node:fs").rmSync("/tmp/scheduler-selftest-scheduler", { recursive: true, force: true });

const { db, initSchema } = require("../db/db");
initSchema();

// Stand in for the model: a fixed, well-formed answer.
global.fetch = async () => ({
  ok: true,
  json: async () => ({
    candidates: [{
      content: { parts: [{ text: JSON.stringify({
        analyse: "Je bent zwaar belast na de lange rit.",
        tips: ["Hydrateer goed"],
        waarschuwing: "TSB laag",
        cardioVoorstel: [{ dag: "2026-08-05", type: "Fietsen", invulling: "herstelrit 45 min" }],
        krachtVoorstel: [{ dag: "2026-08-04", schemaDag: "Dag A", invulling: "één set minder" }],
      })}] },
      finishReason: "STOP",
    }],
  }),
});

const calc = require("./calculations");
const scheduler = require("./scheduler");

// A schema so the coach has something to plan against
db.prepare("INSERT INTO schema_days (id,name,sort_order,weekdays) VALUES (?,?,?,?)").run("d1","Dag A",0,"Dinsdag");
db.prepare("INSERT INTO schema_exercises (id,day_id,name,target_sets,target_reps,sort_order) VALUES (?,?,?,?,?,?)")
  .run("e1","d1","Squat",3,5,0);

// Something the athlete already committed to and locked — must survive untouched
db.prepare("INSERT INTO planned_sessions (id,date,type,description,status,discipline,locked) VALUES (?,?,?,?,?,?,?)")
  .run("vast", "2026-08-04", "Dag A", "mijn eigen clubtraining", "gepland", "kracht", 1);

(async () => {
  console.log("automatische wekelijkse run");
  await scheduler.runWeekly(db.prepare("SELECT * FROM coach_automation WHERE id=1").get());

  const entry = db.prepare("SELECT * FROM coach_history ORDER BY date DESC LIMIT 1").get();
  assert.ok(entry, "er moet een coachantwoord zijn opgeslagen");
  assert.strictEqual(entry.trigger_type, "wekelijks");
  assert.strictEqual(entry.trigger_reason, "Wekelijkse planning");
  console.log(`  ok  antwoord opgeslagen met aanleiding "${entry.trigger_reason}"`);

  const proposals = db.prepare("SELECT * FROM planned_sessions WHERE status='voorgesteld'").all();
  assert.ok(proposals.length > 0, "er moeten voorstellen zijn aangemaakt");
  console.log(`  ok  ${proposals.length} voorstel(len) aangemaakt`);

  const committed = db.prepare("SELECT * FROM planned_sessions WHERE status='gepland'").all();
  assert.strictEqual(committed.length, 1, "alleen de bestaande sessie mag 'gepland' zijn");
  assert.strictEqual(committed[0].id, "vast");
  console.log("  ok  niets automatisch geaccepteerd — de planning is niet gewijzigd");

  const locked = db.prepare("SELECT * FROM planned_sessions WHERE id='vast'").get();
  assert.strictEqual(locked.description, "mijn eigen clubtraining", "vastgezette sessie moet ongewijzigd blijven");
  const onLockedDay = proposals.filter((p) => p.date === "2026-08-04" && p.discipline === "kracht");
  assert.strictEqual(onLockedDay.length, 0, "voor een vastgezette dag mag niets voorgesteld worden");
  console.log("  ok  vastgezette dinsdag ongemoeid, geen voorstel voor die dag");

  const lastRun = db.prepare("SELECT last_weekly_run FROM coach_automation WHERE id=1").get();
  assert.ok(lastRun.last_weekly_run, "tijdstip van de run moet vastgelegd zijn");
  console.log("  ok  tijdstip vastgelegd (voorkomt dubbele run bij herstart)");

  console.log("\nfout tijdens een automatische run legt de server niet plat");
  // The error path only runs if something actually triggers, so create a
  // genuine signal first: a hard ride today with no FTP means a big hrTSS spike.
  db.prepare("INSERT INTO profile (id,max_hr,resting_hr,ftp) VALUES (1,185,50,250) ON CONFLICT(id) DO UPDATE SET max_hr=185, ftp=250").run();
  for (let i = 0; i < 14; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    db.prepare("INSERT INTO cardio_logs (id,date,type,duration_min,avg_power) VALUES (?,?,?,?,?)")
      .run("ride" + i, calc.toDateStr(d), "Fietsen", 180, 240);
  }
  const state = scheduler.gatherState();
  const { detectSignals } = require("./automation");
  assert.ok(detectSignals(state).length > 0, "testopzet: er moet nu een signaal zijn");

  global.fetch = async () => { throw new Error("netwerk weg"); };
  db.prepare("UPDATE coach_automation SET weekly_enabled=0, signals_enabled=1 WHERE id=1").run();
  // The weekly run above already spent a slot from the coach budget, and these
  // two scenarios run milliseconds apart. Without a reset this would assert on
  // a rate-limit message instead of the network failure it means to test.
  require("./coachBudget").reset();
  await scheduler.tick(); // must not throw
  const err = db.prepare("SELECT last_error FROM coach_automation WHERE id=1").get();
  assert.ok(err.last_error && err.last_error.includes("netwerk weg"), "fout moet zichtbaar zijn voor de gebruiker");
  console.log("  ok  fout opgevangen en bewaard:", err.last_error.split(": ").pop());

  console.log("\nAlle schedulertests geslaagd.");
})();
