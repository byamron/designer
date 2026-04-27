import { useEffect } from "react";
import { MessageSquareDashed } from "lucide-react";
import {
  toggleFrictionSelecting,
  useAppState,
  type FrictionMode,
} from "../../store/app";

/**
 * Floating bottom-right button that arms selection mode. Persistent toggle:
 * `aria-pressed="true"` + accent fill while armed. Locked surface per spec
 * (`core-docs/roadmap.md` § Track 13.K → "Floating button"). Bottom-right
 * is reserved for Friction; the dev panel now lives bottom-left.
 *
 * Keyboard: ⌘⇧F (handled here so the binding isn't lost when
 * SelectionOverlay/FrictionWidget unmount).
 */
export function FrictionButton() {
  const mode: FrictionMode = useAppState((s) => s.frictionMode);
  const dialog = useAppState((s) => s.dialog);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        toggleFrictionSelecting();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Hidden while a modal scrim is open — friction is inert in those states
  // (the store's toggle action also bails, but hiding the button avoids a
  // dead affordance the user can click but won't react).
  if (dialog !== null) return null;

  const armed = mode !== "off";
  return (
    <button
      type="button"
      className="friction-button"
      data-component="FrictionButton"
      data-armed={armed ? "true" : "false"}
      aria-pressed={armed}
      aria-label={armed ? "Cancel friction capture" : "Capture friction"}
      title={
        armed
          ? "Cancel (⌘⇧F or click outside)"
          : "Capture friction (⌘⇧F)"
      }
      onClick={toggleFrictionSelecting}
    >
      <MessageSquareDashed size={18} strokeWidth={1.6} aria-hidden="true" />
    </button>
  );
}
