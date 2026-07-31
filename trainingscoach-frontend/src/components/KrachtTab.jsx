import { useState, useEffect } from "react";
import { Plus, X } from "lucide-react";
import TimeOfDayPicker from "./shared/TimeOfDayPicker";
import { uid, todayStr, defaultTimeOfDay, timeOfDayLabel } from "../lib/calculations";

export default function KrachtTab({ schema, workoutLogs, addWorkoutLog, goToSchema }) {
  const [dayId, setDayId] = useState(schema.days[0]?.id || "");
  const [date, setDate] = useState(todayStr());
  const [timeOfDay, setTimeOfDay] = useState(defaultTimeOfDay());
  const [formSets, setFormSets] = useState({});
  const [notes, setNotes] = useState("");
  const [rpe, setRpe] = useState("");
  const [durationMin, setDurationMin] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);

  const day = schema.days.find((d) => d.id === dayId);

  function lastLogFor(exName) {
    for (const log of workoutLogs) {
      const found = log.exercises.find((e) => e.name === exName);
      if (found && found.sets.length) return { sets: found.sets, timeOfDay: log.timeOfDay };
    }
    return null;
  }

  useEffect(() => {
    if (!day) return;
    const init = {};
    day.exercises.forEach((ex) => {
      init[ex.id] = Array.from({ length: ex.targetSets || 1 }, () => ({ weight: "", reps: "" }));
    });
    setFormSets(init);
  }, [dayId, schema]);

  if (schema.days.length === 0) {
    return (
      <div className="tc-empty">
        <p>Je hebt nog geen schema ingesteld.</p>
        <button className="tc-btn tc-btn-strength" onClick={goToSchema}>Ga naar Schema</button>
      </div>
    );
  }

  function updateSet(exId, idx, field, value) {
    setFormSets((prev) => {
      const arr = [...(prev[exId] || [])];
      arr[idx] = { ...arr[idx], [field]: value };
      return { ...prev, [exId]: arr };
    });
  }
  function addSet(exId) {
    setFormSets((prev) => ({ ...prev, [exId]: [...(prev[exId] || []), { weight: "", reps: "" }] }));
  }
  function removeSet(exId, idx) {
    setFormSets((prev) => {
      const arr = [...(prev[exId] || [])];
      arr.splice(idx, 1);
      return { ...prev, [exId]: arr };
    });
  }

  async function handleSubmit() {
    if (!day) return;
    const exercises = day.exercises
      .map((ex) => {
        const sets = (formSets[ex.id] || []).filter((s) => s.weight !== "" && s.reps !== "");
        return { exerciseId: ex.id, name: ex.name, sets: sets.map((s) => ({ weight: Number(s.weight), reps: Number(s.reps) })) };
      })
      .filter((e) => e.sets.length > 0);

    if (exercises.length === 0) return;

    const entry = {
      id: uid(), date, timeOfDay, dayId: day.id, dayName: day.name, exercises, notes,
      rpe: rpe ? Number(rpe) : null,
      durationMin: durationMin ? Number(durationMin) : null,
    };
    const ok = await addWorkoutLog(entry);
    setNotes(""); setRpe(""); setDurationMin("");
    const init = {};
    day.exercises.forEach((ex) => {
      init[ex.id] = Array.from({ length: ex.targetSets || 1 }, () => ({ weight: "", reps: "" }));
    });
    setFormSets(init);
    if (ok) {
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2200);
    }
  }

  return (
    <div>
      <h1 className="tc-title">Krachttraining loggen</h1>
      <p className="tc-sub">Kies je trainingsdag en vul de gewichten en herhalingen in. De vorige sessie zie je als richtlijn.</p>

      <div className="tc-form-row">
        <div>
          <label className="tc-label">Trainingsdag</label>
          <select className="tc-input" value={dayId} onChange={(e) => setDayId(e.target.value)}>
            {schema.days.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="tc-label">Datum</label>
          <input className="tc-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      <label className="tc-label">Moment van de dag</label>
      <TimeOfDayPicker value={timeOfDay} onChange={setTimeOfDay} />

      {day && (
        <div className="tc-ex-log-list">
          {day.exercises.map((ex) => {
            const last = lastLogFor(ex.name);
            return (
              <div className="tc-card" key={ex.id}>
                <div className="tc-card-head">
                  <span className="tc-ex-name">{ex.name || "(naamloos)"}</span>
                  {last && (
                    <span className="tc-hint-badge tc-badge-strength">
                      vorige keer{last.timeOfDay ? ` (${timeOfDayLabel(last.timeOfDay)})` : ""}: {last.sets.map((s) => `${s.weight}kg×${s.reps}`).join(", ")}
                    </span>
                  )}
                </div>
                <div className="tc-set-rows">
                  {(formSets[ex.id] || []).map((s, idx) => (
                    <div className="tc-set-row" key={idx}>
                      <span className="tc-set-idx">Set {idx + 1}</span>
                      <input
                        className="tc-input tc-input-num tc-mono"
                        type="number"
                        placeholder={last?.sets?.[idx]?.weight ?? "kg"}
                        value={s.weight}
                        onChange={(e) => updateSet(ex.id, idx, "weight", e.target.value)}
                      />
                      <span className="tc-x">kg ×</span>
                      <input
                        className="tc-input tc-input-num tc-mono"
                        type="number"
                        placeholder={last?.sets?.[idx]?.reps ?? "reps"}
                        value={s.reps}
                        onChange={(e) => updateSet(ex.id, idx, "reps", e.target.value)}
                      />
                      <span className="tc-x">reps</span>
                      <button className="tc-icon-btn" onClick={() => removeSet(ex.id, idx)}><X size={14} /></button>
                    </div>
                  ))}
                </div>
                <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={() => addSet(ex.id)}>
                  <Plus size={13} /> Set toevoegen
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="tc-form-row">
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
        Duur en RPE samen geven de coach een maat voor je krachtbelasting. Zonder vermogensmeter is
        dat de gangbare manier om gymwerk te kwantificeren — handig, want de belastinggrafiek
        (CTL/ATL/TSB) kijkt alleen naar cardio.
      </p>

      <label className="tc-label">Notities (optioneel)</label>
      <textarea className="tc-input tc-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Hoe voelde de training aan? Vermoeidheid, pijntjes, motivatie..." />

      <div className="tc-actionbar">
        <button className="tc-btn tc-btn-strength" onClick={handleSubmit}>Training opslaan</button>
        {savedFlash && <span className="tc-saved-flash">Opgeslagen ✓</span>}
      </div>
    </div>
  );
}
