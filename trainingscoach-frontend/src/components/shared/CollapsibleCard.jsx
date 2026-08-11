import { useState } from "react";
import { ChevronRight } from "lucide-react";

/**
 * A card that folds away.
 *
 * Several screens open with a form you rarely need — the manual weight entry
 * next to a chart of eight months of measurements, the CSV importer next to
 * your ride history. Reading the page meant scrolling past the input first.
 *
 * The open/closed state is remembered per card in localStorage, so this is a
 * choice you make once rather than on every visit. A browser that refuses
 * storage (private mode, cleared settings) just falls back to the default —
 * worth catching, since an exception here would take the whole tab down.
 */
export default function CollapsibleCard({ id, title, subtitle, badge, defaultOpen = false, className = "", children }) {
  const storageKey = `tc-open-${id}`;

  const [open, setOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored === null ? defaultOpen : stored === "1";
    } catch {
      return defaultOpen;
    }
  });

  function toggle() {
    setOpen((wasOpen) => {
      const next = !wasOpen;
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        /* not being able to remember it is not a reason to refuse the click */
      }
      return next;
    });
  }

  return (
    <div className={"tc-card tc-collapsible" + (className ? ` ${className}` : "")}>
      <button className="tc-collapsible-head" onClick={toggle} aria-expanded={open}>
        <ChevronRight size={15} className={"tc-collapsible-chevron" + (open ? " open" : "")} />
        <span className="tc-ex-name">{title}</span>
        {subtitle && !open && <span className="tc-collapsible-subtitle">{subtitle}</span>}
        <span className="tc-feedback-spacer" />
        {badge}
      </button>
      {open && <div className="tc-collapsible-body">{children}</div>}
    </div>
  );
}
