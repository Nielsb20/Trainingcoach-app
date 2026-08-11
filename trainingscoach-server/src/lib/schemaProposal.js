"use strict";

/**
 * schemaProposal.js — the coach proposing a whole training schema, rather than
 * commenting on the one it was handed.
 *
 * Up to now the athlete built the schema (which days, which exercises, which
 * sets and reps) and the coach only filled it in per week. This module covers
 * the step before that: given the goals, the constraints and the training
 * history, what should the schema itself look like.
 *
 * Everything the model returns is treated as untrusted input. Accepting a
 * proposal replaces the schema — the most destructive write in the app — so a
 * malformed weekday, a 400-rep set or forty invented training days must never
 * reach the database. `normalizeProposal` is the gate: it throws on a proposal
 * with nothing usable in it, and quietly drops the individual parts that make
 * no sense.
 */

const { WEEKDAYS } = require("./calculations");

const TIME_OF_DAY = ["ochtend", "middag", "avond"];
// Kept in step with CARDIO_TYPES in the frontend: the schema editor renders
// these in a <select>, and a value outside the list would show up blank.
const CARDIO_TYPES = ["Hardlopen", "Fietsen", "Zwemmen", "Wandelen", "Anders"];

const MAX_DAYS = 7;
const MAX_EXERCISES_PER_DAY = 15;
const MAX_CARDIO_DAYS = 14; // two sessions a day is already unusual
const MAX_SETS = 12;
const MAX_REPS = 100;

/* ------------------------------ the prompt ------------------------------ */

/**
 * The JSON shape we want back. Gemini enforces this server-side; Anthropic
 * gets the same contract through the system prompt.
 */
const SCHEMA_PROPOSAL_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    toelichting: { type: "STRING" },
    waarschuwing: { type: "STRING", nullable: true },
    opbouw: { type: "ARRAY", items: { type: "STRING" } },
    krachtdagen: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          naam: { type: "STRING" },
          weekdagen: { type: "ARRAY", items: { type: "STRING" } },
          moment: { type: "STRING", nullable: true },
          toelichting: { type: "STRING", nullable: true },
          oefeningen: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                naam: { type: "STRING" },
                sets: { type: "INTEGER" },
                reps: { type: "INTEGER" },
                toelichting: { type: "STRING", nullable: true },
              },
              required: ["naam", "sets", "reps"],
            },
          },
        },
        required: ["naam", "weekdagen", "oefeningen"],
      },
    },
    cardiodagen: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          weekdag: { type: "STRING" },
          type: { type: "STRING" },
          moment: { type: "STRING", nullable: true },
          invulling: { type: "STRING" },
        },
        required: ["weekdag", "type", "invulling"],
      },
    },
  },
  required: ["toelichting", "krachtdagen", "cardiodagen"],
};

function buildSchemaProposalSystemPrompt() {
  return (
    "Je bent een ervaren personal trainer en duursportcoach. Je ontwerpt het TRAININGSSCHEMA van je cliënt: de vaste weekstructuur — welke trainingsdagen, op welke weekdagen, met welke oefeningen, sets en herhalingen, plus de vaste cardiomomenten. Je vult hier geen losse week in; je legt de basis waar de cliënt weken- tot maandenlang mee traint. " +
    "vandaag geeft de huidige datum (JJJJ-MM-DD) en vandaagWeekdag de bijbehorende weekdag. " +
    "doelen is het uitgangspunt: alles wat je voorstelt moet aantoonbaar in dienst staan van doelen.doel. Is dat leeg, ga dan uit van algemene fitheid en zeg in toelichting dat een concreter doel tot een gerichter schema leidt. " +
    "HARDE RANDVOORWAARDEN — hier mag je niet vanaf wijken, ook niet als je een 'beter' schema kent: " +
    "beschikbareWeekdagen (is die lijst gevuld, plan dan UITSLUITEND op die dagen), krachtdagenPerWeek en cardiodagenPerWeek (het aantal dagen dat de cliënt beschikbaar heeft — ga daar niet overheen), sessieMinuten (schat de duur van je sessie realistisch: ongeveer 3 tot 4 minuten per set inclusief rust, en blijf binnen die tijd), en materiaal (stel alleen oefeningen voor die met dat materiaal uitvoerbaar zijn — geen beenpers als er alleen dumbbells zijn). " +
    "beperkingen bevat blessures en oefeningen die de cliënt niet kan of wil doen. Neem die absoluut serieus: vermijd de genoemde bewegingen, kies een alternatief dat dezelfde spiergroep traint, en benoem in de toelichting van die oefening waarom je het alternatief kiest. Verzin nooit medisch advies en zeg bij twijfel dat dit met een fysiotherapeut afgestemd hoort te worden. " +
    "CONTINUÏTEIT BOVEN VERNIEUWING. huidigSchema is wat de cliënt nu doet, en langetermijnSamenvattingKracht laat zien op welke oefeningen hij daadwerkelijk progressie boekt. Een schema is pas iets waard als het volgehouden wordt, en een compleet nieuw schema gooit alle opgebouwde referentiegewichten weg. Behoud daarom oefeningen die lopen, met exact dezelfde naam als in huidigSchema, zodat de logs en de vorige-sessie-referentie blijven werken. Verander alleen wat een aanwijsbaar probleem oplost: een doel dat niet gedekt wordt, een oefening die al lang stagneert, een spiergroep die ontbreekt, of een belasting die niet bij het herstel past. Benoem per wijziging in toelichting waarom. Is huidigSchema leeg, ontwerp dan wel een volledig schema vanaf nul. " +
    "Bouw het schema op volgens de gangbare principes: zware samengestelde oefeningen (squat, deadlift, bankdrukken, roeien, overhead press) eerst in de sessie en met de meeste rust, isolatie daarna; per spiergroep ongeveer 10 tot 20 werksets per week verdeeld over de dagen; kracht in het bereik van 3 tot 6 herhalingen, spiergroei in 6 tot 12, spieruithoudingsvermogen daarboven — kies het bereik dat bij doelen.doel past en meng waar dat logisch is. Plan minimaal 48 uur tussen twee zware sessies voor dezelfde spiergroep. " +
    "Stem kracht en cardio op elkaar af in plaats van ze los te ontwerpen. Zware beentraining en een zware duur- of intervalrit horen niet op opeenvolgende dagen; is de cliënt vooral duursporter, dan is kracht ondersteunend en houd je het volume beperkt; is kracht het doel, dan is cardio grotendeels laag-intensief. Gebruik moment (ochtend/middag/avond) om de werkelijke hersteltijd te sturen: een avondsessie gevolgd door een ochtendtraining geeft maar zo'n twaalf uur. " +
    "trainingsbelasting (CTL/ATL/TSB) en herstel zijn hard berekend, niet door jou geschat. Wijzen ze op onvoldoende herstel of een sterk oplopende belasting, kies dan een voorzichtiger opbouw en zeg dat in waarschuwing. LET OP: CTL/ATL/TSB zijn uitsluitend op cardio gebaseerd; krachttraining zit er niet in. " +
    "geplandeEvenementen bepaalt de periodisering: is er een evenement in zicht, laat het schema daar dan naartoe werken en beschrijf in opbouw hoe de weken tot dat moment verlopen, inclusief afbouw. " +
    "eerderAfgewezenSchemas bevat schemavoorstellen die de cliënt heeft afgewezen, met reden. Kom niet met hetzelfde terug: verwerk de reden of kies een andere aanpak. " +
    "vraagVanGebruiker gaat, als die niet null is, boven de standaardaanpak hierboven. " +
    "Antwoord UITSLUITEND met geldig JSON (geen markdown-codeblokken, geen tekst buiten het JSON-object) volgens exact dit format: " +
    '{"toelichting": string, "waarschuwing": string of null, "opbouw": string[], "krachtdagen": [{"naam": string, "weekdagen": string[], "moment": string of null, "toelichting": string of null, "oefeningen": [{"naam": string, "sets": number, "reps": number, "toelichting": string of null}]}], "cardiodagen": [{"weekdag": string, "type": string, "moment": string of null, "invulling": string}]}. ' +
    "toelichting: 3 tot 6 zinnen waarin je uitlegt hoe dit schema het doel dient, wat je behoudt uit het huidige schema en wat je verandert — met de reden erbij. " +
    "waarschuwing: alleen bij een echt risico (herstel, blessure, te snelle opbouw), anders null. " +
    "opbouw: 2 tot 5 punten over hoe het schema zich de komende weken ontwikkelt, bijvoorbeeld wanneer gewicht omhoog kan en wanneer een rustigere week volgt. Beschrijf hier de progressie, niet de losse trainingen. " +
    `krachtdagen: elke dag krijgt een korte herkenbare naam (bijvoorbeeld "Dag A – Push"), de weekdag(en) waarop hij valt, en de oefeningen met sets en reps. Gebruik voor weekdagen exact deze namen: ${WEEKDAYS.join(", ")}. Gebruik voor moment exact "ochtend", "middag" of "avond", of null als het niet uitmaakt. Zet bij oefening.toelichting kort waarom die oefening erin zit, of met welk gewicht te beginnen op basis van recenteKrachttrainingen — noem daarbij werkelijke getallen als je die hebt. ` +
    "Is doelen.focus 'cardio' en wil de cliënt geen krachttraining, geef dan een lege lijst krachtdagen in plaats van iets te verzinnen. " +
    `cardiodagen: de vaste wekelijkse cardiomomenten. Gebruik voor type een van: ${CARDIO_TYPES.join(", ")}. Zet in invulling het karakter van die vaste sessie (bijvoorbeeld "rustige duurloop 60-75 min in zone 2"), niet een datumgebonden training. ` +
    "Wees concreet en eerlijk, geen motivatiepraat, geen markdown-opmaak binnen de tekstvelden."
  );
}

/* ------------------------------ validation ------------------------------ */

function cleanString(value, maxLength) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

/** Matches a weekday case-insensitively and returns it in canonical spelling. */
function canonicalWeekday(value) {
  if (typeof value !== "string") return null;
  const needle = value.trim().toLowerCase();
  return WEEKDAYS.find((w) => w.toLowerCase() === needle) || null;
}

function canonicalTimeOfDay(value) {
  if (typeof value !== "string") return null;
  const needle = value.trim().toLowerCase();
  return TIME_OF_DAY.includes(needle) ? needle : null;
}

function clampInt(value, min, max, fallback) {
  // Missing is not zero: Number(null) and Number("") are both 0, which would
  // clamp a left-out rep count to 1 rep instead of the sensible default.
  if (value === null || value === undefined || value === "") return fallback;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Turns whatever the model produced into something the schema tables accept.
 *
 * Ids are generated here rather than taken from the model: they are database
 * keys, and a repeated or missing one would either collide or silently drop an
 * exercise. `idPrefix` keeps the ids of two proposals apart.
 *
 * Throws when there is no usable training day at all — an empty schema is not
 * a proposal, and writing one would wipe the athlete's schema for nothing.
 */
function normalizeProposal(raw, { idPrefix = `sp${Date.now()}` } = {}) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Het model gaf geen bruikbaar schemavoorstel terug.");
  }

  const rawDays = Array.isArray(raw.krachtdagen) ? raw.krachtdagen.slice(0, MAX_DAYS) : [];
  const days = [];
  rawDays.forEach((day, dayIdx) => {
    if (!day || typeof day !== "object") return;
    const name = cleanString(day.naam, 60);
    if (!name) return;

    const exercises = [];
    const rawExercises = Array.isArray(day.oefeningen) ? day.oefeningen.slice(0, MAX_EXERCISES_PER_DAY) : [];
    rawExercises.forEach((ex, exIdx) => {
      if (!ex || typeof ex !== "object") return;
      const exName = cleanString(ex.naam, 80);
      if (!exName) return;
      exercises.push({
        id: `${idPrefix}-d${dayIdx}-e${exIdx}`,
        name: exName,
        targetSets: clampInt(ex.sets, 1, MAX_SETS, 3),
        targetReps: clampInt(ex.reps, 1, MAX_REPS, 8),
        // Display only: the schema tables have no room for it, but "why this
        // exercise" is most of the value of asking a coach in the first place.
        toelichting: cleanString(ex.toelichting, 300),
      });
    });
    // A training day without exercises is an empty card in the schema editor.
    if (exercises.length === 0) return;

    const weekdays = [];
    (Array.isArray(day.weekdagen) ? day.weekdagen : []).forEach((w) => {
      const canonical = canonicalWeekday(w);
      if (canonical && !weekdays.includes(canonical)) weekdays.push(canonical);
    });

    days.push({
      id: `${idPrefix}-d${dayIdx}`,
      name,
      weekdays,
      timeOfDay: canonicalTimeOfDay(day.moment),
      toelichting: cleanString(day.toelichting, 300),
      exercises,
    });
  });

  const cardioDays = [];
  const rawCardio = Array.isArray(raw.cardiodagen) ? raw.cardiodagen.slice(0, MAX_CARDIO_DAYS) : [];
  rawCardio.forEach((c, idx) => {
    if (!c || typeof c !== "object") return;
    const weekday = canonicalWeekday(c.weekdag);
    if (!weekday) return; // a cardio slot without a valid weekday cannot be placed

    const rawType = cleanString(c.type, 40);
    const matched = rawType ? CARDIO_TYPES.find((t) => t.toLowerCase() === rawType.toLowerCase()) : null;
    const notes = cleanString(c.invulling, 300);
    cardioDays.push({
      id: `${idPrefix}-c${idx}`,
      weekday,
      type: matched || "Anders",
      timeOfDay: canonicalTimeOfDay(c.moment),
      // An unrecognised sport would be lost in the "Anders" bucket, so keep the
      // coach's own word for it in the notes the editor does show.
      notes: matched ? notes : [rawType, notes].filter(Boolean).join(": ") || null,
    });
  });

  if (days.length === 0 && cardioDays.length === 0) {
    throw new Error(
      "Het voorstel bevatte geen bruikbare trainingsdagen. Probeer het opnieuw, eventueel met een concreter doel."
    );
  }

  return {
    days,
    cardioDays,
    toelichting: cleanString(raw.toelichting, 2000),
    waarschuwing: cleanString(raw.waarschuwing, 600),
    opbouw: (Array.isArray(raw.opbouw) ? raw.opbouw : [])
      .map((o) => cleanString(o, 400))
      .filter(Boolean)
      .slice(0, 8),
  };
}

/* -------------------------------- the diff ------------------------------- */

function exerciseNames(schemaDays) {
  const names = new Set();
  (schemaDays || []).forEach((d) => (d.exercises || []).forEach((e) => e.name && names.add(e.name.trim())));
  return names;
}

/**
 * What accepting this proposal would actually change.
 *
 * Shown before the athlete accepts, because "replace my whole schema" is not a
 * decision anyone should make from a wall of exercise names. Exercises that
 * disappear matter most: logged history keeps them, but the schema stops
 * offering them, and that is the kind of change you want to have seen coming.
 */
function summarizeChanges(currentSchema, proposal) {
  const current = currentSchema || { days: [], cardioDays: [] };
  const currentDayNames = (current.days || []).map((d) => (d.name || "").trim().toLowerCase());
  const proposalDayNames = (proposal.days || []).map((d) => (d.name || "").trim().toLowerCase());

  const currentExercises = exerciseNames(current.days);
  const proposalExercises = exerciseNames(proposal.days);

  const changedDays = (proposal.days || [])
    .filter((d) => currentDayNames.includes((d.name || "").trim().toLowerCase()))
    .filter((d) => {
      const existing = (current.days || []).find(
        (c) => (c.name || "").trim().toLowerCase() === (d.name || "").trim().toLowerCase()
      );
      if (!existing) return false;
      const sameExercises =
        existing.exercises.length === d.exercises.length &&
        existing.exercises.every(
          (e, i) =>
            e.name.trim().toLowerCase() === d.exercises[i].name.trim().toLowerCase() &&
            e.targetSets === d.exercises[i].targetSets &&
            e.targetReps === d.exercises[i].targetReps
        );
      const sameWeekdays =
        (existing.weekdays || []).join(",") === (d.weekdays || []).join(",") &&
        (existing.timeOfDay || null) === (d.timeOfDay || null);
      return !(sameExercises && sameWeekdays);
    })
    .map((d) => d.name);

  // One workout twice a week counts as two sessions: that is what the athlete
  // has to fit into their week, and what the goals cap.
  const strengthSessionsPerWeek = (proposal.days || []).reduce(
    (total, d) => total + Math.max((d.weekdays || []).length, 1),
    0
  );

  return {
    nieuweDagen: (proposal.days || []).filter((d) => !currentDayNames.includes((d.name || "").trim().toLowerCase())).map((d) => d.name),
    vervallenDagen: (current.days || []).filter((d) => !proposalDayNames.includes((d.name || "").trim().toLowerCase())).map((d) => d.name),
    gewijzigdeDagen: changedDays,
    nieuweOefeningen: [...proposalExercises].filter((n) => !currentExercises.has(n)),
    vervallenOefeningen: [...currentExercises].filter((n) => !proposalExercises.has(n)),
    krachtsessiesPerWeek: strengthSessionsPerWeek,
    cardiosessiesPerWeek: (proposal.cardioDays || []).length,
    huidigAantalDagen: (current.days || []).length,
  };
}

module.exports = {
  buildSchemaProposalSystemPrompt,
  SCHEMA_PROPOSAL_RESPONSE_SCHEMA,
  normalizeProposal,
  summarizeChanges,
  CARDIO_TYPES,
  TIME_OF_DAY,
};
