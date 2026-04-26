import { useEffect, useRef, useState } from "react";
import { ipcClient } from "../ipc/client";
import { closeCreateProject, selectProject, useAppState } from "../store/app";
import { refreshProjects } from "../store/data";
import { IconButton } from "./IconButton";
import { IconX } from "./icons";

/**
 * Create-project modal. Replaces the old `window.prompt`-based flow which
 * silently failed in Tauri webviews (the chromium webview Tauri bundles
 * does not implement `window.prompt`). Modeled on `RepoLinkModal` so the
 * scrim behavior, focus trap, and a11y wiring stay consistent.
 *
 * Submit calls `cmd_create_project` and on success selects the new project
 * so the rest of the UI lights up immediately.
 */
export function CreateProjectModal() {
  const open = useAppState((s) => s.createProjectOpen);
  const [name, setName] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setRootPath("");
    setError(null);
    setBusy(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        closeCreateProject();
        return;
      }
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
    requestAnimationFrame(() => nameRef.current?.focus());
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  if (!open) return null;

  const submit = async () => {
    const trimmedName = name.trim();
    const trimmedPath = rootPath.trim();
    if (!trimmedName) {
      setError("Project name is required.");
      return;
    }
    if (!trimmedPath) {
      setError("Repository root path is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const summary = await ipcClient().createProject({
        name: trimmedName,
        root_path: trimmedPath,
      });
      await refreshProjects();
      selectProject(summary.project.id);
      closeCreateProject();
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
        if (e.target === e.currentTarget && !busy) closeCreateProject();
      }}
    >
      <div
        ref={dialogRef}
        className="app-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-project-title"
      >
        <header className="app-dialog__head">
          <h2 className="app-dialog__title" id="create-project-title">
            New project
          </h2>
          <IconButton
            label="Close"
            shortcut="Esc"
            onClick={closeCreateProject}
            disabled={busy}
          >
            <IconX size={12} />
          </IconButton>
        </header>
        <div className="app-dialog__body">
          <section className="app-dialog__section" aria-label="Project name">
            <label
              className="app-dialog__section-label"
              htmlFor="create-project-name"
            >
              Project name
            </label>
            <input
              ref={nameRef}
              id="create-project-name"
              type="text"
              className="quick-switcher__input"
              placeholder="My project"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
              aria-invalid={error !== null && !name.trim()}
              disabled={busy}
            />
          </section>
          <section className="app-dialog__section" aria-label="Repository root">
            <label
              className="app-dialog__section-label"
              htmlFor="create-project-path"
            >
              Repository root path
            </label>
            <input
              id="create-project-path"
              type="text"
              className="quick-switcher__input"
              placeholder="/Users/you/code/my-project"
              value={rootPath}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              onChange={(e) => {
                setRootPath(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
              aria-invalid={error !== null && !rootPath.trim()}
              disabled={busy}
            />
            {error && (
              <p
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
            <p
              style={{
                margin: 0,
                color: "var(--color-muted)",
                fontSize: "var(--type-caption-size)",
                lineHeight: "var(--type-caption-leading)",
              }}
            >
              The repository root is where Designer creates per-track worktrees
              and persists `core-docs/`. You can link an existing git repo or
              point at an empty directory you'd like Designer to seed.
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
              onClick={closeCreateProject}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              data-variant="primary"
              onClick={submit}
              disabled={busy || !name.trim() || !rootPath.trim()}
            >
              {busy ? "Creating…" : "Create project"}
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
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (el) => !el.hasAttribute("inert") && !el.hasAttribute("aria-hidden"),
  );
}

function messageFromError(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const anyErr = err as { message?: string; kind?: string };
    if (anyErr.message) return anyErr.message;
    if (anyErr.kind) return `Could not create project (${anyErr.kind}).`;
  }
  return "Could not create project — please check the inputs and try again.";
}
