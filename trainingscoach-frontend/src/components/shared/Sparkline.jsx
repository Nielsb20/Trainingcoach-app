/**
 * Een kleine lijn met een grijze band voor je normale bereik.
 *
 * Bewust zonder assen of labels: de tegel eromheen geeft het getal, de lijn
 * geeft alleen het verloop en of het laatste punt buiten de band valt.
 */
export default function Sparkline({ values, band, color = "var(--cardio)", height = 36 }) {
  const punten = (values || []).filter((v) => v !== null && v !== undefined);
  if (punten.length < 2) return null;

  const alles = band ? [...punten, ...band] : punten;
  const min = Math.min(...alles);
  const max = Math.max(...alles);
  const bereik = max - min || 1;
  // Een beetje lucht boven en onder, anders plakt de lijn tegen de rand.
  const y = (v) => 3 + (1 - (v - min) / bereik) * (height - 6);
  const x = (i) => (i / (punten.length - 1)) * 100;

  return (
    <svg className="tc-sparkline" width="100%" height={height} viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none" aria-hidden="true">
      {band && (
        <rect x="0" y={y(band[1])} width="100" height={Math.max(1, y(band[0]) - y(band[1]))} fill="var(--border)" />
      )}
      <polyline
        points={punten.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
        fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke"
        strokeLinejoin="round" strokeLinecap="round"
      />
    </svg>
  );
}
