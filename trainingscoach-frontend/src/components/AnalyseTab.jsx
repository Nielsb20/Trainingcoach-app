import { useState, useEffect } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { Loader2 } from "lucide-react";
import * as api from "../api/client";

// One colour per zone, cool (easy) to warm (hard), so the stacked bars read
// as intensity at a glance.
const ZONE_COLORS = ["#4FA8A0", "#5B8FBF", "#8C86C9", "#C97A3F", "#B85C5C", "#8C4A4A", "#6B3A3A"];

function formatMinutes(min) {
  if (!min) return "0m";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}u ${m}m` : `${m}m`;
}

/**
 * Zone distribution and power curve.
 *
 * Rendered inside the Geschiedenis tab as its "Analyse" subtab, hence
 * `embedded`: there it sits under that tab's own title and a second <h1>
 * would just repeat the tab name back at you.
 */
export default function AnalyseTab({ embedded = false }) {
  const [sub, setSub] = useState("zones");
  return (
    <div>
      {!embedded && <h1 className="tc-title">Analyse</h1>}
      <div className="tc-subtabs">
        <button className={"tc-subtab" + (sub === "zones" ? " active-cardio" : "")} onClick={() => setSub("zones")}>
          Zoneverdeling
        </button>
        <button className={"tc-subtab" + (sub === "power" ? " active-event" : "")} onClick={() => setSub("power")}>
          Vermogenscurve
        </button>
      </div>

      {sub === "zones" && <ZoneDistribution />}
      {sub === "power" && <PowerCurve />}
    </div>
  );
}

/* ------------------------------ zones ---------------------------------- */

function ZoneDistribution() {
  const [metric, setMetric] = useState("hr");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    api
      .getZoneDistribution(12, metric)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [metric]);

  if (loading) return <Loading />;
  if (error) return <div className="tc-error"><span>{error}</span></div>;

  return (
    <div>
      <p className="tc-sub" style={{ marginTop: -8 }}>
        Hoeveel tijd je per week in elke zone doorbracht. Voor gepolariseerd trainen wil je veel in
        zone 1–2 en een kleiner deel in zone 4–5, met relatief weinig in het middengebied.
      </p>

      <div className="tc-subtabs">
        <button className={"tc-subtab" + (metric === "hr" ? " active-strength" : "")} onClick={() => setMetric("hr")}>
          Hartslag
        </button>
        <button className={"tc-subtab" + (metric === "power" ? " active-event" : "")} onClick={() => setMetric("power")}>
          Vermogen
        </button>
      </div>

      {!data.available && (
        <div className="tc-empty">
          <p>{data.reason || "Nog geen gegevens met zone-informatie."}</p>
          {data.zones && (
            <p className="tc-empty-hint">
              Zones zijn ingesteld, maar er zijn nog geen sessies met detaildata. Synchroniseer met Strava —
              die data wordt bij het importeren berekend.
            </p>
          )}
        </div>
      )}

      {data.available && (
        <>
          <div className="tc-chiprow">
            {data.zones.map((z, i) => (
              <span key={z.zone} className="tc-hint-badge" style={{ background: ZONE_COLORS[i] + "22", color: ZONE_COLORS[i] }}>
                Z{z.zone} {z.naam} · {z.van}{z.tot ? `–${z.tot}` : "+"}
              </span>
            ))}
          </div>

          <div className="tc-chart-wrap">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.weken.map((w) => {
                const row = { week: w.week.replace(/^\d+-/, "") };
                w.zones.forEach((z) => { row[`Z${z.zone}`] = z.minuten; });
                return row;
              })}>
                <CartesianGrid stroke="#2E363D" strokeDasharray="3 3" />
                <XAxis dataKey="week" stroke="#8B949B" fontSize={11} />
                <YAxis stroke="#8B949B" fontSize={12} unit="m" />
                <Tooltip
                  contentStyle={{ background: "#1C2227", border: "1px solid #2E363D", color: "#E8E6E1" }}
                  formatter={(value, name) => [formatMinutes(value), name]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {data.zones.map((z, i) => (
                  <Bar key={z.zone} dataKey={`Z${z.zone}`} stackId="a" fill={ZONE_COLORS[i]} name={`Z${z.zone} ${z.naam}`} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <p className="tc-import-help">
            Gebaseerd op {data.sessiesMetData} van {data.totaalSessies} sessies — alleen sessies met
            gedetailleerde data tellen mee. Pas je je max. hartslag of FTP aan, dan worden alle weken
            automatisch opnieuw ingedeeld.
          </p>
        </>
      )}
    </div>
  );
}

/* --------------------------- power curve -------------------------------- */

function PowerCurve() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getPowerCurve(90).then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;
  if (error) return <div className="tc-error"><span>{error}</span></div>;
  if (!data.available) return <div className="tc-empty"><p>{data.reason}</p></div>;

  return (
    <div>
      <p className="tc-sub" style={{ marginTop: -8 }}>
        Je beste gemiddelde vermogen over elke tijdsduur. De korte kant zegt iets over je sprint, de
        lange kant over je duurvermogen. Ligt de recente lijn onder je aller-tijden lijn, dan heb je
        die inspanning simpelweg nog niet geleverd in deze periode — dat is niet per se vormverlies.
      </p>

      <div className="tc-chiprow">
        <span className="tc-hint-badge tc-badge-cardio">{data.sessies} sessies met vermogensdata</span>
        {data.ftpSchatting && (
          <span className="tc-hint-badge tc-badge-event">
            Geschatte FTP: {data.ftpSchatting.ftp} W ({data.ftpSchatting.basis})
          </span>
        )}
        {data.ingevuldeFtp && (
          <span className="tc-hint-badge tc-badge-strength">Ingevulde FTP: {data.ingevuldeFtp} W</span>
        )}
      </div>

      {data.ftpSchatting && data.ingevuldeFtp && Math.abs(data.ftpSchatting.ftp - data.ingevuldeFtp) > 15 && (
        <div className="tc-warning-box">
          Je ingevulde FTP ({data.ingevuldeFtp} W) wijkt af van wat je vermogensdata suggereert
          ({data.ftpSchatting.ftp} W). Overweeg de waarde bij Schema → Persoonlijk profiel bij te werken —
          die voedt ook je vermogenszones en de TSS-berekening.
        </div>
      )}

      <div className="tc-chart-wrap">
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data.punten}>
            <CartesianGrid stroke="#2E363D" strokeDasharray="3 3" />
            <XAxis dataKey="label" stroke="#8B949B" fontSize={12} />
            <YAxis stroke="#8B949B" fontSize={12} unit="W" />
            <Tooltip contentStyle={{ background: "#1C2227", border: "1px solid #2E363D", color: "#E8E6E1" }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="altijd" stroke="#8C86C9" strokeWidth={2} dot={{ r: 3 }} name="Beste ooit" connectNulls />
            <Line type="monotone" dataKey="recent" stroke="#4FA8A0" strokeWidth={2} dot={{ r: 3 }} name={`Laatste ${data.dagenRecent} dagen`} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <table className="tc-table">
        <thead><tr><th>Duur</th><th>Beste ooit</th><th>Recent</th><th>W/kg (ooit)</th></tr></thead>
        <tbody>
          {data.punten.map((p) => (
            <tr key={p.duurSeconden}>
              <td className="tc-mono">{p.label}</td>
              <td className="tc-mono">{p.altijd ? `${p.altijd} W` : "–"}</td>
              <td className="tc-mono">{p.recent ? `${p.recent} W` : "–"}</td>
              <td className="tc-mono">{p.altijdWattPerKg ? `${p.altijdWattPerKg}` : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Loading() {
  return (
    <div className="tc-import-help" style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Loader2 className="spin" size={15} /> Laden…
    </div>
  );
}
