/**
 * Shared modal utilities. RepoLinkModal, CreateProjectModal, and the
 * 13.L AddressFrictionDialog all consume these — when the next caller
 * lands the missing piece is a `<Modal>` primitive that owns the
 * scrim+head+body composition.
 */

import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * All focusable descendants of `container`, in tab order. We don't filter
 * by `offsetParent` (jsdom always returns null, which would empty the ring
 * under tests) — `disabled`, `inert`, `aria-hidden` are the cases we care
 * about and they're handled here.
 */
export function collectFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (el) => !el.hasAttribute("inert") && !el.hasAttribute("aria-hidden"),
  );
}

/**
 * Focus-trap hook for modal-style dialogs. Captures the previously
 * focused element on mount, cycles Tab / Shift-Tab inside `dialogRef`,
 * forwards Esc to `onEscape`, and restores focus on unmount. Disabled
 * while `busy` is true so an in-flight submit can't be dismissed.
 */
export function useFocusTrap(
  dialogRef: RefObject<HTMLElement | null>,
  { onEscape, busy = false }: { onEscape: () => void; busy?: boolean },
) {
  useEffect(() => {
    const returnFocus = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        onEscape();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusables = collectFocusable(dialogRef.current);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !dialogRef.current.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      returnFocus?.focus();
    };
  }, [dialogRef, onEscape, busy]);
}

/**
 * Best-effort user-facing message from an IPC error. The Tauri layer
 * returns `IpcError` shaped as `{ kind, message? }`; some callers throw
 * raw strings. Pick the most informative thing available, fall back to
 * a kind-aware sentence.
 *
 * The optional `verb` lets callers customize the fallback ("link
 * repository" / "create project" / etc.).
 */
export function messageFromError(err: unknown, verb = "complete the action"): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const anyErr = err as { message?: string; kind?: string };
    if (anyErr.message) return anyErr.message;
    if (anyErr.kind) return `Could not ${verb} (${anyErr.kind}).`;
  }
  return `Could not ${verb} — please check the inputs and try again.`;
}
