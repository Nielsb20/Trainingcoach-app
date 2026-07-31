"use strict";

const express = require("express");
const { db } = require("../db/db");
const { getFullSchema } = require("./schema");
const { serializeWorkoutLog } = require("./workoutLogs");
const { serialize: serializeCardioLog } = require("./cardioLogs");
const { getUpcomingPlan, getRecentDeclines } = require("./planned");
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
  const wellnessLogs = db.prepare("SELECT * FROM wellness_logs ORDER BY date DESC LIMIT 28").all();
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

  // Strength context. The cardio load model (TSS/CTL/ATL) is blind to gym work,
  // so without this the coach would read "TSB +8, well recovered" the morning
  // after a heavy leg session and happily propose intervals.
  let krachtcontext = null;
  if (workoutLogs.length > 0) {
    const today = calc.todayStr();
    const daysBetween = (a, b) =>
      Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
    const last = workoutLogs[0];
    const within = (days) => workoutLogs.filter((l) => daysBetween(l.date, today) <= days);
    const sRpe = (l) => (l.rpe && l.duration_min ? l.rpe * l.duration_min : null);

    krachtcontext = {
      dagenSindsLaatste: daysBetween(last.date, today),
      laatsteSessie: {
        datum: last.date,
        dag: last.dayName,
        moment: last.timeOfDay ? timeOfDayLabel(last.timeOfDay) : null,
        oefeningen: last.exercises.map((e) => e.name),
        rpe: last.rpe ?? null,
      },
      sessiesLaatste7Dagen: within(7).length,
      sessiesLaatste28Dagen: within(28).length,
      // sRPE = duur x RPE, de gangbare maat voor krachtbelasting. Alleen
      // beschikbaar als de cliënt beide invult.
      sRpeLaatste7Dagen: within(7).map(sRpe).filter(Boolean).reduce((a, b) => a + b, 0) || null,
    };
  }

  // Recovery context: recent nights plus a baseline to compare against, so the
  // coach can spot "resting HR up / HRV down versus normal" rather than being
  // handed absolute numbers it has no reference for.
  let herstel = null;
  if (wellnessLogs.length > 0) {
    const avg = (rows, key) => {
      const vals = rows.map((r) => r[key]).filter((v) => v !== null && v !== undefined);
      return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
    };
    const recent = wellnessLogs.slice(0, 7);
    const baseline = wellnessLogs.slice(7, 28);
    herstel = {
      laatste7Dagen: {
        gemRusthartslag: avg(recent, "resting_hr"),
        gemHrvMs: avg(recent, "hrv_ms"),
        gemSlaapMinuten: avg(recent, "sleep_minutes"),
        gemSlaapscore: avg(recent, "sleep_score"),
      },
      basislijn8tot28Dagen: baseline.length
        ? {
            gemRusthartslag: avg(baseline, "resting_hr"),
            gemHrvMs: avg(baseline, "hrv_ms"),
            gemSlaapMinuten: avg(baseline, "sleep_minutes"),
          }
        : null,
      recenteDagen: wellnessLogs.slice(0, 7).map((w) => ({
        datum: w.date,
        rusthartslag: w.resting_hr,
        hrv_ms: w.hrv_ms,
        slaap_minuten: w.sleep_minutes,
        slaapscore: w.sleep_score,
      })),
    };
  }

  const payload = {
    vandaag: calc.todayStr(),
    vandaagWeekdag: calc.weekdayNameForDate(calc.todayStr()),
    hartslagzones: hrZones ? hrZones.map((z) => ({ zone: z.zone, naam: z.naam, van: z.vanBpm, tot: z.totBpm })) : null,
    lichaamsgewicht: weightSummary,
    herstel,
    krachtcontext,
    huidigePlanning: getUpcomingPlan(14),
    eerderAfgewezenVoorstellen: getRecentDeclines(14),
    trainingsbelasting: currentLoad
      ? {
          ctlFitness: currentLoad.ctl,
          atlVermoeidheid: currentLoad.atl,
          tsbVorm: currentLoad.tsb,
          tsbEenWeekGeleden: loadWeekAgo ? loadWeekAgo.tsb : null,
          methode: schema.profile.ftp ? "vermogen (FTP-gebaseerd, nauwkeurig)" : "hartslag (schatting)",
        }
      : null,
    schema: schema.days.map((d) => ({
      dag: d.name,
      vasteWeekdagen: d.weekdays && d.weekdays.length ? d.weekdays : null,
      moment: d.timeOfDay ? timeOfDayLabel(d.timeOfDay) : null,
      // The last logged sets per exercise, so the coach can propose a concrete
      // next step ("squat 3x5 at 102.5, up from 100") instead of vague advice.
      oefeningen: d.exercises.map((e) => {
        const lastLog = workoutLogs.find((l) => l.exercises.some((x) => x.name === e.name && x.sets.length));
        const lastSets = lastLog
          ? lastLog.exercises.find((x) => x.name === e.name).sets.map((s) => `${s.weight}kg x ${s.reps}`)
          : null;
        return {
          naam: e.name,
          doel: `${e.targetSets}x${e.targetReps}`,
          laatstGelogd: lastSets ? { datum: lastLog.date, sets: lastSets } : null,
        };
      }),
    })),
    vasteCardiomomenten: schema.cardioDays.map((c) => ({ dag: c.weekday, type: c.type, moment: c.timeOfDay ? timeOfDayLabel(c.timeOfDay) : null, notities: c.notes })),
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
          krachtVoorstel: Array.isArray(structured.krachtVoorstel) ? structured.krachtVoorstel : [],
        }
      : { id: entryId, date: new Date().toISOString(), question, rawFeedback: rawText };

    db.prepare(
      "INSERT INTO coach_history (id, date, question, analyse, tips_json, waarschuwing, cardio_voorstel_json, raw_feedback, kracht_voorstel_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      entry.id,
      entry.date,
      question,
      entry.analyse || null,
      entry.tips ? JSON.stringify(entry.tips) : null,
      entry.waarschuwing || null,
      entry.cardioVoorstel ? JSON.stringify(entry.cardioVoorstel) : null,
      entry.rawFeedback || null,
      entry.krachtVoorstel ? JSON.stringify(entry.krachtVoorstel) : null
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
      krachtVoorstel: r.kracht_voorstel_json ? JSON.parse(r.kracht_voorstel_json) : [],
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
