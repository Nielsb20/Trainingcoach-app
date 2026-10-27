"use strict";

/**
 * Wat de coach per oefening voorstelt: sets, herhalingen en gewicht.
 *
 * De coach schreef dit al, maar alleen in de vrije tekst van een krachtsessie
 * ("bench 4x6 op 92,5 kg"). Daar moest je het in de sportschool teruglezen en
 * overtikken. Als losse getallen kan het loggen ze meteen klaarzetten.
 *
 * Het blijft modeluitvoer, dus het gaat door dezelfde soort poort als de
 * blokken van een fietstraining: een oefening die niet in de schemadag staat
 * valt weg (anders zou er een oefening klaarstaan die je niet doet), en een
 * getal buiten een redelijk bereik wordt leeg gelaten in plaats van overgenomen.
 * Beter een leeg veld waar je zelf iets intikt dan een verzonnen 900 kg.
 */

const naamSleutel = (s) => String(s || "").trim().toLowerCase();

function geheelTussen(waarde, min, max) {
  const n = Number(waarde);
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= min && r <= max ? r : null;
}

function gewichtTussen(waarde) {
  if (waarde === null || waarde === undefined || waarde === "") return null;
  const n = Number(String(waarde).replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 500) return null;
  // Halterschijven gaan per 1,25 kg; afronden op een kwart houdt ook
  // dumbbells en machines met kleinere stappen heel.
  return Math.round(n * 4) / 4;
}

/**
 * @param {Array} oefeningen  wat het model teruggaf
 * @param {string[]} schemaNamen  de oefeningen van die schemadag
 * @returns {Array|null} [{naam, sets, herhalingen, gewichtKg}] of null als er niets bruikbaars is
 */
function normalizeStrengthTargets(oefeningen, schemaNamen) {
  if (!Array.isArray(oefeningen) || !Array.isArray(schemaNamen) || schemaNamen.length === 0) return null;
  const bekend = new Map(schemaNamen.map((n) => [naamSleutel(n), n]));
  const gezien = new Set();
  const uit = [];
  for (const o of oefeningen) {
    if (!o || typeof o !== "object") continue;
    const sleutel = naamSleutel(o.naam ?? o.name);
    const naam = bekend.get(sleutel);
    if (!naam || gezien.has(sleutel)) continue;
    const doel = {
      naam,
      sets: geheelTussen(o.sets, 1, 10),
      herhalingen: geheelTussen(o.herhalingen ?? o.reps, 1, 50),
      gewichtKg: gewichtTussen(o.gewichtKg ?? o.gewicht ?? o.weight),
    };
    // Zonder één bruikbaar getal valt er niets klaar te zetten.
    if (doel.sets === null && doel.herhalingen === null && doel.gewichtKg === null) continue;
    gezien.add(sleutel);
    uit.push(doel);
  }
  return uit.length ? uit : null;
}

module.exports = { normalizeStrengthTargets };
