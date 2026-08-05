import { useState, useMemo } from "react";
import { Send, Loader2, Trash2, CalendarPlus } from "lucide-react";
import { askCoach as apiAskCoach, createPlanFromCoach } from "../api/client";
import {
  todayStr, daysUntil, computeHrZones, computeTrainingLoadSeries,
  computeCardioHistorySummary, computeStrengthHistorySummary, computeWeeklyStrengthLoad,
} from "../lib/calculations";

export default function CoachTab({ schema, workoutLogs, cardioLogs, events, weightLogs, coachHistory, onCoachAnswered, deleteCoachEntry }) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const upcomingEvents = (events || []).filter((e) => daysUntil(e.date) >= 0).sort((a, b) => (a.date > b.date ? 1 : -1)).slice(0, 5);
  const cardioSchedule = schema.cardioDays || [];
  const cardioHistorySummary = useMemo(() => computeCardioHistorySummary(cardioLogs), [cardioLogs]);
  const strengthHistorySummary = useMemo(() => computeStrengthHistorySummary(workoutLogs), [workoutLogs]);
  // The coach is handed sRPE for the last two weeks; show the same thing here,
  // including when it's missing — "geen RPE ingevuld" tells you why the coach
  // stays silent about strength load far better than an absent line does.
  const strengthLoad = useMemo(() => {
    const weekly = computeWeeklyStrengthLoad(workoutLogs, 12);
    if (!weekly) return null;
    const rated = weekly.filter((w) => w.sRpe !== null);
    return {
      thisWeek: rated.length ? rated[rated.length - 1] : null,
      prevWeek: rated.length > 1 ? rated[rated.length - 2] : null,
      unrated: workoutLogs.filter((l) => !l.rpe || !l.durationMin).length,
    };
  }, [workoutLogs]);
  const hrZones = schema.profile?.maxHr ? computeHrZones(schema.profile.maxHr, schema.profile.restingHr) : null;
  const weightSummary = useMemo(() => {
    if (!weightLogs || weightLogs.length === 0) return null;
    const sorted = [...weightLogs].sort((a, b) => (a.date > b.date ? 1 : -1));
    const latest = sorted[sorted.length - 1];
    const cutoff8wk = new Date(todayStr() + "T00:00:00");
    cutoff8wk.setDate(cutoff8wk.getDate() - 56);
    const cutoffStr = cutoff8wk.toISOString().slice(0, 10);
    const older = sorted.filter((w) => w.date <= cutoffStr);
    const reference = older.length > 0 ? older[older.length - 1] : sorted[0];
    return {
      huidigGewichtKg: latest.weight_kg,
      huidigVetpercentage: latest.body_fat_pct,
      datumLaatsteMeting: latest.date,
      gewichtCa8WekenGeleden: reference.id !== latest.id ? reference.weight_kg : null,
      verschilKg: reference.id !== latest.id ? Math.round((latest.weight_kg - reference.weight_kg) * 10) / 10 : null,
    };
  }, [weightLogs]);
  const trainingLoadSeries = useMemo(
    () => computeTrainingLoadSeries(cardioLogs, schema.profile?.ftp, hrZones),
    [cardioLogs, schema.profile?.ftp, schema.profile?.maxHr, schema.profile?.restingHr]
  );
  const currentLoad = trainingLoadSeries ? trainingLoadSeries[trainingLoadSeries.length - 1] : null;
  const loadWeekAgo = trainingLoadSeries && trainingLoadSeries.length > 7 ? trainingLoadSeries[trainingLoadSeries.length - 8] : null;

  /**
   * The payload assembly and the Anthropic call now live on the server
   * (see server/src/routes/coach.js). That keeps the API key off the client
   * and makes the server's calculation core the single source of truth for
   * what the coach sees. The frontend just asks the question and renders
   * the result; the derived values below are for on-screen display only.
   */
  async function handleAsk() {
    setLoading(true);
    setError("");
    try {
      const entry = await apiAskCoach(question || null);
      await onCoachAnswered(entry);
      setQuestion("");
    } catch (e) {
      setError(e.message || "Er ging iets mis. Probeer het opnieuw.");
    } finally {
      setLoading(false);
    }
  }

  const hasData = workoutLogs.length > 0 || cardioLogs.length > 0;

  return (
    <div>
      <h1 className="tc-title">Coach feedback</h1>
      <p className="tc-sub">De coach analyseert je meest recente kracht- en cardiologs en stelt ook concrete cardiotrainingen voor op je vaste momenten.</p>

      {!hasData && (
        <div className="tc-empty"><p>Log eerst een training of cardiosessie, dan heeft de coach iets om op te reageren.</p></div>
      )}

      {(strengthHistorySummary || cardioHistorySummary) && (
        <div className="tc-card tc-history-summary">
          <div className="tc-card-head">
            <span className="tc-ex-name">Wat de coach van je geschiedenis weet</span>
          </div>
          <div className="tc-history-grid">
            {strengthHistorySummary && (
              <div>
                <span className="tc-hint-badge tc-badge-strength">
                  {strengthHistorySummary.totaalAantalSessiesOoit} krachtsessies · {strengthHistorySummary.periode}
                </span>
                {strengthHistorySummary.voortgangPerOefeningSindsEersteLog.length > 0 && (
                  <p className="tc-history-detail">
                    {strengthHistorySummary.voortgangPerOefeningSindsEersteLog.map((p) => `${p.oefening}: ${p.eersteLog}→${p.laatsteLog}kg`).join(" · ")}
                  </p>
                )}
                {strengthLoad && (
                  <p className="tc-history-detail">
                    {strengthLoad.thisWeek ? (
                      <>
                        Krachtbelasting: {strengthLoad.thisWeek.sRpe} sRPE deze week
                        {strengthLoad.prevWeek ? ` · ${strengthLoad.prevWeek.sRpe} sRPE de week ervoor` : ""}
                        {strengthLoad.unrated > 0 && ` · ${strengthLoad.unrated} sessie${strengthLoad.unrated === 1 ? "" : "s"} zonder duur/RPE tellen niet mee`}
                      </>
                    ) : (
                      <>
                        Krachtbelasting: nog niet te berekenen — vul bij het loggen duur én RPE in
                        (of vul ze aan via het potlood in Geschiedenis → Kracht), dan weegt de coach je gymwerk mee.
                      </>
                    )}
                  </p>
                )}
              </div>
            )}
            {cardioHistorySummary && (
              <div>
                <span className="tc-hint-badge tc-badge-cardio">
                  {cardioHistorySummary.totaalAantalSessiesOoit} cardiosessies · {cardioHistorySummary.periode}
                </span>
                <p className="tc-history-detail">
                  laatste 4 weken: {cardioHistorySummary.laatste4Weken.km}km / {cardioHistorySummary.laatste4Weken.minuten}min
                  {cardioHistorySummary.laatste4Weken.gemHartslag ? ` · ${cardioHistorySummary.laatste4Weken.gemHartslag}${cardioHistorySummary.laatste4Weken.gemMaxHartslag ? `/${cardioHistorySummary.laatste4Weken.gemMaxHartslag}` : ""} bpm` : ""}
                  {cardioHistorySummary.laatste4Weken.gemSnelheidKmu ? ` · ${cardioHistorySummary.laatste4Weken.gemSnelheidKmu} km/u` : ""}
                  {cardioHistorySummary.laatste4Weken.gemVermogen ? ` · ${cardioHistorySummary.laatste4Weken.gemVermogen} W` : ""}
                  {cardioHistorySummary.laatste4Weken.hoogtemetersTotaal ? ` · ↑${cardioHistorySummary.laatste4Weken.hoogtemetersTotaal}m` : ""}
                  <br />
                  4 weken daarvoor: {cardioHistorySummary.voorgaande4Weken.km}km / {cardioHistorySummary.voorgaande4Weken.minuten}min
                  {cardioHistorySummary.voorgaande4Weken.gemHartslag ? ` · ${cardioHistorySummary.voorgaande4Weken.gemHartslag}${cardioHistorySummary.voorgaande4Weken.gemMaxHartslag ? `/${cardioHistorySummary.voorgaande4Weken.gemMaxHartslag}` : ""} bpm` : ""}
                  {cardioHistorySummary.voorgaande4Weken.gemSnelheidKmu ? ` · ${cardioHistorySummary.voorgaande4Weken.gemSnelheidKmu} km/u` : ""}
                  {cardioHistorySummary.voorgaande4Weken.gemVermogen ? ` · ${cardioHistorySummary.voorgaande4Weken.gemVermogen} W` : ""}
                  {cardioHistorySummary.voorgaande4Weken.hoogtemetersTotaal ? ` · ↑${cardioHistorySummary.voorgaande4Weken.hoogtemetersTotaal}m` : ""}
                </p>
              </div>
            )}
            {currentLoad && (
              <div>
                <span className="tc-hint-badge tc-badge-event">
                  CTL {currentLoad.ctl} · ATL {currentLoad.atl} · TSB {currentLoad.tsb > 0 ? "+" : ""}{currentLoad.tsb}
                </span>
                <p className="tc-history-detail">
                  Trainingsbelasting ({schema.profile?.ftp ? "op basis van vermogen/FTP" : "geschat op basis van hartslag"}) — zie Geschiedenis → Belasting voor de grafiek.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {upcomingEvents.length > 0 && (
        <div className="tc-chiprow">
          {upcomingEvents.map((e) => (
            <span key={e.id} className="tc-hint-badge tc-badge-event">{e.name} · over {daysUntil(e.date)}d</span>
          ))}
        </div>
      )}
      {cardioSchedule.length > 0 && (
        <div className="tc-chiprow">
          {cardioSchedule.map((c) => (
            <span key={c.id} className="tc-hint-badge tc-badge-cardio">{c.weekday} · {c.type}</span>
          ))}
        </div>
      )}

      <div className="tc-card">
        <label className="tc-label">Specifieke vraag voor de coach (optioneel)</label>
        <textarea className="tc-input tc-textarea" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Bijv. 'Moet ik dit blok het gewicht verhogen bij squat?' of 'Wat moet ik dinsdag lopen?'" />
        <div className="tc-actionbar">
          <button className="tc-btn tc-btn-strength" onClick={handleAsk} disabled={loading || !hasData}>
            {loading ? <Loader2 className="spin" size={16} /> : <Send size={15} />}
            {loading ? "Coach denkt na…" : "Vraag coach feedback"}
          </button>
        </div>
        {error && (
          <div className="tc-error">
            <span>{error}</span>
            <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={handleAsk}>Probeer opnieuw</button>
          </div>
        )}
      </div>

      <div className="tc-feedback-list">
        {coachHistory.map((f, i) => <FeedbackCard key={f.id} entry={f} defaultOpen={i === 0} onDelete={() => deleteCoachEntry(f.id)} />)}
      </div>
    </div>
  );
}

function FeedbackCard({ entry, defaultOpen, onDelete }) {
  const [confirming, setConfirming] = useState(false);
  // Check for actual content, not just the presence of the key: the API always
  // returns these fields, but they're null/empty when the model didn't produce
  // parseable JSON. In that case we fall back to showing the raw text, so a
  // reply is never silently swallowed.
  const hasStructuredContent =
    !!entry.analyse ||
    (entry.tips && entry.tips.length > 0) ||
    !!entry.waarschuwing ||
    (entry.cardioVoorstel && entry.cardioVoorstel.length > 0) ||
    (entry.krachtVoorstel && entry.krachtVoorstel.length > 0);
  // `feedback` is the field name used by artifact-era backups; `rawFeedback` by the server.
  const fallbackText = entry.rawFeedback || entry.feedback || null;
  const hasCardioProposal = entry.cardioVoorstel && entry.cardioVoorstel.length > 0;
  const hasStrengthProposal = entry.krachtVoorstel && entry.krachtVoorstel.length > 0;

  function handleDeleteClick(e) {
    e.preventDefault();
    e.stopPropagation();
    setConfirming(true);
  }
  function handleConfirm(e) {
    e.preventDefault();
    e.stopPropagation();
    onDelete();
  }
  function handleCancel(e) {
    e.preventDefault();
    e.stopPropagation();
    setConfirming(false);
  }

  return (
    <details className="tc-feedback-card" open={defaultOpen}>
      <summary>
        <span className="tc-feedback-date">{new Date(entry.date).toLocaleString("nl-NL")}</span>
        {entry.triggerType && entry.triggerType !== "handmatig" && (
          <span className={"tc-hint-badge " + (entry.triggerType === "signaal" ? "tc-badge-warning" : "tc-badge-cardio")}>
            {entry.triggerType === "signaal" ? "automatisch — signaal" : "automatisch — wekelijks"}
          </span>
        )}
        {entry.question && <span className="tc-feedback-q">"{entry.question}"</span>}
        <span className="tc-feedback-spacer" />
        {!confirming && (
          <button className="tc-icon-btn" onClick={handleDeleteClick} title="Verwijderen">
            <Trash2 size={14} />
          </button>
        )}
        {confirming && (
          <span className="tc-confirm-row">
            <span>Verwijderen?</span>
            <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={handleConfirm}>Ja</button>
            <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={handleCancel}>Annuleren</button>
          </span>
        )}
      </summary>

      {entry.triggerReason && entry.triggerType !== "handmatig" && (
        <p className="tc-history-detail" style={{ marginTop: 8 }}>Aanleiding: {entry.triggerReason}</p>
      )}
      {!hasStructuredContent && fallbackText && <p className="tc-feedback-text">{fallbackText}</p>}
      {!hasStructuredContent && !fallbackText && (
        <p className="tc-feedback-text tc-gpxbatch-error">
          Dit antwoord kwam leeg terug van het model. Probeer het opnieuw, of controleer of het
          ingestelde model in .env nog beschikbaar is.
        </p>
      )}

      {hasStructuredContent && (
        <div className="tc-feedback-structured">
          {entry.analyse && <p className="tc-feedback-text">{entry.analyse}</p>}

          {entry.tips && entry.tips.length > 0 && (
            <ul className="tc-tip-list">
              {entry.tips.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          )}

          {entry.waarschuwing && (
            <div className="tc-warning-box">{entry.waarschuwing}</div>
          )}

          {/* One button for both disciplines: they're created together, so two
              buttons would only invite half the plan being taken over. */}
          {(hasCardioProposal || hasStrengthProposal) && <PlanButton entryId={entry.id} />}

          {hasCardioProposal && (
            <>
              <h3 className="tc-feedback-subtitle">Cardiovoorstel</h3>
              <div className="tc-proposal-list">
                {entry.cardioVoorstel.map((p, i) => (
                  <div className="tc-proposal-row" key={i}>
                    <span className="tc-hint-badge tc-badge-cardio">{p.dag}</span>
                    <span className="tc-proposal-type">{p.type}</span>
                    <span className="tc-proposal-invulling">{p.invulling}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {hasStrengthProposal && (
            <>
              <h3 className="tc-feedback-subtitle tc-subtitle-strength">Krachtvoorstel</h3>
              <div className="tc-proposal-list">
                {entry.krachtVoorstel.map((p, i) => (
                  <div className="tc-proposal-row" key={i}>
                    <span className="tc-hint-badge tc-badge-strength">{p.dag}</span>
                    <span className="tc-proposal-type">{p.schemaDag}</span>
                    <span className="tc-proposal-invulling">{p.invulling}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </details>
  );
}


/**
 * Turns a coach proposal into trackable planned sessions. Kept separate from
 * FeedbackCard so its own loading/success state doesn't re-render the whole
 * answer.
 */
function PlanButton({ entryId }) {
  const [state, setState] = useState("idle"); // idle | busy | done | error
  const [message, setMessage] = useState("");

  async function handleClick() {
    setState("busy");
    try {
      const result = await createPlanFromCoach(entryId);
      const kinds = [];
      if (result.cardio > 0) kinds.push(`${result.cardio} cardio`);
      if (result.kracht > 0) kinds.push(`${result.kracht} kracht`);
      const parts = [
        `${result.created.length} trainingen in de planning gezet${kinds.length ? ` (${kinds.join(", ")})` : ""}`,
      ];
      if (result.wijzigingen > 0) parts.push(`${result.wijzigingen} daarvan wijzigen iets bestaands`);
      if (result.skipped?.length) parts.push(`${result.skipped.length} overgeslagen`);
      // A weekday that doesn't match its date means the advice was internally
      // inconsistent; worth showing rather than quietly following the date.
      if (result.waarschuwingen?.length) {
        parts.push(result.waarschuwingen.map((w) => w.melding).join("; "));
      }
      setMessage(parts.join(" — "));
      setState("done");
    } catch (err) {
      setMessage(err.message);
      setState("error");
    }
  }

  if (state === "done") return <p className="tc-import-help">{message} — zie het tabblad Analyse.</p>;

  return (
    <div className="tc-actionbar" style={{ marginTop: 0, marginBottom: 10 }}>
      <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={handleClick} disabled={state === "busy"}>
        {state === "busy" ? <Loader2 className="spin" size={13} /> : <CalendarPlus size={13} />}
        Zet in planning
      </button>
      {state === "error" && <span className="tc-gpxbatch-error">{message}</span>}
    </div>
  );
}
