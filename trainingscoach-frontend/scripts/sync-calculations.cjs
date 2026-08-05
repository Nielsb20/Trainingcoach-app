#!/usr/bin/env node
"use strict";

/**
 * Generates src/lib/calculations.js from the server's copy.
 *
 * The calculation core has to run in two places: the server builds the coach
 * payload with it, the browser renders charts and tables with it without a
 * round-trip. Keeping two hand-maintained copies in sync worked right up until
 * it didn't — a field read under the wrong name on one side is exactly how sRPE
 * reached the coach as null for months.
 *
 * So there is one source of truth, the server's file, and the browser copy is
 * derived from it. The only difference between the two is module syntax:
 * CommonJS on the server, ES modules in Vite. That is a mechanical transform,
 * which is precisely the kind of thing not to do by hand.
 *
 * Run via the frontend's `prebuild`/`predev`, and verified by
 * calculationsParity.test.js in the server suite — that test regenerates the
 * file in memory and fails if the committed copy differs, so editing one side
 * without the other cannot pass tests.
 */

const fs = require("node:fs");
const path = require("node:path");

const SOURCE = path.join(__dirname, "..", "..", "trainingscoach-server", "src", "lib", "calculations.js");
const TARGET = path.join(__dirname, "..", "src", "lib", "calculations.js");

const HEADER = `/**
 * calculations.js — SHARED CALCULATION CORE (browser copy)
 *
 * GENERATED FILE — DO NOT EDIT.
 *
 * Generated from trainingscoach-server/src/lib/calculations.js by
 * scripts/sync-calculations.cjs. Change the server copy and rebuild; edits made
 * here are overwritten on the next build and rejected by the parity test.
 *
 * Helpers that only the interface needs live in ./uiHelpers.js, not here.
 */
`;

/**
 * Rewrites CommonJS into ES modules.
 *
 * Deliberately anchored to column 0: only top-level declarations become
 * exports. A nested `const` inside a function body must stay a plain local, and
 * matching loosely would happily corrupt one.
 */
function toEsm(source) {
  const withoutStrict = source.replace(/^"use strict";\n+/m, "");

  // Drop the trailing module.exports block; the named exports replace it.
  const withoutExports = withoutStrict.replace(/\nmodule\.exports = \{[\s\S]*?\n\};\n?$/, "\n");

  // Replace the source file's own header comment with the generated one.
  const withoutHeader = withoutExports.replace(/^\/\*\*[\s\S]*?\*\/\n+/, "");

  const exported = withoutHeader
    .split("\n")
    .map((line) => {
      if (/^function \w+\s*\(/.test(line)) return `export ${line}`;
      if (/^const \w+\s*=/.test(line)) return `export ${line}`;
      return line;
    })
    .join("\n");

  return HEADER + "\n" + exported.replace(/\n{3,}$/, "\n");
}

function generate() {
  return toEsm(fs.readFileSync(SOURCE, "utf8"));
}

if (require.main === module) {
  const generated = generate();
  const existing = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, "utf8") : null;
  if (existing === generated) {
    console.log("calculations.js is al actueel");
  } else {
    fs.writeFileSync(TARGET, generated);
    console.log("calculations.js gegenereerd vanuit de serverversie");
  }
}

module.exports = { generate, toEsm, SOURCE, TARGET };
