#!/usr/bin/env node
"use strict";

/**
 * Finds and removes duplicate cardio sessions — the same workout stored twice
 * because it arrived from two sources (e.g. the Strava CSV archive first, then
 * the Strava API sync later).
 *
 * Two sessions are considered the same workout when they share a date and
 * sport type and their distance and duration are within 5% of each other.
 *
 * When duplicates are found, the richest version is kept: one with a
 * within-session profile beats one without, then more filled-in fields wins.
 * That way you keep the interval detail rather than the bare summary.
 *
 * Usage:
 *   node scripts/dedupe-cardio.js           # dry run: only reports
 *   node scripts/dedupe-cardio.js --apply   # actually deletes
 */

require("dotenv").config({ path: require("node:path").join(__dirname, "..", ".env") });

const { db, initSchema } = require("../src/db/db");
const { withinTolerance } = require("../src/lib/strava");

initSchema();

const apply = process.argv.includes("--apply");

/** Higher score = more worth keeping. */
function richness(row) {
  let score = 0;
  if (row.profile_json) score += 100; // within-session detail is the most valuable thing
  const fields = [
    "duration_min", "total_duration_min", "distance_km", "avg_hr", "max_hr",
    "avg_power", "max_power", "weighted_avg_power", "avg_cadence", "max_cadence",
    "elevation_gain_m", "elevation_loss_m", "calories",
  ];
  fields.forEach((f) => {
    if (row[f] !== null && row[f] !== undefined) score += 1;
  });
  if (row.notes) score += 1;
  return score;
}

const all = db.prepare("SELECT * FROM cardio_logs ORDER BY date, type").all();

// Group by date+type first, then compare within each group.
const groups = new Map();
all.forEach((row) => {
  const key = `${row.date}|${row.type}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(row);
});

const toDelete = [];
let duplicateSets = 0;

for (const [key, rows] of groups) {
  if (rows.length < 2) continue;

  const used = new Set();
  for (let i = 0; i < rows.length; i++) {
    if (used.has(rows[i].id)) continue;
    const cluster = [rows[i]];
    for (let j = i + 1; j < rows.length; j++) {
      if (used.has(rows[j].id)) continue;
      if (
        withinTolerance(rows[i].distance_km, rows[j].distance_km, 0.05) &&
        withinTolerance(rows[i].duration_min, rows[j].duration_min, 0.05)
      ) {
        cluster.push(rows[j]);
        used.add(rows[j].id);
      }
    }
    if (cluster.length < 2) continue;

    duplicateSets++;
    cluster.sort((a, b) => richness(b) - richness(a));
    const keep = cluster[0];
    const drop = cluster.slice(1);

    const [date, type] = key.split("|");
    console.log(`\n${date} · ${type} · ${keep.distance_km ?? "?"} km`);
    console.log(`  BEHOUDEN  ${keep.id}  (bron: ${keep.source}${keep.profile_json ? ", met verloop" : ""})`);
    drop.forEach((d) => {
      console.log(`  VERWIJDER ${d.id}  (bron: ${d.source}${d.profile_json ? ", met verloop" : ""})`);
      toDelete.push(d.id);
    });
  }
}

console.log(`\n${"-".repeat(60)}`);
console.log(`Totaal sessies:      ${all.length}`);
console.log(`Dubbele groepen:     ${duplicateSets}`);
console.log(`Te verwijderen:      ${toDelete.length}`);

if (toDelete.length === 0) {
  console.log("\nGeen dubbelen gevonden.");
  process.exit(0);
}

if (!apply) {
  console.log("\nDIT WAS EEN PROEFDRAAI — er is niets verwijderd.");
  console.log("Voer opnieuw uit met --apply om daadwerkelijk op te ruimen:");
  console.log("  node scripts/dedupe-cardio.js --apply");
  process.exit(0);
}

const stmt = db.prepare("DELETE FROM cardio_logs WHERE id = ?");
const removeAll = db.transaction((ids) => ids.forEach((id) => stmt.run(id)));
removeAll(toDelete);
console.log(`\n${toDelete.length} dubbele sessies verwijderd.`);
