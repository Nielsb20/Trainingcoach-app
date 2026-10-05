/**
 * calculations.js
 *
 * Pure, deterministic training-science calculations — no React, no browser APIs,
 * no dependency on Express or the database. This is the same logic that was
 * built and tested inside the Claude-artifact prototype, extracted so it's
 * directly reusable and independently testable in the server.
 *
 * Every function here is a pure function: same input -> same output, no
 * side effects. Keep it that way — this module is the "hard math" layer that
 * the AI coach is instructed to defer to rather than re-derive itself.
 */

"use strict";

/* ---------------------------------------------------------------------- */
/* Dates / weekdays                                                       */
/* ---------------------------------------------------------------------- */

const WEEKDAYS = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag", "Zondag"];

/**
 * Formats a Date back to YYYY-MM-DD using its *local* calendar components.
 *
 * Never use toISOString().slice(0,10) for this. That converts to UTC first, so
 * on any host east of Greenwich a date parsed as local midnight stringifies
 * back to the previous day. On a Pi in Europe/Amsterdam that shifted every week
 * bucket a day early and pushed today's session out of the load series
 * entirely — while every test passed, because CI runs in UTC where the two
 * agree.
 *
 * Everything in this app is a calendar date without a time, so the local
 * components are the correct reading.
 */
function toDateStr(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayStr() {
  return toDateStr(new Date());
}

function weekdayNameForDate(dateStr) {
  const jsDay = new Date(dateStr + "T00:00:00").getDay(); // 0=Sunday..6=Saturday
  const idx = (jsDay + 6) % 7; // remap to 0=Monday..6=Sunday
  return WEEKDAYS[idx];
}

function daysUntil(dateStr) {
  const today = new Date(todayStr() + "T00:00:00");
  const target = new Date(dateStr + "T00:00:00");
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

/* ---------------------------------------------------------------------- */
/* Heart rate zones                                                       */
/* ---------------------------------------------------------------------- */

const HR_ZONE_DEFS = [
  { zone: 1, naam: "Herstel", van: 0.5, tot: 0.6 },
  { zone: 2, naam: "Duurtraining", van: 0.6, tot: 0.7 },
  { zone: 3, naam: "Tempo", van: 0.7, tot: 0.8 },
  { zone: 4, naam: "Drempel", van: 0.8, tot: 0.9 },
  { zone: 5, naam: "Maximaal", van: 0.9, tot: 1.0 },
];

/**
 * Uses the Karvonen (heart rate reserve) method when resting HR is known,
 * which is more personalized than a flat percentage of max HR; falls back
 * to %max if resting HR is missing.
 */
function computeHrZones(maxHr, restingHr) {
  if (!maxHr) return null;
  const hasReserve = !!restingHr && restingHr < maxHr;
  return HR_ZONE_DEFS.map((z) => {
    if (hasReserve) {
      const reserve = maxHr - restingHr;
      return { ...z, vanBpm: Math.round(restingHr + reserve * z.van), totBpm: Math.round(restingHr + reserve * z.tot) };
    }
    return { ...z, vanBpm: Math.round(maxHr * z.van), totBpm: Math.round(maxHr * z.tot) };
  });
}

function zoneForHr(hr, zones) {
  if (!hr || !zones) return null;
  const match = zones.find((z) => hr >= z.vanBpm && hr <= z.totBpm);
  if (match) return match.zone;
  if (hr < zones[0].vanBpm) return 0;
  return 5;
}

/**
 * De gemeten hartslag in rust over de afgelopen weken, als één getal.
 *
 * Twee dingen zitten hier in, en het verschil ertussen is de reden dat deze
 * functie bestaat.
 *
 * `sleeping_hr` is de gemiddelde hartslag over het slaapvenster. Die ligt vast
 * zodra je wakker bent.
 *
 * `resting_hr` is wat Garmin rusthartslag noemt, en dat is een DAGwaarde: de
 * laagste aanhoudende hartslag over het hele etmaal. Kijk je er 's ochtends
 * naar, dan gaat hij over je nacht. Lig je 's middags een uur stil op de bank
 * met een lagere hartslag, dan is het 's avonds dát getal geworden. Dezelfde
 * dag, een ander antwoord — en een basislijn die beweegt om redenen die niets
 * met herstel te maken hebben.
 *
 * Dus: de nachtwaarde gaat voor, en de dagwaarde is alleen de terugval voor
 * dagen (of apparaten) waar de nacht niet is vastgelegd. De twee worden nooit
 * door elkaar gemiddeld — een gemiddelde over het slaapvenster ligt structureel
 * hoger dan een minimum over het etmaal, en die twee optellen levert een getal
 * op dat niets meet.
 *
 * Vandaag telt niet mee. Zolang de dag loopt kan de dagwaarde nog zakken, en
 * een basislijn die 's avonds anders is dan 's ochtends is geen basislijn.
 *
 * Mediaan, niet gemiddelde: één nacht na een biertje of met een opkomende
 * verkoudheid tilt een gemiddelde omhoog, de mediaan haalt zijn schouders op.
 *
 * Vier weken is een afweging: lang genoeg om rustig te staan, kort genoeg om
 * een echte verbetering binnen een seizoen te volgen.
 */
const RESTING_HR_WINDOW_DAYS = 28;
const RESTING_HR_MIN_NIGHTS = 7;

function computeRestingHrBaseline(wellnessLogs, options = {}) {
  const windowDays = options.windowDays || RESTING_HR_WINDOW_DAYS;
  const minNights = options.minNights || RESTING_HR_MIN_NIGHTS;
  if (!Array.isArray(wellnessLogs) || wellnessLogs.length === 0) return null;

  const today = options.today || todayStr();
  const cutoff = new Date(today + "T00:00:00");
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffStr = toDateStr(cutoff);

  const afgeronde = wellnessLogs.filter((w) => w.date >= cutoffStr && w.date < today);
  const lees = (w, veld) => {
    const snake = veld === "slaap" ? "sleeping_hr" : "resting_hr";
    const camel = veld === "slaap" ? "sleepingHr" : "restingHr";
    const value = w[snake] !== undefined ? w[snake] : w[camel];
    return value === null || value === undefined || isNaN(value) ? null : Number(value);
  };

  const nacht = afgeronde.map((w) => lees(w, "slaap")).filter((v) => v !== null);
  const dag = afgeronde.map((w) => lees(w, "dag")).filter((v) => v !== null);

  // De nachtwaarde wint zodra er genoeg nachten zijn; anders de dagwaarde,
  // met erbij wélke van de twee het is geworden.
  const [values, bron] =
    nacht.length >= minNights
      ? [nacht, "slaap"]
      : dag.length >= minNights
        ? [dag, "dagwaarde"]
        : [[], null];

  // Te weinig nachten is geen basislijn maar een losse meting. Dan liever
  // niets beweren dan een getal dat stevig lijkt.
  if (!bron) return null;

  const gesorteerd = [...values].sort((a, b) => a - b);
  const mid = Math.floor(gesorteerd.length / 2);
  const median =
    gesorteerd.length % 2 ? gesorteerd[mid] : (gesorteerd[mid - 1] + gesorteerd[mid]) / 2;

  return {
    bpm: Math.round(median),
    bron,
    nachten: gesorteerd.length,
    laagste: gesorteerd[0],
    hoogste: gesorteerd[gesorteerd.length - 1],
    vensterDagen: windowDays,
    // Hoeveel nachten er een echte nachtmeting hebben, ook als de dagwaarde
    // het nu nog doet: dat is wat de interface moet kunnen uitleggen.
    nachtmetingen: nacht.length,
  };
}

/* ---------------------------------------------------------------------- */
/* Power zones (Coggan 7-zone model)                                      */
/* ---------------------------------------------------------------------- */

const POWER_ZONE_DEFS = [
  { zone: 1, naam: "Actief herstel", van: 0, tot: 0.55 },
  { zone: 2, naam: "Duurtraining", van: 0.55, tot: 0.75 },
  { zone: 3, naam: "Tempo", van: 0.76, tot: 0.9 },
  { zone: 4, naam: "Drempel", van: 0.91, tot: 1.05 },
  { zone: 5, naam: "VO2max", van: 1.06, tot: 1.2 },
  { zone: 6, naam: "Anaeroob", van: 1.21, tot: 1.5 },
  { zone: 7, naam: "Neuromusculair/sprint", van: 1.51, tot: 3.0 },
];

function computePowerZones(ftp) {
  if (!ftp) return null;
  return POWER_ZONE_DEFS.map((z) => ({
    ...z,
    vanW: Math.round(ftp * z.van),
    totW: z.tot >= 3.0 ? null : Math.round(ftp * z.tot),
  }));
}

/* ---------------------------------------------------------------------- */
/* Pace zones (running)                                                   */
/* ---------------------------------------------------------------------- */

/**
 * Hardlopen had geen eigen maatstaf. Fietsen krijgt vermogenszones en
 * FTP-gebaseerde TSS; een hardloopsessie viel terug op de hartslagschatting,
 * terwijl tempo voor hardlopers is wat vermogen voor wielrenners is.
 *
 * De zones lopen rond het drempeltempo — het tempo dat je ongeveer een uur
 * volhoudt — met dezelfde indeling als de vermogenszones. Let op de omkering:
 * een hogere intensiteit betekent een *lager* aantal seconden per kilometer.
 */
const PACE_ZONE_DEFS = [
  { zone: 1, naam: "Herstel", van: 0, tot: 0.78 },
  { zone: 2, naam: "Duurloop", van: 0.78, tot: 0.87 },
  { zone: 3, naam: "Tempo", van: 0.87, tot: 0.94 },
  { zone: 4, naam: "Drempel", van: 0.94, tot: 1.03 },
  { zone: 5, naam: "VO2max", van: 1.03, tot: 1.15 },
  { zone: 6, naam: "Anaeroob", van: 1.15, tot: 1.4 },
];

/** Formatteert seconden per kilometer als 4:35. */
function formatPace(secondsPerKm) {
  if (!secondsPerKm || !Number.isFinite(secondsPerKm)) return null;
  const total = Math.round(secondsPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Seconden per kilometer uit afstand en duur. */
function computePaceSecPerKm(distanceKm, durationMin) {
  if (!distanceKm || !durationMin) return null;
  if (distanceKm <= 0 || durationMin <= 0) return null;
  return Math.round(((durationMin * 60) / distanceKm) * 10) / 10;
}

/**
 * Tempozones rond het drempeltempo, in seconden per kilometer.
 *
 * `vanSec` is het langzame eind van de zone en `totSec` het snelle: bij tempo
 * telt een lager getal als harder, dus de grenzen staan omgekeerd ten opzichte
 * van de vermogenszones om een leesbaar bereik te houden.
 */
function computePaceZones(thresholdSecPerKm) {
  if (!thresholdSecPerKm) return null;
  return PACE_ZONE_DEFS.map((z) => ({
    zone: z.zone,
    naam: z.naam,
    vanSec: z.van > 0 ? Math.round(thresholdSecPerKm / z.van) : null, // null = geen traagheidsgrens
    totSec: Math.round(thresholdSecPerKm / z.tot),
    van: z.van > 0 ? formatPace(thresholdSecPerKm / z.van) : null,
    tot: formatPace(thresholdSecPerKm / z.tot),
  }));
}

/** Welke tempozone hoort bij een gelopen tempo? */
function zoneForPace(secPerKm, paceZones) {
  if (!secPerKm || !paceZones) return null;
  const hit = paceZones.find((z) => (z.vanSec === null || secPerKm <= z.vanSec) && secPerKm > z.totSec);
  // Sneller dan de snelste ondergrens telt als de zwaarste zone.
  return hit ? hit.zone : paceZones[paceZones.length - 1].zone;
}

/** Herkent een hardloopsessie aan de sportnaam die de app en Strava gebruiken. */
function isRunning(type) {
  if (!type) return false;
  return /hardlo|running|run\b|trail/i.test(String(type));
}

/* ---------------------------------------------------------------------- */
/* Materiaal en ondergrond: twee verschillende dingen                     */
/* ---------------------------------------------------------------------- */

/**
 * Binnen "Fietsen" zitten ritten die niet met elkaar te vergelijken zijn, en
 * daar zijn twee onafhankelijke redenen voor. Die apart houden is het hele
 * punt van deze sectie.
 *
 * De FIETS bepaalt wat een watt oplevert. Een mountainbike op asfalt is bij
 * hetzelfde vermogen trager dan een racefiets op asfalt — dikke banden,
 * rechtopstaande houding, meer gewicht. Dat verschil hangt niet aan het
 * parcours maar aan het materiaal, en het is er ook in de winter op de weg.
 *
 * De ONDERGROND bepaalt iets anders: remmen en weer op gang komen, techniek,
 * een vermogen dat alle kanten op schiet. Dezelfde mountainbike is in het bos
 * trager dan op de weg.
 *
 * Eerder zaten die twee in één veld, waarbij "mtb" stilzwijgend ook "in het
 * bos" betekende. Voor wie zijn mountainbike 's winters op de weg gebruikt
 * klopt dat niet, en dan vergelijkt de app opnieuw dingen die niet bij elkaar
 * horen — alleen subtieler dan eerst.
 */
const BIKE_TYPES = [
  { id: "racefiets", naam: "Racefiets" },
  { id: "gravel", naam: "Gravelfiets" },
  { id: "mtb", naam: "Mountainbike" },
  { id: "ebike", naam: "E-bike" },
  { id: "indoor", naam: "Indoor trainer" },
];

/**
 * De ondergrond is optioneel en mag leeg blijven.
 *
 * Hij is niet uit Strava af te leiden behalve bij een virtuele rit, en een
 * halfslachtige gok ("MountainBikeRide, dus wel bos") is precies wat hier
 * misging. Leeg betekent onbekend, en onbekend hoort alleen bij onbekend.
 */
const SURFACES = [
  { id: "asfalt", naam: "Asfalt", sporten: ["Fietsen", "Hardlopen"] },
  { id: "onverhard", naam: "Onverhard", sporten: ["Fietsen", "Hardlopen"] },
  { id: "gemengd", naam: "Gemengd", sporten: ["Fietsen", "Hardlopen"] },
  { id: "baan", naam: "Baan", sporten: ["Hardlopen"] },
  { id: "binnen", naam: "Binnen", sporten: ["Fietsen", "Hardlopen"] },
];

/** Welke sport een type is, los van hoe het precies geschreven staat. */
function baseSportOf(type) {
  const t = String(type || "").toLowerCase();
  if (isRunning(t)) return "Hardlopen";
  if (/fiets|ride|cycl|bike|mtb|gravel/.test(t)) return "Fietsen";
  return null;
}

/**
 * De materiaalkeuzes die bij een sport horen.
 *
 * Leeg bij hardlopen: welke schoen je aanhad verandert je tempo niet zoals een
 * andere fiets je snelheid verandert, dus daar is de ondergrond de enige as
 * die ertoe doet.
 */
function subTypesFor(type) {
  return baseSportOf(type) === "Fietsen" ? BIKE_TYPES : [];
}

/** De ondergrondkeuzes die bij een sport horen. */
function surfacesFor(type) {
  const sport = baseSportOf(type);
  return sport ? SURFACES.filter((s) => s.sporten.includes(sport)) : [];
}

/** "mtb" -> "Mountainbike". Onbekende waarden komen ongewijzigd terug. */
function subTypeLabel(id) {
  if (!id) return null;
  const hit = BIKE_TYPES.find((s) => s.id === id);
  return hit ? hit.naam : String(id);
}

/** "onverhard" -> "Onverhard". */
function surfaceLabel(id) {
  if (!id) return null;
  const hit = SURFACES.find((s) => s.id === id);
  return hit ? hit.naam : String(id);
}

/** Een sessie binnen: geen wind, geen afdalingen, wél blokken. */
function isIndoorTrainer(subType, surface = null) {
  return subType === "indoor" || surface === "binnen";
}

/**
 * Zijn deze twee sessies op hetzelfde materiaal gereden?
 *
 * Onbekend geldt alleen als gelijk aan onbekend. Een rit zonder label kan
 * alles zijn geweest, dus hem gelijkstellen aan een racefietsrit zou precies
 * de verwarring terugbrengen die dit veld moet oplossen.
 */
function sameSubType(a, b) {
  return (a || null) === (b || null);
}

/** Idem voor de ondergrond. */
function sameSurface(a, b) {
  return (a || null) === (b || null);
}

/**
 * Hoe goed twee sessies te vergelijken zijn: 0 is het best.
 *
 * De fiets weegt zwaarder dan de ondergrond, omdat het verschil tussen een
 * racefiets en een mountainbike er altijd is en het verschil tussen asfalt en
 * bos alleen als je er ook echt in het bos mee bent geweest.
 */
function comparabilityRank(a, b) {
  return (sameSubType(a.subType, b.subType) ? 0 : 2) + (sameSurface(a.surface, b.surface) ? 0 : 1);
}

/* ---------------------------------------------------------------------- */
/* Speed / distance                                                       */
/* ---------------------------------------------------------------------- */

function computeAvgSpeedKmh(distanceKm, durationMin) {
  if (!distanceKm || !durationMin) return null;
  const hours = durationMin / 60;
  if (hours <= 0) return null;
  return Math.round((distanceKm / hours) * 10) / 10;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ---------------------------------------------------------------------- */
/* Normalized Power                                                       */
/* ---------------------------------------------------------------------- */

/**
 * Standard "Normalized Power" algorithm: 30s rolling average of power,
 * raised to the 4th power, averaged, then 4th-rooted. Weights sustained
 * high efforts more heavily than a plain average — better reflects the
 * physiological cost of variable/interval efforts.
 *
 * @param {Array<{tSec: number, power: number|null}>} points - time-ordered samples
 */
function computeNormalizedPower(points) {
  const withPower = points.filter((p) => p.power !== null && p.power !== undefined && p.power >= 0);
  if (withPower.length < 10) return null;
  const totalSec = Math.floor(points[points.length - 1].tSec);
  if (totalSec < 30) return null;

  const resampled = new Array(totalSec + 1).fill(0);
  let pi = 0;
  for (let t = 0; t <= totalSec; t++) {
    while (pi < withPower.length - 1 && withPower[pi + 1].tSec <= t) pi++;
    resampled[t] = withPower[pi].tSec <= t ? withPower[pi].power : 0;
  }

  const windowSize = 30;
  const rolling = [];
  let sum = 0;
  const buffer = [];
  for (let t = 0; t < resampled.length; t++) {
    buffer.push(resampled[t]);
    sum += resampled[t];
    if (buffer.length > windowSize) sum -= buffer.shift();
    if (buffer.length === windowSize) rolling.push(sum / windowSize);
  }
  if (rolling.length === 0) return null;
  const meanFourthPower = rolling.reduce((a, b) => a + b ** 4, 0) / rolling.length;
  return Math.round(meanFourthPower ** 0.25);
}

/* ---------------------------------------------------------------------- */
/* TSS / CTL / ATL / TSB (Performance Management Chart model)             */
/* ---------------------------------------------------------------------- */

/**
 * TSS (Training Stress Score): 100 = one hour at exactly FTP. Prefers
 * power-based TSS (using Normalized Power when available, else plain avg
 * power) since that's the established standard formula. Falls back to an
 * hrTSS-style approximation using the heart-rate zone-4 boundary as an
 * estimated threshold HR when no power data is available — a rougher
 * estimate, clearly labeled as such via the `method` field.
 *
 * @param {{duration_min: number, avg_power?: number, weighted_avg_power?: number, avg_hr?: number}} session
 * @param {number|null} ftp
 * @param {Array|null} hrZones - result of computeHrZones()
 */
/**
 * Trainingsbelasting van één sessie.
 *
 * Volgorde van betrouwbaarheid: gemeten vermogen, dan gelopen tempo, dan een
 * schatting op hartslag. Die middelste stap ontbrak, waardoor elke hardloop
 * terugviel op de hartslagschatting terwijl het tempo — de hardloopequivalent
 * van vermogen — gewoon beschikbaar was.
 *
 * `thresholdPaceSecPerKm` is optioneel; zonder drempeltempo verandert er niets
 * aan het oude gedrag.
 */
function computeSessionTSS(session, ftp, hrZones, thresholdPaceSecPerKm = null) {
  const durationHours = (session.duration_min || 0) / 60;
  if (durationHours <= 0) return null;

  const powerForTss = session.weighted_avg_power || session.avg_power;
  if (ftp && powerForTss) {
    const intensityFactor = powerForTss / ftp;
    return {
      tss: Math.round(durationHours * intensityFactor * intensityFactor * 100),
      intensityFactor: Math.round(intensityFactor * 100) / 100,
      method: "vermogen",
    };
  }

  // rTSS: bij tempo is de verhouding omgekeerd — sneller lopen is minder
  // seconden per kilometer, dus de intensiteit is drempeltempo gedeeld door
  // het gelopen tempo.
  if (thresholdPaceSecPerKm && isRunning(session.type)) {
    const paceSecPerKm = computePaceSecPerKm(session.distance_km, session.duration_min);
    if (paceSecPerKm) {
      const intensityFactor = thresholdPaceSecPerKm / paceSecPerKm;
      return {
        tss: Math.round(durationHours * intensityFactor * intensityFactor * 100),
        intensityFactor: Math.round(intensityFactor * 100) / 100,
        method: "tempo",
      };
    }
  }

  if (hrZones && session.avg_hr) {
    const thresholdHr = hrZones[3].vanBpm; // lower bound of zone 4 ("Drempel") as an estimated threshold HR
    const hrIntensityFactor = session.avg_hr / thresholdHr;
    return {
      tss: Math.round(durationHours * hrIntensityFactor * hrIntensityFactor * 100),
      intensityFactor: Math.round(hrIntensityFactor * 100) / 100,
      method: "hartslag (schatting)",
    };
  }

  return null;
}

/**
 * CTL (Chronic Training Load / "Fitness"): 42-day exponentially weighted
 * average of daily TSS.
 * ATL (Acute Training Load / "Fatigue"): 7-day exponentially weighted
 * average of daily TSS.
 * TSB (Training Stress Balance / "Form") = CTL - ATL.
 *
 * This is the standard Performance Management Chart model used by
 * TrainingPeaks/WKO — pure arithmetic, computed once per day across the
 * full history, independent of the AI.
 *
 * @param {Array} cardioLogs - all cardio sessions (any date range)
 * @param {number|null} ftp
 * @param {Array|null} hrZones
 * @returns {Array<{date, label, ctl, atl, tsb, tss}>|null}
 */
function computeTrainingLoadSeries(cardioLogs, ftp, hrZones, thresholdPaceSecPerKm = null) {
  if (!cardioLogs || cardioLogs.length === 0) return null;
  const tssByDate = {};
  cardioLogs.forEach((c) => {
    const result = computeSessionTSS(c, ftp, hrZones, thresholdPaceSecPerKm);
    if (result) tssByDate[c.date] = (tssByDate[c.date] || 0) + result.tss;
  });
  const dates = Object.keys(tssByDate).sort();
  if (dates.length === 0) return null;

  const startDate = new Date(dates[0] + "T00:00:00");
  const endDate = new Date(todayStr() + "T00:00:00");
  let ctl = 0;
  let atl = 0;
  const series = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = toDateStr(d);
    const tss = tssByDate[dateStr] || 0;
    ctl = ctl + (tss - ctl) / 42;
    atl = atl + (tss - atl) / 7;
    series.push({
      date: dateStr,
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      tsb: Math.round((ctl - atl) * 10) / 10,
      tss,
    });
  }
  return series;
}

/* ---------------------------------------------------------------------- */
/* Body weight                                                            */
/* ---------------------------------------------------------------------- */

/**
 * Finds the weight that applied AT THE TIME of a given session — the most
 * recent weight log on or before that date — not the current/latest weight.
 * Falls back to the earliest known weight if the session predates all logs.
 */
function getWeightAtDate(weightLogs, dateStr) {
  if (!weightLogs || weightLogs.length === 0) return null;
  const onOrBefore = weightLogs.filter((w) => w.date <= dateStr).sort((a, b) => (a.date > b.date ? -1 : 1));
  if (onOrBefore.length > 0) return onOrBefore[0].weight_kg;
  const sorted = [...weightLogs].sort((a, b) => (a.date > b.date ? 1 : -1));
  return sorted[0].weight_kg;
}

function computeWattsPerKg(avgPowerW, weightKg) {
  if (!avgPowerW || !weightKg) return null;
  return Math.round((avgPowerW / weightKg) * 100) / 100;
}

/* ---------------------------------------------------------------------- */
/* Elevation                                                              */
/* ---------------------------------------------------------------------- */

/**
 * Computes total elevation gain/loss from a series of elevation samples,
 * ignoring changes smaller than the noise threshold so GPS/barometric
 * jitter doesn't inflate the total climb on flat terrain.
 *
 * @param {number[]} elevations - ordered elevation samples in meters
 */
function computeElevationGainLoss(elevations, noiseThresholdM = 1) {
  if (!elevations || elevations.length < 2) return { gain: 0, loss: 0 };
  let gain = 0;
  let loss = 0;
  let smoothed = elevations[0];
  for (let i = 1; i < elevations.length; i++) {
    const delta = elevations[i] - smoothed;
    if (Math.abs(delta) >= noiseThresholdM) {
      if (delta > 0) gain += delta;
      else loss += -delta;
      smoothed = elevations[i];
    }
  }
  return { gain: Math.round(gain), loss: Math.round(loss) };
}

/* ---------------------------------------------------------------------- */
/* Long-term history summaries                                            */
/* ---------------------------------------------------------------------- */

function avgOf(arr, getter) {
  const vals = arr.map(getter).filter((v) => v !== null && v !== undefined && !isNaN(v));
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}

function formatDateNL(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
}

function computeCardioHistorySummary(cardioLogs) {
  if (!cardioLogs || cardioLogs.length === 0) return null;
  const sorted = [...cardioLogs].sort((a, b) => (a.date < b.date ? -1 : 1));
  const today = new Date(todayStr() + "T00:00:00");
  const cutoffRecent = new Date(today);
  cutoffRecent.setDate(cutoffRecent.getDate() - 28);
  const cutoffPrev = new Date(today);
  cutoffPrev.setDate(cutoffPrev.getDate() - 56);
  const inRange = (dateStr, start, end) => {
    const d = new Date(dateStr + "T00:00:00");
    return d > start && d <= end;
  };
  const recent = cardioLogs.filter((c) => inRange(c.date, cutoffRecent, today));
  const prev = cardioLogs.filter((c) => inRange(c.date, cutoffPrev, cutoffRecent));
  const sumKm = (arr) => Math.round(arr.reduce((s, c) => s + (c.distance_km || 0), 0) * 10) / 10;
  const sumMin = (arr) => Math.round(arr.reduce((s, c) => s + (c.duration_min || 0), 0));
  const sumM = (arr) => Math.round(arr.reduce((s, c) => s + (c.elevation_gain_m || 0), 0));
  const byType = {};
  cardioLogs.forEach((c) => {
    byType[c.type] = (byType[c.type] || 0) + 1;
  });
  const periodStats = (arr) => ({
    sessies: arr.length,
    km: sumKm(arr),
    minuten: sumMin(arr),
    hoogtemetersTotaal: sumM(arr),
    gemHartslag: avgOf(arr, (c) => c.avg_hr),
    gemMaxHartslag: avgOf(arr, (c) => c.max_hr),
    gemSnelheidKmu: avgOf(arr, (c) => computeAvgSpeedKmh(c.distance_km, c.duration_min)),
    gemVermogen: avgOf(arr, (c) => c.avg_power),
  });
  return {
    totaalAantalSessiesOoit: cardioLogs.length,
    periode: `${formatDateNL(sorted[0].date)} t/m ${formatDateNL(sorted[sorted.length - 1].date)}`,
    verdelingPerType: byType,
    laatste4Weken: periodStats(recent),
    voorgaande4Weken: periodStats(prev),
  };
}

function computeStrengthHistorySummary(workoutLogs) {
  if (!workoutLogs || workoutLogs.length === 0) return null;
  const sorted = [...workoutLogs].sort((a, b) => (a.date < b.date ? -1 : 1));
  const exerciseNames = new Set();
  workoutLogs.forEach((l) => l.exercises.forEach((e) => e.sets.length && exerciseNames.add(e.name)));
  const voortgang = [];
  exerciseNames.forEach((name) => {
    const logsWithEx = sorted.filter((l) => l.exercises.some((e) => e.name === name && e.sets.length));
    if (logsWithEx.length < 2) return;
    const first = logsWithEx[0].exercises.find((e) => e.name === name);
    const last = logsWithEx[logsWithEx.length - 1].exercises.find((e) => e.name === name);
    const firstMax = Math.max(...first.sets.map((s) => s.weight));
    const lastMax = Math.max(...last.sets.map((s) => s.weight));
    voortgang.push({ oefening: name, eersteLog: firstMax, laatsteLog: lastMax, verschil: Math.round((lastMax - firstMax) * 10) / 10 });
  });
  return {
    totaalAantalSessiesOoit: workoutLogs.length,
    periode: `${formatDateNL(sorted[0].date)} t/m ${formatDateNL(sorted[sorted.length - 1].date)}`,
    voortgangPerOefeningSindsEersteLog: voortgang,
  };
}

/**
 * Session-RPE: duration x perceived exertion, the accepted way to quantify gym
 * work when there is no power meter. Returns null unless both are present —
 * a missing value must stay missing rather than become a quietly invented one.
 *
 * Accepts both the camelCase shape the API serializes (`durationMin`) and the
 * snake_case shape read straight from SQLite (`duration_min`). Reading only one
 * of the two is exactly the bug that kept sRPE permanently null in the coach
 * payload, so both are handled here in one place instead of at each call site.
 */
function computeSessionRpe(log) {
  if (!log) return null;
  const duration = log.durationMin ?? log.duration_min;
  if (!log.rpe || !duration) return null;
  return log.rpe * duration;
}

/**
 * Weekly strength load, as ISO weeks (Monday-based) of summed sRPE.
 *
 * Deliberately kept apart from computeTrainingLoadSeries: sRPE and TSS are not
 * the same unit and must never be added together or drawn on a shared axis.
 * This is the gym counterpart to the cardio-only PMC chart, not an extension
 * of it.
 *
 * Weeks in which sessions were logged without RPE/duration report sRPE null
 * but still count their sessions, so "trained but didn't rate it" stays
 * visible instead of looking like a rest week.
 */
function computeWeeklyStrengthLoad(workoutLogs, weeks = 12) {
  if (!workoutLogs || workoutLogs.length === 0) return null;

  const mondayOf = (dateStr) => {
    const d = new Date(dateStr + "T00:00:00");
    // getDay(): 0 = Sunday. Shift so Monday starts the week.
    const offset = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - offset);
    return toDateStr(d);
  };

  const buckets = new Map();
  workoutLogs.forEach((log) => {
    if (!log.date) return;
    const week = mondayOf(log.date);
    if (!buckets.has(week)) buckets.set(week, { weekStart: week, sRpe: 0, rated: 0, sessions: 0 });
    const bucket = buckets.get(week);
    bucket.sessions += 1;
    const sRpe = computeSessionRpe(log);
    if (sRpe !== null) {
      bucket.sRpe += sRpe;
      bucket.rated += 1;
    }
  });

  return Array.from(buckets.values())
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1))
    .slice(-weeks)
    .map((b) => ({
      weekStart: b.weekStart,
      label: formatDateNL(b.weekStart),
      sessions: b.sessions,
      sessionsRated: b.rated,
      sRpe: b.rated > 0 ? b.sRpe : null,
    }));
}


/* ---------------------------------------------------------------------- */
/* Histograms, power curve, time-in-zone                                  */
/* ---------------------------------------------------------------------- */

/**
 * Builds a histogram of seconds spent at each value, from parallel
 * time/value arrays (as produced by a Strava stream or a GPX track).
 *
 * Storing a histogram rather than the raw per-second series is a deliberate
 * trade-off: it's a few hundred numbers instead of tens of thousands, and —
 * crucially — time-in-zone can be recomputed from it for ANY zone definition.
 * So when you later adjust your FTP or max heart rate, historical sessions
 * re-bucket correctly instead of being stuck with whatever zones applied on
 * the day they were imported.
 *
 * @param {number[]} timeSec - seconds since start, ascending
 * @param {Array<number|null>} values
 * @param {number} binSize - bucket width (1 for bpm, 5 or 10 for watts)
 * @returns {Object<string, number>} bin lower bound -> seconds
 */
function computeHistogram(timeSec, values, binSize = 1) {
  if (!Array.isArray(timeSec) || !Array.isArray(values) || timeSec.length < 2) return null;
  const hist = {};
  let counted = 0;
  for (let i = 0; i < timeSec.length - 1; i++) {
    const v = values[i];
    if (v === null || v === undefined || isNaN(v)) continue;
    // Gaps (auto-pause, lost signal) would otherwise be charged to whatever
    // value happened to precede them, so ignore implausibly long steps.
    const dt = timeSec[i + 1] - timeSec[i];
    if (!(dt > 0) || dt > 30) continue;
    const bin = Math.floor(v / binSize) * binSize;
    hist[bin] = (hist[bin] || 0) + dt;
    counted += dt;
  }
  return counted > 0 ? hist : null;
}

/** Total seconds represented by a histogram. */
function histogramTotalSeconds(hist) {
  if (!hist) return 0;
  return Object.values(hist).reduce((a, b) => a + b, 0);
}

/**
 * Distributes a histogram over zone definitions, returning seconds per zone.
 * Works for both heart rate zones (computeHrZones) and power zones
 * (computePowerZones) — pass the matching bound accessor.
 */
function timeInZones(hist, zones, lowerKey, upperKey) {
  if (!hist || !zones) return null;
  const result = zones.map((z) => ({ zone: z.zone, naam: z.naam, seconden: 0 }));
  Object.entries(hist).forEach(([binStr, seconds]) => {
    const value = Number(binStr);
    let idx = zones.findIndex(
      (z) => value >= z[lowerKey] && (z[upperKey] === null || value <= z[upperKey])
    );
    // Anything under zone 1 counts as zone 1; anything above the top zone as the top zone.
    if (idx === -1) idx = value < zones[0][lowerKey] ? 0 : zones.length - 1;
    result[idx].seconden += seconds;
  });
  return result.map((r) => ({ ...r, minuten: Math.round((r.seconden / 60) * 10) / 10 }));
}

const timeInHrZones = (hist, hrZones) => timeInZones(hist, hrZones, "vanBpm", "totBpm");
const timeInPowerZones = (hist, powerZones) => timeInZones(hist, powerZones, "vanW", "totW");

/** Durations (seconds) the power curve is sampled at — the conventional set. */
const POWER_CURVE_DURATIONS = [1, 5, 15, 30, 60, 120, 300, 480, 720, 1200, 1800, 3600];

/**
 * Mean maximal power: for each duration, the best average power sustained over
 * any window of that length. This is the standard way to track cycling
 * progress, and the 20-minute figure is what FTP is usually estimated from.
 *
 * Uses a prefix-sum so each duration costs one linear pass rather than
 * re-summing every window.
 */
function computePowerCurve(timeSec, watts) {
  if (!Array.isArray(timeSec) || !Array.isArray(watts) || timeSec.length < 2) return null;

  // Resample onto a 1 Hz grid: Strava streams are usually 1 Hz already, but
  // smart recording and GPX exports are not, and the windowing below assumes
  // evenly spaced samples.
  const totalSec = Math.floor(timeSec[timeSec.length - 1]);
  if (totalSec < 1) return null;
  const series = new Array(totalSec + 1).fill(null);
  let idx = 0;
  for (let t = 0; t <= totalSec; t++) {
    while (idx < timeSec.length - 1 && timeSec[idx + 1] <= t) idx++;
    const v = watts[idx];
    series[t] = v === null || v === undefined || isNaN(v) ? 0 : v;
  }

  const prefix = new Array(series.length + 1).fill(0);
  for (let i = 0; i < series.length; i++) prefix[i + 1] = prefix[i] + series[i];

  const curve = {};
  for (const d of POWER_CURVE_DURATIONS) {
    if (d > series.length) break;
    let best = 0;
    for (let start = 0; start + d <= series.length; start++) {
      const avg = (prefix[start + d] - prefix[start]) / d;
      if (avg > best) best = avg;
    }
    if (best > 0) curve[d] = Math.round(best);
  }
  return Object.keys(curve).length > 0 ? curve : null;
}

/**
 * Estimates FTP from a power curve. Prefers a real 60-minute effort when one
 * exists, otherwise falls back to the conventional 95% of best 20-minute
 * power. Returns null when there's nothing long enough to judge from.
 */
function estimateFtpFromCurve(curve) {
  if (!curve) return null;
  if (curve[3600]) return { ftp: curve[3600], basis: "60 minuten (gemeten)" };
  if (curve[1200]) return { ftp: Math.round(curve[1200] * 0.95), basis: "95% van beste 20 minuten" };
  if (curve[480]) return { ftp: Math.round(curve[480] * 0.9), basis: "90% van beste 8 minuten (ruwe schatting)" };
  return null;
}

/** Best value per duration across many sessions — the all-time power curve. */
function mergePowerCurves(curves) {
  const merged = {};
  curves.filter(Boolean).forEach((curve) => {
    Object.entries(curve).forEach(([d, w]) => {
      if (!merged[d] || w > merged[d]) merged[d] = w;
    });
  });
  return Object.keys(merged).length > 0 ? merged : null;
}

module.exports = {
  WEEKDAYS,
  toDateStr,
  todayStr,
  weekdayNameForDate,
  daysUntil,
  computeHrZones,
  zoneForHr,
  computeRestingHrBaseline,
  RESTING_HR_WINDOW_DAYS,
  RESTING_HR_MIN_NIGHTS,
  computePowerZones,
  computePaceZones,
  computePaceSecPerKm,
  formatPace,
  zoneForPace,
  isRunning,
  BIKE_TYPES,
  SURFACES,
  baseSportOf,
  subTypesFor,
  surfacesFor,
  subTypeLabel,
  surfaceLabel,
  isIndoorTrainer,
  sameSubType,
  sameSurface,
  comparabilityRank,
  computeAvgSpeedKmh,
  haversineKm,
  computeNormalizedPower,
  computeSessionTSS,
  computeTrainingLoadSeries,
  getWeightAtDate,
  computeWattsPerKg,
  computeElevationGainLoss,
  formatDateNL,
  avgOf,
  computeCardioHistorySummary,
  computeStrengthHistorySummary,
  computeSessionRpe,
  computeWeeklyStrengthLoad,
  computeHistogram,
  histogramTotalSeconds,
  timeInZones,
  timeInHrZones,
  timeInPowerZones,
  computePowerCurve,
  estimateFtpFromCurve,
  mergePowerCurves,
  POWER_CURVE_DURATIONS,
};
