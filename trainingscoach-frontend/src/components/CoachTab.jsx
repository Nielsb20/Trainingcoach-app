import { useState, useMemo } from "react";
import { Send, Loader2, Trash2 } from "lucide-react";
import { askCoach as apiAskCoach } from "../api/client";
import {
  todayStr, daysUntil, computeHrZones, computeTrainingLoadSeries,
  computeCardioHistorySummary, computeStrengthHistorySummary,
} from "../lib/calculations";

export default function CoachTab({ schema, workoutLogs, cardioLogs, events, weightLogs, coachHistory, onCoachAnswered, deleteCoachEntry }) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const upcomingEvents = (events || []).filter((e) => daysUntil(e.date) >= 0).sort((a, b) => (a.date > b.date ? 1 : -1)).slice(0, 5);
  const cardioSchedule = schema.cardioDays || [];
  const cardioHistorySummary = useMemo(() => computeCardioHistorySummary(cardioLogs), [cardioLogs]);
  const strengthHistorySummary = useMemo(() => computeStrengthHistorySummary(workoutLogs), [workoutLogs]);
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
  const isStructured = entry.analyse !== undefined || (entry.cardioVoorstel && entry.cardioVoorstel.length > 0);

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

      {!isStructured && <p className="tc-feedback-text">{entry.feedback}</p>}

      {isStructured && (
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

          {entry.cardioVoorstel && entry.cardioVoorstel.length > 0 && (
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
        </div>
      )}
    </details>
  );
}
