import { useState, useEffect, useMemo } from "react";
import { Plus, Loader2 } from "lucide-react";
import ConfirmDeleteButton from "./shared/ConfirmDeleteButton";
import CollapsibleCard from "./shared/CollapsibleCard";
import HerstelTegels from "./shared/HerstelTegels";
import * as api from "../api/client";
import { todayStr, formatDateNL } from "../lib/calculations";
import { herstelOverzicht } from "../lib/recovery";

/**
 * Daily recovery metrics. Manual entry is the primary path: the Garmin
 * auto-fetch is a bonus that may stop working when Garmin changes things, so
 * the UI never assumes it's available.
 */
/** 124 -> "2u04". Leeg blijft een streepje. */
const duurKort = (min) => (min ? `${Math.floor(min / 60)}u${String(min % 60).padStart(2, "0")}` : "–");
// Garmin levert de ademhaling als drijvende komma, en dan staat er
// 12.299999999999999 in de kolom. Dat is geen extra nauwkeurigheid, alleen
// binaire ruis — één decimaal is alles wat het apparaat echt meet.
const eenDecimaal = (v) => (v === null || v === undefined ? "–" : (Math.round(v * 10) / 10).toFixed(1));

export default function WellnessTab() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  // De tegels erboven gaan over de trend; de tabel is om een losse dag na te
  // kijken of weg te gooien. Een week is genoeg om mee te beginnen.
  const [alleRijen, setAlleRijen] = useState(false);

  const [date, setDate] = useState(todayStr());
  const [restingHr, setRestingHr] = useState("");
  const [hrvMs, setHrvMs] = useState("");
  const [sleepHours, setSleepHours] = useState("");
  const [sleepScore, setSleepScore] = useState("");
  const [notes, setNotes] = useState("");

  async function load() {
    try {
      setLogs(await api.getWellnessLogs(120));
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleSubmit() {
    if (!date) return;
    try {
      await api.saveWellnessLog({
        date,
        restingHr: restingHr ? Number(restingHr) : null,
        hrvMs: hrvMs ? Number(hrvMs) : null,
        // Entered in hours because that's how people think about sleep; stored in minutes.
        sleepMinutes: sleepHours ? Math.round(Number(sleepHours) * 60) : null,
        sleepScore: sleepScore ? Number(sleepScore) : null,
        notes,
        source: "manual",
      });
      setRestingHr(""); setHrvMs(""); setSleepHours(""); setSleepScore(""); setNotes("");
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2200);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete(d) {
    try {
      await api.deleteWellnessLog(d);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  const RIJEN_INGEKLAPT = 7;
  const nieuwsteEerst = useMemo(() => [...logs].reverse(), [logs]);
  const zichtbareLogs = alleRijen ? nieuwsteEerst : nieuwsteEerst.slice(0, RIJEN_INGEKLAPT);

  const hasNacht = logs.some((l) => l.sleepingHr !== null && l.sleepingHr !== undefined);
  // Een band die slaapfasen meet laat die kolommen zien; een ouder apparaat
  // levert ze niet en dan hoort er ook geen lege kolom te staan.
  const hasFasen = logs.some((l) => l.deepSleepMin !== null && l.deepSleepMin !== undefined);
  const hasAdem = logs.some((l) => l.respirationAvg !== null && l.respirationAvg !== undefined);

  const overzicht = useMemo(() => herstelOverzicht(logs), [logs]);

  if (loading) {
    return (
      <div className="tc-import-help" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Loader2 className="spin" size={15} /> Laden…
      </div>
    );
  }

  return (
    <div>
      <h1 className="tc-title">Herstel</h1>
      <p className="tc-sub">
        Je laatste nacht tegen je eigen normale bereik. Dezelfde vergelijking maakt de coach.
      </p>

      {error && <div className="tc-error"><span>{error}</span></div>}

      {logs.length === 0 ? (
        <div className="tc-empty">
          <p>Nog geen herstelgegevens.</p>
          <p className="tc-empty-hint">
            Vul onderaan deze pagina handmatig in, of haal ze automatisch op uit Garmin met het script
            <code>scripts/garmin-fetch.py</code> (zie de README).
          </p>
        </div>
      ) : (
        <>
          {overzicht && <HerstelTegels overzicht={overzicht} />}
          {hasNacht && (
            <p className="tc-import-help">
              Nachthartslag is het gemiddelde over je slaapvenster en ligt vast zodra je wakker bent;
              rust-HR is de dagwaarde van je horloge en kan later op de dag nog zakken.
            </p>
          )}

          <div className="tc-table-scroll">
          <table className="tc-table">
            <thead><tr><th>Datum</th>{hasNacht && <th>Nacht-HR</th>}<th>Rust-HR</th><th>HRV</th>{hasAdem && <th>Adem</th>}<th>Slaap</th>{hasFasen && <th>Diep</th>}{hasFasen && <th>REM</th>}<th>Score</th><th>Bron</th><th></th></tr></thead>
            <tbody>
              {zichtbareLogs.map((l) => (
                <tr key={l.date}>
                  <td>{formatDateNL(l.date)}</td>
                  {hasNacht && <td className="tc-mono">{l.sleepingHr ?? "–"}</td>}
                  <td className="tc-mono">{l.restingHr ?? "–"}</td>
                  <td className="tc-mono">{l.hrvMs ?? "–"}</td>
                  {hasAdem && <td className="tc-mono">{eenDecimaal(l.respirationAvg)}</td>}
                  <td className="tc-mono">{l.sleepMinutes ? `${Math.floor(l.sleepMinutes / 60)}u ${l.sleepMinutes % 60}m` : "–"}</td>
                  {hasFasen && <td className="tc-mono">{duurKort(l.deepSleepMin)}</td>}
                  {hasFasen && <td className="tc-mono">{duurKort(l.remSleepMin)}</td>}
                  <td className="tc-mono">{l.sleepScore ?? "–"}</td>
                  <td>{l.source}</td>
                  <td><ConfirmDeleteButton onConfirm={() => handleDelete(l.date)} title="Deze dag verwijderen" /></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {nieuwsteEerst.length > RIJEN_INGEKLAPT && (
            <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={() => setAlleRijen(!alleRijen)}>
              {alleRijen
                ? `Toon alleen de laatste ${RIJEN_INGEKLAPT} dagen`
                : `Toon alle ${nieuwsteEerst.length} dagen`}
            </button>
          )}
        </>
      )}

      {/* Onderaan: je komt hier bijna altijd om de trend tegen je basislijn te
          zien, en met een automatische Garmin-ophaal is handmatig invullen de
          uitzondering. */}
      <CollapsibleCard id="herstel-invoer" title="Dag toevoegen of bijwerken" subtitle="handmatig loggen">
        <div className="tc-form-row">
          <div>
            <label className="tc-label">Datum</label>
            <input className="tc-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="tc-label">Rusthartslag (bpm)</label>
            <input className="tc-input tc-mono" type="number" value={restingHr} onChange={(e) => setRestingHr(e.target.value)} placeholder="bv. 48" />
          </div>
        </div>
        <div className="tc-form-row">
          <div>
            <label className="tc-label">HRV (ms)</label>
            <input className="tc-input tc-mono" type="number" value={hrvMs} onChange={(e) => setHrvMs(e.target.value)} placeholder="bv. 62" />
          </div>
          <div>
            <label className="tc-label">Slaap (uren)</label>
            <input className="tc-input tc-mono" type="number" step="0.25" value={sleepHours} onChange={(e) => setSleepHours(e.target.value)} placeholder="bv. 7.5" />
          </div>
        </div>
        <div className="tc-form-row">
          <div>
            <label className="tc-label">Slaapscore (0–100, optioneel)</label>
            <input className="tc-input tc-mono" type="number" value={sleepScore} onChange={(e) => setSleepScore(e.target.value)} placeholder="bv. 82" />
          </div>
        </div>
        <label className="tc-label">Notities</label>
        <textarea className="tc-input tc-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="bv. slecht geslapen, verkoudheid" />
        <p className="tc-import-help">
          Alleen ingevulde velden worden opgeslagen — bestaande waarden voor dezelfde dag blijven staan.
          Zo kun je een automatisch opgehaalde dag aanvullen zonder iets kwijt te raken.
        </p>
        <div className="tc-actionbar">
          <button className="tc-btn tc-btn-event" onClick={handleSubmit}>
            <Plus size={15} /> Opslaan
          </button>
          {savedFlash && <span className="tc-saved-flash">Opgeslagen ✓</span>}
        </div>
      </CollapsibleCard>
    </div>
  );
}
