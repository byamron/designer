import { useEffect, useRef, useState } from "react";
import { ipcClient } from "../ipc/client";
import { IconButton } from "./IconButton";
import { IconX } from "./icons";
import type { WorkspaceId } from "../ipc/types";

/**
 * Repo-link modal — collects an absolute path to a git work-tree, validates
 * it via `cmd_link_repo`, and persists the link on the workspace.
 *
 * Surfaces:
 *   1. Onboarding (extends the welcome slabs with a fourth, action-oriented
 *      step). Surfaces only when the user reaches the final slide.
 *   2. Settings → Account (replaces the "GitHub: not connected" placeholder
 *      with an actionable button).
 *
 * Interaction: focus moves to the input on open, Escape dismisses, Enter on
 * the input submits. We use the existing `app-dialog*` token-driven CSS so
 * no new tokens are introduced.
 */
export interface RepoLinkModalProps {
  workspaceId: WorkspaceId;
  open: boolean;
  initialPath?: string;
  onClose: () => void;
  onLinked?: (path: string) => void;
}

export function RepoLinkModal({
  workspaceId,
  open,
  initialPath = "",
  onClose,
  onLinked,
}: RepoLinkModalProps) {
  const [path, setPath] = useState(initialPath);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setPath(initialPath);
    setError(null);
    setBusy(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        onClose();
        return;
      }
      // Focus trap. Tab / Shift-Tab cycle within the dialog so keyboard
      // users can't accidentally land on the AppShell behind the scrim.
      if (e.key === "Tab" && dialogRef.current) {
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
      }
    };
    window.addEventListener("keydown", onKey);
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.removeEventListener("keydown", onKey);
  }, [open, initialPath, onClose, busy]);

  if (!open) return null;

  const submit = async () => {
    const trimmed = path.trim();
    if (!trimmed) {
      setError("Repository path is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await ipcClient().linkRepo({
        workspace_id: workspaceId,
        repo_path: trimmed,
      });
      onLinked?.(trimmed);
      onClose();
    } catch (err) {
      setError(messageFromError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="app-dialog-scrim"
      role="presentation"
      onClick={(e) => {
        // onClick (not onMouseDown) so a drag that starts inside the
        // dialog and finishes on the scrim doesn't surprise-dismiss the
        // user — `click` only fires when mousedown and mouseup land on
        // the same element.
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="app-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="repo-link-title"
      >
        <header className="app-dialog__head">
          <h2 className="app-dialog__title" id="repo-link-title">
            Link a repository
          </h2>
          <IconButton label="Close" shortcut="Esc" onClick={onClose} disabled={busy}>
            <IconX size={12} />
          </IconButton>
        </header>
        <div className="app-dialog__body">
          <section className="app-dialog__section" aria-label="Repository path">
            <label
              className="app-dialog__section-label"
              htmlFor="repo-link-path"
            >
              Absolute path to the repository
            </label>
            <input
              ref={inputRef}
              id="repo-link-path"
              type="text"
              className="quick-switcher__input"
              placeholder="/Users/you/code/my-project"
              value={path}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              onChange={(e) => {
                setPath(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
              aria-invalid={error !== null}
              aria-describedby={error ? "repo-link-error" : undefined}
              disabled={busy}
            />
            {error && (
              <p
                id="repo-link-error"
                role="alert"
                style={{
                  margin: 0,
                  color: "var(--color-danger)",
                  fontSize: "var(--type-caption-size)",
                }}
              >
                {error}
              </p>
            )}
          </section>
          <section className="app-dialog__section">
            <span className="app-dialog__section-label">Why we need it</span>
            <p
              style={{
                margin: 0,
                color: "var(--color-muted)",
                fontSize: "var(--type-caption-size)",
                lineHeight: "var(--type-caption-leading)",
              }}
            >
              Designer creates per-track worktrees inside this repository so
              agents can work on independent branches without touching your
              main checkout.
            </p>
          </section>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "var(--space-2)",
            }}
          >
            <button
              type="button"
              className="btn"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              data-variant="primary"
              onClick={submit}
              disabled={busy || path.trim().length === 0}
            >
              {busy ? "Linking…" : "Link repository"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function collectFocusable(container: HTMLElement): HTMLElement[] {
  // We don't filter by offsetParent here because jsdom always reports
  // offsetParent === null, which would empty the focus ring under tests.
  // The real-DOM cases we'd want to filter (display:none, hidden) are
  // either disabled (already excluded) or aria-hidden (rare for buttons
  // inside an open modal); leaving them in is safe.
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => !el.hasAttribute("inert") && !el.hasAttribute("aria-hidden"));
}

function messageFromError(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const anyErr = err as { message?: string; kind?: string };
    if (anyErr.message) return anyErr.message;
    if (anyErr.kind) return `Could not link repository (${anyErr.kind}).`;
  }
  return "Could not link repository — please check the path and try again.";
}
