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
  const [error, setError] = useState("");

  async function loadStatus() {
    try {
      setStatus(await api.getStravaStatus());
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
