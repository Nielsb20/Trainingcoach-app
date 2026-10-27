import Sparkline from "./Sparkline";
import { formatDateNL, todayStr } from "../../lib/calculations";

/** Eén tegel per herstelwaarde: de laatste nacht, het verschil met normaal, en het verloop. */
export default function HerstelTegels({ overzicht, compact = false }) {
  const vannacht = overzicht.datum === todayStr();
  return (
    <div className="tc-recovery">
      <p className="tc-recovery-caption">
        {vannacht ? "Vannacht" : `Laatste meting (${formatDateNL(overzicht.datum)})`} vergeleken met je normale bereik
      </p>
      <div className={"tc-recovery-grid" + (compact ? " tc-recovery-compact" : "")}>
        {overzicht.tegels.map((t) => (
          <div key={t.id} className={"tc-recovery-tile" + (t.afwijkend ? " tc-recovery-flag" : "")}>
            <span className="tc-recovery-label">{t.label}</span>
            <span className="tc-recovery-value">
              <span className="tc-mono">{t.waarde}</span>
              {t.eenheid && <span className="tc-recovery-unit">{t.eenheid}</span>}
            </span>
            <span className="tc-recovery-diff">{t.verschil}</span>
            {!compact && (
              <Sparkline values={t.reeks} band={t.band}
                color={t.afwijkend ? "var(--strength)" : "var(--cardio)"} />
            )}
          </div>
        ))}
      </div>
      {!compact && <p className="tc-recovery-legend"><span className="tc-recovery-swatch" /> grijze band = jouw normale bereik (laatste 4 weken)</p>}
    </div>
  );
}
