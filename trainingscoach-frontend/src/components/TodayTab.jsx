import { useState, useEffect, useMemo } from "react";
import { Dumbbell, Activity, Flag, ChevronRight, Loader2 } from "lucide-react";
import * as api from "../api/client";
import HerstelTegels from "./shared/HerstelTegels";
import { herstelOverzicht } from "../lib/recovery";
import {
  todayStr, toDateStr, formatDateNL, daysUntil, computeHrZones, computeTrainingLoadSeries,
} from "../lib/calculations";

/**
 * Vandaag: het scherm waar de app opent.
 *
 * Wat je op een gewone dag wilt weten stond verspreid over vier tabbladen:
 * de training van vandaag in Planning, je herstel onder Herstel, wat de coach
 * zei onder Coach en je vorm onder Geschiedenis → Belasting. Hier staat van
 * elk het deel dat je vandaag nodig hebt, met één tik naar het hele verhaal.
 */
const WEEKDAG_KORT = ["ma", "di", "wo", "do", "vr", "za", "zo"];

function maandagVan(datumStr) {
  const d = new Date(datumStr + "T00:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

export default function TodayTab({ schema, cardioLogs, events, coachHistory, onNavigate, onStartStrength }) {
  const vandaag = todayStr();
  const [planning, setPlanning] = useState(null);
  const [herstel, setHerstel] = useState(null);
  const [laden, setLaden] = useState(true);

  const week = useMemo(() => {
    const ma = maandagVan(vandaag);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(ma);
      d.setDate(ma.getDate() + i);
      return toDateStr(d);
    });
  }, [vandaag]);

  useEffect(() => {
    let weg = false;
    // Los van elkaar: valt de herstelopslag weg, dan moet de training van
    // vandaag er nog steeds staan, en andersom.
    Promise.allSettled([
      api.getPlannedRange(week[0], week[6]),
      api.getWellnessLogs(40),
    ]).then(([p, w]) => {
      if (weg) return;
      setPlanning(p.status === "fulfilled" ? p.value : null);
      setHerstel(w.status === "fulfilled" ? herstelOverzicht(w.value) : null);
      setLaden(false);
    });
    return () => { weg = true; };
  }, [week]);

  const plans = (planning?.plans || []).filter((p) => p.status !== "afgewezen");
  const vandaagGepland = plans.filter((p) => p.date === vandaag && p.status !== "voorgesteld");
  const voorstellen = plans.filter((p) => p.status === "voorgesteld").length;
  const krachtGelogdVandaag = (planning?.krachttrainingen || []).filter((s) => s.date === vandaag);

  const belasting = useMemo(() => {
    const p = schema.profile || {};
    const zones = p.maxHr ? computeHrZones(p.maxHr, p.restingHr) : null;
    const reeks = computeTrainingLoadSeries(cardioLogs, p.ftp, zones, p.thresholdPaceSecPerKm ?? null);
    if (!reeks || reeks.length === 0) return null;
    const nu = reeks[reeks.length - 1];
    const vier = reeks.length > 28 ? reeks[reeks.length - 29] : null;
    return { ...nu, ctlDelta: vier ? Math.round((nu.ctl - vier.ctl) * 10) / 10 : null };
  }, [cardioLogs, schema.profile]);

  const coach = coachHistory && coachHistory[0];
  const volgendEvenement = (events || [])
    .filter((e) => daysUntil(e.date) >= 0)
    .sort((a, b) => (a.date > b.date ? 1 : -1))[0];

  const vorm = belasting
    ? belasting.tsb < -30 ? "zwaar belast" : belasting.tsb < -10 ? "productief" : belasting.tsb <= 5 ? "in balans" : "fris"
    : null;

  const datumKop = new Date(vandaag + "T00:00:00").toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="tc-today">
      <p className="tc-today-date">{datumKop}</p>
      <h1 className="tc-title">Vandaag</h1>

      {herstel && herstel.signalen.length > 0 && (
        <button className="tc-today-alert" onClick={() => onNavigate("voortgang", "herstel")}>
          <span className="tc-today-alert-dot" aria-hidden="true" />
          <span>
            <strong>Herstel: doe vandaag rustig aan</strong>
            <span className="tc-today-alert-text">
              {herstel.signalen.map((t) => `${t.label} ${t.waarde}${t.eenheid && t.eenheid !== "max" ? " " + t.eenheid : ""} (${t.verschil})`).join(" · ")}
            </span>
          </span>
        </button>
      )}

      {laden ? (
        <div className="tc-import-help" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Loader2 className="spin" size={15} /> Laden…
        </div>
      ) : (
        <TrainingVanVandaag
          sessies={vandaagGepland}
          krachtGelogd={krachtGelogdVandaag}
          onStartStrength={onStartStrength}
          onNavigate={onNavigate}
        />
      )}

      {voorstellen > 0 && (
        <button className="tc-today-row tc-today-proposals" onClick={() => onNavigate("planning")}>
          <span><strong>{voorstellen} voorstel{voorstellen === 1 ? "" : "len"} van de coach</strong> wacht{voorstellen === 1 ? "" : "en"} op je in de planning</span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      )}

      {belasting && (
        <button className="tc-today-stats" onClick={() => onNavigate("voortgang", "belasting")}
          aria-label={`Fitheid ${Math.round(belasting.ctl)}, vermoeidheid ${Math.round(belasting.atl)}, vorm ${Math.round(belasting.tsb)}: open de belasting`}>
          <span className="tc-today-stat">
            <span className="tc-today-stat-label">Fitheid</span>
            <span className="tc-today-stat-value tc-mono">{Math.round(belasting.ctl)}</span>
            <span className="tc-today-stat-sub">
              {belasting.ctlDelta === null ? "CTL" : `${belasting.ctlDelta >= 0 ? "+" : "−"}${Math.abs(belasting.ctlDelta)} in 4 wk`}
            </span>
          </span>
          <span className="tc-today-stat">
            <span className="tc-today-stat-label">Vermoeidheid</span>
            <span className="tc-today-stat-value tc-mono">{Math.round(belasting.atl)}</span>
            <span className="tc-today-stat-sub">ATL, 7 dagen</span>
          </span>
          <span className="tc-today-stat">
            <span className="tc-today-stat-label">Vorm</span>
            <span className="tc-today-stat-value tc-mono">{belasting.tsb > 0 ? "+" : ""}{Math.round(belasting.tsb)}</span>
            <span className="tc-today-stat-sub">{vorm}</span>
          </span>
        </button>
      )}

      {herstel && (
        <button className="tc-today-block" onClick={() => onNavigate("voortgang", "herstel")}
          aria-label="Herstel van vannacht, open het overzicht">
          <HerstelTegels overzicht={herstel} compact />
        </button>
      )}

      {coach && (coach.analyse || coach.rawFeedback) && (
        <button className="tc-today-card tc-today-coach" onClick={() => onNavigate("coach")}>
          <span className="tc-today-card-head">
            <span className="tc-today-card-title">Coach</span>
            <span className="tc-today-meta tc-mono">{formatDateNL(coach.date.slice(0, 10))}</span>
          </span>
          <span className="tc-today-coach-text">{coach.analyse || coach.rawFeedback}</span>
          {coach.tips && coach.tips.length > 0 && (
            <span className="tc-today-link">Hele advies en {coach.tips.length} tip{coach.tips.length === 1 ? "" : "s"}</span>
          )}
        </button>
      )}

      {volgendEvenement && (
        <button className="tc-today-row" onClick={() => onNavigate("instellingen", "evenementen")}>
          <span className="tc-today-event">
            <Flag size={15} style={{ color: "var(--event)" }} aria-hidden="true" />
            <span>
              <strong>{volgendEvenement.name}</strong>
              <span className="tc-today-meta">
                {formatDateNL(volgendEvenement.date)}{volgendEvenement.target ? ` · doel ${volgendEvenement.target}` : ""}
              </span>
            </span>
          </span>
          <span className="tc-today-countdown">
            <span className="tc-mono">{daysUntil(volgendEvenement.date)}</span>
            <span className="tc-today-meta">dagen</span>
          </span>
        </button>
      )}

      <WeekStrook week={week} vandaag={vandaag} plans={plans} planning={planning} cardioLogs={cardioLogs}
        onClick={() => onNavigate("planning")} />
    </div>
  );
}

function TrainingVanVandaag({ sessies, krachtGelogd, onStartStrength, onNavigate }) {
  if (sessies.length === 0 && krachtGelogd.length === 0) {
    return (
      <div className="tc-today-card tc-today-session">
        <span className="tc-today-meta">NIETS GEPLAND</span>
        <span className="tc-today-session-title">Rustdag</span>
        <button className="tc-btn tc-btn-ghost" onClick={() => onNavigate("planning")}>Naar de planning</button>
      </div>
    );
  }
  return (
    <>
      {sessies.map((p) => {
        const kracht = p.discipline === "kracht";
        const gedaan = p.status === "gedaan" || (kracht && krachtGelogd.length > 0);
        const doelen = kracht && Array.isArray(p.krachtDoelen) ? p.krachtDoelen : null;
        // Kracht opent het loggen (met de gewichten van de coach al ingevuld),
        // gedane kracht de voortgang, cardio de planning waar het bestand staat.
        const open = kracht
          ? (gedaan ? () => onNavigate("voortgang", "kracht") : onStartStrength)
          : () => onNavigate("planning");
        return (
          <div className="tc-today-card tc-today-session" key={p.id}>
            <button className="tc-today-card-link" onClick={open}>
            <span className="tc-today-card-head">
              <span className="tc-today-meta tc-mono">
                {gedaan ? "GEDAAN" : "GEPLAND"}{p.timeOfDay ? ` · ${p.timeOfDay.toUpperCase()}` : ""}
              </span>
              <span className={"tc-hint-badge " + (kracht ? "tc-badge-strength" : "tc-badge-cardio")}>
                {kracht ? "KRACHT" : "CARDIO"}
              </span>
            </span>
            <span className="tc-today-session-title">
              {kracht ? <Dumbbell size={18} aria-hidden="true" /> : <Activity size={18} aria-hidden="true" />}
              {p.type}
            </span>
            {p.description && <span className="tc-today-session-desc">{p.description}</span>}
            {doelen && (
              <span className="tc-today-targets tc-mono">
                {doelen.map((d) => `${d.naam}${d.gewichtKg != null ? ` ${String(d.gewichtKg).replace(".", ",")} kg` : ""}`).join(" · ")}
              </span>
            )}
            </button>
            {kracht && !gedaan && (
              <button className="tc-btn tc-btn-strength tc-btn-lg" onClick={onStartStrength}>
                Start training
              </button>
            )}
          </div>
        );
      })}
      {sessies.length === 0 && krachtGelogd.map((k) => (
        <button className="tc-today-card tc-today-session" key={k.id} onClick={() => onNavigate("voortgang", "kracht")}>
          <span className="tc-today-meta tc-mono">GEDAAN</span>
          <span className="tc-today-session-title"><Dumbbell size={18} aria-hidden="true" />{k.dayName || "Krachttraining"}</span>
        </button>
      ))}
    </>
  );
}

function WeekStrook({ week, vandaag, plans, planning, cardioLogs, onClick }) {
  const gelogdeKracht = new Set((planning?.krachttrainingen || []).map((s) => s.date));
  const gelogdeCardio = new Set((cardioLogs || []).map((c) => c.date));
  return (
    <button className="tc-today-week" onClick={onClick} aria-label="Deze week, open de planning">
      <span className="tc-today-meta tc-mono">DEZE WEEK</span>
      <span className="tc-today-week-grid">
        {week.map((d, i) => {
          const dagPlans = plans.filter((p) => p.date === d && p.status !== "voorgesteld");
          const kracht = gelogdeKracht.has(d) || dagPlans.some((p) => p.discipline === "kracht");
          const cardio = gelogdeCardio.has(d) || dagPlans.some((p) => p.discipline !== "kracht");
          const gedaan = gelogdeKracht.has(d) || gelogdeCardio.has(d) || dagPlans.some((p) => p.status === "gedaan");
          const soort = kracht ? "kracht" : cardio ? "cardio" : "rust";
          return (
            <span key={d} className={"tc-today-day" + (d === vandaag ? " tc-today-day-now" : "")}>
              <span className="tc-today-day-name">{WEEKDAG_KORT[i]}</span>
              <span className={`tc-today-day-bar tc-bar-${soort}${gedaan ? " tc-bar-done" : ""}`} />
            </span>
          );
        })}
      </span>
    </button>
  );
}
