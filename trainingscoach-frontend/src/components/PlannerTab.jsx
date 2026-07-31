import { useState, useEffect, useMemo } from "react";
import { Check, X, Clock, Plus, Trash2, Loader2, AlertTriangle } from "lucide-react";
import * as api from "../api/client";
import { CARDIO_TYPES } from "../lib/constants";
import { todayStr, formatDateNL, weekdayNameForDate } from "../lib/calculations";

/**
 * Interactive week planner.
 *
 * Coach suggestions arrive as *proposals* rather than commitments, so a second
 * opinion doesn't silently stack a duplicate week on top of the first. You
 * review them here, keep what fits, and conflicts with sessions you already
 * committed to are called out rather than resolved behind your back.
 */
export default function PlannerTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  async function load() {
    try {
      setData(await api.getPlannedSessions(4));
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function act(fn) {
    setBusy(true);
    try {
      await fn();
      await load();
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const plans = data?.plans || [];
  const proposals = plans.filter((p) => p.status === "voorgesteld");
  const committed = plans.filter((p) => p.status !== "voorgesteld");

  // Two weeks from today, so "what's coming" is always visible even on a
  // Sunday evening when this week is done.
  const days = useMemo(() => {
    const out = [];
    const start = new Date(todayStr() + "T00:00:00");
    for (let i = 0; i < 14; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      out.push({
        date: iso,
        weekday: weekdayNameForDate(iso),
        isToday: iso === todayStr(),
        committed: committed.filter((p) => p.date === iso),
        proposed: proposals.filter((p) => p.date === iso),
      });
    }
    return out;
  }, [committed, proposals]);

  if (loading) {
    return (
      <div className="tc-import-help" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Loader2 className="spin" size={15} /> Laden…
      </div>
    );
  }

  const conflicts = proposals.filter((p) => committed.some((c) => c.date === p.date && c.status === "gepland"));

  return (
    <div>
      <h1 className="tc-title">Planning</h1>
      <p className="tc-sub">
        Je trainingsweek. Voorstellen van de coach staan hier klaar ter beoordeling — accepteer wat
        past, negeer de rest. Uitgevoerde trainingen worden automatisch afgevinkt op basis van je logs.
      </p>

      {error && <div className="tc-error"><span>{error}</span></div>}

      {proposals.length > 0 && (
        <div className="tc-card tc-import-card">
          <div className="tc-card-head">
            <span className="tc-ex-name">{proposals.length} voorstel(len) van de coach</span>
            {conflicts.length > 0 && (
              <span className="tc-hint-badge tc-badge-warning">
                <AlertTriangle size={12} style={{ verticalAlign: "middle" }} /> {conflicts.length} botsen met je planning
              </span>
            )}
          </div>
          <p className="tc-import-help">
            Deze staan nog niet in je planning. Een nieuw advies vervangt eerdere voorstellen die je
            niet hebt geaccepteerd — wat je al accepteerde blijft staan.
          </p>
          <div className="tc-actionbar">
            <button className="tc-btn tc-btn-cardio" disabled={busy}
              onClick={() => act(() => api.acceptAllProposals(conflicts.length > 0))}>
              <Check size={15} /> Alles accepteren{conflicts.length > 0 ? " (vervang botsingen)" : ""}
            </button>
            <button className="tc-btn tc-btn-ghost tc-btn-sm" disabled={busy}
              onClick={() => act(async () => { for (const p of proposals) await api.deletePlannedSession(p.id); })}>
              Alles verwerpen
            </button>
          </div>
        </div>
      )}

      <div className="tc-actionbar" style={{ marginBottom: 14 }}>
        <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={() => setShowAdd(!showAdd)}>
          <Plus size={14} /> Zelf een training inplannen
        </button>
      </div>

      {showAdd && <AddSessionForm onAdded={() => { setShowAdd(false); load(); }} onError={setError} />}

      <div className="tc-planner">
        {days.map((day) => {
          const empty = day.committed.length === 0 && day.proposed.length === 0;
          return (
            <div className={"tc-planner-day" + (day.isToday ? " tc-planner-today" : "")} key={day.date}>
              <div className="tc-planner-daylabel">
                <span className="tc-planner-weekday">{day.weekday}</span>
                <span className="tc-planner-date">{formatDateNL(day.date)}</span>
                {day.isToday && <span className="tc-hint-badge tc-badge-strength">vandaag</span>}
              </div>

              <div className="tc-planner-sessions">
                {empty && <span className="tc-planner-empty">rustdag</span>}

                {day.committed.map((p) => (
                  <div className={"tc-planner-session tc-status-" + p.status} key={p.id}>
                    <StatusIcon status={p.status} />
                    <div className="tc-gpxbatch-info">
                      <span className="tc-planner-type">{p.type}</span>
                      <span className="tc-event-notes">{p.description}</span>
                    </div>
                    <div className="tc-planned-actions">
                      {p.status === "gepland" && (
                        <button className="tc-btn tc-btn-ghost tc-btn-sm" disabled={busy}
                          onClick={() => act(() => api.updatePlannedSession(p.id, "gedaan"))}>Gedaan</button>
                      )}
                      <button className="tc-icon-btn" disabled={busy}
                        onClick={() => act(() => api.deletePlannedSession(p.id))}><Trash2 size={13} /></button>
                    </div>
                  </div>
                ))}

                {day.proposed.map((p) => {
                  const clashes = day.committed.some((c) => c.status === "gepland");
                  return (
                    <div className="tc-planner-session tc-status-voorgesteld" key={p.id}>
                      <Clock size={16} style={{ color: "var(--cardio)", flexShrink: 0 }} />
                      <div className="tc-gpxbatch-info">
                        <span className="tc-planner-type">
                          {p.type} <span className="tc-planner-proposed-tag">voorstel</span>
                        </span>
                        <span className="tc-event-notes">{p.description}</span>
                        {clashes && (
                          <span className="tc-gpxbatch-error">
                            Botst met wat je al gepland had op deze dag
                          </span>
                        )}
                      </div>
                      <div className="tc-planned-actions">
                        <button className="tc-btn tc-btn-cardio tc-btn-sm" disabled={busy}
                          onClick={() => act(() => api.acceptProposal(p.id, clashes))}>
                          {clashes ? "Vervang" : "Accepteer"}
                        </button>
                        <button className="tc-icon-btn" disabled={busy}
                          onClick={() => act(() => api.deletePlannedSession(p.id))}><X size={14} /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {data.samenvatting.opvolgingPercentage !== null && (
        <div className="tc-chiprow" style={{ marginTop: 18 }}>
          <span className="tc-hint-badge tc-badge-cardio">{data.samenvatting.gedaan} gedaan</span>
          <span className="tc-hint-badge tc-badge-warning">{data.samenvatting.overgeslagen} overgeslagen</span>
          <span className="tc-hint-badge tc-badge-event">{data.samenvatting.opvolgingPercentage}% opgevolgd</span>
        </div>
      )}
    </div>
  );
}

function AddSessionForm({ onAdded, onError }) {
  const [date, setDate] = useState(todayStr());
  const [type, setType] = useState(CARDIO_TYPES[0]);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      await api.createPlannedSession({ date, type, description });
      onAdded();
    } catch (e) {
      onError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="tc-card">
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
      <label className="tc-label">Invulling</label>
      <input className="tc-input" value={description} onChange={(e) => setDescription(e.target.value)}
        placeholder="bv. 90 min duurrit, zone 2, 180-200W" />
      <div className="tc-actionbar">
        <button className="tc-btn tc-btn-event" onClick={submit} disabled={saving}>
          {saving ? <Loader2 className="spin" size={15} /> : <Plus size={15} />} Inplannen
        </button>
      </div>
    </div>
  );
}

function StatusIcon({ status }) {
  if (status === "gedaan") return <Check size={16} style={{ color: "var(--cardio)", flexShrink: 0 }} />;
  if (status === "overgeslagen") return <X size={16} style={{ color: "#B85C5C", flexShrink: 0 }} />;
  return <Clock size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />;
}
