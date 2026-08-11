import { useState, useRef, useEffect } from "react";
import { Plus, Trash2, X, Download, UploadCloud, Check, Loader2, Lock, Unlock } from "lucide-react";
import { CARDIO_TYPES, TIME_OF_DAY } from "../lib/constants";
import { WEEKDAYS, todayStr, formatDateNL, computeHrZones, computePowerZones } from "../lib/calculations";
import { uid } from "../lib/uiHelpers";
import * as api from "../api/client";
import StravaPanel from "./StravaPanel";
import AutomationPanel from "./AutomationPanel";
import SchemaCoachPanel from "./SchemaCoachPanel";

export default function SchemaTab({ schema, setSchema, onRestored }) {
  const [pendingImport, setPendingImport] = useState(null);
  const [importFileError, setImportFileError] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [restoredFlash, setRestoredFlash] = useState(false);
  const backupFileInputRef = useRef(null);

  const [exportError, setExportError] = useState("");
  // A backup nobody can see is a backup nobody trusts, so the automatic ones
  // are reported here rather than only existing on disk.
  const [autoBackups, setAutoBackups] = useState(null);

  useEffect(() => {
    api.getBackups().then(setAutoBackups).catch(() => setAutoBackups({ backups: [], laatste: null }));
  }, [restoredFlash]);

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
  /**
   * Weekdays are toggles rather than a single dropdown: some people run the
   * same workout twice a week, and forcing one day per workout would mean
   * duplicating the whole exercise list to express that.
   */
  function toggleDayWeekday(dayId, weekday) {
    setSchema({
      ...schema,
      days: schema.days.map((d) => {
        if (d.id !== dayId) return d;
        const current = d.weekdays || [];
        return {
          ...d,
          weekdays: current.includes(weekday)
            ? current.filter((w) => w !== weekday)
            : [...current, weekday],
        };
      }),
    });
  }

  function setDayTimeOfDay(dayId, timeOfDay) {
    setSchema({
      ...schema,
      // Clicking the active option clears it — not every session has a fixed slot.
      days: schema.days.map((d) =>
        d.id === dayId ? { ...d, timeOfDay: d.timeOfDay === timeOfDay ? null : timeOfDay } : d
      ),
    });
  }

  /**
   * A locked day is an appointment made with someone else — a partner, a club,
   * the only evening that could be freed up. The coach may design what happens
   * in it, but a schema proposal never moves it.
   */
  function toggleDayLock(dayId) {
    setSchema({
      ...schema,
      days: schema.days.map((d) => (d.id === dayId ? { ...d, locked: !d.locked } : d)),
    });
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
      <p className="tc-sub">
        Je vaste weekindeling: welke trainingsdagen je hebt, met welke oefeningen. Dit is de basis
        bij het loggen van je krachttraining. Je kunt het zelf samenstellen, of de coach een
        voorstel laten doen op basis van je doelen.
      </p>

      <h2 className="tc-section-title" style={{ marginTop: 0 }}>Laat de coach een schema voorstellen</h2>
      <p className="tc-sub" style={{ marginTop: -4 }}>
        Je hoeft het schema hieronder niet zelf te bedenken. Vertel wat je wilt bereiken en waar je
        aan gebonden bent, dan ontwerpt de coach een weekindeling op basis daarvan én van wat je tot
        nu toe hebt getraind. Je krijgt het als voorstel: je ziet eerst wat er zou veranderen, en
        overnemen kun je meteen terugdraaien.
      </p>
      <SchemaCoachPanel onSchemaReplaced={onRestored} />

      <h2 className="tc-section-title" style={{ marginTop: 32 }}>Je trainingsdagen</h2>
      <p className="tc-sub" style={{ marginTop: -4 }}>
        De coach plant je krachttrainingen exact op de weekdagen die je hier aanvinkt — hij verzint
        er geen eigen rotatie omheen. Geef je ook een tijdstip op, dan rekent hij met de werkelijke
        hersteltijd: een avondtraining gevolgd door een ochtendrit is maar twaalf uur ertussen.
        Is een dag thuis of met een clubgenoot afgesproken, zet hem dan vast met het slotje: een
        schemavoorstel mag zo'n dag niet verplaatsen, alleen invullen.
      </p>

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
              <button
                className={"tc-icon-btn" + (day.locked ? " tc-locked" : "")}
                onClick={() => toggleDayLock(day.id)}
                title={
                  day.locked
                    ? "Vaste afspraak — de coach mag deze dag niet verplaatsen. Klik om vrij te geven."
                    : "Vastzetten: de coach bepaalt dan wél de invulling, maar niet de dag"
                }
              >
                {day.locked ? <Lock size={15} /> : <Unlock size={15} />}
              </button>
              <button className="tc-icon-btn" onClick={() => removeDay(day.id)} title="Dag verwijderen">
                <Trash2 size={15} />
              </button>
            </div>

            <div className="tc-weekday-toggles">
              {WEEKDAYS.map((w) => (
                <button
                  key={w}
                  type="button"
                  className={"tc-weekday-toggle" + ((day.weekdays || []).includes(w) ? " active" : "")}
                  onClick={() => toggleDayWeekday(day.id, w)}
                  title={`${day.name} op ${w.toLowerCase()}`}
                >
                  {w.slice(0, 2)}
                </button>
              ))}
            </div>

            <div className="tc-weekday-toggles">
              {TIME_OF_DAY.map((t) => {
                const Icon = t.icon;
                return (
                  <button key={t.id} type="button"
                    className={"tc-weekday-toggle" + (day.timeOfDay === t.id ? " active" : "")}
                    onClick={() => setDayTimeOfDay(day.id, t.id)}
                    title={`${day.name} in de ${t.label.toLowerCase()}`}>
                    <Icon size={11} /> {t.label}
                  </button>
                );
              })}
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
              <select className="tc-input" value={c.timeOfDay || ""}
                onChange={(e) => updateCardioDay(c.id, { timeOfDay: e.target.value || null })}>
                <option value="">tijdstip…</option>
                {TIME_OF_DAY.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              <input
                className="tc-input"
                placeholder="Notities (bv. duurloop, intervallen, doelafstand)"
                value={c.notes}
                onChange={(e) => updateCardioDay(c.id, { notes: e.target.value })}
              />
              <button
                className={"tc-icon-btn" + (c.locked ? " tc-locked" : "")}
                onClick={() => updateCardioDay(c.id, { locked: !c.locked })}
                title={
                  c.locked
                    ? "Vaste afspraak — de coach mag dit moment niet verplaatsen. Klik om vrij te geven."
                    : "Vastzetten: de coach vult dit moment in, maar verzet het niet"
                }
              >
                {c.locked ? <Lock size={15} /> : <Unlock size={15} />}
              </button>
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

      <h2 className="tc-section-title" style={{ marginTop: 32 }}>Coach</h2>
      <AutomationPanel />

      <h2 className="tc-section-title" style={{ marginTop: 32 }}>Strava</h2>
      <StravaPanel onImported={onRestored} />

      <h2 className="tc-section-title" style={{ marginTop: 32 }}>Back-up</h2>
      <p className="tc-sub" style={{ marginTop: -4 }}>
        De server maakt elke nacht automatisch een kopie. Hieronder kun je daarnaast zelf een bestand
        downloaden — handig om buiten de Pi te bewaren, want een SD-kaart die stukgaat neemt ook de
        automatische kopieën mee.
      </p>
      {autoBackups && (
        <div className="tc-card tc-backup-card" style={{ marginBottom: 12 }}>
          <div className="tc-card-head">
            <span className="tc-ex-name">Automatische back-up</span>
            {autoBackups.laatste ? (
              <span className="tc-hint-badge tc-badge-strength">
                laatste: {formatDateNL(autoBackups.laatste.date)} · {Math.round(autoBackups.laatste.bytes / 1024)} KB
              </span>
            ) : (
              <span className="tc-hint-badge tc-badge-warning">nog geen kopie</span>
            )}
          </div>
          <p className="tc-import-help" style={{ marginTop: 0 }}>
            {autoBackups.backups.length > 0
              ? `${autoBackups.backups.length} kopie${autoBackups.backups.length === 1 ? "" : "\u00ebn"} bewaard op de server (maximaal ${autoBackups.bewaartermijnDagen} dagen). Terugzetten kan met "Herstel vanuit back-up" \u2014 de bestanden staan in data/backups/.`
              : "De eerste kopie wordt vannacht gemaakt. Draait de server al langer, controleer dan of data/backups/ beschrijfbaar is."}
          </p>
        </div>
      )}
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
