import { useState, useEffect, useRef } from "react";
import { Loader2, Sparkles, Check, X, Undo2, AlertTriangle, Trash2 } from "lucide-react";
import * as api from "../api/client";
import CollapsibleCard from "./shared/CollapsibleCard";
import { WEEKDAYS } from "../lib/calculations";

const FOCUS_OPTIONS = [
  { id: "kracht", label: "Vooral kracht" },
  { id: "cardio", label: "Vooral cardio" },
  { id: "combi", label: "Allebei" },
];

const EMPTY_GOALS = {
  goal: "",
  focus: "combi",
  strengthDaysPerWeek: null,
  cardioDaysPerWeek: null,
  sessionMinutes: null,
  availableWeekdays: [],
  equipment: "",
  experience: "",
  limitations: "",
  notes: "",
};

/**
 * The coach designing the schema itself, instead of filling in the one you
 * built.
 *
 * Two deliberate choices in how this is presented. A proposal is shown as a
 * *proposal*: you see what it would change before anything is written, the
 * same promise the planner makes. And accepting stays undoable, because the
 * schema is what every logged session is entered against — losing it to a
 * suggestion you wanted to try out would be the worst kind of surprise.
 */
export default function SchemaCoachPanel({ onSchemaReplaced }) {
  const [goals, setGoals] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);

  const goalsFirstLoad = useRef(true);
  const goalsSaveTimer = useRef(null);

  async function load() {
    try {
      const [loadedGoals, loadedProposals] = await Promise.all([api.getGoals(), api.getSchemaProposals()]);
      goalsFirstLoad.current = true; // don't save the values we just read back
      setGoals({ ...EMPTY_GOALS, ...Object.fromEntries(Object.entries(loadedGoals || {}).filter(([, v]) => v !== null)) });
      setProposals(loadedProposals);
      setLoadFailed(false);
    } catch (e) {
      // An older server without these endpoints shouldn't take the Schema tab
      // down with it — the schema editor below still has to work.
      setLoadFailed(true);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // Same debounce as the schema editor: typing a goal shouldn't fire a request
  // per keystroke, but nothing should have to be explicitly saved either.
  useEffect(() => {
    if (!goals) return;
    if (goalsFirstLoad.current) {
      goalsFirstLoad.current = false;
      return;
    }
    if (goalsSaveTimer.current) clearTimeout(goalsSaveTimer.current);
    goalsSaveTimer.current = setTimeout(() => {
      api
        .saveGoals(goals)
        .then(() => {
          setSavedFlash(true);
          setTimeout(() => setSavedFlash(false), 1800);
        })
        .catch((e) => setError("Doelen opslaan mislukt: " + e.message));
    }, 700);
    return () => clearTimeout(goalsSaveTimer.current);
  }, [goals]);

  function update(patch) {
    setGoals((g) => ({ ...g, ...patch }));
  }

  function toggleWeekday(weekday) {
    setGoals((g) => ({
      ...g,
      availableWeekdays: g.availableWeekdays.includes(weekday)
        ? g.availableWeekdays.filter((w) => w !== weekday)
        : [...g.availableWeekdays, weekday],
    }));
  }

  async function handleGenerate() {
    setGenerating(true);
    setError("");
    try {
      // Saved first rather than trusting the debounce: asking for a schema
      // seconds after typing the goal must use that goal, not the previous one.
      await api.saveGoals(goals);
      await api.generateSchemaProposal(question || null);
      setQuestion("");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleAccept(id) {
    setError("");
    try {
      await api.acceptSchemaProposal(id);
      await load();
      await onSchemaReplaced();
    } catch (e) {
      setError("Schema overnemen mislukt: " + e.message);
    }
  }

  async function handleUndo(id) {
    setError("");
    try {
      await api.undoSchemaProposal(id);
      await load();
      await onSchemaReplaced();
    } catch (e) {
      setError("Terugdraaien mislukt: " + e.message);
    }
  }

  async function handleDecline(id, reason) {
    setError("");
    try {
      await api.declineSchemaProposal(id, reason);
      await load();
    } catch (e) {
      setError("Afwijzen mislukt: " + e.message);
    }
  }

  async function handleDelete(id) {
    try {
      await api.deleteSchemaProposal(id);
      await load();
    } catch (e) {
      setError("Verwijderen mislukt: " + e.message);
    }
  }

  if (loading) {
    return (
      <div className="tc-card">
        <div className="tc-import-help" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Loader2 className="spin" size={15} /> Doelen laden…
        </div>
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className="tc-card">
        <div className="tc-card-head">
          <span className="tc-ex-name">Schema laten voorstellen</span>
        </div>
        <div className="tc-error"><span>Kon je doelen niet ophalen: {error}</span></div>
        <p className="tc-import-help">
          Dit gebeurt meestal als de server nog niet herstart is na een update — de tabellen voor
          doelen en schemavoorstellen worden pas bij het opstarten aangemaakt. Draai op de Pi:
          <br />
          <code>pm2 restart trainingscoach</code>
          <br />
          en ververs daarna deze pagina.
        </p>
        <div className="tc-actionbar">
          <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={() => { setLoading(true); load(); }}>
            Opnieuw proberen
          </button>
        </div>
      </div>
    );
  }

  const open = proposals.find((p) => p.status === "voorgesteld");
  const applied = proposals.find((p) => p.status === "geaccepteerd" && p.kanTerugdraaien);
  const older = proposals.filter((p) => p !== open && p !== applied);
  const goalMissing = !goals.goal?.trim();

  return (
    <>
      <CollapsibleCard
        id="schema-doelen"
        title="Wat wil je bereiken?"
        subtitle={goals.goal ? goals.goal.slice(0, 70) + (goals.goal.length > 70 ? "…" : "") : "nog geen doel ingevuld"}
        defaultOpen
        badge={savedFlash ? <span className="tc-saved-flash">Opgeslagen ✓</span> : null}
      >
        <p className="tc-import-help">
          Hoe concreter dit is, hoe gerichter het schema. De coach houdt zich aan de dagen en de tijd
          die je hier opgeeft, en aan je materiaal en beperkingen — dat is precies het verschil tussen
          een schema voor jou en een schema uit een boekje.
        </p>

        <label className="tc-label">Je doel</label>
        <textarea
          className="tc-input tc-textarea"
          value={goals.goal}
          onChange={(e) => update({ goal: e.target.value })}
          placeholder="Bijv. 'Sterker worden op squat en deadlift, en in september een gravelrit van 150 km uitrijden zonder in te storten'"
        />

        <div className="tc-form-row">
          <div>
            <label className="tc-label">Nadruk</label>
            <select className="tc-input" value={goals.focus || "combi"} onChange={(e) => update({ focus: e.target.value })}>
              {FOCUS_OPTIONS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
          <div>
            <label className="tc-label">Krachtdagen per week</label>
            <input className="tc-input tc-mono" type="number" min={0} max={7}
              value={goals.strengthDaysPerWeek ?? ""}
              onChange={(e) => update({ strengthDaysPerWeek: e.target.value === "" ? null : Number(e.target.value) })}
              placeholder="bv. 3" />
          </div>
          <div>
            <label className="tc-label">Cardiodagen per week</label>
            <input className="tc-input tc-mono" type="number" min={0} max={14}
              value={goals.cardioDaysPerWeek ?? ""}
              onChange={(e) => update({ cardioDaysPerWeek: e.target.value === "" ? null : Number(e.target.value) })}
              placeholder="bv. 2" />
          </div>
          <div>
            <label className="tc-label">Minuten per krachtsessie</label>
            <input className="tc-input tc-mono" type="number" min={10} max={300}
              value={goals.sessionMinutes ?? ""}
              onChange={(e) => update({ sessionMinutes: e.target.value === "" ? null : Number(e.target.value) })}
              placeholder="bv. 60" />
          </div>
        </div>

        <label className="tc-label">Dagen waarop je kunt trainen (leeg = maakt niet uit)</label>
        <div className="tc-weekday-toggles">
          {WEEKDAYS.map((w) => (
            <button key={w} type="button"
              className={"tc-weekday-toggle" + (goals.availableWeekdays.includes(w) ? " active" : "")}
              onClick={() => toggleWeekday(w)} title={`Beschikbaar op ${w.toLowerCase()}`}>
              {w.slice(0, 2)}
            </button>
          ))}
        </div>

        <div className="tc-form-row">
          <div>
            <label className="tc-label">Materiaal</label>
            <input className="tc-input" value={goals.equipment}
              onChange={(e) => update({ equipment: e.target.value })}
              placeholder="bv. sportschool met rek en dumbbells" />
          </div>
          <div>
            <label className="tc-label">Ervaring</label>
            <input className="tc-input" value={goals.experience}
              onChange={(e) => update({ experience: e.target.value })}
              placeholder="bv. 3 jaar serieus krachttraining" />
          </div>
        </div>

        <label className="tc-label">Blessures of oefeningen die je wilt vermijden</label>
        <input className="tc-input" value={goals.limitations}
          onChange={(e) => update({ limitations: e.target.value })}
          placeholder="bv. gevoelige rechterschouder, geen overhead press" />

        <label className="tc-label">Extra vraag bij dit voorstel (optioneel)</label>
        <input className="tc-input" value={question} onChange={(e) => setQuestion(e.target.value)}
          placeholder="bv. 'houd woensdag vrij' of 'ik wil meer aandacht voor mijn rug'" />

        <div className="tc-actionbar">
          <button className="tc-btn tc-btn-strength" onClick={handleGenerate} disabled={generating || goalMissing}>
            {generating ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}
            {generating ? "Coach ontwerpt je schema…" : "Vraag de coach om een schema"}
          </button>
          {goalMissing && <span className="tc-import-help" style={{ margin: 0 }}>Vul eerst je doel in.</span>}
        </div>
        {error && <div className="tc-error"><span>{error}</span></div>}
      </CollapsibleCard>

      {open && (
        <ProposalCard
          proposal={open}
          onAccept={() => handleAccept(open.id)}
          onDecline={(reason) => handleDecline(open.id, reason)}
        />
      )}

      {applied && (
        <AppliedCard proposal={applied} onUndo={() => handleUndo(applied.id)} />
      )}

      {older.length > 0 && (
        <details className="tc-feedback-card">
          <summary>
            <span className="tc-feedback-date">Eerdere schemavoorstellen ({older.length})</span>
          </summary>
          <div className="tc-proposal-list" style={{ marginTop: 10 }}>
            {older.map((p) => (
              <div className="tc-proposal-row" key={p.id}>
                <span className={"tc-hint-badge " + statusBadgeClass(p.status)}>{statusLabel(p.status)}</span>
                <span className="tc-proposal-type">{new Date(p.date).toLocaleDateString("nl-NL")}</span>
                <span className="tc-proposal-invulling">
                  {p.declineReason ? `afgewezen: ${p.declineReason}` : p.toelichting || p.rawFeedback || "—"}
                </span>
                <button className="tc-icon-btn" onClick={() => handleDelete(p.id)} title="Verwijderen">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}

/**
 * The proposal currently in force, with the way back out.
 *
 * Undo asks first, for the same reason accept does: the snapshot is the schema
 * as it was *before* this proposal, so anything edited by hand since then goes
 * with it. That is fine as long as nobody finds out afterwards.
 */
function AppliedCard({ proposal, onUndo }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="tc-card">
      <div className="tc-card-head">
        <span className="tc-ex-name">Schema van de coach is actief</span>
        <span className="tc-hint-badge tc-badge-strength">
          overgenomen op {new Date(proposal.appliedAt).toLocaleString("nl-NL")}
        </span>
      </div>
      {proposal.toelichting && <p className="tc-feedback-text">{proposal.toelichting}</p>}
      <p className="tc-import-help">
        Je vorige schema is bewaard. Bevalt dit toch niet, dan zet je het terug — je gelogde
        trainingen blijven hoe dan ook staan.
      </p>

      {!confirming && (
        <div className="tc-actionbar">
          <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={() => setConfirming(true)}>
            <Undo2 size={13} /> Zet mijn vorige schema terug
          </button>
        </div>
      )}

      {confirming && (
        <div className="tc-backup-confirm">
          <p>
            Dit zet het schema terug zoals het was vóór dit voorstel. Heb je er daarna zelf nog iets
            in aangepast, dan gaat die aanpassing verloren.
          </p>
          <div className="tc-actionbar">
            <button className="tc-btn tc-btn-ghost tc-btn-sm" disabled={busy}
              onClick={async () => { setBusy(true); try { await onUndo(); } finally { setBusy(false); } }}>
              {busy ? <Loader2 className="spin" size={13} /> : <Undo2 size={13} />} Ja, terugzetten
            </button>
            <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={() => setConfirming(false)} disabled={busy}>
              Annuleren
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function statusLabel(status) {
  return {
    geaccepteerd: "overgenomen",
    afgewezen: "afgewezen",
    teruggedraaid: "teruggedraaid",
    vervangen: "vervangen",
    voorgesteld: "open",
    mislukt: "mislukt",
  }[status] || status;
}

function statusBadgeClass(status) {
  if (status === "geaccepteerd") return "tc-badge-strength";
  if (status === "afgewezen" || status === "teruggedraaid" || status === "mislukt") return "tc-badge-warning";
  return "tc-badge-cardio";
}

/**
 * The proposal itself, plus what accepting it would change.
 *
 * The change summary is on top on purpose: "replace my whole schema" is not a
 * decision anyone should make by reading a list of exercise names and hoping
 * they spot what went missing.
 */
function ProposalCard({ proposal, onAccept, onDecline }) {
  const [confirming, setConfirming] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const { voorstel, wijzigingen } = proposal;

  async function run(fn) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tc-card" style={{ borderColor: "var(--strength)" }}>
      <div className="tc-card-head">
        <span className="tc-ex-name">Voorstel van de coach</span>
        <span className="tc-hint-badge tc-badge-cardio">{new Date(proposal.date).toLocaleString("nl-NL")}</span>
      </div>

      {proposal.toelichting && <p className="tc-feedback-text">{proposal.toelichting}</p>}
      {proposal.waarschuwing && (
        <div className="tc-warning-box">
          <AlertTriangle size={13} style={{ verticalAlign: "middle" }} /> {proposal.waarschuwing}
        </div>
      )}

      {/* The coach ignoring a constraint you set is something you should be
          told about, not something the app quietly cleans up behind you. */}
      {proposal.correcties?.length > 0 && (
        <div className="tc-warning-box">
          <strong>Aangepast na controle</strong>
          <ul className="tc-tip-list" style={{ margin: "6px 0 0" }}>
            {proposal.correcties.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      )}

      {wijzigingen && (
        <div className="tc-import-preview">
          <p className="tc-history-label">Wat er verandert als je dit overneemt</p>
          <p className="tc-history-detail">
            {wijzigingen.krachtsessiesPerWeek} krachtsessie{wijzigingen.krachtsessiesPerWeek === 1 ? "" : "s"} en{" "}
            {wijzigingen.cardiosessiesPerWeek} vast cardiomoment{wijzigingen.cardiosessiesPerWeek === 1 ? "" : "en"} per week
          </p>
          {wijzigingen.nieuweDagen.length > 0 && (
            <p className="tc-history-detail">nieuwe trainingsdagen: {wijzigingen.nieuweDagen.join(", ")}</p>
          )}
          {wijzigingen.gewijzigdeDagen.length > 0 && (
            <p className="tc-history-detail">aangepast: {wijzigingen.gewijzigdeDagen.join(", ")}</p>
          )}
          {wijzigingen.vervallenDagen.length > 0 && (
            <p className="tc-history-detail">vervalt: {wijzigingen.vervallenDagen.join(", ")}</p>
          )}
          {wijzigingen.nieuweCardiomomenten?.length > 0 && (
            <p className="tc-history-detail">nieuwe cardiomomenten: {wijzigingen.nieuweCardiomomenten.join(", ")}</p>
          )}
          {wijzigingen.vervallenCardiomomenten?.length > 0 && (
            <p className="tc-history-detail">
              vervallen cardiomomenten: {wijzigingen.vervallenCardiomomenten.join(", ")}
            </p>
          )}
          {wijzigingen.nieuweOefeningen.length > 0 && (
            <p className="tc-history-detail">nieuwe oefeningen: {wijzigingen.nieuweOefeningen.join(", ")}</p>
          )}
          {wijzigingen.vervallenOefeningen.length > 0 && (
            <p className="tc-history-detail">
              verdwijnt uit je schema: {wijzigingen.vervallenOefeningen.join(", ")} — je gelogde
              trainingen met deze oefeningen blijven gewoon bestaan
            </p>
          )}
        </div>
      )}

      <div className="tc-daygrid" style={{ marginTop: 16 }}>
        {voorstel.days.map((day) => (
          <div className="tc-card" key={day.id} style={{ marginBottom: 0 }}>
            <div className="tc-card-head">
              <span className="tc-day-name">{day.name}</span>
            </div>
            <div className="tc-chiprow" style={{ marginBottom: 8 }}>
              {(day.weekdays || []).map((w) => (
                <span key={w} className="tc-hint-badge tc-badge-strength">{w}</span>
              ))}
              {day.timeOfDay && <span className="tc-hint-badge tc-badge-event">{day.timeOfDay}</span>}
            </div>
            {day.toelichting && <p className="tc-history-detail" style={{ marginTop: 0 }}>{day.toelichting}</p>}
            <div className="tc-ex-list" style={{ marginTop: 8 }}>
              {day.exercises.map((ex) => (
                <div key={ex.id} style={{ marginBottom: 6 }}>
                  <span className="tc-planner-type">{ex.name}</span>{" "}
                  <span className="tc-hint-badge tc-badge-strength">{ex.targetSets}×{ex.targetReps}</span>
                  {ex.toelichting && <p className="tc-history-detail" style={{ marginTop: 2 }}>{ex.toelichting}</p>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {voorstel.cardioDays.length > 0 && (
        <>
          <p className="tc-history-label">Vaste cardiomomenten</p>
          <div className="tc-proposal-list">
            {voorstel.cardioDays.map((c) => (
              <div className="tc-proposal-row" key={c.id}>
                <span className="tc-hint-badge tc-badge-cardio">{c.weekday}</span>
                <span className="tc-proposal-type">{c.type}</span>
                <span className="tc-proposal-invulling">{c.notes}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {proposal.opbouw?.length > 0 && (
        <>
          <p className="tc-history-label" style={{ marginTop: 14 }}>Hoe dit de komende weken opbouwt</p>
          <ul className="tc-tip-list">
            {proposal.opbouw.map((o, i) => <li key={i}>{o}</li>)}
          </ul>
        </>
      )}

      {!confirming && !declining && (
        <div className="tc-actionbar">
          <button className="tc-btn tc-btn-strength" onClick={() => setConfirming(true)} disabled={busy}>
            <Check size={15} /> Neem dit schema over
          </button>
          <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={() => setDeclining(true)} disabled={busy}>
            <X size={13} /> Afwijzen
          </button>
        </div>
      )}

      {confirming && (
        <div className="tc-backup-confirm">
          <p>
            Dit vervangt je huidige schema
            {wijzigingen ? ` (${wijzigingen.huidigAantalDagen} trainingsdag${wijzigingen.huidigAantalDagen === 1 ? "" : "en"})` : ""}{" "}
            door dat van de coach. Je gelogde trainingen blijven staan, en je oude schema wordt
            bewaard zodat je dit meteen kunt terugdraaien.
          </p>
          <div className="tc-actionbar">
            <button className="tc-btn tc-btn-strength" disabled={busy} onClick={() => run(onAccept)}>
              {busy ? <Loader2 className="spin" size={15} /> : <Check size={15} />} Ja, overnemen
            </button>
            <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={() => setConfirming(false)} disabled={busy}>
              Annuleren
            </button>
          </div>
        </div>
      )}

      {declining && (
        <div className="tc-backup-confirm">
          <p>Waarom past dit niet? De coach krijgt je reden mee, zodat hij niet met hetzelfde terugkomt.</p>
          <input className="tc-input" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="bv. 'te veel dagen, ik haal er hooguit drie'" />
          <div className="tc-actionbar">
            <button className="tc-btn tc-btn-ghost tc-btn-sm" disabled={busy}
              onClick={() => run(() => onDecline(reason))}>
              {busy ? <Loader2 className="spin" size={13} /> : <X size={13} />} Afwijzen
            </button>
            <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={() => setDeclining(false)} disabled={busy}>
              Annuleren
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
