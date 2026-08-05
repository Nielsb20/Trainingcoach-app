"use strict";
/**
 * The browser copy of the calculation core must be exactly what the generator
 * produces from this one.
 *
 * Both sides used to be maintained by hand under a README rule to "keep the two
 * in sync". They had already drifted: the browser copy was missing the whole
 * histogram/power-curve section, and a field read under the wrong name on one
 * side is how sRPE reached the coach as null for months. A rule that is only
 * enforced by remembering is not enforced.
 *
 * This test fails if someone edits either file without regenerating, which
 * makes the drift impossible to commit rather than merely discouraged.
 */
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const scriptPath = path.join(
  __dirname, "..", "..", "..", "trainingscoach-frontend", "scripts", "sync-calculations.cjs"
);

if (!fs.existsSync(scriptPath)) {
  // The frontend is a separate project and may legitimately be absent, e.g. on
  // a server-only deployment. Skipping beats failing on something that isn't
  // there to check.
  console.log("parity-test overgeslagen: frontend niet aanwezig");
  process.exit(0);
}

const { generate, TARGET } = require(scriptPath);

console.log("de browserkopie van calculations.js is exact de gegenereerde uitvoer");

const committed = fs.readFileSync(TARGET, "utf8");
const expected = generate();

if (committed !== expected) {
  const committedLines = committed.split("\n");
  const expectedLines = expected.split("\n");
  const at = committedLines.findIndex((line, i) => line !== expectedLines[i]);
  assert.fail(
    `trainingscoach-frontend/src/lib/calculations.js loopt niet in de pas met de serverversie.\n` +
    `Eerste verschil op regel ${at + 1}:\n` +
    `  vastgelegd:  ${JSON.stringify(committedLines[at])}\n` +
    `  verwacht:    ${JSON.stringify(expectedLines[at])}\n\n` +
    `Pas de serverversie aan en draai daarna in trainingscoach-frontend: npm run sync:calc`
  );
}

console.log("  ok  beide kopieën komen overeen");

// A generated file that nobody imports would pass the check above while being
// dead weight, so confirm the browser actually pulls from it.
const componentsDir = path.join(__dirname, "..", "..", "..", "trainingscoach-frontend", "src");
const importsCalculations = fs
  .readdirSync(componentsDir, { recursive: true })
  .filter((f) => typeof f === "string" && (f.endsWith(".jsx") || f.endsWith(".js")))
  .some((f) => {
    const full = path.join(componentsDir, f);
    if (!fs.statSync(full).isFile()) return false;
    return /from "[^"]*lib\/calculations"/.test(fs.readFileSync(full, "utf8"));
  });

assert.ok(importsCalculations, "de frontend hoort calculations.js daadwerkelijk te importeren");
console.log("  ok  de frontend importeert de gegenereerde kopie");

console.log("\nParity-test geslaagd.");
