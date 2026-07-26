import { useState, useRef } from "react";
import { Plus, Trash2, X, Download, UploadCloud, Check, Loader2 } from "lucide-react";
import { CARDIO_TYPES } from "../lib/constants";
import { WEEKDAYS, uid, todayStr, computeHrZones, computePowerZones } from "../lib/calculations";
import * as api from "../api/client";

export default function SchemaTab({ schema, setSchema, onRestored }) {
  const [pendingImport, setPendingImport] = useState(null);
  const [importFileError, setImportFileError] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [restoredFlash, setRestoredFlash] = useState(false);
  const backupFileInputRef = useRef(null);

  const [exportError, setExportError] = useState("");

  // Pulls the backup straight from the server so it reflects what's actually
  // stored, not just whatever this browser tab happens to have in memory.
  async function exportBackup() {
    setExportError("");
    try {
      const data = await api.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `trainingscoach-backup-${todayStr()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError("Kon back-up niet ophalen: " + err.message);
    }
  }

  function handleBackupFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileError("");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        setPendingImport(parsed);
      } catch (err) {
        setImportFileError("Kon dit bestand niet lezen als geldige back-up (ongeldig JSON).");
      }
    };
    reader.onerror = () => setImportFileError("Kon het bestand niet lezen.");
    reader.readAsText(file);
    if (backupFileInputRef.current) backupFileInputRef.current.value = "";
  }

  async function confirmRestore() {
    setRestoring(true);
    try {
      await api.importAll(pendingImport);
      await onRestored(); // re-fetch everything so the UI matches the server
      setRestoredFlash(true);
      setTimeout(() => setRestoredFlash(false), 2500);
    } catch (err) {
      setImportFileError("Herstellen mislukt: " + err.message);
    } finally {
      setRestoring(false);
      setPendingImport(null);
    }
  }

  function addDay() {
    const newDay = { id: uid(), name: `Dag ${schema.days.length + 1}`, exercises: [] };
    setSchema({ ...schema, days: [...schema.days, newDay] });
  }
  function updateDayName(dayId, name) {
    setSchema({ ...schema, days: schema.days.map((d) => (d.id === dayId ? { ...d, name } : d)) });
  }
  function removeDay(dayId) {
    setSchema({ ...schema, days: schema.days.filter((d) => d.id !== dayId) });
  }
  function addExercise(dayId) {
    setSchema({
      ...schema,
      days: schema.days.map((d) =>
        d.id === dayId
          ? { ...d, exercises: [...d.exercises, { id: uid(), name: "", targetSets: 3, targetReps: 8 }] }
          : d
      ),
    });
  }
  function updateExercise(dayId, exId, patch) {
    setSchema({
      ...schema,
      days: schema.days.map((d) =>
        d.id === dayId
          ? { ...d, exercises: d.exercises.map((e) => (e.id === exId ? { ...e, ...patch } : e)) }
          : d
      ),
    });
  }
  function removeExercise(dayId, exId) {
    setSchema({
      ...schema,
      days: schema.days.map((d) => (d.id === dayId ? { ...d, exercises: d.exercises.filter((e) => e.id !== exId) } : d)),
    });
  }

  function addCardioDay() {
    const used = new Set(schema.cardioDays.map((c) => c.weekday));
    const nextWeekday = WEEKDAYS.find((w) => !used.has(w)) || WEEKDAYS[0];
    setSchema({ ...schema, cardioDays: [...schema.cardioDays, { id: uid(), weekday: nextWeekday, type: CARDIO_TYPES[0], notes: "" }] });
  }
  function updateCardioDay(id, patch) {
    setSchema({ ...schema, cardioDays: schema.cardioDays.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  }
  function removeCardioDay(id) {
    setSchema({ ...schema, cardioDays: schema.cardioDays.filter((c) => c.id !== id) });
  }

  return (
    <div>
      <h1 className="tc-title">Trainingsschema</h1>
      <p className="tc-sub">Leg je vaste schema eenmalig vast. Dit gebruik je straks als basis bij het loggen van je krachttraining.</p>

      {schema.days.length === 0 && (
        <div className="tc-empty">
          <p>Je hebt nog geen trainingsdagen ingesteld.</p>
          <p className="tc-empty-hint">Bijvoorbeeld: "Dag A – Push" met Bench press, Overhead press, Triceps extensions.</p>
          <button className="tc-btn tc-btn-strength" onClick={addDay}>
            <Plus size={16} /> Eerste trainingsdag toevoegen
          </button>
        </div>
      )}

      <div className="tc-daygrid">
        {schema.days.map((day) => (
          <div className="tc-card" key={day.id}>
            <div className="tc-card-head">
              <input
                className="tc-input tc-day-name"
                value={day.name}
                onChange={(e) => updateDayName(day.id, e.target.value)}
                placeholder="Naam trainingsdag"
              />
              <button className="tc-icon-btn" onClick={() => removeDay(day.id)} title="Dag verwijderen">
                <Trash2 size={15} />
              </button>
            </div>

            <div className="tc-ex-list">
              {day.exercises.map((ex) => (
                <div className="tc-ex-row" key={ex.id}>
                  <input
                    className="tc-input"
                    placeholder="Oefening (bv. Squat)"
                    value={ex.name}
                    onChange={(e) => updateExercise(day.id, ex.id, { name: e.target.value })}
                  />
                  <input
                    className="tc-input tc-input-num"
                    type="number"
                    min={1}
                    value={ex.targetSets}
                    onChange={(e) => updateExercise(day.id, ex.id, { targetSets: Number(e.target.value) || 1 })}
                    title="Aantal sets"
                  />
                  <span className="tc-x">×</span>
                  <input
                    className="tc-input tc-input-num"
                    type="number"
                    min={1}
                    value={ex.targetReps}
                    onChange={(e) => updateExercise(day.id, ex.id, { targetReps: Number(e.target.value) || 1 })}
                    title="Aantal reps"
                  />
                  <button className="tc-icon-btn" onClick={() => removeExercise(day.id, ex.id)}>
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={() => addExercise(day.id)}>
              <Plus size={14} /> Oefening toevoegen
            </button>
          </div>
        ))}
      </div>

      {schema.days.length > 0 && (
        <button className="tc-btn tc-btn-ghost" onClick={addDay}>
          <Plus size={16} /> Trainingsdag toevoegen
        </button>
      )}

      <h2 className="tc-section-title" style={{ marginTop: 32 }}>Vaste cardiomomenten</h2>
      <p className="tc-sub" style={{ marginTop: -4 }}>
        Geef aan op welke dagen je vast cardio traint. De coach gebruikt dit om per moment een concreet trainingsvoorstel te doen.
      </p>

      {schema.cardioDays.length === 0 && (
        <div className="tc-empty">
          <p>Nog geen vaste cardiomomenten ingesteld.</p>
          <button className="tc-btn tc-btn-cardio" onClick={addCardioDay}>
            <Plus size={16} /> Cardiomoment toevoegen
          </button>
        </div>
      )}

      {schema.cardioDays.length > 0 && (
        <div className="tc-cardioday-list">
          {schema.cardioDays.map((c) => (
            <div className="tc-card tc-cardioday-row" key={c.id}>
              <select className="tc-input" value={c.weekday} onChange={(e) => updateCardioDay(c.id, { weekday: e.target.value })}>
                {WEEKDAYS.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
              <select className="tc-input" value={c.type} onChange={(e) => updateCardioDay(c.id, { type: e.target.value })}>
                {CARDIO_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input
                className="tc-input"
                placeholder="Notities (bv. duurloop, intervallen, doelafstand)"
                value={c.notes}
                onChange={(e) => updateCardioDay(c.id, { notes: e.target.value })}
              />
              <button className="tc-icon-btn" onClick={() => removeCardioDay(c.id)}><Trash2 size={15} /></button>
            </div>
          ))}
          <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={addCardioDay}>
            <Plus size={14} /> Cardiomoment toevoegen
          </button>
        </div>
      )}

      <h2 className="tc-section-title" style={{ marginTop: 32 }}>Persoonlijk profiel</h2>
      <p className="tc-sub" style={{ marginTop: -4 }}>
        Met je max. hartslag (en optioneel je rusthartslag, voor een preciezere berekening) kan de coach hartslagwaarden interpreteren als zones in plaats van kale bpm-cijfers.
      </p>
      <div className="tc-card">
        <div className="tc-form-row">
          <div>
            <label className="tc-label">Max. hartslag (bpm)</label>
            <input
              className="tc-input tc-mono"
              type="number"
              value={schema.profile?.maxHr ?? ""}
              onChange={(e) => setSchema({ ...schema, profile: { ...schema.profile, maxHr: e.target.value ? Number(e.target.value) : null } })}
              placeholder="bv. 185"
            />
          </div>
          <div>
            <label className="tc-label">Rust-hartslag (optioneel)</label>
            <input
              className="tc-input tc-mono"
              type="number"
              value={schema.profile?.restingHr ?? ""}
              onChange={(e) => setSchema({ ...schema, profile: { ...schema.profile, restingHr: e.target.value ? Number(e.target.value) : null } })}
              placeholder="bv. 52"
            />
          </div>
        </div>
        {schema.profile?.maxHr && (
          <table className="tc-table" style={{ marginTop: 12 }}>
            <thead><tr><th>Zone</th><th>Naam</th><th>Bereik (bpm)</th></tr></thead>
            <tbody>
              {computeHrZones(schema.profile.maxHr, schema.profile.restingHr).map((z) => (
                <tr key={z.zone}>
                  <td className="tc-mono">Zone {z.zone}</td>
                  <td>{z.naam}</td>
                  <td className="tc-mono">{z.vanBpm}–{z.totBpm}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="tc-form-row" style={{ marginTop: 16 }}>
          <div>
            <label className="tc-label">FTP / drempelvermogen (watt)</label>
            <input
              className="tc-input tc-mono"
              type="number"
              value={schema.profile?.ftp ?? ""}
              onChange={(e) => setSchema({ ...schema, profile: { ...schema.profile, ftp: e.target.value ? Number(e.target.value) : null } })}
              placeholder="bv. 250"
            />
          </div>
        </div>
        <p className="tc-import-help" style={{ marginTop: 4 }}>
          FTP (Functional Threshold Power) is het vermogen dat je ongeveer een uur kunt volhouden. Dit voedt de vermogenszones hieronder én de TSS/CTL/ATL-belastingberekening (zie Geschiedenis-tab) — dat zijn dezelfde formules die tools als TrainingPeaks gebruiken, puur wiskundig, niet door de AI geschat.
        </p>
        {schema.profile?.ftp && (
          <table className="tc-table" style={{ marginTop: 12 }}>
            <thead><tr><th>Zone</th><th>Naam</th><th>Bereik (watt)</th></tr></thead>
            <tbody>
              {computePowerZones(schema.profile.ftp).map((z) => (
                <tr key={z.zone}>
                  <td className="tc-mono">Zone {z.zone}</td>
                  <td>{z.naam}</td>
                  <td className="tc-mono">{z.vanW}{z.totW ? `–${z.totW}` : "+"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2 className="tc-section-title" style={{ marginTop: 32 }}>Back-up</h2>
      <p className="tc-sub" style={{ marginTop: -4 }}>
        Exporteer al je gegevens (schema, logs, gewicht, evenementen en coachgeschiedenis) als bestand — handig als vangnet naast de back-up van de server zelf.
      </p>
      <div className="tc-card tc-backup-card">
        <div className="tc-backup-row">
          <button className="tc-btn tc-btn-ghost" onClick={exportBackup}>
            <Download size={16} /> Exporteer alles (JSON)
          </button>
          {exportError && <span className="tc-gpxbatch-error">{exportError}</span>}
          <label className="tc-btn tc-btn-ghost tc-file-btn">
            <UploadCloud size={16} /> Herstel vanuit back-up
            <input ref={backupFileInputRef} type="file" accept=".json" onChange={handleBackupFile} style={{ display: "none" }} />
          </label>
          {restoredFlash && <span className="tc-saved-flash">Hersteld ✓</span>}
        </div>
        {importFileError && <div className="tc-error"><span>{importFileError}</span></div>}
        {pendingImport && (
          <div className="tc-backup-confirm">
            <p>
              Dit overschrijft je huidige gegevens met de back-up: {(pendingImport.schema?.days || []).length} trainingsdagen,{" "}
              {(pendingImport.workoutLogs || []).length} krachtlogs, {(pendingImport.cardioLogs || []).length} cardiologs,{" "}
              {(pendingImport.events || []).length} evenementen. Weet je het zeker?
            </p>
            <div className="tc-actionbar">
              <button className="tc-btn tc-btn-strength" onClick={confirmRestore} disabled={restoring}>
                {restoring ? <Loader2 className="spin" size={15} /> : <Check size={15} />} Ja, herstellen
              </button>
              <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={() => setPendingImport(null)}>Annuleren</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
