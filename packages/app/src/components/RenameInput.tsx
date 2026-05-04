import { useEffect, useRef, useState } from "react";

interface RenameInputProps {
  initialValue: string;
  ariaLabel: string;
  className?: string;
  /** Commits the rename. May throw / reject — on failure the input
   *  stays mounted with an inline error so the user can retry without
   *  losing their typed value. On success the parent unmounts the
   *  input by flipping its `renaming` flag. */
  onCommit: (value: string) => Promise<void> | void;
  onCancel: () => void;
}

/** Inline rename input. Submits on Enter or blur; cancels on Escape.
 *  Selects the existing text on mount so the user can type-to-replace
 *  or arrow-to-edit, matching macOS Finder + Linear. Empty / whitespace
 *  values cancel rather than submit (no point recording an empty
 *  rename event — backend would reject it).
 *
 *  On commit failure the input stays open in an error register so the
 *  user knows the rename did not stick. Without this, an IPC failure
 *  silently reverts to the old name with no signal — cf. UX review. */
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
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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

  const commit = async () => {
    if (pending) return;
    const value = ref.current?.value ?? "";
    const trimmed = value.trim();
    if (!trimmed || trimmed === initialValue) {
      settle(onCancel);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onCommit(trimmed);
      // Success — the parent unmounts us by flipping `renaming`. Mark
      // settled so a trailing blur after the parent dispatches doesn't
      // re-fire the IPC path.
      settledRef.current = true;
    } catch (err) {
      // Keep the input open + paint an error so the user knows the
      // rename failed and can retry. Allow re-commit by clearing the
      // settled flag (it was never set on this attempt).
      const message =
        err instanceof Error ? err.message : "Rename failed — try again.";
      setError(message);
    } finally {
      setPending(false);
    }
  };

  return (
    <span className="rename-input-wrap">
      <input
        ref={ref}
        type="text"
        defaultValue={initialValue}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-busy={pending || undefined}
        className={className}
        data-error={error ? "true" : undefined}
        // Stop click/double-click/keydown from bubbling to the parent button —
        // a click in the input would otherwise re-select the workspace/tab,
        // and Cmd-W would close the tab the user is renaming.
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onChange={() => {
          // Clear the error register the moment the user edits — keeps
          // the affordance from feeling sticky after they've moved on.
          if (error) setError(null);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            settle(onCancel);
          }
        }}
        onBlur={() => {
          // If a commit is in flight, blur is a no-op — the in-flight
          // commit owns the settle. If the prior commit errored, blur
          // re-attempts (mirrors Enter), so a stale value doesn't
          // silently leak back into read mode.
          void commit();
        }}
      />
      {error && (
        <span className="rename-input__error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
