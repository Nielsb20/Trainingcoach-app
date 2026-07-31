import { useState, useEffect } from "react";
import { Loader2, Play, AlertTriangle } from "lucide-react";
import * as api from "../api/client";
import { WEEKDAYS } from "../lib/calculations";

/**
 * Automatic coach consultation.
 *
 * Off by default and framed carefully: an automatic run only ever produces
 * *proposals*. The plan itself never changes without the athlete accepting
 * something, which is the promise the rest of the planner makes too.
 */
export default function AutomationPanel() {
  const [settings, setSettings] = useState(null);
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const data = await api.getAutomation();
      setSettings(data.settings);
      setSignals(data.huidigeSignalen || []);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function save(next) {
    setSaving(true);
    setSettings(next); // optimistic: the toggles should feel immediate
    try {
      await api.saveAutomation(next);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function runNow(type) {
    setRunning(true);
    setMessage("");
    setError("");
    try {
      const r = await api.runAutomation(type);
      setMessage(r.overgeslagen || "Klaar — kijk bij Planning voor de voorstellen.");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  }

  if (loading) {
    return (
      <div className="tc-card">
        <div className="tc-import-help" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Loader2 className="spin" size={15} /> Laden…
        </div>
      </div>
    );
  }

  return (
    <div className="tc-card">
      <div className="tc-card-head">
        <span className="tc-ex-name">Automatische planning</span>
      </div>

      <p className="tc-import-help">
        De coach kan uit zichzelf naar je gegevens kijken. Wat hij voorstelt komt binnen als
        <strong> voorstel</strong> in het tabblad Planning — je planning verandert dus nooit vanzelf,
        en vastgezette sessies blijven altijd ongemoeid.
      </p>

      {error && <div className="tc-error"><span>{error}</span></div>}
      {settings.lastError && (
        <div className="tc-warning-box">
          <AlertTriangle size={13} style={{ verticalAlign: "middle" }} /> Laatste automatische poging
          mislukte: {settings.lastError}
        </div>
      )}

      {/* ------------------------------ weekly ------------------------------ */}
      <label className="tc-automation-row">
        <input type="checkbox" checked={settings.weeklyEnabled} disabled={saving}
          onChange={(e) => save({ ...settings, weeklyEnabled: e.target.checked })} />
        <div>
          <span className="tc-planner-type">Wekelijkse planning</span>
          <span className="tc-history-detail">
            Vaste dag om de komende week in te plannen. Voorspelbaar ritme, zoals een coach een
            weekblok neerzet.
          </span>
        </div>
      </label>

      {settings.weeklyEnabled && (
        <div className="tc-form-row" style={{ marginLeft: 26 }}>
          <div>
            <label className="tc-label">Dag</label>
            <select className="tc-input" value={settings.weeklyWeekday} disabled={saving}
              onChange={(e) => save({ ...settings, weeklyWeekday: e.target.value })}>
              {WEEKDAYS.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>
          <div>
            <label className="tc-label">Tijdstip</label>
            <select className="tc-input" value={settings.weeklyHour} disabled={saving}
              onChange={(e) => save({ ...settings, weeklyHour: Number(e.target.value) })}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {settings.lastWeeklyRun && (
        <p className="tc-history-detail" style={{ marginLeft: 26 }}>
          Laatste keer: {new Date(settings.lastWeeklyRun).toLocaleString("nl-NL")}
        </p>
      )}

      {/* ------------------------------ signals ----------------------------- */}
      <label className="tc-automation-row" style={{ marginTop: 14 }}>
        <input type="checkbox" checked={settings.signalsEnabled} disabled={saving}
          onChange={(e) => save({ ...settings, signalsEnabled: e.target.checked })} />
        <div>
          <span className="tc-planner-type">Tussentijds bij een signaal</span>
          <span className="tc-history-detail">
            Alleen als er iets afwijkt: sterk gedaalde vorm (TSB), rusthartslag of HRV buiten je
            basislijn, meerdere gemiste sessies, of een evenement dat nadert.
          </span>
        </div>
      </label>

      {settings.signalsEnabled && (
        <div className="tc-form-row" style={{ marginLeft: 26 }}>
          <div>
            <label className="tc-label">Minimaal tussen twee meldingen</label>
            <select className="tc-input" value={settings.cooldownDays} disabled={saving}
              onChange={(e) => save({ ...settings, cooldownDays: Number(e.target.value) })}>
              {[1, 2, 3, 5, 7].map((d) => <option key={d} value={d}>{d} dagen</option>)}
            </select>
          </div>
        </div>
      )}

      {/* --------------------------- current state -------------------------- */}
      <div className="tc-import-preview">
        <p className="tc-import-help">
          {signals.length === 0
            ? "Op dit moment zijn er geen signalen — er zou nu niets automatisch gebeuren."
            : `Op dit moment ${signals.length === 1 ? "is er 1 signaal" : `zijn er ${signals.length} signalen`}:`}
        </p>
        {signals.map((s) => (
          <p key={s.code} className="tc-history-detail">
            <span className={"tc-hint-badge " + (s.severity === "hoog" ? "tc-badge-warning" : "tc-badge-cardio")}>
              {s.severity}
            </span>{" "}
            {s.reason}
          </p>
        ))}

        <div className="tc-actionbar">
          <button className="tc-btn tc-btn-ghost tc-btn-sm" disabled={running}
            onClick={() => runNow("wekelijks")}>
            {running ? <Loader2 className="spin" size={13} /> : <Play size={13} />} Nu weekplanning maken
          </button>
          <button className="tc-btn tc-btn-ghost tc-btn-sm" disabled={running || signals.length === 0}
            onClick={() => runNow("signaal")}>
            <Play size={13} /> Nu op signalen reageren
          </button>
        </div>
        {message && <p className="tc-import-help">{message}</p>}
      </div>
    </div>
  );
}
