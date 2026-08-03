"use strict";

/**
 * Per-session analysis: everything interesting about one ride, plus optional
 * coach feedback on it.
 *
 * The numbers are computed here from stored data (histograms, power curve,
 * profile) rather than in the browser, so the frontend can stay a view layer
 * and the same figures back both the screen and the coach payload.
 */

const express = require("express");
const { db } = require("../db/db");
const calc = require("../lib/calculations");
const { serialize: serializeCardio } = require("./cardioLogs");

const router = express.Router();

function getProfile() {
  const row = db.prepare("SELECT * FROM profile WHERE id = 1").get();
  return { maxHr: row?.max_hr ?? null, restingHr: row?.resting_hr ?? null, ftp: row?.ftp ?? null };
}

/**
 * Comparable earlier sessions: same sport, within 20% distance, so "faster
 * than last time" means something. A 20 km ride and a 200 km ride aren't
 * usefully compared, however similar the sport.
 */
function findComparableSessions(session, limit = 5) {
  if (!session.distance_km) return [];
  const rows = db
    .prepare("SELECT * FROM cardio_logs WHERE type = ? AND date < ? AND distance_km IS NOT NULL ORDER BY date DESC LIMIT 60")
    .all(session.type, session.date);
  return rows
    .filter((r) => Math.abs(r.distance_km - session.distance_km) / session.distance_km <= 0.2)
    .slice(0, limit)
    .map(serializeCardio);
}

// GET /api/sessions/:id
router.get("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM cardio_logs WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Sessie niet gevonden." });

  const session = serializeCardio(row);
  const profile = getProfile();
  const hrZones = profile.maxHr ? calc.computeHrZones(profile.maxHr, profile.restingHr) : null;
  const powerZones = profile.ftp ? calc.computePowerZones(profile.ftp) : null;

  const hrHistogram = row.hr_histogram_json ? JSON.parse(row.hr_histogram_json) : null;
  const powerHistogram = row.power_histogram_json ? JSON.parse(row.power_histogram_json) : null;
  const powerCurve = row.power_curve_json ? JSON.parse(row.power_curve_json) : null;

  const tss = calc.computeSessionTSS(session, profile.ftp, hrZones);
  const weightKg = calc.getWeightAtDate(
    db.prepare("SELECT * FROM weight_logs ORDER BY date").all(),
    session.date
  );

  // Cardiac drift: heart rate creeping up at constant effort is the classic
  // fatigue signal on a long ride. Comparing first and second half of the
  // profile is the standard way to spot it.
  let drift = null;
  if (session.profile && session.profile.length >= 6) {
    const points = session.profile.filter((p) => p.gemHartslag);
    if (points.length >= 6) {
      const half = Math.floor(points.length / 2);
      const avg = (arr, key) => {
        const v = arr.map((p) => p[key]).filter((x) => x != null);
        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
      };
      const firstHr = avg(points.slice(0, half), "gemHartslag");
      const secondHr = avg(points.slice(half), "gemHartslag");
      const firstPower = avg(points.slice(0, half), "gemVermogen");
      const secondPower = avg(points.slice(half), "gemVermogen");
      if (firstHr && secondHr) {
        drift = {
          eersteHelftHartslag: Math.round(firstHr),
          tweedeHelftHartslag: Math.round(secondHr),
          verschilBpm: Math.round(secondHr - firstHr),
          eersteHelftVermogen: firstPower ? Math.round(firstPower) : null,
          tweedeHelftVermogen: secondPower ? Math.round(secondPower) : null,
        };
      }
    }
  }

  const comparable = findComparableSessions(session);
  const speed = calc.computeAvgSpeedKmh(session.distance_km, session.duration_min);
  const comparableSpeeds = comparable
    .map((c) => calc.computeAvgSpeedKmh(c.distance_km, c.duration_min))
    .filter(Boolean);

  const feedbackRow = db.prepare("SELECT * FROM session_feedback WHERE cardio_log_id = ?").get(session.id);

  res.json({
    sessie: session,
    berekend: {
      gemSnelheidKmu: speed,
      tss: tss?.tss ?? null,
      intensiteitsfactor: tss?.intensityFactor ?? null,
      tssMethode: tss?.method ?? null,
      wattPerKg: calc.computeWattsPerKg(session.avg_power, weightKg),
      gewichtKg: weightKg,
      variabiliteit:
        session.avg_power && session.weighted_avg_power
          ? Math.round((session.weighted_avg_power / session.avg_power) * 100) / 100
          : null,
    },
    zones: {
      hartslag: hrHistogram && hrZones ? calc.timeInHrZones(hrHistogram, hrZones) : null,
      vermogen: powerHistogram && powerZones ? calc.timeInPowerZones(powerHistogram, powerZones) : null,
      beschikbaar: !!(hrHistogram || powerHistogram),
      redenOntbreekt: !hrHistogram && !powerHistogram
        ? "Deze sessie heeft geen detailgegevens. Synchroniseer opnieuw met Strava om ze bij te werken."
        : null,
    },
    vermogenscurve: powerCurve
      ? calc.POWER_CURVE_DURATIONS.filter((d) => powerCurve[d] !== undefined).map((d) => ({
          duurSeconden: d,
          label: d < 60 ? `${d}s` : `${d / 60}min`,
          watt: powerCurve[d],
        }))
      : null,
    drift,
    vergelijking: {
      aantalVergelijkbaar: comparable.length,
      gemSnelheidEerder: comparableSpeeds.length
        ? Math.round((comparableSpeeds.reduce((a, b) => a + b, 0) / comparableSpeeds.length) * 10) / 10
        : null,
      sessies: comparable.map((c) => ({
        id: c.id,
        datum: c.date,
        afstandKm: c.distance_km,
        snelheidKmu: calc.computeAvgSpeedKmh(c.distance_km, c.duration_min),
        gemHartslag: c.avg_hr,
        gemVermogen: c.avg_power,
      })),
    },
    evenement: db.prepare("SELECT * FROM events WHERE date = ?").get(session.date) || null,
    feedback: feedbackRow
      ? {
          analyse: feedbackRow.analyse,
          tips: feedbackRow.tips_json ? JSON.parse(feedbackRow.tips_json) : [],
          rawFeedback: feedbackRow.raw_feedback,
          date: feedbackRow.created_at,
        }
      : null,
  });
});

/**
 * POST /api/sessions/:id/feedback  { force?: boolean }
 *
 * Asks the coach to assess this one session. Cached afterwards: the ride
 * doesn't change, so regenerating on every visit would spend tokens on an
 * answer that should be the same. Pass force to ask again anyway.
 */
router.post("/:id/feedback", async (req, res) => {
  const row = db.prepare("SELECT * FROM cardio_logs WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Sessie niet gevonden." });

  const existing = db.prepare("SELECT * FROM session_feedback WHERE cardio_log_id = ?").get(row.id);
  if (existing && !req.body?.force) {
    return res.json({
      analyse: existing.analyse,
      tips: existing.tips_json ? JSON.parse(existing.tips_json) : [],
      rawFeedback: existing.raw_feedback,
      date: existing.created_at,
      uitCache: true,
    });
  }

  const session = serializeCardio(row);
  const profile = getProfile();
  const hrZones = profile.maxHr ? calc.computeHrZones(profile.maxHr, profile.restingHr) : null;
  const tss = calc.computeSessionTSS(session, profile.ftp, hrZones);
  const weightKg = calc.getWeightAtDate(db.prepare("SELECT * FROM weight_logs ORDER BY date").all(), session.date);
  const hrHistogram = row.hr_histogram_json ? JSON.parse(row.hr_histogram_json) : null;
  const powerHistogram = row.power_histogram_json ? JSON.parse(row.power_histogram_json) : null;
  const event = db.prepare("SELECT * FROM events WHERE date = ?").get(session.date);
  const comparable = findComparableSessions(session);

  const payload = {
    vandaag: calc.todayStr(),
    sessie: {
      datum: session.date,
      type: session.type,
      duur_min: session.duration_min,
      afstand_km: session.distance_km,
      gem_snelheid_kmu: calc.computeAvgSpeedKmh(session.distance_km, session.duration_min),
      gem_hartslag: session.avg_hr,
      max_hartslag: session.max_hr,
      gem_vermogen_watt: session.avg_power,
      gewogen_gem_vermogen_watt: session.weighted_avg_power,
      watt_per_kg: calc.computeWattsPerKg(session.avg_power, weightKg),
      gem_cadans: session.avg_cadence,
      hoogtemeters: session.elevation_gain_m,
      tss: tss?.tss ?? null,
      intensiteitsfactor: tss?.intensityFactor ?? null,
      notities: session.notes,
      verloop: session.profile
        ? session.profile.map((p) => ({
            minuut: p.tMin, hartslag: p.gemHartslag, snelheid_kmu: p.gemSnelheidKmu,
            vermogen_watt: p.gemVermogen, cadans: p.gemCadans, hoogte_m: p.hoogte,
          }))
        : null,
    },
    tijdInZones: hrHistogram && hrZones ? calc.timeInHrZones(hrHistogram, hrZones) : null,
    tijdInVermogenszones:
      powerHistogram && profile.ftp
        ? calc.timeInPowerZones(powerHistogram, calc.computePowerZones(profile.ftp))
        : null,
    evenement: event ? { naam: event.name, doel: event.target, type: event.type } : null,
    vergelijkbareEerdereSessies: comparable.map((c) => ({
      datum: c.date, afstand_km: c.distance_km,
      snelheid_kmu: calc.computeAvgSpeedKmh(c.distance_km, c.duration_min),
      gem_hartslag: c.avg_hr, gem_vermogen_watt: c.avg_power,
    })),
    hartslagzones: hrZones ? hrZones.map((z) => ({ zone: z.zone, naam: z.naam, van: z.vanBpm, tot: z.totBpm })) : null,
    ftp: profile.ftp,
  };

  const systemPrompt =
    "Je bent een ervaren wielren- en hardloopcoach. Je beoordeelt ÉÉN specifieke trainingssessie van je cliënt. " +
    "Alle cijfers zijn vooraf berekend en hard: reken ze niet opnieuw uit en wijk er niet vanaf. " +
    "Kijk naar het karakter van de sessie (verloop, tijd in zones, verhouding vermogen/hartslag), naar wat er goed ging, " +
    "en naar wat opvalt. Vergelijk met vergelijkbareEerdereSessies als die er zijn — dat maakt 'sneller' of 'efficiënter' pas betekenisvol. " +
    "Betrek hoogtemeters voordat je iets over snelheid zegt, en let op oplopende hartslag bij gelijkblijvend vermogen (cardiac drift), " +
    "maar controleer eerst of dat niet door het terrein komt. " +
    "Hoort er een evenement bij, beoordeel de uitvoering dan ook tegen het gestelde doel. " +
    "Antwoord UITSLUITEND met geldig JSON, zonder markdown: " +
    '{"analyse": string, "tips": string[]}. ' +
    "analyse: 3 tot 5 zinnen over deze sessie, concreet en met de cijfers erbij. " +
    "tips: 1 tot 3 punten die de cliënt meeneemt naar een volgende, vergelijkbare sessie. " +
    "Wees eerlijk en specifiek, geen loze complimenten, geen opmaak binnen de tekstvelden.";

  try {
    const { callCoachModel } = require("../lib/llmProvider");
    const { rawText } = await callCoachModel({
      systemPrompt,
      userContent: JSON.stringify(payload),
      maxTokens: 800,
    });

    let structured = null;
    try {
      structured = JSON.parse(rawText.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "").trim());
    } catch {
      structured = null;
    }

    const entry = {
      analyse: structured?.analyse || null,
      tips: Array.isArray(structured?.tips) ? structured.tips : [],
      rawFeedback: structured ? null : rawText,
    };

    db.prepare(
      `INSERT INTO session_feedback (cardio_log_id, date, analyse, tips_json, raw_feedback)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(cardio_log_id) DO UPDATE SET
         analyse = excluded.analyse, tips_json = excluded.tips_json,
         raw_feedback = excluded.raw_feedback, created_at = datetime('now')`
    ).run(row.id, session.date, entry.analyse, JSON.stringify(entry.tips), entry.rawFeedback);

    res.json({ ...entry, date: new Date().toISOString(), uitCache: false });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
