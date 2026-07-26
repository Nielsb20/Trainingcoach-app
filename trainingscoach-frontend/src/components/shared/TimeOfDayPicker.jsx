import { TIME_OF_DAY } from "../../lib/constants";

/**
 * Segmented control for ochtend/middag/avond. Deliberately buttons rather
 * than a <select>: three fixed options that are tapped often on a phone
 * mid-workout, so one tap beats two.
 */
export default function TimeOfDayPicker({ value, onChange }) {
  return (
    <div className="tc-tod-picker">
      {TIME_OF_DAY.map((t) => {
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            type="button"
            className={"tc-tod-btn" + (value === t.id ? " active" : "")}
            onClick={() => onChange(t.id)}
          >
            <Icon size={14} /> {t.label}
          </button>
        );
      })}
    </div>
  );
}
