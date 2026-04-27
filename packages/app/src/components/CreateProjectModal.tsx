import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen } from "lucide-react";
import { ipcClient } from "../ipc/client";
import { isTauri, pickFolder } from "../ipc/tauri";
import { closeCreateProject, selectProject, useAppState } from "../store/app";
import { refreshProjects } from "../store/data";
import { collectFocusable, messageFromError } from "../lib/modal";
import { IconButton } from "./IconButton";
import { IconX } from "./icons";
import type { ProjectId } from "../ipc/types";

/**
 * Create-project modal. Replaces the broken `window.prompt`-based flow
 * (Tauri's bundled webview returns null from prompt). Path-first field
 * order matches the user's mental model: "I have a folder, and I want
 * Designer to manage it."
 *
 * Submit calls `cmd_create_project` (which expands `~`, validates the
 * path is a real directory, and canonicalizes). The modal also calls
 * `cmd_validate_project_path` on each path edit to surface inline
 * validation before submit so the button can be greyed out.
 */
export interface CreateProjectModalProps {
  /** Optional callback invoked after a successful create. Defaults to
   *  `selectProject(id)` so the new project becomes active. Onboarding
   *  flows can override to chain into a follow-up step. */
  onCreated?: (projectId: ProjectId) => void;
}

export function CreateProjectModal({ onCreated }: CreateProjectModalProps = {}) {
  const open = useAppState((s) => s.dialog === "create-project");
  const [rootPath, setRootPath] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pathHint, setPathHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pathRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  // Reset form + autofocus when the modal opens. Split from the keyboard
  // listener so flips of `busy` don't clear the form mid-error.
  useEffect(() => {
    if (!open) return;
    setRootPath("");
    setName("");
    setNameTouched(false);
    setError(null);
    setPathHint(null);
    setBusy(false);
    requestAnimationFrame(() => pathRef.current?.focus());
  }, [open]);

  // Keyboard handler — separate effect so it stays mounted across
  // submits and we don't tear down/rebuild on every busy flip.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busyRef.current) {
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
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Autofill the name from the path's basename whenever the user hasn't
  // explicitly typed in the name field. Saves a step in the 90% case.
  const nameValue = nameTouched ? name : basename(rootPath) || name;

  const onPathChange = useCallback(
    (value: string) => {
      setRootPath(value);
      if (error) setError(null);
      setPathHint(null);
    },
    [error],
  );

  const onPickFolder = useCallback(async () => {
    const picked = await pickFolder(rootPath.trim() || undefined);
    if (!picked) return;
    onPathChange(picked);
    // Hand focus back so the user can hit Enter without re-clicking.
    pathRef.current?.focus();
  }, [rootPath, onPathChange]);

  if (!open) return null;

  const submit = async () => {
    const trimmedPath = rootPath.trim();
    const trimmedName = (nameTouched ? name : basename(trimmedPath)).trim();
    if (!trimmedPath) {
      setError("Repository path is required.");
      return;
    }
    if (!trimmedName) {
      setError("Project name is required.");
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
      if (onCreated) {
        onCreated(summary.project.id);
      } else {
        selectProject(summary.project.id);
      }
      closeCreateProject();
    } catch (err) {
      setError(messageFromError(err, "create project"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="app-dialog-scrim"
      role="presentation"
      onClick={(e) => {
        // onClick (not onMouseDown) so a drag inside the dialog ending on
        // the scrim doesn't surprise-dismiss; matches RepoLinkModal.
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
            Create a project
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
          <section className="app-dialog__section" aria-label="Repository path">
            <label
              className="app-dialog__section-label"
              htmlFor="create-project-path"
            >
              Project folder
            </label>
            <div className="create-project__path-row">
              <input
                ref={pathRef}
                id="create-project-path"
                type="text"
                className="quick-switcher__input create-project__path-input"
                placeholder="~/code/my-project"
                value={rootPath}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                onChange={(e) => onPathChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submit();
                  }
                }}
                aria-invalid={error !== null && !rootPath.trim()}
                disabled={busy}
              />
              {/* Native picker only meaningful in Tauri; web build keeps
                * the text input as the sole affordance. */}
              {isTauri() && (
                <button
                  type="button"
                  className="btn create-project__browse"
                  onClick={() => void onPickFolder()}
                  disabled={busy}
                  aria-label="Choose folder"
                  title="Choose folder"
                >
                  <FolderOpen size={14} strokeWidth={1.5} aria-hidden="true" />
                  Browse…
                </button>
              )}
            </div>
            {pathHint && (
              <p
                style={{
                  margin: 0,
                  color: "var(--color-muted)",
                  fontSize: "var(--type-caption-size)",
                }}
              >
                {pathHint}
              </p>
            )}
          </section>
          <section className="app-dialog__section" aria-label="Project name">
            <label
              className="app-dialog__section-label"
              htmlFor="create-project-name"
            >
              Name
            </label>
            <input
              id="create-project-name"
              type="text"
              className="quick-switcher__input"
              placeholder={basename(rootPath) || "My project"}
              value={nameValue}
              onChange={(e) => {
                setName(e.target.value);
                setNameTouched(true);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
              aria-invalid={error !== null && !nameValue.trim()}
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
              Point Designer at an existing git repo, or at an empty folder
              you'd like it to set up. Designer creates per-track worktrees
              inside this folder so agents can work on independent branches
              without touching your main checkout.
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
              disabled={busy || !rootPath.trim() || !nameValue.trim()}
            >
              {busy ? "Creating…" : "Create project"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Last `/`-separated segment of `path`, ignoring trailing slashes. */
function basename(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  const idx = trimmed.lastIndexOf("/");
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}
