import { useEffect, useRef, useState } from "react";
import { ipcClient } from "../ipc/client";
import { collectFocusable, messageFromError } from "../lib/modal";
import { IconButton } from "./IconButton";
import { IconX } from "./icons";
import type { WorkspaceId } from "../ipc/types";

/**
 * Repo-unlink confirmation. Severs Designer's pointer to one or more
 * workspace-linked repos; the repo on disk is untouched. Per-project
 * surfaces (Project Home) hand us the full set of workspace ids so a
 * single confirmation maps to the user's mental "disconnect this
 * project" model.
 */
export interface RepoUnlinkModalProps {
  /** All workspaces whose repo link should be severed on confirm. */
  workspaceIds: WorkspaceId[];
  /** The repo path being disconnected — surfaced verbatim in the copy. */
  repoPath: string;
  open: boolean;
  onClose: () => void;
  onUnlinked?: () => void;
}

export function RepoUnlinkModal({
  workspaceIds,
  repoPath,
  open,
  onClose,
  onUnlinked,
}: RepoUnlinkModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // Destructive confirms default focus to Cancel — keyboard Enter on first
  // open should land on the safe path, not the destructive one. Convention
  // matches macOS-native destructive sheets.
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        onClose();
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
    requestAnimationFrame(() => cancelRef.current?.focus());
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, busy]);

  if (!open) return null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const workspaceId of workspaceIds) {
        await ipcClient().unlinkRepo({ workspace_id: workspaceId });
      }
      onUnlinked?.();
      onClose();
    } catch (err) {
      setError(messageFromError(err, "disconnect repository"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="app-dialog-scrim"
      data-component="RepoUnlinkModal"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="app-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="repo-unlink-title"
        aria-describedby="repo-unlink-body"
      >
        <header className="app-dialog__head">
          <h2 className="app-dialog__title" id="repo-unlink-title">
            Disconnect repository
          </h2>
          <IconButton label="Close" shortcut="Esc" onClick={onClose} disabled={busy}>
            <IconX size={12} />
          </IconButton>
        </header>
        <div className="app-dialog__body">
          <section className="app-dialog__section" id="repo-unlink-body">
            <p
              style={{
                margin: 0,
                color: "var(--color-muted)",
                fontSize: "var(--type-caption-size)",
                lineHeight: "var(--type-caption-leading)",
              }}
            >
              Designer will no longer track changes in{" "}
              <strong style={{ color: "var(--color-foreground)" }}>{repoPath}</strong>.
              Your repo files are not touched — this just severs Designer's
              pointer. You can re-link any time from this project's home tab.
            </p>
          </section>
          {error && (
            <section className="app-dialog__section" aria-label="Error">
              <p
                role="alert"
                style={{
                  margin: 0,
                  color: "var(--danger-11)",
                  fontSize: "var(--type-caption-size)",
                }}
              >
                {error}
              </p>
            </section>
          )}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "var(--space-2)",
            }}
          >
            <button
              ref={cancelRef}
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
              data-variant="danger"
              onClick={submit}
              disabled={busy}
            >
              {busy ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
