import { useCallback, useEffect, useRef, useState } from "react";
import { anchorFromElement, snapTarget } from "../../lib/anchor";
import {
  clearFriction,
  setFrictionAnchor,
  toggleFrictionSelecting,
  useAppState,
} from "../../store/app";

interface HoverState {
  /** The atomic element under the pointer. Anchored when Alt is held. */
  atom: Element;
  /** Snap target — closest ancestor with `data-component`/role/etc. May === atom. */
  snap: Element;
  atomRect: DOMRect;
  snapRect: DOMRect;
  descriptor: string;
  snapText: string | null;
}

const SELF_SELECTOR =
  ".friction-overlay, .friction-widget, .friction-button, .friction-banner";

/**
 * Track 13.K SelectionOverlay — armed-state visual + smart-snap.
 *
 * Renders nothing when `frictionMode !== "selecting"`. Bails when a modal
 * scrim is open (`appStore.dialog !== null`) — friction is inert in those
 * states per spec.
 *
 * Three-exit policy (locked):
 *   1. ESC.
 *   2. Click the FrictionButton again.
 *   3. Click outside any anchorable element after a 600ms grace period from
 *      arming time. The grace gives the user a beat to drift over a target
 *      without losing the armed state on a stray click.
 *
 * Smart-snap walks ancestors to the closest `data-component` / `role="row"|
 * "button"` / `<button>` / `<dialog>`. Hold Alt to override and anchor to
 * the exact hovered node.
 */
export function SelectionOverlay() {
  const mode = useAppState((s) => s.frictionMode);
  const dialog = useAppState((s) => s.dialog);
  const armed = mode === "selecting" && dialog === null;
  const [hover, setHover] = useState<HoverState | null>(null);
  const altHeldRef = useRef(false);
  const armedAtRef = useRef<number>(0);

  const finalize = useCallback(() => {
    if (!hover) return;
    const target = altHeldRef.current ? hover.atom : hover.snap;
    const route = window.location.hash || window.location.pathname || "/";
    setFrictionAnchor(anchorFromElement(target, route), null);
  }, [hover]);

  // Reset armed-at timestamp + clear stale hover whenever arming flips on.
  useEffect(() => {
    if (armed) {
      armedAtRef.current = Date.now();
    } else {
      setHover(null);
    }
  }, [armed]);

  useEffect(() => {
    if (!armed) return;
    let pendingFrame: number | null = null;

    let lastAtom: Element | null = null;
    let lastSnap: Element | null = null;

    const onMove = (e: PointerEvent) => {
      altHeldRef.current = e.altKey;
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = null;
        const atom = document.elementFromPoint(e.clientX, e.clientY);
        if (!atom || (atom as Element).closest?.(SELF_SELECTOR)) {
          if (lastAtom !== null || lastSnap !== null) {
            lastAtom = null;
            lastSnap = null;
            setHover(null);
          }
          return;
        }
        const snap = snapTarget(atom) ?? atom;
        if (atom === lastAtom && snap === lastSnap) return;
        lastAtom = atom;
        lastSnap = snap;
        const descriptor =
          (snap as HTMLElement).getAttribute?.("data-component") ??
          (snap as HTMLElement).getAttribute?.("role") ??
          atom.tagName.toLowerCase();
        const snapText = ((snap as HTMLElement).innerText ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 60);
        setHover({
          atom,
          snap,
          atomRect: atom.getBoundingClientRect(),
          snapRect: snap.getBoundingClientRect(),
          descriptor,
          snapText: snapText.length > 0 ? snapText : null,
        });
      });
    };

    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest(SELF_SELECTOR)) {
        // Let the FrictionButton/banner-cancel button handle their own clicks.
        return;
      }
      const atom = document.elementFromPoint(e.clientX, e.clientY);
      const snap = atom ? snapTarget(atom) : null;
      // Clicks outside any anchorable element dismiss after grace.
      const sinceArmed = Date.now() - armedAtRef.current;
      if (!snap && !altHeldRef.current) {
        if (sinceArmed > 600) {
          clearFriction();
        }
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      finalize();
    };

    const onKeyDown = (e: KeyboardEvent) => {
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
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
    };
  }, [armed, finalize]);

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
              left: hover.snapRect.left - 2,
              top: hover.snapRect.top - 2,
              width: hover.snapRect.width + 4,
              height: hover.snapRect.height + 4,
            }}
          />
          <div
            className="friction-overlay friction-overlay--atom"
            aria-hidden="true"
            style={{
              left: hover.atomRect.left - 1,
              top: hover.atomRect.top - 1,
              width: hover.atomRect.width + 2,
              height: hover.atomRect.height + 2,
            }}
          />
          <div
            className="friction-overlay__tooltip"
            style={{
              left: Math.min(hover.snapRect.left + 4, window.innerWidth - 320),
              top: Math.max(hover.snapRect.top - 32, 8),
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
