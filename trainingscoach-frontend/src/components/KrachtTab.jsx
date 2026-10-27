import { useState, useEffect, useRef, useMemo } from "react";
import { Plus, X, MessageCircle, Check } from "lucide-react";
import TimeOfDayPicker from "./shared/TimeOfDayPicker";
import RestTimer, { startRest } from "./shared/RestTimer";
import CollapsibleCard from "./shared/CollapsibleCard";
import * as api from "../api/client";
import { todayStr, formatDateNL } from "../lib/calculations";
import { uid, defaultTimeOfDay, timeOfDayLabel } from "../lib/uiHelpers";

const naamSleutel = (s) => String(s || "").trim().toLowerCase();
const kg = (w) => String(w).replace(".", ",");

/**
 * Wat er per set klaarstaat, en waar het vandaan komt.
 *
 * Eerst wat de coach voor deze sessie heeft voorgesteld, dan wat je de vorige
 * keer deed, dan alleen het aantal herhalingen uit je schema. De getallen
 * worden echt ingevuld en niet als grijze placeholder getoond: een placeholder
 * van 90 was niet te onderscheiden van een ingetikte 90, en je wilt in de
 * sportschool afvinken, niet overtikken.
 */
function voorstelVoor(ex, doel, vorige) {
  const aantal = doel?.sets || ex.targetSets || 1;
  return Array.from({ length: aantal }, (_, i) => {
    const vorigeSet = vorige?.sets?.[i] || vorige?.sets?.[vorige.sets.length - 1];
    const gewicht = doel?.gewichtKg ?? vorigeSet?.weight ?? null;
    const reps = doel?.herhalingen ?? vorigeSet?.reps ?? ex.targetReps ?? null;
    return {
      weight: gewicht === null || gewicht === undefined ? "" : String(gewicht),
      reps: reps === null || reps === undefined ? "" : String(reps),
      done: false,
      // Alleen een set die je afvinkt of zelf aanpast wordt opgeslagen. Wat
      // alleen klaarstond heb je niet per se getild.
      touched: false,
    };
  });
}

export default function KrachtTab({ schema, workoutLogs, addWorkoutLog, goToSchema }) {
  const [dayId, setDayId] = useState(schema.days[0]?.id || "");
  const [date, setDate] = useState(todayStr());
  const [timeOfDay, setTimeOfDay] = useState(defaultTimeOfDay());
  const [formSets, setFormSets] = useState({});
  const [notes, setNotes] = useState("");
  const [rpe, setRpe] = useState("");
  const [durationMin, setDurationMin] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);

  // De krachtvoorstellen van de coach die in de planning staan. Die stonden
  // alleen in het Coach- en Planning-tabblad, terwijl je ze juist hier nodig
  // hebt: met welk gewicht je moet beginnen lees je niet meer terug op het
  // moment dat je voor het rek staat.
  const [plannedStrength, setPlannedStrength] = useState([]);
  const dayChosenByUser = useRef(false);

  useEffect(() => {
    api
      .getPlannedSessions(3)
      .then((data) => setPlannedStrength((data.plans || []).filter((p) => p.discipline === "kracht")))
      .catch(() => setPlannedStrength([])); // advies is meegenomen, loggen moet altijd kunnen
  }, []);

  const day = schema.days.find((d) => d.id === dayId);

  // Het advies voor de dag die je logt. Alleen op datum: dat is wat de coach
  // bedoelde, ook als je een andere trainingsdag uit je schema kiest. Een
  // geaccepteerde sessie gaat voor; staat er alleen een voorstel (bijvoorbeeld
  // uit een automatische ronde die je nog niet hebt bekeken), dan telt dat ook
  // — het is nog steeds het meest recente wat de coach erover zei.
  const forDate = plannedStrength.filter((p) => p.date === date);
  const adviceForDate =
    forDate.find((p) => p.status === "gepland" || p.status === "gedaan") ||
    forDate.find((p) => p.status === "voorgesteld");
  // Niets voor vandaag? Dan is het nuttig te weten wanneer wél — anders lijkt
  // het alsof de coach niets over je krachttraining heeft gezegd.
  const nextAdvice = plannedStrength
    .filter((p) => p.date > date && p.status === "gepland")
    .sort((a, b) => (a.date > b.date ? 1 : -1))[0];

  // Het advies hoort bij de trainingsdag die het noemt; logt je een andere,
  // dan horen de gewichten er niet bij.
  const adviceMatchesDay =
    !!adviceForDate && !!day && naamSleutel(day.name) === naamSleutel(adviceForDate.type);
  const doelen = useMemo(() => {
    const m = new Map();
    if (adviceMatchesDay && Array.isArray(adviceForDate.krachtDoelen)) {
      adviceForDate.krachtDoelen.forEach((d) => m.set(naamSleutel(d.naam), d));
    }
    return m;
  }, [adviceMatchesDay, adviceForDate]);

  // Traint je vandaag zonder dat je het zelf hebt aangeklikt, dan staat de
  // juiste trainingsdag meteen goed — schelen twee handelingen in de gym.
  useEffect(() => {
    if (dayChosenByUser.current || !adviceForDate) return;
    const match = schema.days.find((d) => naamSleutel(d.name) === naamSleutel(adviceForDate.type));
    if (match && match.id !== dayId) setDayId(match.id);
  }, [adviceForDate, schema.days]);

  function lastLogFor(exName) {
    for (const log of workoutLogs) {
      const found = log.exercises.find((e) => e.name === exName);
      if (found && found.sets.length) return { sets: found.sets, timeOfDay: log.timeOfDay, date: log.date };
    }
    return null;
  }

  function freshSets() {
    const init = {};
    (day?.exercises || []).forEach((ex) => {
      init[ex.id] = voorstelVoor(ex, doelen.get(naamSleutel(ex.name)), lastLogFor(ex.name));
    });
    return init;
  }

  // Opnieuw klaarzetten bij een andere dag of als het advies binnenkomt, maar
  // niet over sets heen die je al hebt afgevinkt of aangepast.
  useEffect(() => {
    if (!day) return;
    setFormSets((prev) => {
      const begonnen = Object.values(prev).some((sets) => sets.some((s) => s.done || s.touched));
      const sameDay = day.exercises.every((ex) => prev[ex.id]);
      if (begonnen && sameDay) return prev;
      return freshSets();
    });
  }, [dayId, schema, doelen, workoutLogs]);

  if (schema.days.length === 0) {
    return (
      <div className="tc-empty">
        <p>Je hebt nog geen schema ingesteld.</p>
        <button className="tc-btn tc-btn-strength" onClick={goToSchema}>Naar Instellingen → Schema</button>
      </div>
    );
  }

  function updateSet(exId, idx, field, value) {
    setFormSets((prev) => {
      const arr = [...(prev[exId] || [])];
      arr[idx] = { ...arr[idx], [field]: value, touched: true };
      return { ...prev, [exId]: arr };
    });
  }
  function toggleDone(exId, idx) {
    const set = formSets[exId]?.[idx];
    if (!set) return;
    const wordtGedaan = !set.done;
    setFormSets((prev) => {
      const arr = [...(prev[exId] || [])];
      arr[idx] = { ...arr[idx], done: wordtGedaan, touched: true };
      return { ...prev, [exId]: arr };
    });
    // Afvinken = set klaar = rust begint. Eén tik in plaats van twee.
    if (wordtGedaan) startRest();
  }
  function addSet(exId) {
    setFormSets((prev) => {
      const arr = prev[exId] || [];
      const laatste = arr[arr.length - 1];
      return {
        ...prev,
        [exId]: [...arr, { weight: laatste?.weight ?? "", reps: laatste?.reps ?? "", done: false, touched: false }],
      };
    });
  }
  function removeSet(exId, idx) {
    setFormSets((prev) => {
      const arr = [...(prev[exId] || [])];
      arr.splice(idx, 1);
      return { ...prev, [exId]: arr };
    });
  }

  const allSets = Object.values(formSets).flat();
  const doneCount = allSets.filter((s) => s.done).length;

  async function handleSubmit() {
    if (!day) return;
    const exercises = day.exercises
      .map((ex) => {
        const sets = (formSets[ex.id] || []).filter(
          (s) => (s.done || s.touched) && s.weight !== "" && s.reps !== ""
        );
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
    if (ok) {
      setNotes(""); setRpe(""); setDurationMin("");
      setFormSets(freshSets());
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2200);
    }
  }

  const heeftDoelen = doelen.size > 0;

  return (
    <div className="tc-kracht">
      <h1 className="tc-title">Kracht loggen</h1>

      {/* Het advies van de coach voor deze dag, bovenaan: met welk gewicht je
          begint is precies wat je kwijt bent op het moment dat je het nodig hebt. */}
      {adviceForDate && (
        <div className="tc-card tc-advice-card">
          <div className="tc-card-head">
            <span className="tc-ex-name">
              <MessageCircle size={14} style={{ marginRight: 6, verticalAlign: "middle", color: "var(--strength)" }} />
              Wat de coach voor deze training adviseert
            </span>
            <span className="tc-hint-badge tc-badge-strength">
              {adviceForDate.type}{adviceForDate.status === "voorgesteld" ? " · voorstel" : ""}
            </span>
          </div>
          <p className="tc-feedback-text" style={{ marginTop: 0 }}>{adviceForDate.description}</p>
          {heeftDoelen && (
            <p className="tc-import-help" style={{ marginBottom: 0 }}>
              De gewichten hieronder staan klaar volgens dit advies. Vink een set af als hij klaar is, of pas hem eerst aan.
            </p>
          )}
          {day && adviceForDate.type && !adviceMatchesDay && (
            <p className="tc-import-help" style={{ marginBottom: 0 }}>
              Let op: dit advies hoort bij "{adviceForDate.type}", en je logt nu "{day.name}".
            </p>
          )}
        </div>
      )}

      {!adviceForDate && nextAdvice && (
        <p className="tc-import-help">
          Voor {formatDateNL(date)} staat geen coachadvies. Het eerstvolgende is{" "}
          {formatDateNL(nextAdvice.date)} ({nextAdvice.type}).
        </p>
      )}

      <div className="tc-form-row">
        <div>
          <label className="tc-label" htmlFor="kracht-dag">Trainingsdag</label>
          <select id="kracht-dag" className="tc-input" value={dayId}
            onChange={(e) => { dayChosenByUser.current = true; setDayId(e.target.value); }}>
            {schema.days.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="tc-label" htmlFor="kracht-datum">Datum</label>
          <input id="kracht-datum" className="tc-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      <TimeOfDayPicker value={timeOfDay} onChange={setTimeOfDay} />

      {day && (
        <div className="tc-ex-log-list">
          {day.exercises.map((ex) => {
            const last = lastLogFor(ex.name);
            const doel = doelen.get(naamSleutel(ex.name));
            const sets = formSets[ex.id] || [];
            return (
              <div className="tc-card tc-ex-card" key={ex.id}>
                <div className="tc-card-head">
                  <span className="tc-ex-name">{ex.name || "(naamloos)"}</span>
                  <span className="tc-ex-target tc-mono">{sets.filter((s) => s.done).length}/{sets.length}</span>
                </div>
                {(doel || last) && (
                  <p className="tc-ex-source">
                    {doel ? (
                      <>
                        <strong>Coach:</strong>{" "}
                        {doel.sets && doel.herhalingen ? `${doel.sets} × ${doel.herhalingen}` : ""}
                        {doel.gewichtKg != null ? ` op ${kg(doel.gewichtKg)} kg` : ""}
                        {last ? ` · vorige keer ${last.sets.map((s) => `${kg(s.weight)}×${s.reps}`).join(", ")}` : ""}
                      </>
                    ) : (
                      <>
                        Vorige keer{last.timeOfDay ? ` (${timeOfDayLabel(last.timeOfDay)})` : ""}:{" "}
                        {last.sets.map((s) => `${kg(s.weight)}×${s.reps}`).join(", ")}
                      </>
                    )}
                  </p>
                )}
                <div className="tc-set-grid" role="group" aria-label={`Sets ${ex.name}`}>
                  <span className="tc-set-head">Set</span>
                  <span className="tc-set-head">kg</span>
                  <span className="tc-set-head">reps</span>
                  <span />
                  <span />
                  {sets.map((s, idx) => (
                    <SetRij key={idx} idx={idx} set={s} exName={ex.name}
                      onChange={(field, v) => updateSet(ex.id, idx, field, v)}
                      onToggle={() => toggleDone(ex.id, idx)}
                      onRemove={() => removeSet(ex.id, idx)} />
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

      <CollapsibleCard id="kracht-afronden" title="Duur, RPE en notities" subtitle="optioneel, voor je krachtbelasting">
        <div className="tc-form-row">
          <div>
            <label className="tc-label" htmlFor="kracht-duur">Duur (minuten)</label>
            <input id="kracht-duur" className="tc-input tc-mono" type="number" value={durationMin}
              onChange={(e) => setDurationMin(e.target.value)} placeholder="bv. 60" />
          </div>
          <div>
            <label className="tc-label" htmlFor="kracht-rpe">Zwaarte / RPE 1–10</label>
            <input id="kracht-rpe" className="tc-input tc-mono" type="number" min="1" max="10" value={rpe}
              onChange={(e) => setRpe(e.target.value)} placeholder="bv. 7" />
          </div>
        </div>
        <p className="tc-import-help">
          Duur maal RPE is de gangbare maat voor gymbelasting; de coach weegt het mee naast je cardio.
        </p>
        <label className="tc-label" htmlFor="kracht-notities">Notities</label>
        <textarea id="kracht-notities" className="tc-input tc-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Hoe voelde de training aan? Vermoeidheid, pijntjes, motivatie..." />
      </CollapsibleCard>

      <div className="tc-actionbar">
        <button className="tc-btn tc-btn-strength" onClick={handleSubmit}>Training opslaan</button>
        <span className="tc-import-help" style={{ margin: 0 }}>{doneCount} set{doneCount === 1 ? "" : "s"} afgevinkt</span>
        {savedFlash && <span className="tc-saved-flash">Opgeslagen ✓</span>}
      </div>

      {day && day.exercises.length > 0 && <RestTimer bar />}
    </div>
  );
}

function SetRij({ idx, set, exName, onChange, onToggle, onRemove }) {
  const label = `${exName} set ${idx + 1}`;
  return (
    <>
      <span className={"tc-set-idx tc-mono" + (set.done ? " tc-set-idx-done" : "")}>{idx + 1}</span>
      <input
        className={"tc-input tc-mono tc-set-input" + (set.done ? " tc-set-done" : "")}
        type="number" inputMode="decimal" step="0.25"
        aria-label={`${label} gewicht`}
        value={set.weight}
        placeholder="kg"
        onChange={(e) => onChange("weight", e.target.value)}
      />
      <input
        className={"tc-input tc-mono tc-set-input" + (set.done ? " tc-set-done" : "")}
        type="number" inputMode="numeric"
        aria-label={`${label} herhalingen`}
        value={set.reps}
        placeholder="reps"
        onChange={(e) => onChange("reps", e.target.value)}
      />
      <button
        className={"tc-set-check" + (set.done ? " tc-set-check-on" : "")}
        aria-label={`${label} ${set.done ? "niet meer gedaan" : "gedaan"}`}
        aria-pressed={set.done}
        disabled={set.weight === "" || set.reps === ""}
        onClick={onToggle}
      >
        <Check size={20} strokeWidth={3} />
      </button>
      <button className="tc-icon-btn tc-set-remove" aria-label={`${label} verwijderen`} onClick={onRemove}>
        <X size={14} />
      </button>
    </>
  );
}
