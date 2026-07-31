import { useState, useEffect } from "react";
import { RefreshCw, Check, X, Loader2 } from "lucide-react";
import * as api from "../api/client";

/**
 * Strava connection panel. Lives in the Schema tab alongside the other
 * settings.
 *
 * The "connect" step deliberately uses a full page navigation rather than
 * fetch(): OAuth requires the browser itself to visit Strava's consent screen
 * and be redirected back.
 */
export default function StravaPanel({ onImported }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [backfill, setBackfill] = useState(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState(null);
  const [error, setError] = useState("");

  async function loadStatus() {
    try {
      const s = await api.getStravaStatus();
      setStatus(s);
      if (s.connected) setBackfill(await api.getStravaBackfillStatus());
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    setError("");
    try {
      const result = await api.syncStrava(20);
      setSyncResult(result);
      await onImported();
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  }

  /**
   * Re-fetches activities imported before the analysis features existed, so
   * histograms and power curves appear for your history too. Batched, because
   * each activity costs two Strava calls against a 100-per-15-minutes limit.
   */
  async function handleBackfill() {
    setBackfilling(true);
    setError("");
    try {
      const result = await api.backfillStrava(25);
      setBackfillResult(result);
      setBackfill(await api.getStravaBackfillStatus());
      await onImported();
    } catch (err) {
      setError(err.message);
    } finally {
      setBackfilling(false);
    }
  }

  async function handleDisconnect() {
    try {
      await api.disconnectStrava();
      await loadStatus();
      setSyncResult(null);
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) {
    return (
      <div className="tc-card">
        <div className="tc-import-help" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Loader2 className="spin" size={15} /> Strava-status ophalen…
        </div>
      </div>
    );
  }

  return (
    <div className="tc-card">
      <div className="tc-card-head">
        <span className="tc-ex-name">Strava-koppeling</span>
        {status?.connected ? (
          <span className="tc-hint-badge tc-badge-cardio">verbonden</span>
        ) : (
          <span className="tc-hint-badge tc-badge-warning">niet verbonden</span>
        )}
      </div>

      {error && <div className="tc-error"><span>{error}</span></div>}

      {!status?.configured && (
        <p className="tc-import-help">
          Zet eerst <code>STRAVA_CLIENT_ID</code> en <code>STRAVA_CLIENT_SECRET</code> in het
          <code>.env</code>-bestand op de server, en herstart daarna. Die krijg je door een API-app te
          registreren op strava.com/settings/api.
        </p>
      )}

      {status?.configured && !status?.connected && (
        <>
          <p className="tc-import-help">
            Koppel je Strava-account, dan kan de server je activiteiten zelf ophalen — inclusief het
            verloop van hartslag, vermogen en cadans per sessie. Handmatig GPX-bestanden exporteren
            is dan niet meer nodig.
          </p>
          <a className="tc-btn tc-btn-cardio" href="/api/strava/authorize">
            Verbinden met Strava
          </a>
        </>
      )}

      {status?.connected && (
        <>
          <p className="tc-history-detail">
            Verbonden als {status.athleteName || "onbekende atleet"}
            {status.connectedAt ? ` sinds ${new Date(status.connectedAt).toLocaleDateString("nl-NL")}` : ""}
          </p>
          <p className="tc-import-help">
            Nieuwe activiteiten komen automatisch binnen zodra de webhook is ingesteld. Met
            "Nu synchroniseren" haal je de laatste 20 activiteiten handmatig op — handig om bij te
            werken of de koppeling te testen.
          </p>
          {backfill?.verouderd > 0 && (
            <div className="tc-warning-box">
              <strong>{backfill.verouderd} activiteiten missen analysedata.</strong> Ze zijn geïmporteerd
              voordat de zoneverdeling en vermogenscurve bestonden, dus die tabbladen blijven leeg voor
              je geschiedenis. Werk ze bij om ze mee te laten tellen — dit gebeurt in blokken van 25
              vanwege Strava's limiet, dus bij een lange historie klik je een paar keer.
              <div className="tc-actionbar">
                <button className="tc-btn tc-btn-cardio" onClick={handleBackfill} disabled={backfilling}>
                  {backfilling ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
                  {backfilling ? "Bezig met bijwerken…" : `Analysedata bijwerken (${backfill.verouderd} te gaan)`}
                </button>
              </div>
            </div>
          )}

          {backfillResult && (
            <p className="tc-import-help">
              {backfillResult.bijgewerkt} bijgewerkt
              {backfillResult.mislukt > 0 ? `, ${backfillResult.mislukt} mislukt` : ""}.
              {backfillResult.hint ? ` ${backfillResult.hint}` : " Alles is bij."}
            </p>
          )}

          <div className="tc-actionbar">
            <button className="tc-btn tc-btn-cardio" onClick={handleSync} disabled={syncing}>
              <RefreshCw size={15} className={syncing ? "spin" : ""} />
              {syncing ? "Bezig met ophalen…" : "Nu synchroniseren"}
            </button>
            <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={handleDisconnect}>
              Ontkoppelen
            </button>
          </div>

          {syncResult && (
            <div className="tc-import-preview">
              <p className="tc-import-help">
                <Check size={14} style={{ verticalAlign: "middle" }} /> {syncResult.imported} geïmporteerd,{" "}
                {syncResult.skipped} overgeslagen
                {syncResult.failed > 0 ? `, ${syncResult.failed} mislukt` : ""}
              </p>
              <div className="tc-gpxbatch-list">
                {syncResult.details.map((d) => (
                  <div className="tc-gpxbatch-row" key={d.id}>
                    {d.status === "geïmporteerd" ? (
                      <Check size={14} style={{ color: "var(--cardio)", flexShrink: 0 }} />
                    ) : (
                      <X size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                    )}
                    <div className="tc-gpxbatch-info">
                      <span className="tc-gpxbatch-filename">{d.name}</span>
                      <span className="tc-history-detail">{d.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
