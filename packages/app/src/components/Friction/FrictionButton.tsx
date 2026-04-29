import { useEffect } from "react";
import { MessageSquareDashed } from "lucide-react";
import {
  toggleFrictionComposer,
  useAppState,
  type FrictionMode,
} from "../../store/app";

/**
 * Floating bottom-right entry point. Visually demoted in 13.M — the primary
 * trigger is now ⌘⇧F, and the button itself is intentionally smaller and
 * lower-contrast than 13.K's accent-fill armed state. It exists as the
 * discoverable affordance for users who don't yet know the shortcut.
 *
 * Click → opens the composer (typed-sentence path). Selection mode is now
 * an opt-in step inside the composer.
 *
 * Keyboard: ⌘⇧F is bound here so the global shortcut works even when the
 * widget/overlay are unmounted.
 */
export function FrictionButton() {
  const mode: FrictionMode = useAppState((s) => s.frictionMode);
  const dialog = useAppState((s) => s.dialog);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        toggleFrictionComposer();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Hidden while a modal scrim is open — friction is inert in those states
  // (the store's toggle action also bails, but hiding the button avoids a
  // dead affordance the user can click but won't react).
  if (dialog !== null) return null;

  const active = mode !== "off";
  return (
    <button
      type="button"
      className="friction-button"
      data-component="FrictionButton"
      data-active={active ? "true" : "false"}
      aria-pressed={active}
      aria-label={active ? "Close friction" : "Capture friction"}
      title={active ? "Close (⌘⇧F or ESC)" : "Capture friction (⌘⇧F)"}
      onClick={toggleFrictionComposer}
    >
      <MessageSquareDashed size={14} strokeWidth={1.4} aria-hidden="true" />
    </button>
  );
}
