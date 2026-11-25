import { useState, useEffect } from "react";
import { Loader2, Route } from "lucide-react";
import * as api from "../../api/client";
import CollapsibleCard from "./CollapsibleCard";
import { todayStr, toDateStr, formatDateNL } from "../../lib/calculations";

/**
 * Het blokplan: de lange lijn van de coach, per week één regel.
 *
 * Bovenaan de planning, want het is het kader waar de concrete sessies
 * hieronder uit voortkomen. De huidige week staat open, de rest kort, zodat
 * je in één oogopslag ziet waar je in het blok zit en wat er komt.
 */
const VRAAG =
  "Maak een blokplan voor de komende 8 à 12 weken, of tot mijn eerstvolgende evenement, " +
  "en plan de komende week concreet in volgens dat blokplan.";

function maandagVan(datumStr) {
  const d = new Date(datumStr + "T00:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toDateStr(d);
}

export default function Blokplan({ onProposals }) {
  const [plan, setPlan] = useState(undefined);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState("");
  // Twaalf weken bovenaan de planning duwen de sessies van deze week van het
  // scherm. Standaard deze en volgende week; de rest op verzoek.
  const [alles, setAlles] = useState(false);

  async function laad() {
    try {
      setPlan(await api.getBlokplan());
    } catch {
      setPlan(null);
    }
  }
  useEffect(() => { laad(); }, []);

  async function maak() {
    setBezig(true);
    setFout("");
    try {
      const entry = await api.askCoach(VRAAG);
      if (entry?.id) await api.createPlanFromCoach(entry.id);
      await laad();
      onProposals?.();
    } catch (e) {
      setFout(e.message);
    } finally {
      setBezig(false);
    }
  }

  if (plan === undefined) return null;

  const dezeWeek = maandagVan(todayStr());
  const huidige = plan?.weken?.find((w) => w.weekVan === dezeWeek);
  const laatste = plan?.weken?.[plan.weken.length - 1];

  return (
    <CollapsibleCard
      id="planner-blokplan"
      title="Blokplan"
      subtitle={plan
        ? `${huidige ? huidige.fase.toLowerCase() + " · " : ""}t/m week van ${formatDateNL(laatste.weekVan)}`
        : "nog geen lange lijn"}
      defaultOpen={!!plan}
    >
      {fout && <div className="tc-error"><span>{fout}</span></div>}
      {!plan ? (
        <>
          <p className="tc-import-help">
            Laat de coach 8 à 12 weken vooruit een lijn uitzetten: per week de fase, focus, uren en
            kernsessies. Elke week vult hij daarna de concrete trainingen in en schaaft hij het blok bij.
            Zet daarvoor bij Instellingen › Automatische planning de wekelijkse planning aan.
          </p>
          <div className="tc-actionbar">
            <button className="tc-btn tc-btn-cardio" disabled={bezig} onClick={maak}>
              {bezig ? <Loader2 className="spin" size={15} /> : <Route size={15} />} Maak een blokplan
            </button>
          </div>
        </>
      ) : (
        <>
          {plan.doel && <p className="tc-import-help"><strong>Doel:</strong> {plan.doel}</p>}
          <ol className="tc-blok-list">
            {(alles ? plan.weken : plan.weken.slice(0, 2)).map((w) => {
              const nu = w.weekVan === dezeWeek;
              return (
                <li key={w.weekVan} className={"tc-blok-week" + (nu ? " tc-blok-nu" : "")}>
                  <div className="tc-blok-head">
                    <span className="tc-blok-datum tc-mono">{formatDateNL(w.weekVan)}</span>
                    <span className={"tc-blok-fase tc-blok-fase-" + faseSoort(w.fase)}>{w.fase}</span>
                    <span className="tc-blok-cijfers tc-mono">
                      {[w.cardioUren != null ? `${String(w.cardioUren).replace(".", ",")} u` : null,
                        w.krachtSessies != null ? `${w.krachtSessies}× kracht` : null].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  {w.focus && <span className="tc-blok-focus">{w.focus}</span>}
                  {w.kernsessies.length > 0 && (
                    <span className="tc-blok-kern">{w.kernsessies.join(" · ")}</span>
                  )}
                  {nu && w.toelichting && <span className="tc-blok-toelichting">{w.toelichting}</span>}
                </li>
              );
            })}
          </ol>
          {plan.weken.length > 2 && (
            <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={() => setAlles(!alles)}>
              {alles ? "Alleen deze en volgende week" : `Toon alle ${plan.weken.length} weken`}
            </button>
          )}
          <p className="tc-history-detail">
            Bijgewerkt {formatDateNL(plan.bijgewerkt.slice(0, 10))}. De wekelijkse planning schaaft dit bij;
            je kunt de coach er ook zelf om vragen.
          </p>
          <div className="tc-actionbar">
            <button className="tc-btn tc-btn-ghost tc-btn-sm" disabled={bezig} onClick={maak}>
              {bezig ? <Loader2 className="spin" size={13} /> : <Route size={13} />} Opnieuw opzetten
            </button>
          </div>
        </>
      )}
    </CollapsibleCard>
  );
}

function faseSoort(fase) {
  const f = String(fase || "").toLowerCase();
  if (/herstel|rust|deload|licht/.test(f)) return "herstel";
  if (/taper|afbouw/.test(f)) return "taper";
  if (/piek|wedstrijd|race|evenement/.test(f)) return "piek";
  return "opbouw";
}
