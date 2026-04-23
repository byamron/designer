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
  const gap = 6;
  const resolved = side === "auto" ? (rect.top > 48 ? "top" : "bottom") : side;
  const style: React.CSSProperties = { position: "fixed" };
  if (resolved === "top") {
    style.left = rect.left + rect.width / 2;
    style.top = rect.top - gap;
    style.transform = "translate(-50%, -100%)";
  } else if (resolved === "bottom") {
    style.left = rect.left + rect.width / 2;
    style.top = rect.bottom + gap;
    style.transform = "translate(-50%, 0)";
  } else if (resolved === "left") {
    style.left = rect.left - gap;
    style.top = rect.top + rect.height / 2;
    style.transform = "translate(-100%, -50%)";
  } else {
    style.left = rect.right + gap;
    style.top = rect.top + rect.height / 2;
    style.transform = "translate(0, -50%)";
  }
  return (
    <div id={id} role="tooltip" className="tooltip" data-side={resolved} style={style}>
      <span className="tooltip__label">{label}</span>
      {shortcut && <kbd className="tooltip__kbd">{shortcut}</kbd>}
    </div>
  );
}
