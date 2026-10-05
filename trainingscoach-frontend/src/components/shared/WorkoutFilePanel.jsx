import { useState } from "react";
import { Download, FileCog, Loader2 } from "lucide-react";
import * as api from "../../api/client";

/**
 * Een geplande training als bestand voor de indoortrainer.
 *
 * Twee gevallen. Ligt er een blokkenstructuur (de coach leverde hem mee, of je
 * hebt hem eerder goedgekeurd), dan staan de blokken er en kun je downloaden.
 * Is er alleen een omschrijving, dan kun je er blokken van laten maken — maar
 * die worden eerst getoond, en pas opgeslagen als je ze bevestigt.
 *
 * Die tussenstap is het hele punt. Een bestand dat net iets anders voorschrijft
 * dan er in je planning staat merk je pas halverwege het tweede interval, en
 * dan ben je de training kwijt.
 */
export default function WorkoutFilePanel({ plan, onChanged }) {
  const [voorstel, setVoorstel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [melding, setMelding] = useState(null);
  const [fout, setFout] = useState(null);

  const blokken = plan.structuur || null;

  async function omzetten() {
    setBusy(true);
    setFout(null);
    setMelding(null);
    try {
      const r = await api.derivePlannedStructure(plan.id);
      setVoorstel(r);
    } catch (err) {
      setFout(err.message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Vastleggen, en meteen het bestand ophalen.
   *
   * Eén handeling in plaats van twee: je staat met je tablet naast de trainer
   * en wil rijden, niet eerst bevestigen en dan nog een knop zoeken.
   */
  async function bevestigen({ download = false } = {}) {
    setBusy(true);
    setFout(null);
    try {
      await api.savePlannedStructure(plan.id, voorstel.blokken, "coach-omzetting");
      setVoorstel(null);
      if (onChanged) await onChanged();
      if (download) {
        window.location.href = api.workoutFileUrl(plan.id, "zwo");
        setMelding("Vastgelegd en gedownload — importeer in ROUVY via Workouts → Add your own workout.");
      } else {
        setMelding("Blokken vastgelegd.");
      }
    } catch (err) {
      setFout(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function wissen() {
    setBusy(true);
    setFout(null);
    try {
      await api.savePlannedStructure(plan.id, null);
      setMelding("Blokken verwijderd.");
      if (onChanged) await onChanged();
    } catch (err) {
      setFout(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tc-workoutfile">
      {blokken ? (
        <>
          <span className="tc-workoutfile-title">
            <FileCog size={12} /> Trainingsbestand
            {plan.structuurBron === "coach" && <span className="tc-hint-badge">van de coach</span>}
          </span>
          <ol className="tc-workoutfile-blocks">
            {blokken.map((b, i) => (
              <li key={i}>{beschrijfBlok(b)}</li>
            ))}
          </ol>
          {/* Echte links, geen knoppen met ophaalcode erachter. Op een tablet
              of telefoon laat die laatste het nogal eens afweten, en juist daar
              gebruik je dit — naast de trainer. Nu doet de browser het zelf en
              biedt iOS meteen "openen in ROUVY" aan. */}
          <div className="tc-actionbar" style={{ gap: 6 }}>
            <a className="tc-btn tc-btn-cardio tc-btn-sm" href={api.workoutFileUrl(plan.id, "zwo")} download>
              <Download size={13} /> Download .zwo
            </a>
            <a className="tc-btn tc-btn-ghost tc-btn-sm" href={api.workoutFileUrl(plan.id, "erg")} download
              title="In watt — gebruikt je FTP">.erg</a>
            <a className="tc-btn tc-btn-ghost tc-btn-sm" href={api.workoutFileUrl(plan.id, "mrc")} download
              title="In procenten van je FTP">.mrc</a>
            <button className="tc-btn tc-btn-ghost tc-btn-sm" disabled={busy} onClick={wissen}>
              Blokken wissen
            </button>
          </div>
          <p className="tc-import-help" style={{ margin: "6px 0 0" }}>
            Importeren in ROUVY: Workouts → Add your own workout → Import from file.
          </p>
        </>
      ) : voorstel ? (
        <>
          <span className="tc-workoutfile-title">
            <FileCog size={12} /> Voorstel — nog niet opgeslagen
          </span>
          {voorstel.toelichting && <p className="tc-import-help" style={{ margin: "4px 0" }}>{voorstel.toelichting}</p>}
          <ol className="tc-workoutfile-blocks">
            {voorstel.blokken.map((b, i) => (
              <li key={i}>{beschrijfBlok(b)}</li>
            ))}
          </ol>
          <p className="tc-import-help" style={{ margin: "4px 0" }}>
            Totaal {voorstel.samenvatting?.totaalMinuten ?? "?"} minuten. Klopt dit met je planning?
          </p>
          <div className="tc-actionbar" style={{ gap: 6 }}>
            <button className="tc-btn tc-btn-cardio tc-btn-sm" disabled={busy}
              onClick={() => bevestigen({ download: true })}>
              <Download size={13} /> Kloppen — vastleggen en downloaden
            </button>
            <button className="tc-btn tc-btn-ghost tc-btn-sm" disabled={busy} onClick={() => bevestigen()}>
              Alleen vastleggen
            </button>
            <button className="tc-btn tc-btn-ghost tc-btn-sm" disabled={busy} onClick={() => setVoorstel(null)}>
              Weggooien
            </button>
          </div>
        </>
      ) : (
        <div className="tc-actionbar" style={{ gap: 6 }}>
          <button className="tc-btn tc-btn-ghost tc-btn-sm" disabled={busy} onClick={omzetten}
            title="Zet de omschrijving om in blokken voor je slimme trainer">
            {busy ? <Loader2 size={13} className="tc-spin" /> : <FileCog size={13} />}
            {busy ? "Bezig…" : "Maak een trainingsbestand"}
          </button>
        </div>
      )}

      {melding && <p className="tc-import-help" style={{ margin: "4px 0 0", color: "var(--cardio)" }}>{melding}</p>}
      {fout && <p className="tc-warning-box" style={{ margin: "6px 0 0" }}>{fout}</p>}
    </div>
  );
}

const SOORT_LABELS = {
  warmup: "Warm-up",
  duur: "Duurblok",
  interval: "Intervallen",
  herstel: "Herstel",
  cooldown: "Uitrijden",
  vrij: "Vrij rijden",
};

/** Dezelfde regels als de server genereert, maar zonder er een call voor te doen. */
function beschrijfBlok(b) {
  if (b.soort === "interval") {
    return `${b.herhalingen}x ${b.aanMinuten} min op ${b.aanPctFtp}% FTP, ${b.uitMinuten} min op ${b.uitPctFtp}%`;
  }
  if (b.soort === "vrij") {
    return `${b.minuten} min vrij rijden`;
  }
  if (b.pctFtpTot && b.pctFtpTot !== b.pctFtp) {
    return `${SOORT_LABELS[b.soort]} ${b.minuten} min van ${b.pctFtp}% naar ${b.pctFtpTot}% FTP`;
  }
  return `${SOORT_LABELS[b.soort]} ${b.minuten} min op ${b.pctFtp}% FTP`;
}
