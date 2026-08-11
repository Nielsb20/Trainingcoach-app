import { useState } from "react";
import { Plus, Pencil, Check, X } from "lucide-react";
import ConfirmDeleteButton from "./shared/ConfirmDeleteButton";
import CollapsibleCard from "./shared/CollapsibleCard";
import { EVENT_TYPES } from "../lib/constants";
import { todayStr, formatDateNL, daysUntil } from "../lib/calculations";
import { uid } from "../lib/uiHelpers";

const EMPTY_FORM = { name: "", date: todayStr(), type: EVENT_TYPES[0], target: "", notes: "" };

export default function EventsTab({ events, addEvent, updateEvent, deleteEvent }) {
  const [form, setForm] = useState(EMPTY_FORM);
  // Which event is open in the editor. Editing happens in place rather than in
  // a dialog: a race is a handful of fields, and the surrounding list is the
  // context you are correcting it against.
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);

  async function handleSubmit() {
    if (!form.name || !form.date) return;
    await addEvent({ id: uid(), ...form });
    setForm({ ...EMPTY_FORM, date: form.date });
  }

  function startEdit(ev) {
    setEditingId(ev.id);
    setEditForm({
      name: ev.name,
      date: ev.date,
      type: ev.type || EVENT_TYPES[0],
      target: ev.target || "",
      notes: ev.notes || "",
    });
  }

  async function saveEdit() {
    if (!editForm.name || !editForm.date) return;
    const ok = await updateEvent(editingId, editForm);
    if (ok) setEditingId(null);
  }

  const upcoming = events.filter((e) => daysUntil(e.date) >= 0).sort((a, b) => (a.date > b.date ? 1 : -1));
  const past = events.filter((e) => daysUntil(e.date) < 0).sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div>
      <h1 className="tc-title">Geplande evenementen</h1>
      <p className="tc-sub">
        Voeg wedstrijden of doelen toe. De coach houdt hier rekening mee bij zijn feedback en bij het
        plannen — hij bouwt naar een evenement toe en bouwt er weer vanaf.
      </p>

      <CollapsibleCard id="evenement-toevoegen" title="Evenement toevoegen" defaultOpen={events.length === 0}>
        <EventFields values={form} onChange={(patch) => setForm({ ...form, ...patch })} />
        <div className="tc-actionbar">
          <button className="tc-btn tc-btn-event" onClick={handleSubmit} disabled={!form.name || !form.date}>
            <Plus size={15} /> Evenement toevoegen
          </button>
        </div>
      </CollapsibleCard>

      {upcoming.length === 0 && past.length === 0 && (
        <div className="tc-empty"><p>Nog geen evenementen toegevoegd.</p></div>
      )}

      {upcoming.length > 0 && (
        <>
          <h2 className="tc-section-title">Aankomend</h2>
          <div className="tc-event-list">
            {upcoming.map((ev) => (
              <div className="tc-card tc-event-card" key={ev.id}>
                {editingId === ev.id ? (
                  <>
                    <EventFields values={editForm} onChange={(patch) => setEditForm({ ...editForm, ...patch })} />
                    <div className="tc-actionbar">
                      <button className="tc-btn tc-btn-event tc-btn-sm" onClick={saveEdit} disabled={!editForm.name || !editForm.date}>
                        <Check size={14} /> Opslaan
                      </button>
                      <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={() => setEditingId(null)}>
                        <X size={14} /> Annuleren
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="tc-card-head">
                      <div>
                        <span className="tc-ex-name">{ev.name}</span>
                        <span className="tc-hint-badge tc-badge-event" style={{ marginLeft: 10 }}>
                          {daysUntil(ev.date) === 0 ? "vandaag" : `over ${daysUntil(ev.date)} dagen`}
                        </span>
                      </div>
                      <span style={{ display: "flex", gap: 2 }}>
                        <button className="tc-icon-btn" onClick={() => startEdit(ev)} title="Dit evenement bewerken">
                          <Pencil size={14} />
                        </button>
                        <ConfirmDeleteButton onConfirm={() => deleteEvent(ev.id)} title="Dit evenement verwijderen" />
                      </span>
                    </div>
                    <p className="tc-event-meta">{formatDateNL(ev.date)} · {ev.type}{ev.target ? ` · doel: ${ev.target}` : ""}</p>
                    {ev.notes && <p className="tc-event-notes">{ev.notes}</p>}
                  </>
                )}
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
                {editingId === ev.id ? (
                  <>
                    <EventFields values={editForm} onChange={(patch) => setEditForm({ ...editForm, ...patch })} />
                    <div className="tc-actionbar">
                      <button className="tc-btn tc-btn-event tc-btn-sm" onClick={saveEdit} disabled={!editForm.name || !editForm.date}>
                        <Check size={14} /> Opslaan
                      </button>
                      <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={() => setEditingId(null)}>
                        <X size={14} /> Annuleren
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="tc-card-head">
                      <span className="tc-ex-name">{ev.name}</span>
                      <span style={{ display: "flex", gap: 2 }}>
                        {/* Also editable once it has been and gone: this is where
                            you write down how it actually went. */}
                        <button className="tc-icon-btn" onClick={() => startEdit(ev)} title="Dit evenement bewerken">
                          <Pencil size={14} />
                        </button>
                        <ConfirmDeleteButton onConfirm={() => deleteEvent(ev.id)} title="Dit evenement verwijderen" />
                      </span>
                    </div>
                    <p className="tc-event-meta">{formatDateNL(ev.date)} · {ev.type}{ev.target ? ` · doel: ${ev.target}` : ""}</p>
                    {ev.notes && <p className="tc-event-notes">{ev.notes}</p>}
                  </>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** The same fields for adding and for correcting — one place to keep them in step. */
function EventFields({ values, onChange }) {
  return (
    <>
      <div className="tc-form-row">
        <div>
          <label className="tc-label">Naam evenement</label>
          <input className="tc-input" value={values.name} onChange={(e) => onChange({ name: e.target.value })}
            placeholder="bv. Marathon Rotterdam" />
        </div>
        <div>
          <label className="tc-label">Datum</label>
          <input className="tc-input" type="date" value={values.date} onChange={(e) => onChange({ date: e.target.value })} />
        </div>
      </div>
      <div className="tc-form-row">
        <div>
          <label className="tc-label">Type</label>
          <select className="tc-input" value={values.type} onChange={(e) => onChange({ type: e.target.value })}>
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="tc-label">Doel (optioneel)</label>
          <input className="tc-input" value={values.target} onChange={(e) => onChange({ target: e.target.value })}
            placeholder="bv. sub 1:45 of PR op deadlift" />
        </div>
      </div>
      <label className="tc-label">Notities</label>
      <textarea className="tc-input tc-textarea" value={values.notes} onChange={(e) => onChange({ notes: e.target.value })}
        placeholder="Parcours, hoogtemeters, aandachtspunten — de coach leest dit mee bij het plannen" />
    </>
  );
}
