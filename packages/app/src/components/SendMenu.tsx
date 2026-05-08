// Phase 24 §5.4 — hover/focus-revealed menu attached to the Send button
// in ComposeDock. Surfaces both send modes when a turn is open in the
// focused tab:
//
//   1. Send when done   (⏎)    — queue the message; auto-dispatches on
//                                 AgentTurnEnded.
//   2. Stop and send now (⌘⏎)  — dispatch cmd_interrupt_turn, then
//                                 queue. The same auto-dispatch handler
//                                 fires when the resulting AgentTurnEnded
//                                 { Interrupted } arrives.
//
// When the subprocess is idle in the focused tab the menu hides
// entirely — the parent unmounts SendMenu and renders the bare button
// directly. No "send immediately" alternate to surface there.
//
// Discoverability rule from spec §5.4: hover OR keyboard focus reveals
// the menu after a 200 ms debounce so cursor-passing doesn't flash it.
// `role="menu"` + `role="menuitem"` rows make it keyboard-discoverable;
// arrow-down moves focus into the menu, ⏎ activates the focused row,
// Esc dismisses, click-outside dismisses.

import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";

const REVEAL_DELAY_MS = 200;

export interface SendMenuProps {
  /** Default action (clicking the trigger button itself, or the
   *  "Send when done" row, or pressing ⏎ globally). */
  onQueue: () => void;
  /** Alternate action ("Stop and send now" row, or ⌘⏎ globally).
   *  Caller is responsible for both the interrupt RPC and the
   *  subsequent queue insert; SendMenu only fires the callback. */
  onStopAndSend: () => void;
  /** The Send button. SendMenu clones it to attach hover/focus
   *  handlers + `aria-haspopup` / `aria-expanded`. */
  children: ReactElement;
}

export function SendMenu({ onQueue, onStopAndSend, children }: SendMenuProps) {
  const id = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const revealTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    setRect(anchorRef.current.getBoundingClientRect());
    let frame = 0;
    const reposition = () => {
      frame = 0;
      if (anchorRef.current) setRect(anchorRef.current.getBoundingClientRect());
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(reposition);
    };
    window.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll, {
        capture: true,
      } as EventListenerOptions);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  // Esc + click-outside dismiss while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        anchorRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (anchorRef.current?.contains(t)) return;
      if (surfaceRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const cancelRevealTimer = () => {
    if (revealTimerRef.current !== null) {
      window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
  };

  const scheduleReveal = () => {
    if (open) return;
    cancelRevealTimer();
    revealTimerRef.current = window.setTimeout(() => {
      revealTimerRef.current = null;
      setOpen(true);
    }, REVEAL_DELAY_MS);
  };

  const hide = () => {
    cancelRevealTimer();
    setOpen(false);
  };

  // Trigger: clone the child Send button to attach event handlers.
  // Forward existing handlers via `?.()` so callers' onClick / onFocus
  // still fire. The button's own onClick is the default action — our
  // outer onQueue is only used by the menu rows, not the button itself
  // (per spec: clicking the Send button = queue / send-default; menu
  // surfaces the alternate).
  const trigger = cloneElement(children, {
    ref: (node: HTMLElement | null) => {
      anchorRef.current = node;
      const forward = (children as unknown as { ref?: unknown }).ref;
      if (typeof forward === "function") forward(node);
      else if (forward && typeof forward === "object" && "current" in forward) {
        (forward as { current: unknown }).current = node;
      }
    },
    onMouseEnter: (e: React.MouseEvent) => {
      children.props.onMouseEnter?.(e);
      scheduleReveal();
    },
    onMouseLeave: (e: React.MouseEvent) => {
      children.props.onMouseLeave?.(e);
      // Only hide if the cursor isn't moving onto the menu surface.
      // requestAnimationFrame defers the check by one frame so the
      // hover state on the menu has a chance to settle.
      requestAnimationFrame(() => {
        if (!surfaceRef.current?.matches(":hover")) hide();
      });
    },
    onFocus: (e: React.FocusEvent) => {
      children.props.onFocus?.(e);
      // Focus skips the debounce — keyboard reveal is intentional, not
      // accidental cursor-passing.
      cancelRevealTimer();
      setOpen(true);
    },
    onBlur: (e: React.FocusEvent) => {
      children.props.onBlur?.(e);
      // Only blur-dismiss if focus isn't moving onto a menu item.
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active && surfaceRef.current?.contains(active)) return;
        hide();
      });
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      children.props.onKeyDown?.(e);
      // Arrow-down from the trigger moves focus into the menu.
      if (e.key === "ArrowDown" && open) {
        e.preventDefault();
        const first =
          surfaceRef.current?.querySelector<HTMLButtonElement>(
            '[role="menuitem"]',
          );
        first?.focus();
      }
    },
    "aria-haspopup": "menu",
    "aria-expanded": open,
    "aria-controls": open ? id : undefined,
  } as Record<string, unknown>);

  return (
    <>
      {trigger}
      {open && rect && (
        <SendMenuSurface
          id={id}
          rect={rect}
          surfaceRef={surfaceRef}
          onQueue={() => {
            hide();
            onQueue();
          }}
          onStopAndSend={() => {
            hide();
            onStopAndSend();
          }}
          onMouseEnter={cancelRevealTimer}
          onMouseLeave={hide}
          onBlurOut={() => {
            requestAnimationFrame(() => {
              const active = document.activeElement;
              if (active && surfaceRef.current?.contains(active)) return;
              if (active === anchorRef.current) return;
              hide();
            });
          }}
        />
      )}
    </>
  );
}

interface SurfaceProps {
  id: string;
  rect: DOMRect;
  surfaceRef: React.MutableRefObject<HTMLDivElement | null>;
  onQueue: () => void;
  onStopAndSend: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onBlurOut: () => void;
}

function SendMenuSurface({
  id,
  rect,
  surfaceRef,
  onQueue,
  onStopAndSend,
  onMouseEnter,
  onMouseLeave,
  onBlurOut,
}: SurfaceProps) {
  // Two-pass measure → clamp, mirroring Tooltip. First paint offscreen
  // hidden so we can read width/height; second paints in viewport.
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(
    null,
  );

  useLayoutEffect(() => {
    if (!surfaceRef.current) return;
    const r = surfaceRef.current.getBoundingClientRect();
    setMeasured((prev) =>
      prev && prev.w === r.width && prev.h === r.height
        ? prev
        : { w: r.width, h: r.height },
    );
  }, [surfaceRef]);

  const gap = 8;
  const margin = 4;
  const style: React.CSSProperties = { position: "fixed" };
  if (!measured) {
    style.left = -9999;
    style.top = -9999;
    style.visibility = "hidden";
  } else {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const { w, h } = measured;
    // Anchor above the trigger by default; the Send button sits at the
    // bottom-right of the dock so "above" is the natural reading-order
    // direction. Right-align with the trigger's right edge so the menu
    // doesn't overflow the viewport in narrow windows.
    let left = rect.right - w;
    let top = rect.top - gap - h;
    // Clamp to viewport.
    left = Math.min(Math.max(left, margin), Math.max(margin, vw - w - margin));
    top = Math.min(Math.max(top, margin), Math.max(margin, vh - h - margin));
    style.left = left;
    style.top = top;
  }

  // Keyboard navigation within the menu.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = Array.from(
      surfaceRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]',
      ) ?? [],
    );
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = items[(i + 1) % items.length];
      next?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = items[(i - 1 + items.length) % items.length];
      prev?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  return (
    <div
      ref={surfaceRef}
      id={id}
      role="menu"
      aria-label="Send options"
      className="send-menu"
      data-component="SendMenu"
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onKeyDown={onKeyDown}
      onBlur={onBlurOut}
    >
      <button
        type="button"
        role="menuitem"
        className="send-menu__item"
        onClick={onQueue}
        data-action="queue"
      >
        <span className="send-menu__label">Send when done</span>
        <kbd className="send-menu__kbd">⏎</kbd>
      </button>
      <button
        type="button"
        role="menuitem"
        className="send-menu__item"
        onClick={onStopAndSend}
        data-action="stop-and-send"
      >
        <span className="send-menu__label">Stop and send now</span>
        <kbd className="send-menu__kbd">⌘⏎</kbd>
      </button>
    </div>
  );
}
