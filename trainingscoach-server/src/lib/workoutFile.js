"use strict";

/**
 * workoutFile.js — een geplande training als bestand voor een indoortrainer.
 *
 * ROUVY (en Zwift, en de meeste trainerapps) leest .zwo, .erg en .mrc. Alle
 * drie beschrijven hetzelfde: een reeks blokken met een duur en een
 * doelintensiteit. Het verschil zit in de eenheid en de syntax:
 *
 *   .zwo  XML, intensiteit als fractie van FTP, kent intervallen en tekstcues
 *   .mrc  platte tekst, intensiteit in procenten van FTP
 *   .erg  platte tekst, intensiteit in absolute watt (dus FTP nodig)
 *
 * Waarom .zwo de eerste keus is: het kan een interval als één blok
 * uitdrukken ("4x8 min aan, 4 min uit") en kan er een tekstcue bij zetten, dus
 * wat de coach heeft bedacht blijft leesbaar in de trainer. De andere twee zijn
 * een reeks tijd-waardeparen; wat erin staat is identiek, de bedoeling leest
 * minder makkelijk.
 *
 * Wat hier NIET gebeurt: de omschrijving van de coach interpreteren. De
 * blokkenstructuur komt altijd van buiten — de coach levert hem mee, of hij
 * wordt er één keer uit gehaald en aan de sporter voorgelegd. Een bestand dat
 * net iets anders voorschrijft dan er in de planning staat is erger dan geen
 * bestand, want je merkt het pas halverwege een interval.
 */

const SOORTEN = ["warmup", "duur", "interval", "herstel", "cooldown", "vrij"];

// Grenzen die een onzinnige modeluitvoer tegenhouden, geen goede training.
const MIN_MINUTEN = 0.5;
const MAX_MINUTEN = 300;
const MIN_PCT = 20;
const MAX_PCT = 200;
const MAX_BLOKKEN = 40;
const MAX_TOTAAL_MINUTEN = 360;

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function clampMinuten(value) {
  const n = clamp(value, MIN_MINUTEN, MAX_MINUTEN);
  return n === null ? null : Math.round(n * 10) / 10;
}

function clampPct(value) {
  const n = clamp(value, MIN_PCT, MAX_PCT);
  return n === null ? null : Math.round(n);
}

function schoonTekst(value, max = 120) {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * Maakt van wat er binnenkomt een structuur die te vertrouwen is, of null.
 *
 * Blokken die niet kloppen worden weggelaten in plaats van gerepareerd: een
 * interval zonder duur is niet te raden, en iets aannemelijks invullen is
 * precies wat een trainingsbestand niet mag doen. Blijft er niets over, dan is
 * er geen structuur en wordt er geen bestand aangeboden.
 */
function normalizeStructure(input) {
  const lijst = Array.isArray(input) ? input : Array.isArray(input?.blokken) ? input.blokken : null;
  if (!lijst || lijst.length === 0) return null;

  const blokken = [];
  let totaal = 0;

  for (const raw of lijst.slice(0, MAX_BLOKKEN)) {
    if (!raw || typeof raw !== "object") continue;
    const soort = SOORTEN.includes(raw.soort) ? raw.soort : null;
    if (!soort) continue;
    const tekst = schoonTekst(raw.tekst);

    if (soort === "interval") {
      const herhalingen = clamp(raw.herhalingen, 1, 40);
      const aanMinuten = clampMinuten(raw.aanMinuten);
      const uitMinuten = clampMinuten(raw.uitMinuten);
      const aanPctFtp = clampPct(raw.aanPctFtp);
      const uitPctFtp = clampPct(raw.uitPctFtp);
      if (!herhalingen || !aanMinuten || !uitMinuten || !aanPctFtp || !uitPctFtp) continue;
      const duur = Math.round(herhalingen) * (aanMinuten + uitMinuten);
      if (totaal + duur > MAX_TOTAAL_MINUTEN) break;
      totaal += duur;
      blokken.push({
        soort,
        herhalingen: Math.round(herhalingen),
        aanMinuten,
        uitMinuten,
        aanPctFtp,
        uitPctFtp,
        tekst,
      });
      continue;
    }

    const minuten = clampMinuten(raw.minuten);
    if (!minuten) continue;
    if (totaal + minuten > MAX_TOTAAL_MINUTEN) break;

    // Vrij rijden heeft geen doelintensiteit: de trainer laat de weerstand dan
    // los. Dat is iets anders dan een doel dat we niet weten.
    if (soort === "vrij") {
      totaal += minuten;
      blokken.push({ soort, minuten, tekst });
      continue;
    }

    const pctFtp = clampPct(raw.pctFtp);
    if (!pctFtp) continue;
    // Een warm-up of uitrijden mag oplopen of aflopen; de rest is vlak.
    const pctFtpTot =
      soort === "warmup" || soort === "cooldown" ? clampPct(raw.pctFtpTot) : null;
    totaal += minuten;
    blokken.push({ soort, minuten, pctFtp, pctFtpTot: pctFtpTot ?? null, tekst });
  }

  return blokken.length ? blokken : null;
}

/** Hoe lang de hele training duurt, in minuten. */
function totalMinutes(blokken) {
  return (blokken || []).reduce((sum, b) => {
    if (b.soort === "interval") return sum + b.herhalingen * (b.aanMinuten + b.uitMinuten);
    return sum + b.minuten;
  }, 0);
}

/**
 * De blokken als vlakke reeks segmenten: {minuten, vanPct, totPct}.
 *
 * Gebruikt voor .erg en .mrc, die geen intervallen kennen en dus elke
 * herhaling uitgeschreven willen zien.
 */
function flattenToSegments(blokken) {
  const segments = [];
  (blokken || []).forEach((b) => {
    if (b.soort === "interval") {
      for (let i = 0; i < b.herhalingen; i += 1) {
        segments.push({ minuten: b.aanMinuten, vanPct: b.aanPctFtp, totPct: b.aanPctFtp });
        segments.push({ minuten: b.uitMinuten, vanPct: b.uitPctFtp, totPct: b.uitPctFtp });
      }
      return;
    }
    // Vrij rijden heeft geen doel; in een tijd-vermogenbestand bestaat dat niet,
    // dus wordt het een rustig blok op 50% — en dat staat erbij in de tekst.
    const van = b.soort === "vrij" ? 50 : b.pctFtp;
    const tot = b.soort === "vrij" ? 50 : b.pctFtpTot ?? b.pctFtp;
    segments.push({ minuten: b.minuten, vanPct: van, totPct: tot });
  });
  return segments;
}

/* ------------------------------- .zwo ---------------------------------- */

function xmlEscape(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Fractie van FTP met twee decimalen, zoals .zwo het wil. */
function fractie(pct) {
  return (Math.round((pct / 100) * 100) / 100).toFixed(2);
}

function cue(tekst) {
  if (!tekst) return "";
  return `\n      <textevent timeoffset="0" message="${xmlEscape(tekst)}"/>\n    `;
}

function toZwo(blokken, { naam, beschrijving, sport = "bike" } = {}) {
  const steps = blokken.map((b) => {
    const inner = cue(b.tekst);
    if (b.soort === "interval") {
      return `    <IntervalsT Repeat="${b.herhalingen}" OnDuration="${Math.round(b.aanMinuten * 60)}" OffDuration="${Math.round(b.uitMinuten * 60)}" OnPower="${fractie(b.aanPctFtp)}" OffPower="${fractie(b.uitPctFtp)}">${inner}</IntervalsT>`;
    }
    const seconds = Math.round(b.minuten * 60);
    if (b.soort === "vrij") {
      return `    <FreeRide Duration="${seconds}" FlatRoad="1">${inner}</FreeRide>`;
    }
    if (b.soort === "warmup" || b.soort === "cooldown") {
      const tag = b.soort === "warmup" ? "Warmup" : "Cooldown";
      const laag = b.soort === "warmup" ? b.pctFtp : b.pctFtpTot ?? b.pctFtp;
      const hoog = b.soort === "warmup" ? b.pctFtpTot ?? b.pctFtp : b.pctFtp;
      return `    <${tag} Duration="${seconds}" PowerLow="${fractie(laag)}" PowerHigh="${fractie(hoog)}">${inner}</${tag}>`;
    }
    return `    <SteadyState Duration="${seconds}" Power="${fractie(b.pctFtp)}">${inner}</SteadyState>`;
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<workout_file>",
    "  <author>Trainingscoach</author>",
    `  <name>${xmlEscape(naam || "Training")}</name>`,
    `  <description>${xmlEscape(beschrijving || "")}</description>`,
    `  <sportType>${sport}</sportType>`,
    "  <tags/>",
    "  <workout>",
    ...steps,
    "  </workout>",
    "</workout_file>",
    "",
  ].join("\n");
}

/* --------------------------- .erg en .mrc ------------------------------ */

/**
 * Beide formaten zijn een lijst tijd-waardeparen: per segment een regel voor
 * het begin en een voor het eind. Een vlak blok staat er dus twee keer in met
 * dezelfde waarde; een oplopende warm-up met twee verschillende.
 */
function toCourseFile(blokken, { naam, beschrijving, ftp = null, mode = "mrc" }) {
  const absoluut = mode === "erg";
  if (absoluut && !ftp) {
    throw new Error("Een .erg-bestand is in watt, dus daar is je FTP voor nodig. Vul die in bij je profiel of kies .mrc.");
  }
  const waarde = (pct) => (absoluut ? Math.round((pct / 100) * ftp) : Math.round(pct));

  const rows = [];
  let t = 0;
  flattenToSegments(blokken).forEach((s) => {
    rows.push(`${t.toFixed(2)}\t${waarde(s.vanPct)}`);
    t += s.minuten;
    rows.push(`${t.toFixed(2)}\t${waarde(s.totPct)}`);
  });

  return [
    "[COURSE HEADER]",
    "VERSION = 2",
    "UNITS = ENGLISH",
    `DESCRIPTION = ${(beschrijving || naam || "Training").replace(/[\r\n]+/g, " ")}`,
    `FILE NAME = ${bestandsnaam(naam, mode)}`,
    absoluut ? "MINUTES WATTS" : "MINUTES PERCENT",
    "[END COURSE HEADER]",
    "[COURSE DATA]",
    ...rows,
    "[END COURSE DATA]",
    "",
  ].join("\n");
}

/* ------------------------------ naamgeving ----------------------------- */

function bestandsnaam(naam, extensie) {
  const kern = String(naam || "training")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "training";
  return `${kern}.${extensie}`;
}

/* ------------------------------ samenvatting --------------------------- */

const SOORT_LABELS = {
  warmup: "Warm-up",
  duur: "Duurblok",
  interval: "Intervallen",
  herstel: "Herstel",
  cooldown: "Uitrijden",
  vrij: "Vrij rijden",
};

/** Eén blok in één regel, zodat de sporter kan zien wat hij downloadt. */
function describeBlock(blok, ftp = null) {
  const watt = (pct) => (ftp ? ` (${Math.round((pct / 100) * ftp)} W)` : "");
  if (blok.soort === "interval") {
    return `${blok.herhalingen}x ${blok.aanMinuten} min op ${blok.aanPctFtp}% FTP${watt(blok.aanPctFtp)}, ${blok.uitMinuten} min op ${blok.uitPctFtp}%${watt(blok.uitPctFtp)}`;
  }
  if (blok.soort === "vrij") {
    return `${blok.minuten} min vrij rijden (geen weerstandsdoel)`;
  }
  if (blok.pctFtpTot && blok.pctFtpTot !== blok.pctFtp) {
    return `${SOORT_LABELS[blok.soort]} ${blok.minuten} min van ${blok.pctFtp}% naar ${blok.pctFtpTot}% FTP`;
  }
  return `${SOORT_LABELS[blok.soort]} ${blok.minuten} min op ${blok.pctFtp}% FTP${watt(blok.pctFtp)}`;
}

function describeStructure(blokken, ftp = null) {
  if (!blokken || !blokken.length) return null;
  return {
    totaalMinuten: Math.round(totalMinutes(blokken)),
    regels: blokken.map((b) => describeBlock(b, ftp)),
  };
}

/* -------------------------------- render ------------------------------- */

const FORMATS = {
  zwo: { extensie: "zwo", contentType: "application/xml; charset=utf-8" },
  mrc: { extensie: "mrc", contentType: "text/plain; charset=utf-8" },
  erg: { extensie: "erg", contentType: "text/plain; charset=utf-8" },
};

/**
 * Rendert de structuur naar één bestand.
 *
 * @returns {{inhoud: string, bestandsnaam: string, contentType: string}}
 */
function renderWorkoutFile(blokken, { format = "zwo", naam, beschrijving, ftp = null, sport = "bike" } = {}) {
  const spec = FORMATS[format];
  if (!spec) {
    throw new Error(`Onbekend formaat "${format}". Kies uit: ${Object.keys(FORMATS).join(", ")}.`);
  }
  if (!blokken || !blokken.length) {
    throw new Error("Zonder blokkenstructuur is er geen trainingsbestand te maken.");
  }
  const inhoud =
    format === "zwo"
      ? toZwo(blokken, { naam, beschrijving, sport })
      : toCourseFile(blokken, { naam, beschrijving, ftp, mode: format });

  return {
    inhoud,
    bestandsnaam: bestandsnaam(naam, spec.extensie),
    contentType: spec.contentType,
  };
}

module.exports = {
  SOORTEN,
  FORMATS,
  normalizeStructure,
  totalMinutes,
  flattenToSegments,
  renderWorkoutFile,
  describeStructure,
  describeBlock,
  bestandsnaam,
  toZwo,
  toCourseFile,
  MAX_TOTAAL_MINUTEN,
};
