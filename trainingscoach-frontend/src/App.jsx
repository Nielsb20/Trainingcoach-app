import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { Loader2, RefreshCw, X } from "lucide-react";

import { NAV, SETTINGS_NAV, LOG_KINDS } from "./lib/constants";
import * as api from "./api/client";

import ErrorBoundary from "./components/shared/ErrorBoundary";
import SchemaTab from "./components/SchemaTab";
import KrachtTab from "./components/KrachtTab";

/**
 * Tabs beyond the first two are loaded when they are opened.
 *
 * The charting library is the bulk of the bundle and six screens pull it in,
 * so it was downloaded before the first screen could render — on a phone away
 * from wifi that is the whole wait. Splitting per tab means you only fetch the
 * charts once you ask for one.
 *
 * Schema and Kracht stay eager: Kracht is what you reach for mid-workout, where
 * a loading flash is most annoying and a flaky connection most likely, and
 * Schema is small. Vandaag is where the app opens, but it only draws cards and
 * no charts, so its chunk is tiny.
 */
const CardioTab = lazy(() => import("./components/CardioTab"));
const EventsTab = lazy(() => import("./components/EventsTab"));
const GeschiedenisTab = lazy(() => import("./components/GeschiedenisTab"));
const CoachTab = lazy(() => import("./components/CoachTab"));
const SessionDetail = lazy(() => import("./components/SessionDetail"));
const PlannerTab = lazy(() => import("./components/PlannerTab"));
const TodayTab = lazy(() => import("./components/TodayTab"));

function TabLoading() {
  return (
    <div className="tc-loading">
      <Loader2 className="spin" size={20} />
      <span>Laden…</span>
    </div>
  );
}

const EMPTY_SCHEMA = { days: [], cardioDays: [], profile: {} };

export default function App() {
  // De app opent op Vandaag: wat staat er, hoe is je herstel, wat zei de
  // coach. Hij opende op Schema, en dat is een scherm dat je eens per maand
  // aanpast.
  const [tab, setTab] = useState("vandaag");
  const [logKind, setLogKind] = useState("kracht");
  const [settingsPage, setSettingsPage] = useState("schema");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");

  const [schema, setSchema] = useState(EMPTY_SCHEMA);
  const [workoutLogs, setWorkoutLogs] = useState([]);
  const [cardioLogs, setCardioLogs] = useState([]);
  const [weightLogs, setWeightLogs] = useState([]);
  const [events, setEvents] = useState([]);
  const [coachHistory, setCoachHistory] = useState([]);

  const [pendingProposals, setPendingProposals] = useState(0);
  // Which session's detail panel is open, if any.
  const [detailSessionId, setDetailSessionId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(null);

  // Schema edits happen locally as the user types; we debounce the PUT so we
  // aren't firing a request on every keystroke.
  const schemaFirstLoad = useRef(true);
  const schemaSaveTimer = useRef(null);

  async function loadAll() {
    const data = await api.loadAll();
    schemaFirstLoad.current = true; // don't echo the freshly-loaded schema straight back
    setSchema({
      days: data.schema.days || [],
      cardioDays: data.schema.cardioDays || [],
      profile: data.schema.profile || {},
    });
    setWorkoutLogs(data.workoutLogs);
    setCardioLogs(data.cardioLogs);
    setWeightLogs(data.weightLogs);
    setEvents(data.events);
    setCoachHistory(data.coachHistory);

    // Automatic runs can add proposals while the app is closed, so surface the
    // count on the nav rather than leaving them to be discovered by chance.
    try {
      const planned = await api.getPlannedSessions(4);
      setPendingProposals(planned.plans.filter((p) => p.status === "voorgesteld").length);
    } catch {
      setPendingProposals(0); // a failure here shouldn't block the whole load
    }
  }

  useEffect(() => {
    (async () => {
      try {
        await loadAll();
      } catch (err) {
        setLoadError(err.message);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (schemaFirstLoad.current) {
      schemaFirstLoad.current = false;
      return;
    }
    if (schemaSaveTimer.current) clearTimeout(schemaSaveTimer.current);
    schemaSaveTimer.current = setTimeout(() => {
      api.saveSchema(schema).catch((err) => setActionError("Schema opslaan mislukt: " + err.message));
    }, 700);
    return () => clearTimeout(schemaSaveTimer.current);
  }, [schema, loaded]);

  async function handleRefresh() {
    setRefreshing(true);
    setActionError("");
    try {
      await loadAll();
      setLastRefreshed(new Date());
    } catch (err) {
      setActionError("Verversen mislukt: " + err.message);
    } finally {
      setRefreshing(false);
    }
  }

  /**
   * Wraps a write so a failed request surfaces in the UI instead of silently
   * leaving the screen out of sync with the server — the exact failure mode
   * that made data appear to vanish in the artifact prototype.
   */
  async function withErrorHandling(fn, failureMessage) {
    setActionError("");
    try {
      await fn();
      return true;
    } catch (err) {
      setActionError(`${failureMessage}: ${err.message}`);
      return false;
    }
  }

  const addWorkoutLog = (entry) =>
    withErrorHandling(async () => {
      await api.createWorkoutLog(entry);
      setWorkoutLogs(await api.getWorkoutLogs());
    }, "Training opslaan mislukt");

  const updateWorkoutLog = (id, entry) =>
    withErrorHandling(async () => {
      await api.updateWorkoutLog(id, entry);
      setWorkoutLogs(await api.getWorkoutLogs());
    }, "Training bijwerken mislukt");

  const deleteWorkoutLog = (id) =>
    withErrorHandling(async () => {
      await api.deleteWorkoutLog(id);
      setWorkoutLogs(await api.getWorkoutLogs());
    }, "Training verwijderen mislukt");

  const addCardioLog = (entry) =>
    withErrorHandling(async () => {
      await api.createCardioLog(entry);
      setCardioLogs(await api.getCardioLogs());
    }, "Cardiosessie opslaan mislukt");

  const addCardioLogsBulk = (entries, source) =>
    withErrorHandling(async () => {
      await api.createCardioLogsBulk(entries, source);
      setCardioLogs(await api.getCardioLogs());
    }, "Sessies importeren mislukt");

  /** After a Strava sync: only the cardio list can have changed. */
  const refreshCardioLogs = () =>
    withErrorHandling(async () => {
      setCardioLogs(await api.getCardioLogs());
    }, "Sessies verversen mislukt");

  const deleteCardioLog = (id) =>
    withErrorHandling(async () => {
      await api.deleteCardioLog(id);
      setCardioLogs(await api.getCardioLogs());
    }, "Cardiosessie verwijderen mislukt");

  const addWeightLog = (entry) =>
    withErrorHandling(async () => {
      await api.createWeightLog(entry);
      setWeightLogs(await api.getWeightLogs());
    }, "Gewicht opslaan mislukt");

  const deleteWeightLog = (id) =>
    withErrorHandling(async () => {
      await api.deleteWeightLog(id);
      setWeightLogs(await api.getWeightLogs());
    }, "Gewicht verwijderen mislukt");

  const addEvent = (entry) =>
    withErrorHandling(async () => {
      await api.createEvent(entry);
      setEvents(await api.getEvents());
    }, "Evenement opslaan mislukt");

  const updateEvent = (id, entry) =>
    withErrorHandling(async () => {
      await api.updateEvent(id, entry);
      setEvents(await api.getEvents());
    }, "Evenement bijwerken mislukt");

  const deleteEvent = (id) =>
    withErrorHandling(async () => {
      await api.deleteEvent(id);
      setEvents(await api.getEvents());
    }, "Evenement verwijderen mislukt");

  const onCoachAnswered = () =>
    withErrorHandling(async () => {
      setCoachHistory(await api.getCoachHistory());
    }, "Coachgeschiedenis bijwerken mislukt");

  const deleteCoachEntry = (id) =>
    withErrorHandling(async () => {
      await api.deleteCoachEntry(id);
      setCoachHistory(await api.getCoachHistory());
    }, "Coachantwoord verwijderen mislukt");

  if (!loaded) {
    return (
      <div className="tc-loading">
        <Loader2 className="spin" size={22} />
        <span>Gegevens laden…</span>
      </div>
    );
  }

  function openLog(kind) {
    setLogKind(kind);
    setTab("loggen");
  }

  // Een functie en geen eigen component: binnen App gedefinieerd zou React
  // elke knop bij iedere render als nieuw onderdeel zien en opnieuw opbouwen.
  function navButton(item, className = "") {
    const Icon = item.icon;
    return (
      <button
        key={item.id}
        className={"tc-navitem" + (item.primary ? " tc-navitem-primary" : "") + (tab === item.id ? " active" : "") + className}
        onClick={() => setTab(item.id)}
        // Het label staat er als tekst naast, maar een naam op de knop
        // zelf overleeft het ook als de tekst om ruimte wegvalt — en
        // dat is precies wanneer je hem het hardst nodig hebt.
        title={item.label}
        aria-label={item.label}
        aria-current={tab === item.id ? "page" : undefined}
      >
        <span className="tc-navicon"><Icon size={item.primary ? 20 : 17} /></span>
        <span className="tc-navlabel">{item.label}</span>
        {item.id === "planning" && pendingProposals > 0 && (
          <span className="tc-nav-badge">{pendingProposals}</span>
        )}
      </button>
    );
  }

  return (
    <div className="tc-app">
      {/* Eén navigatie voor beide schermformaten. Op een telefoon zet de CSS
          de vijf onderdelen als balk onderin, binnen bereik van je duim; het
          merkje, Instellingen en verversen blijven bovenaan. Twee aparte
          menu's zouden elke knop dubbel in de pagina zetten. */}
      <nav className="tc-sidebar" aria-label="Hoofdmenu">
        <div className="tc-brand">
          <span className="tc-brand-mark">TC</span>
          <span className="tc-brand-name">Trainingscoach</span>
        </div>
        <div className="tc-navlist">
          {NAV.map((n) => navButton(n))}
        </div>
        <div className="tc-sidebar-footer">
          {navButton(SETTINGS_NAV, " tc-settings-btn")}
          <button className="tc-navitem tc-refresh-btn" onClick={handleRefresh} disabled={refreshing}
            title="Gegevens opnieuw ophalen" aria-label="Ververs gegevens">
            <RefreshCw size={16} className={refreshing ? "spin" : ""} />
            <span>{refreshing ? "Verversen…" : "Ververs gegevens"}</span>
          </button>
          {lastRefreshed && (
            <span className="tc-refresh-timestamp">
              Laatst ververst: {lastRefreshed.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <span className="tc-copyright">© 2026 Trainingscoach</span>
        </div>
      </nav>

      <main className="tc-main">
        {loadError && (
          <div className="tc-savebanner">
            <span>
              ⚠️ Kon geen verbinding maken met de server ({loadError}). Draait de backend? Controleer <code>npm start</code> in de server-map.
            </span>
          </div>
        )}
        {actionError && (
          <div className="tc-savebanner">
            <span>⚠️ {actionError}</span>
            <button className="tc-icon-btn" onClick={() => setActionError("")} aria-label="Melding sluiten">
              <X size={14} />
            </button>
          </div>
        )}

        {/* resetKey = het tabblad: overstappen geeft een nieuwe kans, want de
            fout zat vrijwel zeker in het scherm dat je net verliet. */}
        <ErrorBoundary resetKey={tab + logKind + settingsPage}>
        <Suspense fallback={<TabLoading />}>
        {tab === "vandaag" && (
          <TodayTab
            schema={schema}
            cardioLogs={cardioLogs}
            events={events}
            coachHistory={coachHistory}
            onNavigate={setTab}
            onStartStrength={() => openLog("kracht")}
          />
        )}
        {tab === "planning" && <PlannerTab onOpenSession={setDetailSessionId} />}
        {tab === "loggen" && (
          <>
            <div className="tc-subtabs" role="tablist" aria-label="Wat wil je loggen">
              {LOG_KINDS.map((k) => (
                <button key={k.id} role="tab" aria-selected={logKind === k.id}
                  className={"tc-subtab" + (logKind === k.id ? (k.id === "kracht" ? " active-strength" : " active-cardio") : "")}
                  onClick={() => setLogKind(k.id)}>
                  {k.label}
                </button>
              ))}
            </div>
            {logKind === "kracht" && (
              <KrachtTab schema={schema} workoutLogs={workoutLogs} addWorkoutLog={addWorkoutLog}
                goToSchema={() => { setSettingsPage("schema"); setTab("instellingen"); }} />
            )}
            {logKind === "cardio" && (
              <CardioTab
                cardioLogs={cardioLogs}
                addCardioLog={addCardioLog}
                addCardioLogsBulk={addCardioLogsBulk}
                weightLogs={weightLogs}
                onStravaImported={refreshCardioLogs}
              />
            )}
          </>
        )}
        {tab === "voortgang" && (
          <GeschiedenisTab
            schema={schema}
            workoutLogs={workoutLogs}
            cardioLogs={cardioLogs}
            weightLogs={weightLogs}
            updateWorkoutLog={updateWorkoutLog}
            deleteWorkoutLog={deleteWorkoutLog}
            deleteCardioLog={deleteCardioLog}
            onOpenSession={setDetailSessionId}
            addWeightLog={addWeightLog}
            deleteWeightLog={deleteWeightLog}
          />
        )}
        {tab === "coach" && (
          <CoachTab
            schema={schema}
            workoutLogs={workoutLogs}
            cardioLogs={cardioLogs}
            events={events}
            weightLogs={weightLogs}
            coachHistory={coachHistory}
            onCoachAnswered={onCoachAnswered}
            deleteCoachEntry={deleteCoachEntry}
            onSchemaReplaced={loadAll}
          />
        )}
        {tab === "instellingen" && (
          <>
            <h1 className="tc-title">Instellingen</h1>
            <div className="tc-subtabs" role="tablist" aria-label="Instellingen">
              <button role="tab" aria-selected={settingsPage === "schema"}
                className={"tc-subtab" + (settingsPage === "schema" ? " active-strength" : "")}
                onClick={() => setSettingsPage("schema")}>Schema en profiel</button>
              <button role="tab" aria-selected={settingsPage === "evenementen"}
                className={"tc-subtab" + (settingsPage === "evenementen" ? " active-event" : "")}
                onClick={() => setSettingsPage("evenementen")}>Evenementen</button>
            </div>
            <div className="tc-embedded">
              {settingsPage === "schema" && (
                <SchemaTab schema={schema} setSchema={setSchema} onRestored={loadAll} goToCoach={() => setTab("coach")} />
              )}
              {settingsPage === "evenementen" && (
                <EventsTab events={events} addEvent={addEvent} updateEvent={updateEvent} deleteEvent={deleteEvent} />
              )}
            </div>
          </>
        )}
        </Suspense>
        </ErrorBoundary>
      </main>

      {detailSessionId && (
        <ErrorBoundary resetKey={detailSessionId}>
          <Suspense fallback={<TabLoading />}>
            <SessionDetail sessionId={detailSessionId} onClose={() => setDetailSessionId(null)} />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  );
}
