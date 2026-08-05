import { useState } from "react";
import { Plus } from "lucide-react";
import ConfirmDeleteButton from "./shared/ConfirmDeleteButton";
import { EVENT_TYPES } from "../lib/constants";
import { uid, todayStr, formatDateNL, daysUntil } from "../lib/calculations";

export default function EventsTab({ events, addEvent, deleteEvent }) {
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayStr());
  const [type, setType] = useState(EVENT_TYPES[0]);
  const [target, setTarget] = useState("");
  const [notes, setNotes] = useState("");

  async function handleSubmit() {
    if (!name || !date) return;
    await addEvent({ id: uid(), name, date, type, target, notes });
    setName(""); setTarget(""); setNotes("");
  }

  const upcoming = events.filter((e) => daysUntil(e.date) >= 0).sort((a, b) => (a.date > b.date ? 1 : -1));
  const past = events.filter((e) => daysUntil(e.date) < 0).sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div>
      <h1 className="tc-title">Geplande evenementen</h1>
      <p className="tc-sub">Voeg wedstrijden of doelen toe. De coach houdt hier rekening mee bij het geven van feedback en tips, bijvoorbeeld voor afbouwen richting een wedstrijd.</p>

      <div className="tc-card">
        <div className="tc-form-row">
          <div>
            <label className="tc-label">Naam evenement</label>
            <input className="tc-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="bv. Marathon Rotterdam" />
          </div>
          <div>
            <label className="tc-label">Datum</label>
            <input className="tc-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="tc-form-row">
          <div>
            <label className="tc-label">Type</label>
            <select className="tc-input" value={type} onChange={(e) => setType(e.target.value)}>
              {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="tc-label">Doel (optioneel)</label>
            <input className="tc-input" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="bv. sub 1:45 of PR op deadlift" />
          </div>
        </div>
        <label className="tc-label">Notities</label>
        <textarea className="tc-input tc-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Parcours, aandachtspunten, tapering-wensen..." />
        <div className="tc-actionbar">
          <button className="tc-btn tc-btn-event" onClick={handleSubmit}>
            <Plus size={15} /> Evenement toevoegen
          </button>
        </div>
      </div>

      {upcoming.length === 0 && past.length === 0 && (
        <div className="tc-empty"><p>Nog geen evenementen toegevoegd.</p></div>
      )}

      {upcoming.length > 0 && (
        <>
          <h2 className="tc-section-title">Aankomend</h2>
          <div className="tc-event-list">
            {upcoming.map((ev) => (
              <div className="tc-card tc-event-card" key={ev.id}>
                <div className="tc-card-head">
                  <div>
                    <span className="tc-ex-name">{ev.name}</span>
                    <span className="tc-hint-badge tc-badge-event" style={{ marginLeft: 10 }}>
                      {daysUntil(ev.date) === 0 ? "vandaag" : `over ${daysUntil(ev.date)} dagen`}
                    </span>
                  </div>
                  <ConfirmDeleteButton onConfirm={() => deleteEvent(ev.id)} title="Dit evenement verwijderen" />
                </div>
                <p className="tc-event-meta">{formatDateNL(ev.date)} · {ev.type}{ev.target ? ` · doel: ${ev.target}` : ""}</p>
                {ev.notes && <p className="tc-event-notes">{ev.notes}</p>}
              </div>
            ))}
          </div>
        </>
      )}

      {past.length > 0 && (
        <>
          <h2 className="tc-section-title">Geweest</h2>
          <div className="tc-event-list">
            {past.map((ev) => (
              <div className="tc-card tc-event-card tc-event-past" key={ev.id}>
                <div className="tc-card-head">
                  <span className="tc-ex-name">{ev.name}</span>
                  <ConfirmDeleteButton onConfirm={() => deleteEvent(ev.id)} title="Dit evenement verwijderen" />
                </div>
                <p className="tc-event-meta">{formatDateNL(ev.date)} · {ev.type}{ev.target ? ` · doel: ${ev.target}` : ""}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
