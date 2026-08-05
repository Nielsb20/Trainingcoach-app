import { useState } from "react";
import { X, Plus, Loader2, Trash2 } from "lucide-react";
import TimeOfDayPicker from "./shared/TimeOfDayPicker";
import { formatDateNL, computeSessionRpe } from "../lib/calculations";

/**
 * Edits an already-logged strength session.
 *
 * Works from the exercises as they were *logged*, not from the current schema
 * day: schemas get renamed and reshuffled over time, and an old session must
 * stay correctable without being retro-fitted to today's schema. Exercises from
 * the schema can still be added for the case of "I did it but forgot to log it".
 *
 * Values are kept as strings while editing so a half-typed field doesn't get
 * coerced to 0 mid-keystroke; they're converted once on save.
 */
export default function WorkoutLogEditor({ log, schema, onSave, onClose }) {
  const [date, setDate] = useState(log.date);
  const [timeOfDay, setTimeOfDay] = useState(log.timeOfDay || "");
  const [notes, setNotes] = useState(log.notes || "");
  const [rpe, setRpe] = useState(log.rpe == null ? "" : String(log.rpe));
  const [durationMin, setDurationMin] = useState(log.durationMin == null ? "" : String(log.durationMin));
  const [exercises, setExercises] = useState(() =>
    log.exercises.map((ex) => ({
      name: ex.name,
      sets: ex.sets.map((s) => ({ weight: String(s.weight), reps: String(s.reps) })),
    }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const schemaDay = schema.days.find((d) => d.id === log.dayId);
  const addableExercises = (schemaDay?.exercises || [])
    .map((e) => e.name)
    .filter((n) => n && !exercises.some((ex) => ex.name === n));

  function updateSet(exIdx, setIdx, field, value) {
    setExercises((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        const sets = [...ex.sets];
        sets[setIdx] = { ...sets[setIdx], [field]: value };
        return { ...ex, sets };
      })
    );
  }

  function addSet(exIdx) {
    setExercises((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        // Prefill from the last set: corrections usually mean "one more like
        // that one", and an empty row would just be retyped.
        const lastSet = ex.sets[ex.sets.length - 1];
        return { ...ex, sets: [...ex.sets, { weight: lastSet?.weight || "", reps: lastSet?.reps || "" }] };
      })
    );
  }

  function removeSet(exIdx, setIdx) {
    setExercises((prev) =>
      prev.map((ex, i) => (i === exIdx ? { ...ex, sets: ex.sets.filter((_, j) => j !== setIdx) } : ex))
    );
  }

  function removeExercise(exIdx) {
    setExercises((prev) => prev.filter((_, i) => i !== exIdx));
  }

  function addExercise(name) {
    if (!name) return;
    setExercises((prev) => [...prev, { name, sets: [{ weight: "", reps: "" }] }]);
  }

  const previewSRpe = computeSessionRpe({
    rpe: rpe ? Number(rpe) : null,
    durationMin: durationMin ? Number(durationMin) : null,
  });

  async function handleSave() {
    const cleaned = exercises
      .map((ex) => ({
        name: ex.name,
        sets: ex.sets
          .filter((s) => s.weight !== "" && s.reps !== "")
          .map((s) => ({ weight: Number(s.weight), reps: Number(s.reps) })),
      }))
      .filter((ex) => ex.sets.length > 0);

    if (cleaned.length === 0) {
      setError("Vul minstens één set in, of verwijder de hele training via het prullenbakicoon.");
      return;
    }

    setError("");
    setSaving(true);
    const ok = await onSave(log.id, {
      date,
      timeOfDay: timeOfDay || null,
      dayId: log.dayId,
      dayName: log.dayName,
      notes,
      rpe: rpe ? Number(rpe) : null,
      durationMin: durationMin ? Number(durationMin) : null,
      exercises: cleaned,
    });
    setSaving(false);
    if (ok) {
      onClose();
    } else {
      // The app-level error banner sits behind this overlay, so repeat it here
      // rather than leaving the panel open with no visible reason. The edits
      // stay on screen so nothing typed is lost.
      setError("Opslaan mislukt. Controleer of de server draait en probeer het opnieuw.");
    }
  }

  return (
    <div className="tc-detail-overlay" onClick={onClose}>
      <div className="tc-detail-panel" onClick={(e) => e.stopPropagation()}>
        <div className="tc-detail-head">
          <div>
            <h2 className="tc-title" style={{ marginBottom: 2 }}>Training bewerken</h2>
            <p className="tc-sub" style={{ marginBottom: 0 }}>
              {log.dayName || "Krachttraining"} · oorspronkelijk gelogd op {formatDateNL(log.date)}
            </p>
          </div>
          <button className="tc-icon-btn" onClick={onClose} title="Sluiten"><X size={16} /></button>
        </div>

        {error && <div className="tc-savebanner" style={{ marginTop: 12 }}><span>⚠️ {error}</span></div>}

        <div className="tc-form-row" style={{ marginTop: 16 }}>
          <div>
            <label className="tc-label">Datum</label>
            <input className="tc-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="tc-label">Moment van de dag</label>
            <TimeOfDayPicker value={timeOfDay} onChange={setTimeOfDay} />
          </div>
        </div>

        <div className="tc-ex-log-list">
          {exercises.map((ex, exIdx) => (
            <div className="tc-card" key={`${ex.name}-${exIdx}`}>
              <div className="tc-card-head">
                <span className="tc-ex-name">{ex.name}</span>
                <button className="tc-icon-btn" title="Deze oefening uit de training halen"
                  onClick={() => removeExercise(exIdx)}>
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="tc-set-rows">
                {ex.sets.map((s, setIdx) => (
                  <div className="tc-set-row" key={setIdx}>
                    <span className="tc-set-idx">Set {setIdx + 1}</span>
                    <input className="tc-input tc-input-num tc-mono" type="number" value={s.weight}
                      onChange={(e) => updateSet(exIdx, setIdx, "weight", e.target.value)} />
                    <span className="tc-x">kg ×</span>
                    <input className="tc-input tc-input-num tc-mono" type="number" value={s.reps}
                      onChange={(e) => updateSet(exIdx, setIdx, "reps", e.target.value)} />
                    <span className="tc-x">reps</span>
                    <button className="tc-icon-btn" onClick={() => removeSet(exIdx, setIdx)}><X size={14} /></button>
                  </div>
                ))}
              </div>
              <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={() => addSet(exIdx)}>
                <Plus size={13} /> Set toevoegen
              </button>
            </div>
          ))}
        </div>

        {addableExercises.length > 0 && (
          <div style={{ marginTop: 4 }}>
            <label className="tc-label">Vergeten oefening toevoegen</label>
            <select className="tc-input tc-select-inline" value=""
              onChange={(e) => { addExercise(e.target.value); e.target.value = ""; }}>
              <option value="">Kies een oefening uit {schemaDay?.name || "je schema"}…</option>
              {addableExercises.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        )}

        <div className="tc-form-row" style={{ marginTop: 12 }}>
          <div>
            <label className="tc-label">Duur (minuten, optioneel)</label>
            <input className="tc-input tc-mono" type="number" value={durationMin}
              onChange={(e) => setDurationMin(e.target.value)} placeholder="bv. 60" />
          </div>
          <div>
            <label className="tc-label">Zwaarte / RPE 1–10 (optioneel)</label>
            <input className="tc-input tc-mono" type="number" min="1" max="10" value={rpe}
              onChange={(e) => setRpe(e.target.value)} placeholder="bv. 7" />
          </div>
        </div>
        <p className="tc-import-help" style={{ marginTop: -4 }}>
          {previewSRpe !== null
            ? `Belasting van deze sessie: ${previewSRpe} sRPE (${durationMin} min × RPE ${rpe}).`
            : "Vul duur én RPE in om deze sessie mee te laten tellen in je krachtbelasting."}
        </p>

        <label className="tc-label">Notities (optioneel)</label>
        <textarea className="tc-input tc-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />

        <div className="tc-actionbar">
          <button className="tc-btn tc-btn-strength" onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 size={14} className="spin" /> Opslaan…</> : "Wijzigingen opslaan"}
          </button>
          <button className="tc-btn tc-btn-ghost" onClick={onClose} disabled={saving}>Annuleren</button>
        </div>
      </div>
    </div>
  );
}
