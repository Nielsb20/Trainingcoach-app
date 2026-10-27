/**
 * Herstel in één oogopslag: per meetwaarde de laatste nacht tegen je eigen
 * normale bereik.
 *
 * De hersteltab had één grafiek met zes lijnen op twee assen. Daar stond alles
 * in, maar "is vannacht afwijkend?" kon je er niet uit aflezen zonder de
 * legenda te ontcijferen. Een tegel per waarde met een band voor wat normaal
 * is voor jóu beantwoordt die vraag direct, en Vandaag gebruikt dezelfde
 * uitkomst voor de melding bovenaan.
 *
 * De drempels zijn die van de coach (zie coachPrompt en de signaaldetectie op
 * de server): één nacht telt bij een forse uitschieter, een kleinere afwijking
 * pas als het weekgemiddelde hem ook laat zien. Zo zegt het scherm hetzelfde
 * als het advies.
 */

const BASIS_DAGEN = 28;
const MIN_BASIS = 5;

const gemiddelde = (v) => v.reduce((a, b) => a + b, 0) / v.length;
function spreiding(v) {
  if (v.length < 2) return 0;
  const m = gemiddelde(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}
const afgerond = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/** 437 -> "7u17" */
export const minutenAlsDuur = (min) =>
  min === null || min === undefined ? "–" : `${Math.floor(min / 60)}u${String(Math.round(min % 60)).padStart(2, "0")}`;

const METRIEKEN = [
  {
    id: "hartslag",
    // De nachtwaarde als het apparaat die levert: die ligt vast zodra je
    // wakker bent, de dagwaarde zakt nog als je een uur stilzit.
    veld: (logs) => (logs.some((l) => l.sleepingHr != null) ? "sleepingHr" : "restingHr"),
    label: (veld) => (veld === "sleepingHr" ? "Nachthartslag" : "Rusthartslag"),
    eenheid: "bpm",
    richting: "hoger",
    signaal: ({ laatste, basis, week }) => laatste >= basis + 10 || (week !== null && week >= basis + 5),
    verschil: ({ laatste, basis }) => {
      const d = Math.round(laatste - basis);
      return d === 0 ? "gelijk aan normaal" : `${d > 0 ? "+" : "−"}${Math.abs(d)} t.o.v. normaal`;
    },
  },
  {
    id: "hrv",
    veld: () => "hrvMs",
    label: () => "HRV",
    eenheid: "ms",
    richting: "lager",
    signaal: ({ laatste, basis, week }) => laatste <= basis * 0.8 || (week !== null && week <= basis * 0.9),
    verschil: ({ laatste, basis }) => {
      const pct = Math.round(((laatste - basis) / basis) * 100);
      return pct === 0 ? "gelijk aan normaal" : `${pct > 0 ? "+" : "−"}${Math.abs(pct)}% t.o.v. ${Math.round(basis)}`;
    },
  },
  {
    id: "slaap",
    veld: () => "sleepMinutes",
    label: () => "Slaap",
    eenheid: "",
    richting: "lager",
    formatteer: minutenAlsDuur,
    signaal: ({ laatste, basis, sd }) => sd > 0 && laatste < basis - 1.5 * sd,
    verschil: ({ laatste, basis }) => {
      const d = Math.round(laatste - basis);
      if (Math.abs(d) < 10) return "normaal";
      return `${d > 0 ? "+" : "−"}${minutenAlsDuur(Math.abs(d))} t.o.v. normaal`;
    },
  },
  {
    id: "bodybattery",
    veld: () => "bodyBatteryMax",
    label: () => "Body battery",
    eenheid: "max",
    richting: "lager",
    signaal: ({ laatste, basis, sd }) => sd > 0 && laatste < basis - 1.5 * sd,
    verschil: ({ laatste, basis }) => {
      const d = Math.round(laatste - basis);
      return Math.abs(d) < 3 ? "normaal" : `${d > 0 ? "+" : "−"}${Math.abs(d)} t.o.v. normaal`;
    },
  },
];

/**
 * @param {Array} logs  herstellogs, in willekeurige volgorde
 * @returns {{datum: string, tegels: Array, signalen: Array}|null}
 */
export function herstelOverzicht(logs) {
  if (!Array.isArray(logs) || logs.length === 0) return null;
  const oplopend = [...logs].sort((a, b) => (a.date > b.date ? 1 : -1));

  const tegels = [];
  for (const m of METRIEKEN) {
    const veld = m.veld(oplopend);
    const metWaarde = oplopend.filter((l) => l[veld] !== null && l[veld] !== undefined);
    if (metWaarde.length < MIN_BASIS + 1) continue;

    const laatsteLog = metWaarde[metWaarde.length - 1];
    const basisReeks = metWaarde.slice(-(BASIS_DAGEN + 1), -1).map((l) => l[veld]);
    if (basisReeks.length < MIN_BASIS) continue;
    const laatste = laatsteLog[veld];
    const basis = gemiddelde(basisReeks);
    const sd = spreiding(basisReeks);
    const weekReeks = metWaarde.slice(-7).map((l) => l[veld]);
    const week = weekReeks.length >= 3 ? gemiddelde(weekReeks) : null;
    const ctx = { laatste, basis, sd, week };

    tegels.push({
      id: m.id,
      label: m.label(veld),
      eenheid: m.eenheid,
      datum: laatsteLog.date,
      waarde: m.formatteer ? m.formatteer(laatste) : String(afgerond(laatste, 0)),
      verschil: m.verschil(ctx),
      afwijkend: m.signaal(ctx),
      basis: afgerond(basis),
      // De band rond je normaal: ± één standaardafwijking, en minstens een
      // beetje breed zodat een heel stabiele reeks geen streep wordt.
      band: [basis - Math.max(sd, basis * 0.02), basis + Math.max(sd, basis * 0.02)],
      reeks: metWaarde.slice(-30).map((l) => l[veld]),
    });
  }
  if (tegels.length === 0) return null;

  return {
    datum: tegels.map((t) => t.datum).sort().at(-1),
    tegels,
    signalen: tegels.filter((t) => t.afwijkend),
  };
}
