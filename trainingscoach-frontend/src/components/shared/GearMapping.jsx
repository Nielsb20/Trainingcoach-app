import { useState, useEffect } from "react";
import { Bike, Loader2 } from "lucide-react";
import * as api from "../../api/client";
import { BIKE_TYPES } from "../../lib/calculations";

/**
 * Je fietsen uit Strava, elk met de ondergrond die eraan hangt.
 *
 * Dit is de betrouwbare weg naar het fietstype. Strava's sporttype is in het
 * beste geval een aanwijzing — een kale "Ride" zegt niets, en dat is precies
 * wat de meeste mensen laten staan. Welke fiets je aan een rit hangt is geen
 * gissing maar een registratie.
 *
 * Eén keer aanwijzen, en het geldt meteen voor elke rit op die fiets. Dat
 * laatste is waarom dit de moeite waard is: anders zou je jaren geschiedenis
 * rit voor rit moeten labelen.
 */
export default function GearMapping() {
  const [data, setData] = useState(null);
  const [betekenis, setBetekenis] = useState(null);
  const [bezig, setBezig] = useState(null);
  const [melding, setMelding] = useState(null);
  const [fout, setFout] = useState(null);

  async function load() {
    try {
      const [gear, meaning] = await Promise.all([
        api.getStravaGear(),
        api.getStravaSportTypeMeaning(),
      ]);
      setData(gear);
      setBetekenis(meaning.betekenis);
    } catch (err) {
      setFout(err.message);
    }
  }

  async function kiesBetekenis(nieuwe) {
    setBezig("betekenis");
    setFout(null);
    setMelding(null);
    try {
      await api.setStravaSportTypeMeaning(nieuwe);
      setBetekenis(nieuwe);
      setMelding("Opgeslagen. Geldt vanaf de volgende synchronisatie; wat er al ligt verandert niet vanzelf.");
    } catch (err) {
      setFout(err.message);
    } finally {
      setBezig(null);
    }
  }

  /**
   * De keuze die bepaalt hoe het sporttype gelezen wordt.
   *
   * Staat boven de fietsenlijst omdat hij bepaalt of die lijst er überhaupt
   * toe doet: kies je op ondergrond, dan is de koppeling de enige bron voor
   * welke fiets het was.
   */
  function betekenisKeuze() {
    if (!betekenis) return null;
    return (
      <div className="tc-inline-note" style={{ marginTop: 8 }}>
        <p style={{ margin: "0 0 6px" }}>
          <strong>Hoe kies je je profiel in Garmin?</strong> Dat bepaalt wat het sporttype dat Strava
          doorgeeft betekent, en dat kan de app niet raden.
        </p>
        <label style={{ display: "block", marginBottom: 4 }}>
          <input type="radio" name="sporttype-betekenis" value="fiets" checked={betekenis === "fiets"}
            disabled={bezig === "betekenis"} onChange={() => kiesBetekenis("fiets")} />{" "}
          <strong>Op de fiets waar ik op zit.</strong> "Mountainbiken" betekent dan: dit was de
          mountainbike, waar ik ook reed. De ondergrond blijft onbekend.
        </label>
        <label style={{ display: "block" }}>
          <input type="radio" name="sporttype-betekenis" value="ondergrond" checked={betekenis === "ondergrond"}
            disabled={bezig === "betekenis"} onChange={() => kiesBetekenis("ondergrond")} />{" "}
          <strong>Op waar ik rijd.</strong> "Mountainbiken" betekent dan het bos en "Wegfietsen"
          asfalt. Welke fiets eronder zat komt dan uit de lijst hieronder — vul die dus in.
        </label>
      </div>
    );
  }

  useEffect(() => {
    load();
  }, []);

  async function koppel(id, ondergrond) {
    setBezig(id);
    setFout(null);
    setMelding(null);
    try {
      const r = await api.setStravaGearSubType(id, ondergrond || null);
      setMelding(
        r.bijgewerkt > 0
          ? `${r.bijgewerkt} eerdere ${r.bijgewerkt === 1 ? "sessie" : "sessies"} meteen bijgewerkt.`
          : "Vastgelegd. Geldt voor ritten die hierna binnenkomen."
      );
      await load();
    } catch (err) {
      setFout(err.message);
    } finally {
      setBezig(null);
    }
  }

  if (!data) {
    return (
      <p className="tc-import-help" style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <Loader2 className="spin" size={14} /> Materiaal ophalen…
      </p>
    );
  }

  // Een lege lijst zonder uitleg is de slechtste uitkomst: je ziet niets en
  // weet niet of het stuk is of gewoon leeg. Vlak na een update is leeg juist
  // het normale geval, want ritten die eerder zijn geïmporteerd dragen nog
  // geen fiets — die moet eerst bijgewerkt worden.
  if (!data.materiaal.length) {
    return (
      <div style={{ marginTop: 8 }}>
        {betekenisKeuze()}
        <span className="tc-workoutfile-title" style={{ marginTop: 10, display: "flex" }}>
          <Bike size={12} /> Wat voor fiets is dit
        </span>
        <p className="tc-import-help" style={{ margin: "4px 0" }}>
          Nog geen fietsen bekend.{" "}
          {data.verouderd > 0 ? (
            <>
              Je ritten zijn geïmporteerd voordat de fiets werd bewaard. Klik hierboven op
              <strong> Analysedata bijwerken</strong> — er staan er <strong>{data.verouderd}</strong> klaar.
              Zodra de eerste ritten zijn bijgewerkt verschijnen je fietsen hier vanzelf.
            </>
          ) : (
            <>
              Ze verschijnen zodra je een rit synchroniseert waar in Strava een fiets aan hangt. Staat er
              in Strava geen fiets onder je ritten, dan is daar niets uit te halen; zet de ondergrond dan
              per sessie in het detailscherm.
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 8 }}>
      {betekenisKeuze()}
      <span className="tc-workoutfile-title" style={{ marginTop: 10, display: "flex" }}>
        <Bike size={12} /> Wat voor fiets is dit
      </span>
      <p className="tc-import-help" style={{ margin: "4px 0 8px" }}>
        Zeg hier één keer wat voor fiets elke Strava-fiets is. Dat wordt meteen op al je eerdere ritten
        met die fiets toegepast en geldt daarna vanzelf voor nieuwe — betrouwbaarder dan het sporttype,
        want een kale "Ride" in Strava zegt niets. <strong>Niet</strong> waar je reed: dezelfde
        mountainbike gaat 's zomers het bos in en 's winters over de weg, dus de ondergrond staat per
        sessie.
      </p>

      <table className="tc-table">
        <thead>
          <tr><th>Materiaal in Strava</th><th>Sessies</th><th>Wat voor fiets</th></tr>
        </thead>
        <tbody>
          {data.materiaal.map((g) => (
            <tr key={g.id}>
              <td>{g.naam}</td>
              <td className="tc-mono">{g.aantalRitten || "–"}</td>
              <td>
                {/* Schoenen staan in dezelfde Strava-lijst als fietsen. Een
                    paar hardloopschoenen een fietstype laten kiezen is onzin
                    die bovendien niets doet, want de koppeling raakt alleen
                    fietssessies. Dus hier geen keuzelijst. */}
                {g.sport === "Hardlopen" ? (
                  <span className="tc-import-help">hardloopschoenen — geen fietstype</span>
                ) : (
                  <>
                    <select
                      className="tc-input"
                      style={{ width: "auto" }}
                      value={g.fiets || ""}
                      disabled={bezig === g.id}
                      onChange={(e) => koppel(g.id, e.target.value)}
                    >
                      <option value="">Niet toegewezen</option>
                      {BIKE_TYPES.map((s) => (
                        <option key={s.id} value={s.id}>{s.naam}</option>
                      ))}
                    </select>
                    {bezig === g.id && <Loader2 className="spin" size={13} style={{ marginLeft: 6 }} />}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.zonderMateriaal > 0 && <ZonderMateriaal data={data} />}
      {melding && <p className="tc-import-help" style={{ color: "var(--cardio)" }}>{melding}</p>}
      {fout && <p className="tc-warning-box">{fout}</p>}
    </div>
  );
}

/**
 * De ritten waar geen materiaal onder hangt, met de reden erbij.
 *
 * Of er iets aan te doen is hangt af van waar ze vandaan komen. Een rit die
 * via de Strava-API binnenkwam kan opnieuw opgehaald worden en krijgt dan
 * alsnog zijn fiets. Een rit uit een CSV-archief of een GPX-bestand niet: in
 * die bestanden staat geen materiaal, punt. Dat verschil onbenoemd laten
 * levert iemand op die blijft klikken op een knop die niets kan doen.
 */
function ZonderMateriaal({ data }) {
  const perBron = data.zonderMateriaalPerBron || [];
  const uitStrava = perBron
    .filter((b) => String(b.source || "").startsWith("strava"))
    .reduce((n, b) => n + b.aantal, 0);
  const anders = perBron.filter((b) => !String(b.source || "").startsWith("strava"));

  return (
    <p className="tc-import-help" style={{ marginTop: 6 }}>
      <strong>{data.zonderMateriaal} fietssessies hebben geen materiaal uit Strava.</strong>{" "}
      {uitStrava > 0 && (
        <>
          Daarvan kwamen er {uitStrava} via Strava binnen; die kun je opnieuw laten ophalen met
          "Analysedata bijwerken" hierboven, mits er in Strava wél een fiets onder hangt.{" "}
        </>
      )}
      {anders.length > 0 && (
        <>
          De overige {anders.reduce((n, b) => n + b.aantal, 0)} komen uit een import
          ({anders.map((b) => `${b.source}: ${b.aantal}`).join(", ")}). In een CSV-export of een
          GPX-bestand staat geen materiaal, dus daar valt langs deze weg niets te halen — die stel je
          per sessie in, of je laat ze leeg.
        </>
      )}
    </p>
  );
}
