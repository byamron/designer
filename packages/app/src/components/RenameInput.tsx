import { useEffect, useRef } from "react";

interface RenameInputProps {
  initialValue: string;
  ariaLabel: string;
  className?: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

/** Inline rename input. Submits on Enter or blur; cancels on Escape.
 *  Selects the existing text on mount so the user can type-to-replace
 *  or arrow-to-edit, matching macOS Finder + Linear. Empty / whitespace
 *  values cancel rather than submit (no point recording an empty
 *  rename event — backend would reject it). */
export function RenameInput({
  initialValue,
  ariaLabel,
  className,
  onCommit,
  onCancel,
}: RenameInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  // Tracks whether a commit/cancel has fired so blur doesn't double-fire
  // after the user pressed Enter or Escape (both blur the input).
  const settledRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const settle = (next: () => void) => {
    if (settledRef.current) return;
    settledRef.current = true;
    next();
  };

  const commit = () => {
    const value = ref.current?.value ?? "";
    const trimmed = value.trim();
    if (!trimmed || trimmed === initialValue) {
      settle(onCancel);
      return;
    }
    settle(() => onCommit(trimmed));
  };

  return (
    <input
      ref={ref}
      type="text"
      defaultValue={initialValue}
      aria-label={ariaLabel}
      className={className}
      // Stop click/double-click/keydown from bubbling to the parent button —
      // a click in the input would otherwise re-select the workspace/tab,
      // and Cmd-W would close the tab the user is renaming.
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          settle(onCancel);
        }
      }}
      onBlur={() => commit()}
    />
  );
}
