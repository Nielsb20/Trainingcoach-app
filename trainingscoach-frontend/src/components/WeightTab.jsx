import { useState, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Plus } from "lucide-react";
import ConfirmDeleteButton from "./shared/ConfirmDeleteButton";
import CollapsibleCard from "./shared/CollapsibleCard";
import { todayStr, formatDateNL } from "../lib/calculations";
import { uid } from "../lib/uiHelpers";

export default function WeightTab({ weightLogs, addWeightLog, deleteWeightLog }) {
  const [date, setDate] = useState(todayStr());
  const [weight, setWeight] = useState("");
  const [bodyFat, setBodyFat] = useState("");
  const [notes, setNotes] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);

  const sorted = useMemo(() => [...weightLogs].sort((a, b) => (a.date > b.date ? 1 : -1)), [weightLogs]);
  const chartData = sorted.map((w) => ({ date: w.date, label: formatDateNL(w.date), gewicht: w.weight_kg, vetpercentage: w.body_fat_pct }));
  const latest = sorted[sorted.length - 1];
  const hasBodyFat = weightLogs.some((w) => w.body_fat_pct !== null && w.body_fat_pct !== undefined);

  async function handleSubmit() {
    if (!date || !weight) return;
    const entry = { id: uid(), date, weight_kg: Number(weight), body_fat_pct: bodyFat ? Number(bodyFat) : null, notes };
    const ok = await addWeightLog(entry);
    if (ok) {
      setWeight(""); setBodyFat(""); setNotes("");
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2200);
    }
  }

  return (
    <div>
      <h1 className="tc-title">Lichaamsgewicht</h1>
      <p className="tc-sub">
        Log je gewicht (bijv. vanaf je Garmin-weegschaal) om trends te zien en om vermogen-per-kilo bij het fietsen en relatieve krachtvoortgang te kunnen berekenen.
      </p>

      {weightLogs.length === 0 ? (
        <div className="tc-empty">
          <p>Nog geen gewicht gelogd.</p>
          <p className="tc-empty-hint">Voeg onderaan deze pagina je eerste meting toe.</p>
        </div>
      ) : (
        <>
          {latest && (
            <div className="tc-chiprow">
              <span className="tc-hint-badge tc-badge-event">Laatste log: {latest.weight_kg} kg ({formatDateNL(latest.date)})</span>
              {latest.body_fat_pct != null && <span className="tc-hint-badge tc-badge-event">{latest.body_fat_pct}% vet</span>}
            </div>
          )}
          <div className="tc-chart-wrap">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData}>
                <CartesianGrid stroke="#2E363D" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#8B949B" fontSize={12} />
                <YAxis yAxisId="gewicht" stroke="#8C86C9" fontSize={12} unit="kg" domain={["auto", "auto"]} />
                {hasBodyFat && <YAxis yAxisId="vet" orientation="right" stroke="#7FA65C" fontSize={12} unit="%" domain={["auto", "auto"]} />}
                <Tooltip contentStyle={{ background: "#1C2227", border: "1px solid #2E363D", color: "#E8E6E1" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line yAxisId="gewicht" type="monotone" dataKey="gewicht" stroke="#8C86C9" strokeWidth={2} dot={{ fill: "#8C86C9", r: 3 }} name="Gewicht (kg)" connectNulls />
                {hasBodyFat && (
                  <Line yAxisId="vet" type="monotone" dataKey="vetpercentage" stroke="#7FA65C" strokeWidth={2} dot={{ fill: "#7FA65C", r: 3 }} name="Vetpercentage (%)" connectNulls />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <table className="tc-table">
            <thead><tr><th>Datum</th><th>Gewicht</th><th>Vet%</th><th></th></tr></thead>
            <tbody>
              {[...sorted].reverse().map((w) => (
                <tr key={w.id}>
                  <td>{formatDateNL(w.date)}</td>
                  <td className="tc-mono">{w.weight_kg} kg</td>
                  <td className="tc-mono">{w.body_fat_pct != null ? `${w.body_fat_pct}%` : "–"}</td>
                  <td><ConfirmDeleteButton onConfirm={() => deleteWeightLog(w.id)} title="Deze meting verwijderen" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Onderaan, niet bovenaan: de meeste bezoeken zijn om de trend te zien,
          niet om te wegen — en met een weegschaal die zelf synchroniseert is dit
          formulier het uitzonderingsgeval. */}
      <CollapsibleCard id="gewicht-invoer" title="Meting toevoegen" subtitle="handmatig loggen">
        <div className="tc-form-row">
          <div>
            <label className="tc-label">Datum</label>
            <input className="tc-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="tc-label">Gewicht (kg)</label>
            <input className="tc-input tc-mono" type="number" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="bv. 74.5" />
          </div>
        </div>
        <div className="tc-form-row">
          <div>
            <label className="tc-label">Vetpercentage (optioneel)</label>
            <input className="tc-input tc-mono" type="number" step="0.1" value={bodyFat} onChange={(e) => setBodyFat(e.target.value)} placeholder="bv. 16.2" />
          </div>
        </div>
        <label className="tc-label">Notities</label>
        <textarea className="tc-input tc-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optioneel" />
        <div className="tc-actionbar">
          <button className="tc-btn tc-btn-event" onClick={handleSubmit}>
            <Plus size={15} /> Gewicht opslaan
          </button>
          {savedFlash && <span className="tc-saved-flash">Opgeslagen ✓</span>}
        </div>
      </CollapsibleCard>
    </div>
  );
}
