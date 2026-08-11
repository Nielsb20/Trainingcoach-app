import { useState, useEffect, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Plus, Loader2 } from "lucide-react";
import ConfirmDeleteButton from "./shared/ConfirmDeleteButton";
import CollapsibleCard from "./shared/CollapsibleCard";
import * as api from "../api/client";
import { todayStr, formatDateNL } from "../lib/calculations";

/**
 * Daily recovery metrics. Manual entry is the primary path: the Garmin
 * auto-fetch is a bonus that may stop working when Garmin changes things, so
 * the UI never assumes it's available.
 */
export default function WellnessTab() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);

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

  const chartData = useMemo(
    () =>
      logs.map((l) => ({
        label: formatDateNL(l.date),
        rusthartslag: l.restingHr,
        hrv: l.hrvMs,
        slaapUren: l.sleepMinutes ? Math.round((l.sleepMinutes / 60) * 10) / 10 : null,
      })),
    [logs]
  );

  const hasHrv = logs.some((l) => l.hrvMs !== null);
  const hasSleep = logs.some((l) => l.sleepMinutes !== null);

  // A 7-day mean versus the three weeks before it — the same comparison the
  // coach makes, shown here so the number on screen matches the advice.
  const trend = useMemo(() => {
    if (logs.length < 8) return null;
    const sorted = [...logs].sort((a, b) => (a.date > b.date ? -1 : 1));
    const avg = (rows, key) => {
      const v = rows.map((r) => r[key]).filter((x) => x !== null && x !== undefined);
      return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
    };
    const recent = sorted.slice(0, 7);
    const base = sorted.slice(7, 28);
    if (!base.length) return null;
    return {
      rustNu: avg(recent, "restingHr"),
      rustBasis: avg(base, "restingHr"),
      hrvNu: avg(recent, "hrvMs"),
      hrvBasis: avg(base, "hrvMs"),
    };
  }, [logs]);

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
        Rusthartslag, HRV en slaap. De coach vergelijkt deze waarden met je eigen basislijn — een
        verhoogde rusthartslag of verlaagde HRV is een signaal om een zware training uit te stellen.
      </p>

      {error && <div className="tc-error"><span>{error}</span></div>}

      {trend && (
        <div className="tc-chiprow">
          {trend.rustNu !== null && trend.rustBasis !== null && (
            <span className={"tc-hint-badge " + (trend.rustNu > trend.rustBasis + 5 ? "tc-badge-warning" : "tc-badge-cardio")}>
              Rusthartslag: {trend.rustNu} nu vs. {trend.rustBasis} basislijn
            </span>
          )}
          {trend.hrvNu !== null && trend.hrvBasis !== null && (
            <span className={"tc-hint-badge " + (trend.hrvNu < trend.hrvBasis * 0.9 ? "tc-badge-warning" : "tc-badge-cardio")}>
              HRV: {trend.hrvNu} nu vs. {trend.hrvBasis} basislijn
            </span>
          )}
        </div>
      )}

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
          <div className="tc-chart-wrap">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={chartData}>
                <CartesianGrid stroke="#2E363D" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#8B949B" fontSize={11} />
                <YAxis yAxisId="hr" stroke="#C97A3F" fontSize={12} domain={["auto", "auto"]} />
                {(hasHrv || hasSleep) && <YAxis yAxisId="other" orientation="right" stroke="#4FA8A0" fontSize={12} domain={["auto", "auto"]} />}
                <Tooltip contentStyle={{ background: "#1C2227", border: "1px solid #2E363D", color: "#E8E6E1" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line yAxisId="hr" type="monotone" dataKey="rusthartslag" stroke="#C97A3F" strokeWidth={2} dot={false} name="Rusthartslag (bpm)" connectNulls />
                {hasHrv && <Line yAxisId="other" type="monotone" dataKey="hrv" stroke="#4FA8A0" strokeWidth={2} dot={false} name="HRV (ms)" connectNulls />}
                {hasSleep && <Line yAxisId="other" type="monotone" dataKey="slaapUren" stroke="#8C86C9" strokeWidth={2} dot={false} strokeDasharray="4 3" name="Slaap (uren)" connectNulls />}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <table className="tc-table">
            <thead><tr><th>Datum</th><th>Rust-HR</th><th>HRV</th><th>Slaap</th><th>Score</th><th>Bron</th><th></th></tr></thead>
            <tbody>
              {[...logs].reverse().map((l) => (
                <tr key={l.date}>
                  <td>{formatDateNL(l.date)}</td>
                  <td className="tc-mono">{l.restingHr ?? "–"}</td>
                  <td className="tc-mono">{l.hrvMs ?? "–"}</td>
                  <td className="tc-mono">{l.sleepMinutes ? `${Math.floor(l.sleepMinutes / 60)}u ${l.sleepMinutes % 60}m` : "–"}</td>
                  <td className="tc-mono">{l.sleepScore ?? "–"}</td>
                  <td>{l.source}</td>
                  <td><ConfirmDeleteButton onConfirm={() => handleDelete(l.date)} title="Deze dag verwijderen" /></td>
                </tr>
              ))}
            </tbody>
          </table>
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
