"use strict";

/**
 * backup.js — writes a nightly snapshot of everything to disk.
 *
 * The app had no automatic backup at all: the only safety net was a button in
 * the interface that someone had to remember to press. A single misplaced tap
 * on a delete icon was enough to lose a logged session permanently, which is
 * exactly what happened. The database also lives on an SD card, and those fail.
 *
 * Snapshots are plain JSON in the same shape as the manual export, so a backup
 * can be restored through the existing import endpoint with no conversion.
 */

const fs = require("node:fs");
const path = require("node:path");
const { db } = require("../db/db");
const calc = require("./calculations");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "..", "data");
const BACKUP_DIR = path.join(DATA_DIR, "backups");

// A month of daily snapshots is enough to notice and undo a mistake, and costs
// a few megabytes at the volumes this app deals with.
const KEEP_BACKUPS = Number(process.env.BACKUP_KEEP_DAYS) || 30;

// Not at midnight: the date rolls over there, and a backup written seconds
// either side of it is easy to misattribute. Three in the morning is safely
// inside one calendar day.
const BACKUP_AFTER_HOUR = 3;

const FILENAME_PREFIX = "trainingscoach-backup-";

/**
 * Builds the full backup payload.
 *
 * Shared with the /api/export route rather than duplicated: a backup that
 * silently omits a table the export includes would only be discovered on the
 * day it is needed.
 */
function buildBackup() {
  const { getFullSchema } = require("../routes/schema");
  const { serializeWorkoutLogs } = require("../routes/workoutLogs");
  const { serialize: serializeCardioLog } = require("../routes/cardioLogs");
  const { serialize: serializeWeightLog } = require("../routes/weightLogs");
  const { serialize: serializeEvent } = require("../routes/events");

  return {
    schema: getFullSchema(),
    workoutLogs: serializeWorkoutLogs(db.prepare("SELECT * FROM workout_logs ORDER BY date DESC").all()),
    cardioLogs: db.prepare("SELECT * FROM cardio_logs ORDER BY date DESC").all().map(serializeCardioLog),
    events: db.prepare("SELECT * FROM events ORDER BY date ASC").all().map(serializeEvent),
    weightLogs: db.prepare("SELECT * FROM weight_logs ORDER BY date ASC").all().map(serializeWeightLog),
    coachHistory: db.prepare("SELECT * FROM coach_history ORDER BY date DESC").all(),
    exportedAt: new Date().toISOString(),
  };
}

function backupPathFor(dateStr) {
  return path.join(BACKUP_DIR, `${FILENAME_PREFIX}${dateStr}.json`);
}

/** Existing snapshots, newest first. */
function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith(FILENAME_PREFIX) && f.endsWith(".json"))
    .map((f) => {
      const full = path.join(BACKUP_DIR, f);
      return { file: f, date: f.slice(FILENAME_PREFIX.length, -".json".length), bytes: fs.statSync(full).size };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** Drops the oldest snapshots beyond the retention limit. */
function pruneBackups(keep = KEEP_BACKUPS) {
  const stale = listBackups().slice(keep);
  stale.forEach((b) => fs.unlinkSync(path.join(BACKUP_DIR, b.file)));
  return stale.length;
}

/**
 * Writes today's snapshot. Overwrites an existing one for the same day, so a
 * restart cannot produce a second file for one date.
 *
 * Written to a temporary file and then renamed: a crash halfway through a
 * multi-megabyte write would otherwise leave truncated JSON behind, and a
 * backup that cannot be parsed is worse than an obviously missing one.
 */
function writeBackup(dateStr = calc.todayStr()) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const target = backupPathFor(dateStr);
  const temp = `${target}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(buildBackup()));
  fs.renameSync(temp, target);
  const removed = pruneBackups();
  return { file: path.basename(target), path: target, bytes: fs.statSync(target).size, removed };
}

/**
 * True when today has no snapshot yet and the hour has come round.
 *
 * Checked per tick rather than scheduled at a fixed time, so a Pi that was off
 * overnight still backs up once it is switched on instead of skipping the day.
 */
function isBackupDue(now = new Date()) {
  if (now.getHours() < BACKUP_AFTER_HOUR) return false;
  return !fs.existsSync(backupPathFor(calc.toDateStr(now)));
}

module.exports = {
  buildBackup,
  writeBackup,
  listBackups,
  pruneBackups,
  isBackupDue,
  BACKUP_DIR,
  KEEP_BACKUPS,
};
