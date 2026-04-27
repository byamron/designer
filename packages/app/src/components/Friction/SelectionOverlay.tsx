import { useCallback, useEffect, useRef, useState } from "react";
import { anchorFromElement, snapTarget } from "../../lib/anchor";
import {
  clearFriction,
  setFrictionAnchor,
  toggleFrictionSelecting,
  useAppState,
} from "../../store/app";

/**
 * Track 13.K SelectionOverlay — armed state visual + smart-snap.
 *
 * Renders nothing when `frictionMode !== "selecting"`. Mount/unmount on
 * armed-state transitions so the global pointer/key listeners aren't paying
 * cost in the steady state.
 *
 * Three-exit policy (locked by spec):
 *   1. ESC — toggle off via `clearFriction`.
 *   2. Click the FrictionButton again — handled by FrictionButton itself.
 *   3. Click outside any anchorable element with a 600ms grace period —
 *      grace gives the user a beat to drift over the target without
 *      losing the armed state on a stray click.
 *
 * Smart snap: hover any element, walk up to the nearest `data-component`
 * (or `role="row"|"button"|"dialog"`) ancestor and outline that. Hold Alt
 * to override and anchor to the exact hovered node.
 */
export function SelectionOverlay() {
  const mode = useAppState((s) => s.frictionMode);
  const armed = mode === "selecting";
  const [hover, setHover] = useState<{
    target: DOMRect;
    snapped: DOMRect;
    descriptor: string;
    snapText: string | null;
  } | null>(null);
  const altHeldRef = useRef(false);

  const updateHoverFromPoint = useCallback(
    (clientX: number, clientY: number) => {
      const atom = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
      if (!atom) {
        setHover(null);
        return;
      }
      // Skip our own UI so the overlay never tries to anchor to itself.
      if (atom.closest(".friction-overlay, .friction-widget, .friction-button, .friction-banner")) {
        setHover(null);
        return;
      }
      const snap = snapTarget(atom);
      const useAtom = altHeldRef.current || !snap;
      const target = useAtom ? atom : (snap as HTMLElement);
      const targetRect = target.getBoundingClientRect();
      const snappedRect = (snap ?? target).getBoundingClientRect();
      const descriptor =
        (snap as HTMLElement | null)?.getAttribute?.("data-component") ??
        (snap as HTMLElement | null)?.getAttribute?.("role") ??
        atom.tagName.toLowerCase();
      const snapText = ((snap as HTMLElement | null)?.innerText ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 60);
      setHover({
        target: targetRect,
        snapped: snappedRect,
        descriptor,
        snapText: snapText.length > 0 ? snapText : null,
      });
    },
    [],
  );

  // Capture screenshot of the snapped element BEFORE the widget covers it.
  // We use html2canvas only if available; otherwise auto-capture is null
  // and the user can paste/upload manually. Tauri's `webview.capture()`
  // would be the production path — wired in commands_friction once the
  // platform plugin is added; for now this path stays empty.
  const finalizeAnchor = useCallback(() => {
    if (!hover) return;
    const point = {
      x: hover.target.left + hover.target.width / 2,
      y: hover.target.top + hover.target.height / 2,
    };
    const el = document.elementFromPoint(point.x, point.y) as HTMLElement | null;
    if (!el) return;
    const target = altHeldRef.current ? el : (snapTarget(el) ?? el);
    const route = window.location.hash || window.location.pathname || "/";
    const anchor = anchorFromElement(target, route);
    setFrictionAnchor(anchor, null);
  }, [hover]);

  useEffect(() => {
    if (!armed) {
      setHover(null);
      return;
    }
    let pending: number | null = null;
    let lastOutside = 0;
    const onMove = (e: PointerEvent) => {
      altHeldRef.current = e.altKey;
      if (pending !== null) cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => {
        updateHoverFromPoint(e.clientX, e.clientY);
        pending = null;
      });
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest(".friction-button, .friction-overlay, .friction-banner")) {
        return; // let the button toggle off, banner ignore clicks
      }
      const atom = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      if (!atom) return;
      const snap = snapTarget(atom);
      // No anchorable element — start the 600ms grace timer to dismiss.
      if (!snap && !altHeldRef.current) {
        const now = Date.now();
        if (now - lastOutside > 600) {
          lastOutside = now;
          return;
        }
        clearFriction();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      finalizeAnchor();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        clearFriction();
      } else if (e.key === "Alt") {
        altHeldRef.current = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") altHeldRef.current = false;
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      if (pending !== null) cancelAnimationFrame(pending);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keyup", onKeyUp);
    };
  }, [armed, updateHoverFromPoint, finalizeAnchor]);

  if (!armed) return null;

  return (
    <>
      <div
        className="friction-banner"
        data-component="FrictionBanner"
        role="status"
        aria-live="polite"
      >
        <span className="friction-banner__title">Click anything to anchor feedback</span>
        <span className="friction-banner__hint">Alt to anchor exactly · ESC to cancel</span>
        <button
          type="button"
          className="friction-banner__cancel"
          onClick={toggleFrictionSelecting}
        >
          Cancel
        </button>
      </div>
      {hover && (
        <>
          <div
            className="friction-overlay friction-overlay--snapped"
            aria-hidden="true"
            style={{
              left: hover.snapped.left - 2,
              top: hover.snapped.top - 2,
              width: hover.snapped.width + 4,
              height: hover.snapped.height + 4,
            }}
          />
          <div
            className="friction-overlay friction-overlay--atom"
            aria-hidden="true"
            style={{
              left: hover.target.left - 1,
              top: hover.target.top - 1,
              width: hover.target.width + 2,
              height: hover.target.height + 2,
            }}
          />
          <div
            className="friction-overlay__tooltip"
            style={{
              left: Math.min(hover.snapped.left + 4, window.innerWidth - 320),
              top: Math.max(hover.snapped.top - 32, 8),
            }}
          >
            <span className="friction-overlay__descriptor">{hover.descriptor}</span>
            {hover.snapText && (
              <span className="friction-overlay__snippet">{hover.snapText}</span>
            )}
          </div>
        </>
      )}
    </>
  );
}
