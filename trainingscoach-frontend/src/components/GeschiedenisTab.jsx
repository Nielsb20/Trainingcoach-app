import { useState, useEffect, useMemo, Fragment } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { TrendingUp, Search, Pencil } from "lucide-react";
import ConfirmDeleteButton from "./shared/ConfirmDeleteButton";
import {
  formatDateNL, timeOfDayLabel, computeAvgSpeedKmh, computeHrZones,
  computeTrainingLoadSeries, getWeightAtDate, computeSessionRpe, computeWeeklyStrengthLoad,
} from "../lib/calculations";
import WorkoutLogEditor from "./WorkoutLogEditor";

export default function GeschiedenisTab({ schema, workoutLogs, cardioLogs, weightLogs, updateWorkoutLog, deleteWorkoutLog, deleteCardioLog, onOpenSession }) {
  const [sub, setSub] = useState("kracht");
  const [expandedProfileId, setExpandedProfileId] = useState(null);
  const [isolatedSeries, setIsolatedSeries] = useState(null);
  const [editingLogId, setEditingLogId] = useState(null);

  function toggleProfile(id) {
    setExpandedProfileId((prev) => (prev === id ? null : id));
    setIsolatedSeries(null);
  }

  function handleLegendClick(e) {
    setIsolatedSeries((prev) => (prev === e.dataKey ? null : e.dataKey));
  }

  function seriesOpacity(dataKey) {
    return isolatedSeries === null || isolatedSeries === dataKey ? 1 : 0;
  }
  const allExerciseNames = useMemo(() => {
    const names = new Set();
    schema.days.forEach((d) => d.exercises.forEach((e) => e.name && names.add(e.name)));
    workoutLogs.forEach((l) => l.exercises.forEach((e) => names.add(e.name)));
    return Array.from(names);
  }, [schema, workoutLogs]);
  const [selectedEx, setSelectedEx] = useState(allExerciseNames[0] || "");

  useEffect(() => {
    if (!selectedEx && allExerciseNames.length) setSelectedEx(allExerciseNames[0]);
  }, [allExerciseNames]);

  const exChartData = useMemo(() => {
    return workoutLogs
      .filter((l) => l.exercises.some((e) => e.name === selectedEx))
      .map((l) => {
        const ex = l.exercises.find((e) => e.name === selectedEx);
        const maxWeight = Math.max(...ex.sets.map((s) => s.weight));
        return { date: l.date, label: formatDateNL(l.date), maxWeight };
      })
      .sort((a, b) => (a.date > b.date ? 1 : -1));
  }, [workoutLogs, selectedEx]);

  const cardioChartData = useMemo(() => {
    return [...cardioLogs]
      .sort((a, b) => (a.date > b.date ? 1 : -1))
      .map((c) => ({ date: c.date, label: formatDateNL(c.date), distance: c.distance_km || 0, duration: c.duration_min || 0 }));
  }, [cardioLogs]);

  const hrZonesForTss = schema.profile?.maxHr ? computeHrZones(schema.profile.maxHr, schema.profile.restingHr) : null;
  const trainingLoadSeries = useMemo(
    () => computeTrainingLoadSeries(cardioLogs, schema.profile?.ftp, hrZonesForTss),
    [cardioLogs, schema.profile?.ftp, schema.profile?.maxHr, schema.profile?.restingHr]
  );
  const latestLoad = trainingLoadSeries ? trainingLoadSeries[trainingLoadSeries.length - 1] : null;
  const recentLoadSeries = trainingLoadSeries ? trainingLoadSeries.slice(-90) : null;

  // Strength load lives on its own scale (sRPE, not TSS) and so gets its own
  // chart rather than a second line on the PMC — mixing the two units would
  // suggest a relationship the numbers don't have.
  const weeklyStrengthLoad = useMemo(() => computeWeeklyStrengthLoad(workoutLogs, 12), [workoutLogs]);
  const strengthLoadWeeks = weeklyStrengthLoad?.filter((w) => w.sRpe !== null) || [];
  const thisWeekSRpe = strengthLoadWeeks.length ? strengthLoadWeeks[strengthLoadWeeks.length - 1] : null;
  const prevWeekSRpe = strengthLoadWeeks.length > 1 ? strengthLoadWeeks[strengthLoadWeeks.length - 2] : null;
  const sRpeChangePct =
    thisWeekSRpe && prevWeekSRpe && prevWeekSRpe.sRpe > 0
      ? Math.round(((thisWeekSRpe.sRpe - prevWeekSRpe.sRpe) / prevWeekSRpe.sRpe) * 100)
      : null;
  // Sessions logged without RPE/duration are invisible in the load numbers;
  // say so explicitly rather than letting them read as rest.
  const unratedSessions = workoutLogs.filter((l) => computeSessionRpe(l) === null).length;

  const editingLog = editingLogId ? workoutLogs.find((l) => l.id === editingLogId) : null;

  return (
    <div>
      <h1 className="tc-title">Geschiedenis &amp; progressie</h1>
      <div className="tc-subtabs">
        <button className={"tc-subtab" + (sub === "kracht" ? " active-strength" : "")} onClick={() => setSub("kracht")}>Kracht</button>
        <button className={"tc-subtab" + (sub === "cardio" ? " active-cardio" : "")} onClick={() => setSub("cardio")}>Cardio</button>
        <button className={"tc-subtab" + (sub === "belasting" ? " active-event" : "")} onClick={() => setSub("belasting")}>Belasting</button>
      </div>

      {sub === "kracht" && (
        <div>
          {allExerciseNames.length === 0 ? (
            <div className="tc-empty"><p>Nog geen krachtdata gelogd.</p></div>
          ) : (
            <>
              <select className="tc-input tc-select-inline" value={selectedEx} onChange={(e) => setSelectedEx(e.target.value)}>
                {allExerciseNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <div className="tc-chart-wrap">
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={exChartData}>
                    <CartesianGrid stroke="#2E363D" strokeDasharray="3 3" />
                    <XAxis dataKey="label" stroke="#8B949B" fontSize={12} />
                    <YAxis stroke="#8B949B" fontSize={12} unit="kg" />
                    <Tooltip contentStyle={{ background: "#1C2227", border: "1px solid #2E363D", color: "#E8E6E1" }} />
                    <Line type="monotone" dataKey="maxWeight" stroke="#C97A3F" strokeWidth={2} dot={{ fill: "#C97A3F", r: 3 }} name="Max gewicht (kg)" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <table className="tc-table">
                <thead><tr><th>Datum</th><th>Moment</th><th>Sets</th><th>Duur</th><th>RPE</th><th>sRPE</th><th></th><th></th></tr></thead>
                <tbody>
                  {workoutLogs.filter((l) => l.exercises.some((e) => e.name === selectedEx)).map((l) => {
                    const ex = l.exercises.find((e) => e.name === selectedEx);
                    const sRpe = computeSessionRpe(l);
                    return (
                      <tr key={l.id}>
                        <td>{formatDateNL(l.date)}</td>
                        <td>{l.timeOfDay ? timeOfDayLabel(l.timeOfDay) : "–"}</td>
                        <td className="tc-mono">{ex.sets.map((s) => `${s.weight}×${s.reps}`).join(", ")}</td>
                        <td className="tc-mono">{l.durationMin ? `${l.durationMin} min` : "–"}</td>
                        <td className="tc-mono">{l.rpe ?? "–"}</td>
                        <td className="tc-mono">{sRpe ?? "–"}</td>
                        <td>
                          <button className="tc-icon-btn" title="Deze training bewerken"
                            onClick={() => setEditingLogId(l.id)}>
                            <Pencil size={14} />
                          </button>
                        </td>
                        <td><ConfirmDeleteButton onConfirm={() => deleteWorkoutLog(l.id)} title="Deze training verwijderen" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="tc-import-help">
                Klik op het potlood om een gelogde training te corrigeren — gewichten, herhalingen, duur, RPE en datum.
              </p>
            </>
          )}
        </div>
      )}

      {sub === "cardio" && (
        <div>
          {cardioLogs.length === 0 ? (
            <div className="tc-empty"><p>Nog geen cardiodata gelogd.</p></div>
          ) : (
            <>
              <div className="tc-chart-wrap">
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={cardioChartData}>
                    <CartesianGrid stroke="#2E363D" strokeDasharray="3 3" />
                    <XAxis dataKey="label" stroke="#8B949B" fontSize={12} />
                    <YAxis stroke="#8B949B" fontSize={12} />
                    <Tooltip contentStyle={{ background: "#1C2227", border: "1px solid #2E363D", color: "#E8E6E1" }} />
                    <Line type="monotone" dataKey="distance" stroke="#4FA8A0" strokeWidth={2} dot={{ fill: "#4FA8A0", r: 3 }} name="Afstand (km)" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <table className="tc-table">
                <thead><tr><th>Datum</th><th>Moment</th><th>Type</th><th>Duur</th><th>Afstand</th><th>Gem./Max HR</th><th>Snelheid</th><th>Vermogen</th><th>Cadans</th><th>Hoogte</th><th></th><th></th></tr></thead>
                <tbody>
                  {cardioLogs.map((c) => (
                    <Fragment key={c.id}>
                      <tr>
                        <td>{formatDateNL(c.date)}</td>
                        <td>{c.timeOfDay ? timeOfDayLabel(c.timeOfDay) : "–"}</td>
                        <td>{c.type}</td>
                        <td className="tc-mono">
                          {c.duration_min ? `${c.duration_min} min` : "–"}
                          {c.total_duration_min && c.total_duration_min > c.duration_min ? ` (${c.total_duration_min})` : ""}
                        </td>
                        <td className="tc-mono">{c.distance_km ? `${c.distance_km} km` : "–"}</td>
                        <td className="tc-mono">{c.avg_hr ? `${c.avg_hr}` : "–"}{c.max_hr ? ` / ${c.max_hr} bpm` : (c.avg_hr ? " bpm" : "")}</td>
                        <td className="tc-mono">{computeAvgSpeedKmh(c.distance_km, c.duration_min) ? `${computeAvgSpeedKmh(c.distance_km, c.duration_min)} km/u` : "–"}</td>
                        <td className="tc-mono">
                          {c.avg_power ? `${c.avg_power}` : "–"}{c.max_power ? ` / ${c.max_power} W` : (c.avg_power ? " W" : "")}
                          {c.weighted_avg_power ? ` (NP ${c.weighted_avg_power})` : ""}
                          {c.avg_power && getWeightAtDate(weightLogs, c.date) ? ` · ${(c.avg_power / getWeightAtDate(weightLogs, c.date)).toFixed(1)} W/kg` : ""}
                        </td>
                        <td className="tc-mono">{c.avg_cadence ? `${c.avg_cadence}` : "–"}{c.max_cadence ? ` / ${c.max_cadence}` : ""}</td>
                        <td className="tc-mono">{c.elevation_gain_m ? `↑${c.elevation_gain_m}m` : "–"}{c.elevation_loss_m ? ` ↓${c.elevation_loss_m}m` : ""}</td>
                        <td>
                          <button className="tc-icon-btn" title="Analyse en beoordeling"
                            onClick={() => onOpenSession && onOpenSession(c.id)}>
                            <Search size={14} />
                          </button>
                          {c.profile && c.profile.length > 0 && (
                            <button className="tc-icon-btn" title="Toon verloop" onClick={() => toggleProfile(c.id)}>
                              <TrendingUp size={14} />
                            </button>
                          )}
                        </td>
                        <td><ConfirmDeleteButton onConfirm={() => deleteCardioLog(c.id)} title="Deze sessie verwijderen" /></td>
                      </tr>
                      {expandedProfileId === c.id && c.profile && (
                        <tr>
                          <td colSpan={12}>
                            <div className="tc-chart-wrap" style={{ marginTop: 8, marginBottom: 8 }}>
                              <ResponsiveContainer width="100%" height={200}>
                                <LineChart data={c.profile}>
                                  <CartesianGrid stroke="#2E363D" strokeDasharray="3 3" />
                                  <XAxis dataKey="tMin" stroke="#8B949B" fontSize={12} unit="m" />
                                  <YAxis yAxisId="hr" stroke="#C97A3F" fontSize={12} domain={["auto", "auto"]} />
                                  <YAxis yAxisId="speed" orientation="right" stroke="#4FA8A0" fontSize={12} domain={["auto", "auto"]} />
                                  {c.avg_power != null && (
                                    <YAxis yAxisId="power" orientation="right" stroke="#8C86C9" fontSize={12} domain={["auto", "auto"]} />
                                  )}
                                  {c.avg_cadence != null && <YAxis yAxisId="cadence" hide domain={["auto", "auto"]} />}
                                  {c.elevation_gain_m != null && <YAxis yAxisId="elevation" hide domain={["auto", "auto"]} />}
                                  <Tooltip contentStyle={{ background: "#1C2227", border: "1px solid #2E363D", color: "#E8E6E1" }} />
                                  <Legend
                                    wrapperStyle={{ fontSize: 12, cursor: "pointer" }}
                                    onClick={handleLegendClick}
                                    formatter={(value, entry) => (
                                      <span style={{ opacity: seriesOpacity(entry.dataKey) === 0 ? 0.4 : 1 }}>{value}</span>
                                    )}
                                  />
                                  <Line yAxisId="hr" type="monotone" dataKey="gemHartslag" stroke="#C97A3F" strokeWidth={2} strokeOpacity={seriesOpacity("gemHartslag")} dot={false} name="Hartslag (bpm)" connectNulls />
                                  <Line yAxisId="speed" type="monotone" dataKey="gemSnelheidKmu" stroke="#4FA8A0" strokeWidth={2} strokeOpacity={seriesOpacity("gemSnelheidKmu")} dot={false} name="Snelheid (km/u)" connectNulls />
                                  {c.avg_power != null && (
                                    <Line yAxisId="power" type="monotone" dataKey="gemVermogen" stroke="#8C86C9" strokeWidth={2} strokeOpacity={seriesOpacity("gemVermogen")} dot={false} name="Vermogen (W)" connectNulls />
                                  )}
                                  {c.avg_cadence != null && (
                                    <Line yAxisId="cadence" type="monotone" dataKey="gemCadans" stroke="#7FA65C" strokeWidth={2} strokeOpacity={seriesOpacity("gemCadans")} dot={false} strokeDasharray="4 3" name="Cadans" connectNulls />
                                  )}
                                  {c.elevation_gain_m != null && (
                                    <Line yAxisId="elevation" type="monotone" dataKey="hoogte" stroke="#D4A843" strokeWidth={2} strokeOpacity={seriesOpacity("hoogte")} dot={false} strokeDasharray="2 2" name="Hoogte (m)" connectNulls />
                                  )}
                                </LineChart>
                              </ResponsiveContainer>
                            </div>
                            <p className="tc-import-help" style={{ marginTop: 0 }}>
                              Klik op een naam in de legenda om alleen die lijn te tonen — nogmaals klikken toont ze weer allemaal.
                            </p>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {sub === "belasting" && (
        <div>
          <h2 className="tc-section-title">Cardio — Performance Management Chart</h2>
          {!schema.profile?.ftp && !schema.profile?.maxHr ? (
            <div className="tc-empty">
              <p>Vul je FTP en/of max. hartslag in bij Schema → Persoonlijk profiel om trainingsbelasting (TSS/CTL/ATL) te berekenen.</p>
            </div>
          ) : !trainingLoadSeries ? (
            <div className="tc-empty"><p>Nog geen cardiodata om belasting uit te berekenen.</p></div>
          ) : (
            <>
              <p className="tc-sub" style={{ marginTop: -8 }}>
                CTL (Fitness), ATL (Vermoeidheid) en TSB (Vorm) — hetzelfde Performance Management Chart-model als TrainingPeaks/WKO, puur berekend uit je sessies, niet door de AI geschat.
              </p>
              <div className="tc-chiprow">
                <span className="tc-hint-badge tc-badge-event">CTL (Fitness): {latestLoad.ctl}</span>
                <span className="tc-hint-badge tc-badge-cardio">ATL (Vermoeidheid): {latestLoad.atl}</span>
                <span className={"tc-hint-badge " + (latestLoad.tsb < -10 ? "tc-badge-warning" : "tc-badge-strength")}>TSB (Vorm): {latestLoad.tsb > 0 ? "+" : ""}{latestLoad.tsb}</span>
              </div>
              <div className="tc-chart-wrap">
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={recentLoadSeries}>
                    <CartesianGrid stroke="#2E363D" strokeDasharray="3 3" />
                    <XAxis dataKey="label" stroke="#8B949B" fontSize={11} interval={Math.max(1, Math.floor(recentLoadSeries.length / 8))} />
                    <YAxis stroke="#8B949B" fontSize={12} />
                    <Tooltip contentStyle={{ background: "#1C2227", border: "1px solid #2E363D", color: "#E8E6E1" }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="ctl" stroke="#8C86C9" strokeWidth={2} dot={false} name="CTL (Fitness)" />
                    <Line type="monotone" dataKey="atl" stroke="#4FA8A0" strokeWidth={2} dot={false} name="ATL (Vermoeidheid)" />
                    <Line type="monotone" dataKey="tsb" stroke="#C97A3F" strokeWidth={2} dot={false} name="TSB (Vorm)" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="tc-import-help">
                Vuistregel: TSB rond 0 = in balans, sterk negatief (onder -20/-30) = hoog vermoeidheidsrisico, sterk positief = uitgerust/getaperd (goed vóór een wedstrijd, maar te lang te positief kan op detraining wijzen).
                {!schema.profile?.ftp && " Zonder FTP is dit een schatting op basis van hartslag, minder nauwkeurig dan met vermogensdata."}
              </p>
            </>
          )}

          <h2 className="tc-section-title" style={{ marginTop: 32 }}>Kracht — weekbelasting (sRPE)</h2>
          {!weeklyStrengthLoad ? (
            <div className="tc-empty"><p>Nog geen krachttraining gelogd.</p></div>
          ) : strengthLoadWeeks.length === 0 ? (
            <div className="tc-empty">
              <p>
                Je hebt {workoutLogs.length} krachtsessie{workoutLogs.length === 1 ? "" : "s"} gelogd, maar zonder duur en RPE.
                Vul die bij het loggen in — of corrigeer ze via het potlood in de Kracht-tab — om je krachtbelasting te zien.
              </p>
            </div>
          ) : (
            <>
              <p className="tc-sub" style={{ marginTop: -8 }}>
                sRPE = duur × RPE, per week opgeteld. Dit is de gymtegenhanger van de grafiek hierboven: krachttraining
                zit bewust niet in CTL/ATL/TSB, omdat daar geen vermogensmeter voor is en de eenheden niet vergelijkbaar zijn.
              </p>
              <div className="tc-chiprow">
                <span className="tc-hint-badge tc-badge-strength">Deze week: {thisWeekSRpe.sRpe} sRPE</span>
                {prevWeekSRpe && <span className="tc-hint-badge tc-badge-event">Vorige week: {prevWeekSRpe.sRpe} sRPE</span>}
                {sRpeChangePct !== null && (
                  <span className={"tc-hint-badge " + (sRpeChangePct > 30 ? "tc-badge-warning" : "tc-badge-cardio")}>
                    {sRpeChangePct > 0 ? "+" : ""}{sRpeChangePct}% t.o.v. vorige week
                  </span>
                )}
              </div>
              <div className="tc-chart-wrap">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={weeklyStrengthLoad}>
                    <CartesianGrid stroke="#2E363D" strokeDasharray="3 3" />
                    <XAxis dataKey="label" stroke="#8B949B" fontSize={11} />
                    <YAxis stroke="#8B949B" fontSize={12} />
                    <Tooltip
                      contentStyle={{ background: "#1C2227", border: "1px solid #2E363D", color: "#E8E6E1" }}
                      formatter={(value, name, entry) => [
                        `${value} sRPE (${entry.payload.sessionsRated} van ${entry.payload.sessions} sessies beoordeeld)`,
                        "Weekbelasting",
                      ]}
                      labelFormatter={(label) => `Week van ${label}`}
                    />
                    <Bar dataKey="sRpe" fill="#C97A3F" name="Weekbelasting (sRPE)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="tc-import-help">
                Vuistregel: een stijging van meer dan ongeveer 30% ten opzichte van de week ervoor is een flinke sprong —
                nuttig als je bewust opbouwt, maar reden om cardio die week wat rustiger te plannen.
                {unratedSessions > 0 && ` ${unratedSessions} sessie${unratedSessions === 1 ? "" : "s"} zonder duur of RPE tellen hier niet in mee.`}
              </p>
            </>
          )}
        </div>
      )}

      {editingLog && (
        <WorkoutLogEditor
          log={editingLog}
          schema={schema}
          onSave={updateWorkoutLog}
          onClose={() => setEditingLogId(null)}
        />
      )}
    </div>
  );
}
