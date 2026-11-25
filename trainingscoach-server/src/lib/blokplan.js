"use strict";

/**
 * Het blokplan: de lange lijn van 8 tot 12 weken, per week één regel.
 *
 * Alle sessies van drie maanden in detail neerzetten werkt niet: wat er over
 * zes weken op dinsdag staat verandert toch nog drie keer, en elke keer moet je
 * tientallen voorstellen opnieuw beoordelen. Een echte coach werkt daarom met
 * een blok (opbouw, herstelweek, piek, taper) en vult per week de details in.
 * Dat doet de app nu ook: het blokplan zegt per week wat de bedoeling is, de
 * wekelijkse planning maakt daar concrete sessies van en stelt het blokplan
 * bij als herstel of gemiste trainingen daar aanleiding toe geven.
 *
 * Het is modeluitvoer, dus het gaat door een poort: weken worden op hun maandag
 * gezet, weken die al voorbij zijn vallen weg, dubbele weken tellen één keer,
 * en tekst en getallen worden begrensd.
 */

const calc = require("./calculations");

const MAX_WEKEN = 16;

function maandagVan(datumStr) {
  const d = new Date(datumStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return calc.toDateStr(d);
}

function tekst(waarde, max) {
  if (waarde === null || waarde === undefined) return null;
  const s = String(waarde).replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

function getalTussen(waarde, min, max, stap) {
  if (waarde === null || waarde === undefined || waarde === "") return null;
  const n = Number(String(waarde).replace(",", "."));
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return Math.round(n / stap) * stap;
}

/**
 * Maakt van wat het model teruggeeft een bruikbaar blokplan, of null.
 * `vandaag` is instelbaar voor de tests.
 */
function normalizeBlokplan(raw, vandaag = calc.todayStr()) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.weken)) return null;
  const dezeWeek = maandagVan(vandaag);
  const perWeek = new Map();
  for (const w of raw.weken) {
    if (!w || typeof w !== "object") continue;
    const iso = String(w.weekVan || "").match(/\d{4}-\d{2}-\d{2}/);
    const weekVan = iso ? maandagVan(iso[0]) : null;
    if (!weekVan || weekVan < dezeWeek || perWeek.has(weekVan)) continue;
    const fase = tekst(w.fase, 40);
    const focus = tekst(w.focus, 240);
    if (!fase && !focus) continue;
    perWeek.set(weekVan, {
      weekVan,
      fase,
      focus,
      cardioUren: getalTussen(w.cardioUren, 0, 40, 0.5),
      krachtSessies: getalTussen(w.krachtSessies, 0, 7, 1),
      kernsessies: (Array.isArray(w.kernsessies) ? w.kernsessies : [])
        .map((k) => tekst(k, 120))
        .filter(Boolean)
        .slice(0, 6),
      toelichting: tekst(w.toelichting, 300),
    });
  }
  const weken = [...perWeek.values()].sort((a, b) => (a.weekVan < b.weekVan ? -1 : 1)).slice(0, MAX_WEKEN);
  if (weken.length === 0) return null;
  return { doel: tekst(raw.doel, 240), weken };
}

/**
 * Het blokplan dat nu geldt: het laatst opgeslagen, vanaf de huidige week.
 * `db` wordt meegegeven zodat dit bestand los te testen blijft.
 */
function huidigBlokplan(db, vandaag = calc.todayStr()) {
  const rij = db
    .prepare("SELECT id, date, blokplan_json FROM coach_history WHERE blokplan_json IS NOT NULL ORDER BY date DESC LIMIT 1")
    .get();
  if (!rij) return null;
  let plan;
  try {
    plan = JSON.parse(rij.blokplan_json);
  } catch {
    return null;
  }
  const dezeWeek = maandagVan(vandaag);
  const weken = (plan.weken || []).filter((w) => w.weekVan >= dezeWeek);
  if (weken.length === 0) return null;
  return { coachEntryId: rij.id, bijgewerkt: rij.date, doel: plan.doel || null, weken };
}

module.exports = { normalizeBlokplan, huidigBlokplan, maandagVan };
