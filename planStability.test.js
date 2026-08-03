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

module.exports = { db, initSchema, DB_PATH };
