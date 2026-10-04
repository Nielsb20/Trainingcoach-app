import { useState, useEffect } from "react";
import { Bike, Loader2 } from "lucide-react";
import * as api from "../../api/client";
import { CARDIO_SUB_TYPES } from "../../lib/calculations";

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
  const [bezig, setBezig] = useState(null);
  const [melding, setMelding] = useState(null);
  const [fout, setFout] = useState(null);

  async function load() {
    try {
      setData(await api.getStravaGear());
    } catch (err) {
      setFout(err.message);
    }
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

  // Niets te koppelen is niets te tonen. Een leeg kopje met de mededeling dat
  // er geen fietsen zijn is ruis op een scherm waar al genoeg staat.
  if (!data.materiaal.length) return null;

  return (
    <div style={{ marginTop: 8 }}>
      <span className="tc-workoutfile-title">
        <Bike size={12} /> Welke fiets is welke ondergrond
      </span>
      <p className="tc-import-help" style={{ margin: "4px 0 8px" }}>
        Hang hier één keer een ondergrond aan elke fiets. Dat wordt meteen op al je eerdere ritten met
        die fiets toegepast, en geldt daarna vanzelf voor nieuwe ritten — betrouwbaarder dan het
        sporttype, want een kale "Ride" in Strava zegt niets over waar je reed.
      </p>

      <table className="tc-table">
        <thead>
          <tr><th>Fiets</th><th>Ritten</th><th>Ondergrond</th></tr>
        </thead>
        <tbody>
          {data.materiaal.map((g) => (
            <tr key={g.id}>
              <td>
                {g.naam}
                {!g.inStrava && (
                  <span className="tc-hint-badge" style={{ marginLeft: 6 }}>niet meer in Strava</span>
                )}
              </td>
              <td className="tc-mono">{g.aantalRitten || "–"}</td>
              <td>
                <select
                  className="tc-input"
                  style={{ width: "auto" }}
                  value={g.ondergrond || ""}
                  disabled={bezig === g.id}
                  onChange={(e) => koppel(g.id, e.target.value)}
                >
                  <option value="">Niet toegewezen</option>
                  {CARDIO_SUB_TYPES.map((s) => (
                    <option key={s.id} value={s.id}>{s.naam} ({s.sport})</option>
                  ))}
                </select>
                {bezig === g.id && <Loader2 className="spin" size={13} style={{ marginLeft: 6 }} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.zonderMateriaal > 0 && (
        <p className="tc-import-help" style={{ marginTop: 6 }}>
          {data.zonderMateriaal} fietssessies hebben geen fiets in Strava. Die blijven op "niet
          opgegeven" staan tenzij je ze per sessie instelt — of je hangt er in Strava alsnog een fiets
          aan en werkt je historie bij.
        </p>
      )}
      {melding && <p className="tc-import-help" style={{ color: "var(--cardio)" }}>{melding}</p>}
      {fout && <p className="tc-warning-box">{fout}</p>}
    </div>
  );
}
