import { useState } from "react";
import { Loader2, Route } from "lucide-react";
import * as api from "../../api/client";
import { toDateStr, formatDateNL } from "../../lib/calculations";

/**
 * Het blokplan in de planning zelf.
 *
 * Eerst stond het als los overzicht boven de planning, en dan lees je twee
 * planningen: de lange lijn bovenaan en de dagen eronder. Nu staat elke week
 * van het blokplan als kop boven de dagen van die week, zodat je bij het
 * doorbladeren ziet in welke fase je zit en wat de bedoeling van de week is.
 */
export const BLOKPLAN_VRAAG =
  "Maak een blokplan voor de komende 8 à 12 weken, of tot mijn eerstvolgende evenement, " +
  "en plan de komende week concreet in volgens dat blokplan.";

export function maandagVan(datumStr) {
  const d = new Date(datumStr + "T00:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toDateStr(d);
}

function faseSoort(fase) {
  const f = String(fase || "").toLowerCase();
  if (/herstel|rust|deload|licht/.test(f)) return "herstel";
  if (/taper|afbouw/.test(f)) return "taper";
  if (/piek|wedstrijd|race|evenement/.test(f)) return "piek";
  return "opbouw";
}

/** De kop boven de dagen van één week. */
export function WeekKop({ week, huidig }) {
  const cijfers = [
    week.cardioUren != null ? `${String(week.cardioUren).replace(".", ",")} u` : null,
    week.krachtSessies != null ? `${week.krachtSessies}× kracht` : null,
  ].filter(Boolean).join(" · ");
  return (
    <div className={"tc-blok-week" + (huidig ? " tc-blok-nu" : "")}>
      <div className="tc-blok-head">
        <span className="tc-blok-datum tc-mono">week {formatDateNL(week.weekVan)}</span>
        <span className={"tc-blok-fase tc-blok-fase-" + faseSoort(week.fase)}>{week.fase}</span>
        {cijfers && <span className="tc-blok-cijfers tc-mono">{cijfers}</span>}
      </div>
      {week.focus && <span className="tc-blok-focus">{week.focus}</span>}
      {week.kernsessies?.length > 0 && <span className="tc-blok-kern">{week.kernsessies.join(" · ")}</span>}
      {huidig && week.toelichting && <span className="tc-blok-toelichting">{week.toelichting}</span>}
    </div>
  );
}

/** Knop om de coach het blokplan te laten maken of opnieuw op te zetten. */
export function BlokplanKnop({ heeftPlan, onKlaar, onFout }) {
  const [bezig, setBezig] = useState(false);
  async function maak() {
    setBezig(true);
    try {
      const entry = await api.askCoach(BLOKPLAN_VRAAG);
      if (entry?.id) await api.createPlanFromCoach(entry.id);
      await onKlaar?.();
    } catch (e) {
      onFout?.(e.message);
    } finally {
      setBezig(false);
    }
  }
  return (
    <button className="tc-btn tc-btn-ghost tc-btn-sm" disabled={bezig} onClick={maak}
      title={heeftPlan ? "Laat de coach het blokplan opnieuw opzetten" : "Laat de coach 8 à 12 weken vooruit een lijn uitzetten"}>
      {bezig ? <Loader2 className="spin" size={14} /> : <Route size={14} />}
      {bezig ? " De coach is bezig…" : heeftPlan ? " Blokplan opnieuw opzetten" : " Maak een blokplan"}
    </button>
  );
}
