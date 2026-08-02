import { useState, useEffect, useMemo } from "react";
import { Check, X, Clock, Plus, Trash2, Loader2, Lock, Unlock, ArrowRight, Dumbbell, Activity, ChevronLeft, ChevronRight, CalendarPlus } from "lucide-react";
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
  const [fillMessage, setFillMessage] = useState("");
  // Offset in 2-week blocks from today. The coach happily plans three weeks
  // out, so a fixed window would hide part of its own advice.
  const [blockOffset, setBlockOffset] = useState(0);

  const DAYS_PER_BLOCK = 14;
  const rangeStart = useMemo(() => {
    const d = new Date(todayStr() + "T00:00:00");
    d.setDate(d.getDate() + blockOffset * DAYS_PER_BLOCK);
    return d;
  }, [blockOffset]);
  const rangeEnd = useMemo(() => {
    const d = new Date(rangeStart);
    d.setDate(d.getDate() + DAYS_PER_BLOCK - 1);
    return d;
  }, [rangeStart]);
  const isoOf = (d) => {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  async function load() {
    try {
      setData(await api.getPlannedRange(isoOf(rangeStart), isoOf(rangeEnd)));
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { setLoading(true); load(); }, [blockOffset]);

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
  const strengthSessions = data?.krachttrainingen || [];
  const proposals = plans.filter((p) => p.status === "voorgesteld");
  const committed = plans.filter((p) => p.status !== "voorgesteld" && p.status !== "afgewezen");

  // Two weeks from today, so "what's coming" is always visible even on a
  // Sunday evening when this week is done.
  const days = useMemo(() => {
    const out = [];
    for (let i = 0; i < DAYS_PER_BLOCK; i++) {
      const d = new Date(rangeStart);
      d.setDate(d.getDate() + i);
      const iso = isoOf(d);
      out.push({
        date: iso,
        weekday: weekdayNameForDate(iso),
        isToday: iso === todayStr(),
        committed: committed.filter((p) => p.date === iso),
        proposed: proposals.filter((p) => p.date === iso),
        strength: strengthSessions.filter((s) => s.date === iso),
      });
    }
    return out;
  }, [committed, proposals, strengthSessions, rangeStart]);

  if (loading) {
    return (
      <div className="tc-import-help" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Loader2 className="spin" size={15} /> Laden…
      </div>
    );
  }

  const changes = proposals.filter((p) => p.replacesId);
  const additions = proposals.filter((p) => !p.replacesId);

  return (
    <div>
      <h1 className="tc-title">Planning</h1>
      <p className="tc-sub">
        Je trainingsweek: cardiovoorstellen van de coach én je gelogde krachttrainingen. Uitgevoerde
        cardiosessies worden automatisch afgevinkt. De coach houdt bij het plannen rekening met je
        krachttraining — geen zware rit de dag na een beendag.
      </p>

      {error && <div className="tc-error"><span>{error}</span></div>}

      <div className="tc-planner-nav">
        <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={() => setBlockOffset(blockOffset - 1)}>
          <ChevronLeft size={14} /> Vorige
        </button>
        <span className="tc-planner-range">
          {formatDateNL(isoOf(rangeStart))} — {formatDateNL(isoOf(rangeEnd))}
          {blockOffset !== 0 && (
            <button className="tc-btn tc-btn-ghost tc-btn-sm" style={{ marginLeft: 10 }}
              onClick={() => setBlockOffset(0)}>naar vandaag</button>
          )}
        </span>
        <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={() => setBlockOffset(blockOffset + 1)}>
          Volgende <ChevronRight size={14} />
        </button>
      </div>

      {proposals.length > 0 && (
        <div className="tc-card tc-import-card">
          <div className="tc-card-head">
            <span className="tc-ex-name">Voorstellen van de coach</span>
            <span className="tc-hint-badge tc-badge-cardio">
              {additions.length} nieuw{changes.length > 0 ? `, ${changes.length} wijziging(en)` : ""}
            </span>
            {proposals.some((p) => p.discipline === "kracht") && (
              <span className="tc-hint-badge tc-badge-strength">
                incl. {proposals.filter((p) => p.discipline === "kracht").length} krachttraining(en)
              </span>
            )}
          </div>
          <p className="tc-import-help">
            Je planning verandert pas als je iets accepteert. Doe je niets, dan blijft alles zoals het
            was. Wijzigingen laten zien wat er zou veranderen, zodat je kunt beoordelen of je het
            ermee eens bent.
          </p>
          <div className="tc-actionbar">
            <button className="tc-btn tc-btn-cardio" disabled={busy}
              onClick={() => act(() => api.acceptAllProposals())}>
              <Check size={15} /> Alles accepteren
            </button>
            <button className="tc-btn tc-btn-ghost tc-btn-sm" disabled={busy}
              onClick={() => act(async () => { for (const p of proposals) await api.declineProposal(p.id, null); })}>
              Alles afwijzen
            </button>
          </div>
        </div>
      )}

      <div className="tc-actionbar" style={{ marginBottom: 14 }}>
        <button className="tc-btn tc-btn-ghost tc-btn-sm" disabled={busy}
          onClick={() => act(async () => {
            const r = await api.fillPlanFromSchema(isoOf(rangeStart), isoOf(rangeEnd));
            const parts = [];
            if (r.aangemaakt > 0) parts.push(`${r.aangemaakt} sessies toegevoegd (${r.kracht} kracht, ${r.cardio} cardio)`);
            if (r.bijgewerkt > 0) parts.push(`${r.bijgewerkt} omschrijving(en) bijgewerkt met je oefeningen`);
            setFillMessage(parts.length ? parts.join(" — ") + "." : "Deze periode was al gevuld — er is niets veranderd.");
          })}>
          <CalendarPlus size={14} /> Vul aan vanuit mijn schema
        </button>
        <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={() => setShowAdd(!showAdd)}>
          <Plus size={14} /> Zelf een training inplannen
        </button>
      </div>
      {fillMessage && <p className="tc-import-help" style={{ marginTop: -8 }}>{fillMessage}</p>}

      {showAdd && <AddSessionForm onAdded={() => { setShowAdd(false); load(); }} onError={setError} />}

      <div className="tc-planner">
        {days.map((day) => {
          const empty = day.committed.length === 0 && day.proposed.length === 0 && day.strength.length === 0;
          return (
            <div className={"tc-planner-day" + (day.isToday ? " tc-planner-today" : "")} key={day.date}>
              <div className="tc-planner-daylabel">
                <span className="tc-planner-weekday">{day.weekday}</span>
                <span className="tc-planner-date">{formatDateNL(day.date)}</span>
                {day.isToday && <span className="tc-hint-badge tc-badge-strength">vandaag</span>}
              </div>

              <div className="tc-planner-sessions">
                {empty && <span className="tc-planner-empty">rustdag</span>}

                {day.strength.map((s) => (
                  <div className="tc-planner-session tc-planner-strength" key={s.id}>
                    <Dumbbell size={16} style={{ color: "var(--strength)", flexShrink: 0 }} />
                    <div className="tc-gpxbatch-info">
                      <span className="tc-planner-type">{s.dayName || "Krachttraining"}</span>
                      <span className="tc-event-notes">
                        gedaan
                        {s.durationMin ? ` · ${s.durationMin} min` : ""}
                        {s.rpe ? ` · RPE ${s.rpe}` : ""}
                      </span>
                    </div>
                  </div>
                ))}

                {day.committed.map((p) => (
                  <div className={"tc-planner-session tc-status-" + p.status} key={p.id}>
                    <StatusIcon status={p.status} />
                    <div className="tc-gpxbatch-info">
                      <span className="tc-planner-type">
                        {p.discipline === "kracht"
                          ? <Dumbbell size={12} style={{ marginRight: 5, color: "var(--strength)" }} />
                          : <Activity size={12} style={{ marginRight: 5, color: "var(--cardio)" }} />}
                        {p.type}
                        {p.timeOfDay && <span className="tc-planner-moment">{p.timeOfDay}</span>}
                      </span>
                      <span className="tc-event-notes">{p.description}</span>
                    </div>
                    <div className="tc-planned-actions">
                      {p.status === "gepland" && (
                        <>
                          <button className="tc-btn tc-btn-ghost tc-btn-sm" disabled={busy}
                            onClick={() => act(() => api.updatePlannedSession(p.id, "gedaan"))}>Gedaan</button>
                          {/* Deliberately available before the day is over: deciding in the
                              morning that a session isn't happening is normal, and waiting
                              for the automatic sweep at midnight helps nobody. */}
                          <button className="tc-btn tc-btn-ghost tc-btn-sm" disabled={busy}
                            title="Deze training gaat niet door"
                            onClick={() => act(() => api.updatePlannedSession(p.id, "overgeslagen"))}>
                            Overslaan
                          </button>
                          <button className="tc-icon-btn" disabled={busy}
                            title={p.locked ? "Vaste afspraak — coach laat deze met rust" : "Vastzetten: coach mag deze niet wijzigen"}
                            onClick={() => act(() => api.lockPlannedSession(p.id, !p.locked))}>
                            {p.locked ? <Lock size={13} style={{ color: "var(--strength)" }} /> : <Unlock size={13} />}
                          </button>
                        </>
                      )}

                      {/* A wrong call should be correctable — an accidental "overslaan"
                          otherwise sticks around in your adherence figures. */}
                      {(p.status === "gedaan" || p.status === "overgeslagen") && (
                        <button className="tc-btn tc-btn-ghost tc-btn-sm" disabled={busy}
                          title="Terugzetten naar gepland"
                          onClick={() => act(() => api.updatePlannedSession(p.id, "gepland"))}>
                          Ongedaan maken
                        </button>
                      )}
                      <button className="tc-icon-btn" disabled={busy}
                        onClick={() => act(() => api.deletePlannedSession(p.id))}><Trash2 size={13} /></button>
                    </div>
                  </div>
                ))}

                {day.proposed.map((p) => {
                  const replaced = p.replacesId ? day.committed.find((c) => c.id === p.replacesId) : null;
                  return (
                    <div className="tc-planner-session tc-status-voorgesteld" key={p.id}>
                      {p.discipline === "kracht"
                        ? <Dumbbell size={16} style={{ color: "var(--strength)", flexShrink: 0 }} />
                        : <Clock size={16} style={{ color: "var(--cardio)", flexShrink: 0 }} />}
                      <div className="tc-gpxbatch-info">
                        <span className="tc-planner-type">
                          {p.type}
                          <span className="tc-planner-proposed-tag">
                            {replaced ? "wijziging" : "nieuw voorstel"}
                          </span>
                        </span>
                        {replaced && (
                          <span className="tc-planner-diff">
                            <span className="tc-planner-diff-old">{replaced.description}</span>
                            <ArrowRight size={12} />
                            <span>{p.description}</span>
                          </span>
                        )}
                        {!replaced && <span className="tc-event-notes">{p.description}</span>}
                      </div>
                      <div className="tc-planned-actions">
                        <button className="tc-btn tc-btn-cardio tc-btn-sm" disabled={busy}
                          onClick={() => act(() => api.acceptProposal(p.id))}>
                          {replaced ? "Wijzig" : "Accepteer"}
                        </button>
                        <button className="tc-icon-btn" title="Afwijzen — de coach onthoudt dit"
                          disabled={busy} onClick={() => act(() => api.declineProposal(p.id, null))}>
                          <X size={14} />
                        </button>
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
  const [discipline, setDiscipline] = useState("cardio");
  const [type, setType] = useState(CARDIO_TYPES[0]);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      await api.createPlannedSession({ date, type, description, discipline });
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
          <label className="tc-label">Soort</label>
          <select className="tc-input" value={discipline}
            onChange={(e) => { setDiscipline(e.target.value); setType(e.target.value === "kracht" ? "" : CARDIO_TYPES[0]); }}>
            <option value="cardio">Cardio</option>
            <option value="kracht">Krachttraining</option>
          </select>
        </div>
      </div>
      <div className="tc-form-row">
        <div>
          <label className="tc-label">{discipline === "kracht" ? "Trainingsdag" : "Type"}</label>
          {discipline === "kracht" ? (
            <input className="tc-input" value={type} onChange={(e) => setType(e.target.value)}
              placeholder="bv. Dag A - Push" />
          ) : (
            <select className="tc-input" value={type} onChange={(e) => setType(e.target.value)}>
              {CARDIO_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
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
