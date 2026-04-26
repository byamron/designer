/**
 * Shared modal utilities. Extracted after `RepoLinkModal` and
 * `CreateProjectModal` ended up with verbatim copies of the focus-trap
 * selector + collector + IPC error formatter. Pull a third modal in and
 * the missing piece is a `<Modal>` primitive — but until then, these
 * three helpers carry the load.
 */

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
