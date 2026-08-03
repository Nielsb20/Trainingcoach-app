import { useState, useEffect } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { X, Loader2, MessageCircle, TrendingDown, Flag, RefreshCw } from "lucide-react";
import * as api from "../api/client";
import { formatDateNL } from "../lib/calculations";

const ZONE_COLORS = ["#4FA8A0", "#5B8FBF", "#8C86C9", "#C97A3F", "#B85C5C", "#8C4A4A", "#6B3A3A"];

const formatDuration = (min) => {
  if (!min) return "–";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}u ${m}m` : `${m}m`;
};

/**
 * Everything about one session, in a panel over the app.
 *
 * The numbers come from the server rather than being recomputed here, so what
 * you read on screen is exactly what the coach is handed — no chance of the
 * two drifting apart.
 */
export default function SessionDetail({ sessionId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [askingFeedback, setAskingFeedback] = useState(false);

  useEffect(() => {
    setLoading(true);
    api
      .getSessionDetail(sessionId)
      .then((d) => {
        setData(d);
        setFeedback(d.feedback);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [sessionId]);

  async function askFeedback(force = false) {
    setAskingFeedback(true);
    setError("");
    try {
      setFeedback(await api.getSessionFeedback(sessionId, force));
    } catch (e) {
      setError(e.message);
    } finally {
      setAskingFeedback(false);
    }
  }

  if (loading) {
    return (
      <div className="tc-detail-overlay" onClick={onClose}>
        <div className="tc-detail-panel" onClick={(e) => e.stopPropagation()}>
          <div className="tc-import-help" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Loader2 className="spin" size={15} /> Analyse laden…
          </div>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="tc-detail-overlay" onClick={onClose}>
        <div className="tc-detail-panel" onClick={(e) => e.stopPropagation()}>
          <div className="tc-error"><span>{error}</span></div>
          <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={onClose}>Sluiten</button>
        </div>
      </div>
    );
  }

  const { sessie, berekend, zones, vermogenscurve, drift, vergelijking, evenement } = data;
  const sneller =
    berekend.gemSnelheidKmu && vergelijking.gemSnelheidEerder
      ? Math.round((berekend.gemSnelheidKmu - vergelijking.gemSnelheidEerder) * 10) / 10
      : null;

  return (
    <div className="tc-detail-overlay" onClick={onClose}>
      <div className="tc-detail-panel" onClick={(e) => e.stopPropagation()}>
        <div className="tc-detail-head">
          <div>
            <h2 className="tc-title" style={{ marginBottom: 2 }}>
              {evenement ? evenement.name : sessie.type}
            </h2>
            <span className="tc-history-detail">
              {formatDateNL(sessie.date)}
              {evenement ? ` · ${sessie.type}` : ""}
              {sessie.notes && !evenement ? ` · ${sessie.notes}` : ""}
            </span>
          </div>
          <button className="tc-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        {evenement && (
          <div className="tc-chiprow">
            <span className="tc-hint-badge tc-badge-event">
              <Flag size={12} style={{ verticalAlign: "middle" }} /> {evenement.type || "evenement"}
              {evenement.target ? ` · doel: ${evenement.target}` : ""}
            </span>
          </div>
        )}

        {/* ------------------------------ key figures ------------------------------ */}
        <div className="tc-detail-stats">
          <Stat label="Afstand" value={sessie.distance_km ? `${sessie.distance_km} km` : "–"} />
          <Stat label="Tijd" value={formatDuration(sessie.duration_min)} />
          <Stat label="Snelheid" value={berekend.gemSnelheidKmu ? `${berekend.gemSnelheidKmu} km/u` : "–"} />
          <Stat label="Hartslag" value={sessie.avg_hr ? `${sessie.avg_hr}/${sessie.max_hr || "–"}` : "–"} unit="bpm" />
          <Stat label="Vermogen" value={sessie.avg_power ? `${sessie.avg_power}` : "–"} unit={sessie.weighted_avg_power ? `W · NP ${sessie.weighted_avg_power}` : "W"} />
          <Stat label="W/kg" value={berekend.wattPerKg ?? "–"} unit={berekend.gewichtKg ? `bij ${berekend.gewichtKg} kg` : ""} />
          <Stat label="TSS" value={berekend.tss ?? "–"} unit={berekend.intensiteitsfactor ? `IF ${berekend.intensiteitsfactor}` : ""} />
          <Stat label="Hoogte" value={sessie.elevation_gain_m ? `↑${sessie.elevation_gain_m} m` : "–"} />
        </div>

        {berekend.variabiliteit && berekend.variabiliteit >= 1.1 && (
          <p className="tc-import-help">
            Variabiliteit {berekend.variabiliteit}: het vermogen wisselde sterk — kenmerkend voor
            intervallen, sprints of een heuvelachtig parcours.
          </p>
        )}

        {/* -------------------------------- drift --------------------------------- */}
        {drift && (
          <div className={"tc-card" + (drift.verschilBpm >= 5 ? " tc-warning-box" : "")}>
            <div className="tc-card-head">
              <span className="tc-ex-name">
                <TrendingDown size={14} style={{ verticalAlign: "middle", marginRight: 5 }} />
                Verloop over de sessie
              </span>
            </div>
            <p className="tc-history-detail">
              Eerste helft {drift.eersteHelftHartslag} bpm
              {drift.eersteHelftVermogen ? ` bij ${drift.eersteHelftVermogen} W` : ""} · tweede helft{" "}
              {drift.tweedeHelftHartslag} bpm
              {drift.tweedeHelftVermogen ? ` bij ${drift.tweedeHelftVermogen} W` : ""}
            </p>
            <p className="tc-import-help">
              {drift.verschilBpm >= 5
                ? `Je hartslag liep ${drift.verschilBpm} slagen op${
                    drift.tweedeHelftVermogen && drift.eersteHelftVermogen && drift.tweedeHelftVermogen < drift.eersteHelftVermogen
                      ? " terwijl je vermogen daalde — een duidelijk teken van vermoeidheid richting het einde."
                      : ". Let op of dit door het terrein kwam of door vermoeidheid."
                  }`
                : "Je hartslag bleef stabiel over de sessie — een teken dat de inspanning goed vol te houden was."}
            </p>
          </div>
        )}

        {/* -------------------------------- profile -------------------------------- */}
        {sessie.profile && sessie.profile.length > 0 && (
          <>
            <h3 className="tc-section-title">Verloop</h3>
            <div className="tc-chart-wrap">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={sessie.profile}>
                  <CartesianGrid stroke="#2E363D" strokeDasharray="3 3" />
                  <XAxis dataKey="tMin" stroke="#8B949B" fontSize={11} unit="m" />
                  <YAxis yAxisId="hr" stroke="#C97A3F" fontSize={12} domain={["auto", "auto"]} />
                  <YAxis yAxisId="pw" orientation="right" stroke="#8C86C9" fontSize={12} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={{ background: "#1C2227", border: "1px solid #2E363D", color: "#E8E6E1" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line yAxisId="hr" type="monotone" dataKey="gemHartslag" stroke="#C97A3F" strokeWidth={2} dot={false} name="Hartslag" connectNulls />
                  <Line yAxisId="pw" type="monotone" dataKey="gemVermogen" stroke="#8C86C9" strokeWidth={2} dot={false} name="Vermogen" connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}

        {/* --------------------------------- zones --------------------------------- */}
        {zones.beschikbaar ? (
          <>
            <h3 className="tc-section-title">Tijd per zone</h3>
            {zones.hartslag && (
              <div className="tc-chart-wrap">
                <ResponsiveContainer width="100%" height={170}>
                  <BarChart data={zones.hartslag} layout="vertical">
                    <CartesianGrid stroke="#2E363D" strokeDasharray="3 3" />
                    <XAxis type="number" stroke="#8B949B" fontSize={11} unit="m" />
                    <YAxis type="category" dataKey="naam" stroke="#8B949B" fontSize={11} width={95} />
                    <Tooltip contentStyle={{ background: "#1C2227", border: "1px solid #2E363D", color: "#E8E6E1" }}
                      formatter={(v) => [`${v} min`, "tijd"]} />
                    <Bar dataKey="minuten" fill="#C97A3F" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        ) : (
          zones.redenOntbreekt && <p className="tc-import-help">{zones.redenOntbreekt}</p>
        )}

        {/* ------------------------------ comparison ------------------------------- */}
        {vergelijking.aantalVergelijkbaar > 0 && (
          <>
            <h3 className="tc-section-title">Vergeleken met eerder</h3>
            <p className="tc-import-help">
              {vergelijking.aantalVergelijkbaar} eerdere sessie(s) van vergelijkbare afstand.
              {sneller !== null && (
                <> Je gemiddelde snelheid lag {Math.abs(sneller)} km/u {sneller >= 0 ? "hoger" : "lager"} dan
                  het gemiddelde daarvan ({vergelijking.gemSnelheidEerder} km/u).</>
              )}
            </p>
            <table className="tc-table">
              <thead><tr><th>Datum</th><th>Afstand</th><th>Snelheid</th><th>Gem. HR</th><th>Vermogen</th></tr></thead>
              <tbody>
                {vergelijking.sessies.map((s) => (
                  <tr key={s.id}>
                    <td>{formatDateNL(s.datum)}</td>
                    <td className="tc-mono">{s.afstandKm} km</td>
                    <td className="tc-mono">{s.snelheidKmu ? `${s.snelheidKmu} km/u` : "–"}</td>
                    <td className="tc-mono">{s.gemHartslag ?? "–"}</td>
                    <td className="tc-mono">{s.gemVermogen ? `${s.gemVermogen} W` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* ------------------------------ power curve ------------------------------ */}
        {vermogenscurve && vermogenscurve.length > 0 && (
          <>
            <h3 className="tc-section-title">Beste vermogen in deze sessie</h3>
            <div className="tc-chart-wrap">
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={vermogenscurve}>
                  <CartesianGrid stroke="#2E363D" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="#8B949B" fontSize={11} />
                  <YAxis stroke="#8B949B" fontSize={12} unit="W" />
                  <Tooltip contentStyle={{ background: "#1C2227", border: "1px solid #2E363D", color: "#E8E6E1" }} />
                  <Line type="monotone" dataKey="watt" stroke="#8C86C9" strokeWidth={2} dot={{ r: 3 }} name="Watt" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}

        {/* -------------------------------- feedback ------------------------------- */}
        <h3 className="tc-section-title">Wat vindt de coach ervan?</h3>
        {error && <div className="tc-error"><span>{error}</span></div>}

        {!feedback ? (
          <div className="tc-card">
            <p className="tc-import-help">
              Vraag de coach om deze sessie te beoordelen. Hij kijkt naar het verloop, de zones en je
              eerdere sessies van vergelijkbare afstand.
            </p>
            <div className="tc-actionbar">
              <button className="tc-btn tc-btn-strength" onClick={() => askFeedback(false)} disabled={askingFeedback}>
                {askingFeedback ? <Loader2 className="spin" size={15} /> : <MessageCircle size={15} />}
                {askingFeedback ? "Bezig…" : "Vraag beoordeling"}
              </button>
            </div>
          </div>
        ) : (
          <div className="tc-card">
            {feedback.analyse && <p className="tc-feedback-text">{feedback.analyse}</p>}
            {feedback.rawFeedback && <p className="tc-feedback-text">{feedback.rawFeedback}</p>}
            {feedback.tips && feedback.tips.length > 0 && (
              <ul className="tc-feedback-list">
                {feedback.tips.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            )}
            <div className="tc-actionbar">
              <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={() => askFeedback(true)} disabled={askingFeedback}>
                {askingFeedback ? <Loader2 className="spin" size={13} /> : <RefreshCw size={13} />} Opnieuw beoordelen
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, unit }) {
  return (
    <div className="tc-detail-stat">
      <span className="tc-detail-stat-label">{label}</span>
      <span className="tc-detail-stat-value">{value}</span>
      {unit && <span className="tc-detail-stat-unit">{unit}</span>}
    </div>
  );
}
