import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";

/**
 * Tooltip — immediate on hover and focus, no delay. Renders in an absolutely
 * positioned layer anchored to the trigger so the tooltip is not clipped by
 * overflow ancestors. `shortcut` renders as a right-aligned kbd.
 *
 * Replaces the project's prior HTML `title` pattern. Keeps the semantic
 * `aria-describedby` for screen readers and preserves keyboard path.
 */
export function Tooltip({
  label,
  shortcut,
  children,
  side = "auto",
  disabled,
}: {
  label: string;
  shortcut?: string;
  children: ReactElement;
  side?: "auto" | "top" | "bottom" | "left" | "right";
  disabled?: boolean;
}) {
  const id = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    setRect(anchorRef.current.getBoundingClientRect());
    // Scroll + resize listeners are passive and rAF-coalesced so an open
    // tooltip doesn't force a synchronous layout read for every scroll
    // event in the app.
    let frame = 0;
    const reposition = () => {
      frame = 0;
      if (anchorRef.current) setRect(anchorRef.current.getBoundingClientRect());
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(reposition);
    };
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const show = () => {
    if (!disabled) setOpen(true);
  };
  const hide = () => setOpen(false);

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
      show();
    },
    onMouseLeave: (e: React.MouseEvent) => {
      children.props.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent) => {
      children.props.onFocus?.(e);
      show();
    },
    onBlur: (e: React.FocusEvent) => {
      children.props.onBlur?.(e);
      hide();
    },
    "aria-describedby":
      [children.props["aria-describedby"], open ? id : null]
        .filter(Boolean)
        .join(" ") || undefined,
  } as Record<string, unknown>);

  return (
    <>
      {trigger}
      {open && rect && (
        <TooltipSurface id={id} label={label} shortcut={shortcut} rect={rect} side={side} />
      )}
    </>
  );
}

function TooltipSurface({
  id,
  label,
  shortcut,
  rect,
  side,
}: {
  id: string;
  label: string;
  shortcut?: string;
  rect: DOMRect;
  side: "auto" | "top" | "bottom" | "left" | "right";
}) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  // Two-pass measure → clamp. First pass paints offscreen + hidden; second
  // pass positions inside the viewport, so triggers at any window edge
  // (titlebar corners, modal close X) never produce a clipped tooltip.
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
  }, [label, shortcut]);

  const gap = 6;
  const margin = 4;
  const resolved =
    side === "auto" ? (rect.top > 48 ? "top" : "bottom") : side;

  const style: React.CSSProperties = { position: "fixed" };
  if (!measured) {
    style.left = -9999;
    style.top = -9999;
    style.visibility = "hidden";
  } else {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const { w, h } = measured;
    let left: number;
    let top: number;
    if (resolved === "top") {
      left = rect.left + rect.width / 2 - w / 2;
      top = rect.top - gap - h;
    } else if (resolved === "bottom") {
      left = rect.left + rect.width / 2 - w / 2;
      top = rect.bottom + gap;
    } else if (resolved === "left") {
      left = rect.left - gap - w;
      top = rect.top + rect.height / 2 - h / 2;
    } else {
      left = rect.right + gap;
      top = rect.top + rect.height / 2 - h / 2;
    }
    left = Math.min(Math.max(left, margin), Math.max(margin, vw - w - margin));
    top = Math.min(Math.max(top, margin), Math.max(margin, vh - h - margin));
    style.left = left;
    style.top = top;
  }

  return (
    <div
      ref={surfaceRef}
      id={id}
      role="tooltip"
      className="tooltip"
      data-side={resolved}
      style={style}
    >
      <span className="tooltip__label">{label}</span>
      {shortcut && <kbd className="tooltip__kbd">{shortcut}</kbd>}
    </div>
  );
}
