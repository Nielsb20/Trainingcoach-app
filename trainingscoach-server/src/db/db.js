"use strict";

const path = require("node:path");
const fs = require("node:fs");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "..", "data");
const DB_PATH = path.join(DATA_DIR, "trainingscoach.db");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL"); // safer + faster for a server that writes frequently

function initSchema() {
  const schemaSql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");

  // Run statement by statement rather than as one exec(): CREATE TABLE IF NOT
  // EXISTS is idempotent, but ALTER TABLE ADD COLUMN is not, and SQLite has no
  // "IF NOT EXISTS" for it. On an already-migrated database those statements
  // are expected to fail, so we swallow exactly that failure and nothing else.
  const withoutComments = schemaSql
    .split("\n")
    .map((line) => (line.trim().startsWith("--") ? "" : line))
    .join("\n");

  const statements = withoutComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  statements.forEach((statement) => {
    try {
      db.exec(statement + ";");
    } catch (err) {
      const alreadyApplied =
        /duplicate column name/i.test(err.message) || /already exists/i.test(err.message);
      if (!alreadyApplied) {
        throw new Error(`Schema-migratie mislukt bij: ${statement.slice(0, 60)}... -> ${err.message}`);
      }
    }
  });
}

/**
 * Clears completion links that no longer mean anything.
 *
 * Twee gevallen. Een sessie die weer openstaat mag niet naar een training
 * blijven wijzen: dat hield die training bezet, zodat de automatische controle
 * hem nooit meer kon koppelen en de sessie eeuwig open bleef — precies het
 * symptoom van een rit die zich na "ongedaan maken" niet meer liet afvinken.
 *
 * En een sessie die verwijst naar een log die is verwijderd. Die stond op
 * "gedaan" met een rit die niet meer bestond: een vinkje zonder dekking, dat
 * wel meetelde in het opvolgingspercentage. Sinds kort halen de verwijderroutes
 * die koppeling zelf weg; dit ruimt op wat er daarvóór is ontstaan.
 */
function repairOrphanedCompletions() {
  const result = db
    .prepare(
      `UPDATE planned_sessions SET completed_cardio_log_id = NULL
       WHERE completed_cardio_log_id IS NOT NULL
         AND status IN ('gepland', 'voorgesteld')`
    )
    .run();
  if (result.changes > 0) {
    console.log(`[db] ${result.changes} openstaande sessie(s) losgekoppeld van hun oude training`);
  }

  const dangling = db
    .prepare(
      `UPDATE planned_sessions SET completed_cardio_log_id = NULL, status = 'gepland'
       WHERE completed_cardio_log_id IS NOT NULL
         AND completed_cardio_log_id NOT IN (SELECT id FROM cardio_logs)
         AND completed_cardio_log_id NOT IN (SELECT id FROM workout_logs)`
    )
    .run();
  if (dangling.changes > 0) {
    console.log(
      `[db] ${dangling.changes} sessie(s) stonden op 'gedaan' met een verwijderde training — weer opengezet`
    );
  }
}

module.exports = { db, initSchema, repairOrphanedCompletions, DB_PATH };
