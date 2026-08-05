import { useState, useEffect, useRef } from "react";
import { Trash2 } from "lucide-react";

/**
 * A delete button that asks first.
 *
 * Deleting a logged session is irreversible — there is no undo and no soft
 * delete — so a single stray tap must not be enough, especially with an edit
 * button sitting right next to it in the history tables.
 *
 * The two-step confirm (rather than window.confirm) matches the pattern the
 * coach feedback cards already use, and reverts on its own after a few seconds
 * so a half-finished tap doesn't leave a primed delete button lying around.
 */
export default function ConfirmDeleteButton({ onConfirm, label = "Verwijderen?", title = "Verwijderen" }) {
  const [confirming, setConfirming] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    if (!confirming) return;
    timer.current = setTimeout(() => setConfirming(false), 5000);
    return () => clearTimeout(timer.current);
  }, [confirming]);

  if (!confirming) {
    return (
      <button className="tc-icon-btn" title={title} onClick={() => setConfirming(true)}>
        <Trash2 size={14} />
      </button>
    );
  }

  return (
    <span className="tc-confirm-row">
      <span>{label}</span>
      <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={() => { clearTimeout(timer.current); onConfirm(); }}>
        Ja
      </button>
      <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={() => setConfirming(false)}>
        Nee
      </button>
    </span>
  );
}
