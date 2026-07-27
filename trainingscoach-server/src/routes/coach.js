"use strict";

const express = require("express");
const { db } = require("../db/db");
const { getFullSchema } = require("./schema");
const { serializeWorkoutLog } = require("./workoutLogs");
const { serialize: serializeCardioLog } = require("./cardioLogs");
const calc = require("../lib/calculations");
const { buildCoachSystemPrompt } = require("../lib/coachPrompt");
const { callCoachModel, describeProvider } = require("../lib/llmProvider");

const router = express.Router();

function stripJsonFences(text) {
  return text.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "").trim();
}

function timeOfDayLabel(id) {
  const map = { ochtend: "Ochtend", middag: "Middag", avond: "Avond" };
  return map[id] || null;
}

// POST /api/coach/ask  { question?: string }
router.post("/ask", async (req, res) => {
  const question = req.body.question || null;

  const schema = getFullSchema();
  const workoutLogs = db
    .prepare("SELECT * FROM workout_logs ORDER BY date DESC, created_at DESC")
    .all()
    .map(serializeWorkoutLog);
  const cardioLogs = db
    .prepare("SELECT * FROM cardio_logs ORDER BY date DESC, created_at DESC")
    .all()
    .map(serializeCardioLog);
  const weightLogs = db.prepare("SELECT * FROM weight_logs ORDER BY date ASC").all();
  const events = db.prepare("SELECT * FROM events ORDER BY date ASC").all();

  const hrZones = schema.profile.maxHr ? calc.computeHrZones(schema.profile.maxHr, schema.profile.restingHr) : null;
  const upcomingEvents = events.filter((e) => calc.daysUntil(e.date) >= 0).slice(0, 5);
  const cardioHistorySummary = calc.computeCardioHistorySummary(cardioLogs);
  const strengthHistorySummary = calc.computeStrengthHistorySummary(workoutLogs);
  const trainingLoadSeries = calc.computeTrainingLoadSeries(cardioLogs, schema.profile.ftp, hrZones);
  const currentLoad = trainingLoadSeries ? trainingLoadSeries[trainingLoadSeries.length - 1] : null;
  const loadWeekAgo = trainingLoadSeries && trainingLoadSeries.length > 7 ? trainingLoadSeries[trainingLoadSeries.length - 8] : null;

  let weightSummary = null;
  if (weightLogs.length > 0) {
    const sorted = [...weightLogs].sort((a, b) => (a.date > b.date ? 1 : -1));
    const latest = sorted[sorted.length - 1];
    const cutoff = new Date(calc.todayStr() + "T00:00:00");
    cutoff.setDate(cutoff.getDate() - 56);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const older = sorted.filter((w) => w.date <= cutoffStr);
    const reference = older.length > 0 ? older[older.length - 1] : sorted[0];
    weightSummary = {
      huidigGewichtKg: latest.weight_kg,
      huidigVetpercentage: latest.body_fat_pct,
      datumLaatsteMeting: latest.date,
      gewichtCa8WekenGeleden: reference.id !== latest.id ? reference.weight_kg : null,
      verschilKg: reference.id !== latest.id ? Math.round((latest.weight_kg - reference.weight_kg) * 10) / 10 : null,
    };
  }

  const payload = {
    vandaag: calc.todayStr(),
    vandaagWeekdag: calc.weekdayNameForDate(calc.todayStr()),
    hartslagzones: hrZones ? hrZones.map((z) => ({ zone: z.zone, naam: z.naam, van: z.vanBpm, tot: z.totBpm })) : null,
    lichaamsgewicht: weightSummary,
    trainingsbelasting: currentLoad
      ? {
          ctlFitness: currentLoad.ctl,
          atlVermoeidheid: currentLoad.atl,
          tsbVorm: currentLoad.tsb,
          tsbEenWeekGeleden: loadWeekAgo ? loadWeekAgo.tsb : null,
          methode: schema.profile.ftp ? "vermogen (FTP-gebaseerd, nauwkeurig)" : "hartslag (schatting)",
        }
      : null,
    schema: schema.days.map((d) => ({ dag: d.name, oefeningen: d.exercises.map((e) => `${e.name} (${e.targetSets}x${e.targetReps})`) })),
    vasteCardiomomenten: schema.cardioDays.map((c) => ({ dag: c.weekday, type: c.type, notities: c.notes })),
    langetermijnSamenvattingKracht: strengthHistorySummary,
    langetermijnSamenvattingCardio: cardioHistorySummary,
    recenteKrachttrainingen: workoutLogs.slice(0, 8).map((l) => ({
      datum: l.date, moment: l.timeOfDay ? timeOfDayLabel(l.timeOfDay) : null, dag: l.dayName, notities: l.notes,
      oefeningen: l.exercises.map((e) => ({ naam: e.name, sets: e.sets.map((s) => `${s.weight}kg x ${s.reps}`) })),
    })),
    recenteCardio: cardioLogs.slice(0, 8).map((c) => {
      const tssResult = calc.computeSessionTSS(c, schema.profile.ftp, hrZones);
      return {
        datum: c.date, moment: c.timeOfDay ? timeOfDayLabel(c.timeOfDay) : null, type: c.type, duur_min: c.duration_min, afstand_km: c.distance_km,
        gem_hartslag: c.avg_hr, max_hartslag: c.max_hr, hartslagzone: calc.zoneForHr(c.avg_hr, hrZones), gem_snelheid_kmu: calc.computeAvgSpeedKmh(c.distance_km, c.duration_min),
        gem_vermogen_watt: c.avg_power, max_vermogen_watt: c.max_power, gewogen_gem_vermogen_watt: c.weighted_avg_power,
        watt_per_kg: calc.computeWattsPerKg(c.avg_power, calc.getWeightAtDate(weightLogs, c.date)),
        tss: tssResult ? tssResult.tss : null, intensiteitsfactor: tssResult ? tssResult.intensityFactor : null, tssMethode: tssResult ? tssResult.method : null,
        gem_cadans: c.avg_cadence, max_cadans: c.max_cadence, hoogtemeters_omhoog: c.elevation_gain_m, hoogtemeters_omlaag: c.elevation_loss_m, tempo: c.pace, notities: c.notes,
        verloopBinnenSessie: c.profile ? c.profile.map((p) => ({ minuut: p.tMin, hartslag: p.gemHartslag, snelheid_kmu: p.gemSnelheidKmu, vermogen_watt: p.gemVermogen, cadans: p.gemCadans, hoogte_m: p.hoogte })) : null,
      };
    }),
    geplandeEvenementen: upcomingEvents.map((e) => ({ naam: e.name, datum: e.date, overDagen: calc.daysUntil(e.date), type: e.type, doel: e.target, notities: e.notes })),
    vraagVanGebruiker: question,
  };

  try {
    const { rawText, provider, model } = await callCoachModel({
      systemPrompt: buildCoachSystemPrompt(),
      userContent: JSON.stringify(payload),
      maxTokens: 1000,
    });

    let structured = null;
    try {
      structured = JSON.parse(stripJsonFences(rawText));
    } catch {
      structured = null;
    }
    if (structured) console.log(`[coach] antwoord via ${provider} (${model})`);

    const entryId = `coach-${Date.now()}`;
    const entry = structured
      ? {
          id: entryId,
          date: new Date().toISOString(),
          question,
          analyse: structured.analyse || null,
          tips: Array.isArray(structured.tips) ? structured.tips : [],
          waarschuwing: structured.waarschuwing || null,
          cardioVoorstel: Array.isArray(structured.cardioVoorstel) ? structured.cardioVoorstel : [],
        }
      : { id: entryId, date: new Date().toISOString(), question, rawFeedback: rawText };

    db.prepare(
      "INSERT INTO coach_history (id, date, question, analyse, tips_json, waarschuwing, cardio_voorstel_json, raw_feedback) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      entry.id,
      entry.date,
      question,
      entry.analyse || null,
      entry.tips ? JSON.stringify(entry.tips) : null,
      entry.waarschuwing || null,
      entry.cardioVoorstel ? JSON.stringify(entry.cardioVoorstel) : null,
      entry.rawFeedback || null
    );

    res.json(entry);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/coach/provider - which model is configured (diagnostics)
router.get("/provider", (req, res) => {
  res.json(describeProvider());
});

// GET /api/coach/history
router.get("/history", (req, res) => {
  const rows = db.prepare("SELECT * FROM coach_history ORDER BY date DESC").all();
  res.json(
    rows.map((r) => ({
      id: r.id,
      date: r.date,
      question: r.question,
      analyse: r.analyse,
      tips: r.tips_json ? JSON.parse(r.tips_json) : [],
      waarschuwing: r.waarschuwing,
      cardioVoorstel: r.cardio_voorstel_json ? JSON.parse(r.cardio_voorstel_json) : [],
      rawFeedback: r.raw_feedback,
    }))
  );
});

// DELETE /api/coach/history/:id
router.delete("/history/:id", (req, res) => {
  db.prepare("DELETE FROM coach_history WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

module.exports = router;
