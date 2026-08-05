import { useState, useRef } from "react";
import Papa from "papaparse";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { UploadCloud, Check, X, Loader2 } from "lucide-react";
import TimeOfDayPicker from "./shared/TimeOfDayPicker";
import { CARDIO_TYPES, TIME_OF_DAY } from "../lib/constants";
import { todayStr, formatDateNL, getWeightAtDate } from "../lib/calculations";
import { uid, defaultTimeOfDay, timeOfDayLabel } from "../lib/uiHelpers";
import { mapActivitiesCsv, guessCardioType } from "../lib/csvImport";
import { parseGpxToSession, readGpxFileAsText } from "../lib/gpxParser";

export default function CardioTab({ cardioLogs, addCardioLog, addCardioLogsBulk, weightLogs }) {
  const [date, setDate] = useState(todayStr());
  const [type, setType] = useState(CARDIO_TYPES[0]);
  const [timeOfDay, setTimeOfDay] = useState(defaultTimeOfDay());
  const [duration, setDuration] = useState("");
  const [distance, setDistance] = useState("");
  const [avgHr, setAvgHr] = useState("");
  const [maxHr, setMaxHr] = useState("");
  const [avgPower, setAvgPower] = useState("");
  const [weightedAvgPower, setWeightedAvgPower] = useState("");
  const [avgCadence, setAvgCadence] = useState("");
  const [elevationGain, setElevationGain] = useState("");
  const [pace, setPace] = useState("");
  const [calories, setCalories] = useState("");
  const [notes, setNotes] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);

  const [importRows, setImportRows] = useState(null);
  const [importError, setImportError] = useState("");
  const fileInputRef = useRef(null);

  const [gpxBatch, setGpxBatch] = useState(null);
  const [gpxLoading, setGpxLoading] = useState(false);
  const [gpxError, setGpxError] = useState("");
  const [gpxSavedFlash, setGpxSavedFlash] = useState(false);
  const gpxFileInputRef = useRef(null);

  async function handleGpxFiles(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setGpxError("");
    setGpxLoading(true);
    setGpxBatch(null);

    const results = await Promise.all(
      files.map(async (file) => {
        try {
          const text = await readGpxFileAsText(file);
          const parsed = parseGpxToSession(text);
          if (!parsed) {
            return { id: uid(), fileName: file.name, error: "Kon geen tijdreeks vinden (geen geldige tijdstempels per punt).", include: false };
          }
          return { id: uid(), fileName: file.name, parsed, type: parsed.guessedType ? guessCardioType(parsed.guessedType) : CARDIO_TYPES[0], include: true, error: null };
        } catch (err) {
          return { id: uid(), fileName: file.name, error: err.message, include: false };
        }
      })
    );

    setGpxBatch(results);
    setGpxLoading(false);
    if (gpxFileInputRef.current) gpxFileInputRef.current.value = "";
  }

  function updateGpxBatchItem(id, patch) {
    setGpxBatch((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function confirmGpxBatchSave() {
    if (!gpxBatch) return;
    const toAdd = gpxBatch
      .filter((item) => item.include && item.parsed)
      .map((item) => ({
        id: uid(),
        date: item.parsed.date,
        timeOfDay: item.parsed.timeOfDay,
        type: item.type,
        duration_min: item.parsed.duration_min,
        total_duration_min: item.parsed.total_duration_min,
        distance_km: item.parsed.distance_km,
        avg_hr: item.parsed.avg_hr,
        max_hr: item.parsed.max_hr,
        avg_power: item.parsed.avg_power,
        max_power: item.parsed.max_power,
        weighted_avg_power: item.parsed.weighted_avg_power,
        avg_cadence: item.parsed.avg_cadence,
        max_cadence: item.parsed.max_cadence,
        elevation_gain_m: item.parsed.elevation_gain_m,
        elevation_loss_m: item.parsed.elevation_loss_m,
        pace: null,
        calories: null,
        notes: "",
        profile: item.parsed.profile,
      }));
    const ok = await addCardioLogsBulk(toAdd);
    if (ok) {
      setGpxBatch(null);
      setGpxSavedFlash(true);
      setTimeout(() => setGpxSavedFlash(false), 2200);
    }
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError("");
    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: (res) => {
        try {
          const { rows, error } = mapActivitiesCsv(res.data);
          if (error) {
            setImportError(error);
            setImportRows(null);
          } else {
            setImportRows(rows);
          }
        } catch (err) {
          setImportError("Kon het bestand niet verwerken: " + err.message);
        }
      },
      error: (err) => setImportError("Kon het bestand niet lezen: " + err.message),
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function updateImportRow(idx, patch) {
    setImportRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function setAllIncluded(include) {
    setImportRows((prev) => prev.map((r) => ({ ...r, include })));
  }
  function filterFromDate(minDate) {
    if (!minDate) return;
    setImportRows((prev) => prev.map((r) => ({ ...r, include: r.date >= minDate })));
  }

  async function confirmImport() {
    const toAdd = importRows.filter((r) => r.include).map((r) => ({ id: uid(), ...r }));
    // strip the "include" helper flag before saving
    const cleaned = toAdd.map(({ include, ...rest }) => rest);
    const ok = await addCardioLogsBulk(cleaned);
    if (ok) setImportRows(null);
  }

  async function handleSubmit() {
    if (!date || !type) return;
    const entry = {
      id: uid(), date, timeOfDay, type,
      duration_min: duration ? Number(duration) : null,
      distance_km: distance ? Number(distance) : null,
      avg_hr: avgHr ? Number(avgHr) : null,
      max_hr: maxHr ? Number(maxHr) : null,
      avg_power: avgPower ? Number(avgPower) : null,
      max_power: null,
      weighted_avg_power: weightedAvgPower ? Number(weightedAvgPower) : null,
      avg_cadence: avgCadence ? Number(avgCadence) : null,
      max_cadence: null,
      elevation_gain_m: elevationGain ? Number(elevationGain) : null,
      pace: pace || null,
      calories: calories ? Number(calories) : null,
      notes,
    };
    const ok = await addCardioLog(entry);
    if (ok) {
      setDuration(""); setDistance(""); setAvgHr(""); setMaxHr(""); setAvgPower(""); setWeightedAvgPower(""); setAvgCadence(""); setElevationGain(""); setPace(""); setCalories(""); setNotes("");
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2200);
    }
  }

  return (
    <div>
      <h1 className="tc-title">Cardiosessie loggen</h1>
      <p className="tc-sub">Vul handmatig een sessie in, of importeer meteen meerdere sessies uit een Strava- of Garmin-export.</p>

      <div className="tc-card tc-import-card">
        <div className="tc-card-head">
          <span className="tc-ex-name">CSV importeren</span>
          <span className="tc-hint-badge tc-badge-cardio">Strava &amp; Garmin</span>
        </div>
        <p className="tc-import-help">
          Garmin Connect: ga naar je activiteitenlijst → "Exporteren" → CSV. Strava: Instellingen → "Mijn account" → "Download of verwijder je account" → archief aanvragen, gebruik daarna <code>activities.csv</code> uit de zip.
          Upload het bestand hieronder — je krijgt eerst een controlescherm te zien voordat er iets wordt opgeslagen.
        </p>
        <label className="tc-btn tc-btn-ghost tc-file-btn">
          <UploadCloud size={15} /> Kies CSV-bestand
          <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFile} style={{ display: "none" }} />
        </label>
        {importError && <div className="tc-error"><span>{importError}</span></div>}

        {importRows && (
          <div className="tc-import-preview">
            <p className="tc-import-help">
              {importRows.length} activiteiten gevonden. Krachttrainingen zijn automatisch uitgevinkt (dit is geen cardio) — vink aan als je die toch wilt meenemen. Controleer verder vooral eenheden (km vs. meter, minuten vs. seconden) en vink uit wat je niet wilt importeren.
            </p>
            <div className="tc-import-bulkbar">
              <span className="tc-import-count">{importRows.filter((r) => r.include).length} van {importRows.length} geselecteerd</span>
              <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={() => setAllIncluded(true)}>Alles selecteren</button>
              <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={() => setAllIncluded(false)}>Alles deselecteren</button>
              <label className="tc-import-datefilter">
                Alleen vanaf:
                <input className="tc-input tc-input-cell" type="date" onChange={(e) => filterFromDate(e.target.value)} />
              </label>
            </div>
            <table className="tc-table tc-import-table">
              <thead>
                <tr><th></th><th>Datum</th><th>Moment</th><th>Type</th><th>Duur (min)</th><th>Afstand (km)</th><th>Gem. HR</th><th>Max HR</th><th>Gem. W</th><th>Max W</th><th>NP (W)</th><th>Cadans</th><th>Hoogte (m)</th><th>Naam</th></tr>
              </thead>
              <tbody>
                {importRows.map((r, idx) => (
                  <tr key={idx} className={r.include ? "" : "tc-row-disabled"}>
                    <td>
                      <input type="checkbox" checked={r.include} onChange={(e) => updateImportRow(idx, { include: e.target.checked })} />
                    </td>
                    <td><input className="tc-input tc-mono tc-input-cell" type="date" value={r.date} onChange={(e) => updateImportRow(idx, { date: e.target.value })} /></td>
                    <td>
                      <select className="tc-input tc-input-cell" value={r.timeOfDay} onChange={(e) => updateImportRow(idx, { timeOfDay: e.target.value })}>
                        {TIME_OF_DAY.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="tc-input tc-input-cell" value={r.type} onChange={(e) => updateImportRow(idx, { type: e.target.value })}>
                        {CARDIO_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td><input className="tc-input tc-mono tc-input-cell tc-input-num" type="number" value={r.duration_min ?? ""} onChange={(e) => updateImportRow(idx, { duration_min: e.target.value ? Number(e.target.value) : null })} /></td>
                    <td><input className="tc-input tc-mono tc-input-cell tc-input-num" type="number" step="0.01" value={r.distance_km ?? ""} onChange={(e) => updateImportRow(idx, { distance_km: e.target.value ? Number(e.target.value) : null })} /></td>
                    <td><input className="tc-input tc-mono tc-input-cell tc-input-num" type="number" value={r.avg_hr ?? ""} onChange={(e) => updateImportRow(idx, { avg_hr: e.target.value ? Number(e.target.value) : null })} /></td>
                    <td><input className="tc-input tc-mono tc-input-cell tc-input-num" type="number" value={r.max_hr ?? ""} onChange={(e) => updateImportRow(idx, { max_hr: e.target.value ? Number(e.target.value) : null })} /></td>
                    <td><input className="tc-input tc-mono tc-input-cell tc-input-num" type="number" value={r.avg_power ?? ""} onChange={(e) => updateImportRow(idx, { avg_power: e.target.value ? Number(e.target.value) : null })} /></td>
                    <td><input className="tc-input tc-mono tc-input-cell tc-input-num" type="number" value={r.max_power ?? ""} onChange={(e) => updateImportRow(idx, { max_power: e.target.value ? Number(e.target.value) : null })} /></td>
                    <td><input className="tc-input tc-mono tc-input-cell tc-input-num" type="number" value={r.weighted_avg_power ?? ""} onChange={(e) => updateImportRow(idx, { weighted_avg_power: e.target.value ? Number(e.target.value) : null })} /></td>
                    <td><input className="tc-input tc-mono tc-input-cell tc-input-num" type="number" value={r.avg_cadence ?? ""} onChange={(e) => updateImportRow(idx, { avg_cadence: e.target.value ? Number(e.target.value) : null })} /></td>
                    <td><input className="tc-input tc-mono tc-input-cell tc-input-num" type="number" value={r.elevation_gain_m ?? ""} onChange={(e) => updateImportRow(idx, { elevation_gain_m: e.target.value ? Number(e.target.value) : null })} /></td>
                    <td><input className="tc-input tc-input-cell" value={r.notes} onChange={(e) => updateImportRow(idx, { notes: e.target.value })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="tc-actionbar">
              <button className="tc-btn tc-btn-cardio" onClick={confirmImport}>
                <Check size={15} /> {importRows.filter((r) => r.include).length} activiteiten importeren
              </button>
              <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={() => setImportRows(null)}>Annuleren</button>
            </div>
          </div>
        )}
      </div>

      <div className="tc-card tc-import-card">
        <div className="tc-card-head">
          <span className="tc-ex-name">Sessiedetail toevoegen (GPX)</span>
          <span className="tc-hint-badge tc-badge-cardio">Voor intervallen/verloop</span>
        </div>
        <p className="tc-import-help">
          Een CSV-export geeft alleen gemiddelden per activiteit — daarin is het verloop tíjdens een training (bijvoorbeeld intervallen) niet te zien.
          Selecteer hier één of meerdere GPX-bestanden tegelijk (bijv. de hele "activities"-map uit je Strava-archief, inclusief gecomprimeerde <code>.gpx.gz</code>-bestanden — die worden automatisch uitgepakt) en ik reconstrueer per sessie het verloop van hartslag, snelheid, vermogen en cadans over de tijd.
          Bij Strava: activiteit openen → "..." → "Exporteer GPX". Bij Garmin Connect: activiteit → instellingen-tandwiel → "Exporteren naar GPX". FIT-bestanden worden niet ondersteund.
        </p>
        <label className="tc-btn tc-btn-ghost tc-file-btn">
          <UploadCloud size={15} /> Kies GPX-bestand(en)
          <input ref={gpxFileInputRef} type="file" accept=".gpx,.gz" multiple onChange={handleGpxFiles} style={{ display: "none" }} />
        </label>
        {gpxLoading && (
          <div className="tc-import-help" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Loader2 className="spin" size={15} /> Bestanden inlezen…
          </div>
        )}
        {gpxError && <div className="tc-error"><span>{gpxError}</span></div>}

        {gpxBatch && (
          <div className="tc-import-preview">
            <p className="tc-import-help">
              {gpxBatch.filter((i) => i.parsed).length} van {gpxBatch.length} bestanden succesvol gelezen.
              {gpxBatch.some((i) => i.error) ? " Bestanden met een fout zijn uitgevinkt en worden niet opgeslagen." : ""}
            </p>
            <div className="tc-gpxbatch-list">
              {gpxBatch.map((item) => (
                <div className={"tc-gpxbatch-row" + (item.error ? " tc-row-disabled" : "")} key={item.id}>
                  {!item.error ? (
                    <input type="checkbox" checked={item.include} onChange={(e) => updateGpxBatchItem(item.id, { include: e.target.checked })} />
                  ) : (
                    <X size={15} style={{ color: "#B85C5C", flexShrink: 0 }} />
                  )}
                  <div className="tc-gpxbatch-info">
                    <span className="tc-gpxbatch-filename">{item.fileName}</span>
                    {item.error ? (
                      <span className="tc-gpxbatch-error">{item.error}</span>
                    ) : (
                      <span className="tc-history-detail">
                        {formatDateNL(item.parsed.date)} · {timeOfDayLabel(item.parsed.timeOfDay)} · {item.parsed.duration_min} min beweging{item.parsed.total_duration_min > item.parsed.duration_min ? ` (${item.parsed.total_duration_min} min totaal)` : ""} · {item.parsed.distance_km} km
                        {item.parsed.avg_hr ? ` · ${item.parsed.avg_hr}${item.parsed.max_hr ? `/${item.parsed.max_hr}` : ""} bpm` : ""}
                        {item.parsed.avg_power ? ` · ${item.parsed.avg_power}W${item.parsed.weighted_avg_power ? ` (NP ${item.parsed.weighted_avg_power})` : ""}` : ""}
                        {item.parsed.avg_cadence ? ` · ${item.parsed.avg_cadence} cadans` : ""}
                        {item.parsed.elevation_gain_m ? ` · ↑${item.parsed.elevation_gain_m}m` : ""}
                        {item.parsed.avg_power && getWeightAtDate(weightLogs, item.parsed.date) ? ` · ${(item.parsed.avg_power / getWeightAtDate(weightLogs, item.parsed.date)).toFixed(1)} W/kg` : ""}
                      </span>
                    )}
                  </div>
                  {!item.error && (
                    <select className="tc-input tc-input-cell" value={item.type} onChange={(e) => updateGpxBatchItem(item.id, { type: e.target.value })}>
                      {CARDIO_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  )}
                </div>
              ))}
            </div>
            <div className="tc-actionbar">
              <button className="tc-btn tc-btn-cardio" onClick={confirmGpxBatchSave}>
                <Check size={15} /> {gpxBatch.filter((i) => i.include && i.parsed).length} sessie(s) met verloop opslaan
              </button>
              <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={() => setGpxBatch(null)}>Annuleren</button>
              {gpxSavedFlash && <span className="tc-saved-flash">Opgeslagen ✓</span>}
            </div>
          </div>
        )}
      </div>

      <div className="tc-card">
        <div className="tc-card-head">
          <span className="tc-ex-name">Losse sessie handmatig invoeren</span>
        </div>
        <div className="tc-form-row">
          <div>
            <label className="tc-label">Datum</label>
            <input className="tc-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="tc-label">Type</label>
            <select className="tc-input" value={type} onChange={(e) => setType(e.target.value)}>
              {CARDIO_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <label className="tc-label">Moment van de dag</label>
        <TimeOfDayPicker value={timeOfDay} onChange={setTimeOfDay} />

        <div className="tc-form-row">
          <div>
            <label className="tc-label">Duur (minuten)</label>
            <input className="tc-input tc-mono" type="number" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="bv. 45" />
          </div>
          <div>
            <label className="tc-label">Afstand (km)</label>
            <input className="tc-input tc-mono" type="number" step="0.01" value={distance} onChange={(e) => setDistance(e.target.value)} placeholder="bv. 8.2" />
          </div>
        </div>
        <div className="tc-form-row">
          <div>
            <label className="tc-label">Gem. hartslag (bpm)</label>
            <input className="tc-input tc-mono" type="number" value={avgHr} onChange={(e) => setAvgHr(e.target.value)} placeholder="bv. 152" />
          </div>
          <div>
            <label className="tc-label">Max. hartslag (bpm)</label>
            <input className="tc-input tc-mono" type="number" value={maxHr} onChange={(e) => setMaxHr(e.target.value)} placeholder="bv. 178" />
          </div>
        </div>
        <div className="tc-form-row">
          <div>
            <label className="tc-label">Gem. tempo/snelheid</label>
            <input className="tc-input tc-mono" value={pace} onChange={(e) => setPace(e.target.value)} placeholder="bv. 5:10 /km" />
          </div>
          <div>
            <label className="tc-label">Gem. vermogen (watt)</label>
            <input className="tc-input tc-mono" type="number" value={avgPower} onChange={(e) => setAvgPower(e.target.value)} placeholder="bv. 210" />
          </div>
        </div>
        <div className="tc-form-row">
          <div>
            <label className="tc-label">Gewogen gem. vermogen / NP (watt)</label>
            <input className="tc-input tc-mono" type="number" value={weightedAvgPower} onChange={(e) => setWeightedAvgPower(e.target.value)} placeholder="bv. 225" />
          </div>
          <div>
            <label className="tc-label">Gem. cadans (spm/rpm)</label>
            <input className="tc-input tc-mono" type="number" value={avgCadence} onChange={(e) => setAvgCadence(e.target.value)} placeholder="bv. 172" />
          </div>
        </div>
        <div className="tc-form-row">
          <div>
            <label className="tc-label">Hoogtemeters (m)</label>
            <input className="tc-input tc-mono" type="number" value={elevationGain} onChange={(e) => setElevationGain(e.target.value)} placeholder="bv. 340" />
          </div>
        </div>
        <p className="tc-import-help" style={{ marginTop: -4 }}>
          Gemiddelde snelheid (km/u) wordt automatisch berekend uit afstand en duur — dat hoef je niet apart in te vullen.
        </p>
        <label className="tc-label">Calorieën</label>
        <input className="tc-input tc-mono" type="number" value={calories} onChange={(e) => setCalories(e.target.value)} placeholder="optioneel" />

        <label className="tc-label">Notities (bv. plaknotitie uit Strava/Garmin)</label>
        <textarea className="tc-input tc-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Route, gevoel, weersomstandigheden, hartslagzones..." />

        <div className="tc-actionbar">
          <button className="tc-btn tc-btn-cardio" onClick={handleSubmit}>Cardiosessie opslaan</button>
          {savedFlash && <span className="tc-saved-flash">Opgeslagen ✓</span>}
        </div>
      </div>
    </div>
  );
}
