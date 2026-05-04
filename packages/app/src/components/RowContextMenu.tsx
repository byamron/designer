import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  /** Optional shortcut hint rendered on the right (e.g. "↵", "⌘W"). */
  shortcut?: string;
  /** When true, renders the item in the danger color register. */
  destructive?: boolean;
  disabled?: boolean;
}

interface RowContextMenuProps {
  /** Click position in viewport coordinates (from `MouseEvent`). */
  x: number;
  y: number;
  items: ContextMenuItem[];
  onDismiss: () => void;
}

/** Lightweight right-click context menu. Renders into a portal at the
 *  click position; dismisses on outside click, Escape, scroll, or
 *  resize. Keyboard nav (Up/Down/Enter) traverses the items. */
export function RowContextMenu({ x, y, items, onDismiss }: RowContextMenuProps) {
  const menuRef = useRef<HTMLUListElement>(null);
  const [position, setPosition] = useState({ x, y });
  const [activeIndex, setActiveIndex] = useState(0);

  // Clamp the menu inside the viewport. Without this a click near the
  // bottom-right edge would render the menu off-screen. We measure on
  // mount via useLayoutEffect so the user never sees a flash at (x, y)
  // before the clamp.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 4;
    const nx = Math.min(x, vw - rect.width - pad);
    const ny = Math.min(y, vh - rect.height - pad);
    if (nx !== x || ny !== y) {
      setPosition({ x: Math.max(pad, nx), y: Math.max(pad, ny) });
    }
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(items.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = items[activeIndex];
        if (item && !item.disabled) {
          item.onSelect();
          onDismiss();
        }
      }
    };
    const onPointerDown = (e: MouseEvent) => {
      const el = menuRef.current;
      if (el && !el.contains(e.target as Node)) onDismiss();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", onDismiss, true);
    window.addEventListener("resize", onDismiss);
    window.addEventListener("blur", onDismiss);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", onDismiss, true);
      window.removeEventListener("resize", onDismiss);
      window.removeEventListener("blur", onDismiss);
    };
  }, [activeIndex, items, onDismiss]);

  // Focus the list root on mount so keyboard nav works even when the
  // user opened the menu via a synthetic event with no focused target.
  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  return createPortal(
    <ul
      ref={menuRef}
      className="row-context-menu"
      role="menu"
      tabIndex={-1}
      style={{ top: position.y, left: position.x }}
    >
      {items.map((item, i) => (
        <li key={`${item.label}-${i}`} role="none">
          <button
            type="button"
            role="menuitem"
            className="row-context-menu__item"
            data-active={i === activeIndex || undefined}
            data-destructive={item.destructive || undefined}
            disabled={item.disabled}
            onMouseEnter={() => setActiveIndex(i)}
            onClick={() => {
              if (item.disabled) return;
              item.onSelect();
              onDismiss();
            }}
          >
            <span className="row-context-menu__label">{item.label}</span>
            {item.shortcut && (
              <span className="row-context-menu__shortcut" aria-hidden="true">
                {item.shortcut}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>,
    document.body,
  );
}
