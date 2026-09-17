"use strict";

/**
 * validate.js — controleert wat er binnenkomt op de schrijfroutes.
 *
 * Modeluitvoer werd al als onbetrouwbaar behandeld (zie `normalizeProposal`),
 * maar wat de client stuurde ging rechtstreeks de database in. Een CSV-import
 * met een kolom in de verkeerde eenheid, een veld dat als tekst binnenkomt, of
 * een halve rij uit een mislukte GPX-parse leverde dan een 500 met een ruwe
 * SQL-foutmelding — of erger: een rij die er is, maar nergens op slaat.
 *
 * Bewust niet streng op alles. Ontbrekende velden zijn normaal (niet elke rit
 * heeft vermogen), dus die blijven leeg. Geweigerd wordt alleen wat aantoonbaar
 * fout is: een ontbrekende sleutel, een datum die geen datum is, of een getal
 * dat buiten elk menselijk bereik valt.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/** Grenzen die een tikfout of een verkeerde eenheid opvangen, niet een goede prestatie. */
const RANGES = {
  duration_min: [0, 3000],        // 50 uur; een meerdaagse tocht wordt per dag gelogd
  total_duration_min: [0, 3000],
  distance_km: [0, 1000],
  avg_hr: [20, 250],
  max_hr: [20, 250],
  avg_power: [0, 2000],
  max_power: [0, 3000],
  weighted_avg_power: [0, 2000],
  avg_cadence: [0, 250],
  max_cadence: [0, 300],
  elevation_gain_m: [0, 20000],
  elevation_loss_m: [0, 20000],
  calories: [0, 20000],
};

function checkNumber(entry, field, [min, max]) {
  const value = entry[field];
  if (value === null || value === undefined || value === "") return;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new ValidationError(`${field} is geen getal (kreeg: ${JSON.stringify(value)}).`);
  }
  if (n < min || n > max) {
    throw new ValidationError(
      `${field} van ${n} valt buiten het aannemelijke bereik ${min}–${max}. ` +
        "Controleer de eenheid — meters tegenover kilometers en seconden tegenover minuten zijn de gebruikelijke verwisselingen."
    );
  }
}

/** Gooit bij een cardiosessie die niet op te slaan valt. Vult niets aan. */
function validateCardioEntry(entry, index = null) {
  const waar = index === null ? "" : ` (rij ${index + 1})`;
  if (!entry || typeof entry !== "object") {
    throw new ValidationError(`Lege of ongeldige sessie${waar}.`);
  }
  if (!entry.id || typeof entry.id !== "string") {
    throw new ValidationError(`Sessie${waar} mist een id.`);
  }
  if (!ISO_DATE.test(String(entry.date || ""))) {
    throw new ValidationError(`Sessie${waar} heeft geen geldige datum (JJJJ-MM-DD), kreeg: ${JSON.stringify(entry.date)}.`);
  }
  if (!entry.type || typeof entry.type !== "string") {
    throw new ValidationError(`Sessie${waar} mist een sport.`);
  }
  Object.entries(RANGES).forEach(([field, range]) => {
    try {
      checkNumber(entry, field, range);
    } catch (err) {
      throw new ValidationError(err.message.replace(/\.$/, "") + `${waar}.`);
    }
  });
  // Een rit van nul kilometer in nul minuten is geen training maar een lege rij.
  if (!entry.duration_min && !entry.distance_km) {
    throw new ValidationError(`Sessie${waar} heeft geen duur en geen afstand.`);
  }
}

// Eén import mag groot zijn (een heel Strava-archief), maar niet onbegrensd:
// de hele partij gaat in één transactie en in één stuk door het geheugen.
const MAX_BULK = 5000;

function validateCardioBulk(entries) {
  if (!Array.isArray(entries)) {
    throw new ValidationError("Verwacht een lijst met sessies in 'entries'.");
  }
  if (entries.length === 0) {
    throw new ValidationError("Geen sessies om te importeren.");
  }
  if (entries.length > MAX_BULK) {
    throw new ValidationError(
      `${entries.length} sessies in één keer is te veel (maximaal ${MAX_BULK}). Splits het bestand.`
    );
  }
  entries.forEach((entry, i) => validateCardioEntry(entry, i));
}

function validateWeightEntry(entry) {
  if (!entry || !entry.id) throw new ValidationError("Meting mist een id.");
  if (!ISO_DATE.test(String(entry.date || ""))) {
    throw new ValidationError("Meting heeft geen geldige datum (JJJJ-MM-DD).");
  }
  const kg = Number(entry.weight_kg);
  if (!Number.isFinite(kg) || kg <= 20 || kg > 400) {
    throw new ValidationError(`Een gewicht van ${entry.weight_kg} kg klopt niet — controleer de eenheid.`);
  }
  if (entry.body_fat_pct !== null && entry.body_fat_pct !== undefined && entry.body_fat_pct !== "") {
    const pct = Number(entry.body_fat_pct);
    if (!Number.isFinite(pct) || pct < 1 || pct > 70) {
      throw new ValidationError(`Een vetpercentage van ${entry.body_fat_pct} klopt niet.`);
    }
  }
}

function validateWorkoutEntry(entry) {
  if (!entry || !entry.id) throw new ValidationError("Training mist een id.");
  if (!ISO_DATE.test(String(entry.date || ""))) {
    throw new ValidationError("Training heeft geen geldige datum (JJJJ-MM-DD).");
  }
  if (!Array.isArray(entry.exercises)) {
    throw new ValidationError("Training mist een lijst met oefeningen.");
  }
  if (entry.rpe !== null && entry.rpe !== undefined && entry.rpe !== "") {
    const rpe = Number(entry.rpe);
    if (!Number.isFinite(rpe) || rpe < 1 || rpe > 10) {
      throw new ValidationError("RPE loopt van 1 tot 10.");
    }
  }
  if (entry.durationMin !== null && entry.durationMin !== undefined && entry.durationMin !== "") {
    const min = Number(entry.durationMin);
    if (!Number.isFinite(min) || min < 0 || min > 600) {
      throw new ValidationError(`Een duur van ${entry.durationMin} minuten klopt niet.`);
    }
  }
  entry.exercises.forEach((ex, i) => {
    if (!ex || typeof ex.name !== "string" || !ex.name.trim()) {
      throw new ValidationError(`Oefening ${i + 1} mist een naam.`);
    }
    (ex.sets || []).forEach((set, j) => {
      const weight = Number(set.weight);
      const reps = Number(set.reps);
      if (!Number.isFinite(weight) || weight < 0 || weight > 1000) {
        throw new ValidationError(`${ex.name}, set ${j + 1}: ${set.weight} kg klopt niet.`);
      }
      if (!Number.isFinite(reps) || reps < 1 || reps > 1000) {
        throw new ValidationError(`${ex.name}, set ${j + 1}: ${set.reps} herhalingen klopt niet.`);
      }
    });
  });
}

module.exports = {
  ValidationError,
  validateCardioEntry,
  validateCardioBulk,
  validateWeightEntry,
  validateWorkoutEntry,
  MAX_BULK,
};
