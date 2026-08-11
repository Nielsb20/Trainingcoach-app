import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { Loader2, RefreshCw, X } from "lucide-react";

import { NAV } from "./lib/constants";
import * as api from "./api/client";

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
 * Schema and Kracht stay eager: Schema is where the app opens, and Kracht is
 * what you reach for mid-workout, where a loading flash is most annoying and a
 * flaky connection most likely.
 */
const CardioTab = lazy(() => import("./components/CardioTab"));
const WeightTab = lazy(() => import("./components/WeightTab"));
const EventsTab = lazy(() => import("./components/EventsTab"));
const GeschiedenisTab = lazy(() => import("./components/GeschiedenisTab"));
const CoachTab = lazy(() => import("./components/CoachTab"));
const WellnessTab = lazy(() => import("./components/WellnessTab"));
const SessionDetail = lazy(() => import("./components/SessionDetail"));
const PlannerTab = lazy(() => import("./components/PlannerTab"));

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
  const [tab, setTab] = useState("schema");
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

  return (
    <div className="tc-app">
      <nav className="tc-sidebar">
        <div className="tc-brand">
          <span className="tc-brand-mark">TC</span>
          <span className="tc-brand-name">Trainingscoach</span>
        </div>
        <div className="tc-navlist">
          {NAV.map((n) => {
            const Icon = n.icon;
            return (
              <button
                key={n.id}
                className={"tc-navitem" + (tab === n.id ? " active" : "")}
                onClick={() => setTab(n.id)}
              >
                <Icon size={17} />
                <span>{n.label}</span>
                {n.id === "planning" && pendingProposals > 0 && (
                  <span className="tc-nav-badge">{pendingProposals}</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="tc-sidebar-footer">
          <button className="tc-navitem tc-refresh-btn" onClick={handleRefresh} disabled={refreshing} title="Gegevens opnieuw ophalen">
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
            <button className="tc-icon-btn" onClick={() => setActionError("")}>
              <X size={14} />
            </button>
          </div>
        )}

        <Suspense fallback={<TabLoading />}>
        {tab === "schema" && <SchemaTab schema={schema} setSchema={setSchema} onRestored={loadAll} />}
        {tab === "kracht" && (
          <KrachtTab schema={schema} workoutLogs={workoutLogs} addWorkoutLog={addWorkoutLog} goToSchema={() => setTab("schema")} />
        )}
        {tab === "cardio" && (
          <CardioTab
            cardioLogs={cardioLogs}
            addCardioLog={addCardioLog}
            addCardioLogsBulk={addCardioLogsBulk}
            weightLogs={weightLogs}
            onStravaImported={refreshCardioLogs}
          />
        )}
        {tab === "gewicht" && (
          <WeightTab weightLogs={weightLogs} addWeightLog={addWeightLog} deleteWeightLog={deleteWeightLog} />
        )}
        {tab === "herstel" && <WellnessTab />}
        {tab === "planning" && <PlannerTab onOpenSession={setDetailSessionId} />}
        {tab === "evenementen" && (
          <EventsTab events={events} addEvent={addEvent} updateEvent={updateEvent} deleteEvent={deleteEvent} />
        )}
        {tab === "geschiedenis" && (
          <GeschiedenisTab
            schema={schema}
            workoutLogs={workoutLogs}
            cardioLogs={cardioLogs}
            weightLogs={weightLogs}
            updateWorkoutLog={updateWorkoutLog}
            deleteWorkoutLog={deleteWorkoutLog}
            deleteCardioLog={deleteCardioLog}
            onOpenSession={setDetailSessionId}
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
          />
        )}
        </Suspense>
      </main>

      {detailSessionId && (
        <Suspense fallback={<TabLoading />}>
          <SessionDetail sessionId={detailSessionId} onClose={() => setDetailSessionId(null)} />
        </Suspense>
      )}
    </div>
  );
}
