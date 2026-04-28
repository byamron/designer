import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image as ImageIcon, Trash2, X } from "lucide-react";
import {
  cancelFrictionEditing,
  clearFriction,
  openDialog,
  useAppState,
} from "../../store/app";
import { ipcClient } from "../../ipc/client";
import {
  anchorDescriptor,
  resolveAnchor,
  synthesizeTitle,
} from "../../lib/anchor";

const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? "0.1.0";

type ToastKind = "local" | "failed";

interface ToastState {
  kind: ToastKind;
  message: string;
  /// When set on a `local` toast, the toast renders an inline action that
  /// jumps to Settings → Activity → Friction. Frees the user from
  /// hunt-and-peck navigation after submit.
  linkToTriage?: boolean;
}

interface ScreenshotState {
  bytes: Uint8Array;
  filename: string;
  previewUrl: string;
  source: "paste" | "auto" | "drop" | "picker";
}

/**
 * Track 13.K FrictionWidget — pinned input surface.
 *
 * Three working screenshot inputs in v1 (paste / drop / file picker).
 * Auto-capture (Tauri `webview.capture()`) is a follow-up — when the
 * SelectionOverlay grows that wiring it'll set `frictionAutoCapture` in
 * the store and this widget will adopt it automatically.
 *
 * Closes on ESC; bails out (back to "selecting") on Cancel so the user
 * can re-anchor without re-arming. Hidden when a modal scrim is open
 * (friction is inert in those states per spec).
 */
export function FrictionWidget() {
  const mode = useAppState((s) => s.frictionMode);
  const dialog = useAppState((s) => s.dialog);
  const anchor = useAppState((s) => s.frictionAnchor);
  const autoCapture = useAppState((s) => s.frictionAutoCapture);
  const workspaceId = useAppState((s) => s.activeWorkspace);
  const projectId = useAppState((s) => s.activeProject);
  const visible = mode === "editing" && anchor !== null && dialog === null;

  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [screenshot, setScreenshot] = useState<ScreenshotState | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const screenshotRef = useRef<ScreenshotState | null>(null);
  useEffect(() => {
    screenshotRef.current = screenshot;
  }, [screenshot]);
  // Final cleanup — runs once on unmount. Without this, leaving the widget
  // mounted while React tears the tree down (route swap, hot reload) leaks
  // the object-URL for the previewed PNG.
  useEffect(() => {
    return () => {
      const cur = screenshotRef.current;
      if (cur) URL.revokeObjectURL(cur.previewUrl);
    };
  }, []);

  const adoptScreenshot = useCallback(
    (bytes: Uint8Array, filename: string, source: ScreenshotState["source"]) => {
      setScreenshot((prev) => {
        if (prev) URL.revokeObjectURL(prev.previewUrl);
        // The inner `Uint8Array(bytes)` forces an ArrayBuffer backing —
        // TS rejects the bare `Uint8Array` because its buffer could be
        // SharedArrayBuffer-typed, which `Blob` doesn't accept.
        const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
        return {
          bytes,
          filename,
          previewUrl: URL.createObjectURL(blob),
          source,
        };
      });
    },
    [],
  );

  // Reset on enter/exit of editing mode so re-anchoring sees a fresh widget;
  // previous text from a different anchor would mislead.
  useEffect(() => {
    if (mode === "editing") {
      setBody("");
      setSubmitting(false);
      setToast(null);
      if (autoCapture) {
        adoptScreenshot(autoCapture.bytes, autoCapture.filename, "auto");
      } else {
        setScreenshot(null);
      }
    } else if (mode === "off") {
      setScreenshot((prev) => {
        if (prev) URL.revokeObjectURL(prev.previewUrl);
        return null;
      });
    }
  }, [mode, autoCapture, adoptScreenshot]);

  // Position the widget near the anchor with simple collision-avoidance:
  // prefer right of the anchor; if that overflows, flip to left. Falls
  // back to a fixed corner if the anchor is no longer in the DOM.
  const widgetStyle = useMemo<React.CSSProperties>(() => {
    if (!anchor) return {};
    const el = resolveAnchor(anchor);
    if (!el) return { right: 24, bottom: 84 };
    const rect = el.getBoundingClientRect();
    const widget = { width: 360, height: 320 };
    let left = rect.right + 12;
    let top = rect.top;
    if (left + widget.width > window.innerWidth - 8) {
      left = Math.max(8, rect.left - widget.width - 12);
    }
    if (top + widget.height > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - widget.height - 8);
    }
    return { left, top };
  }, [anchor]);

  // Paste handler — clipboard image becomes the screenshot.
  useEffect(() => {
    if (!visible) return;
    const onPaste = async (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItem = items.find((it) => it.type.startsWith("image/"));
      if (!imageItem) return;
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (!file) return;
      const buf = new Uint8Array(await file.arrayBuffer());
      adoptScreenshot(buf, file.name || "paste.png", "paste");
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [visible, adoptScreenshot]);

  // ESC exits the widget (back to selecting; user can re-anchor).
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelFrictionEditing();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible]);

  const onPickFile = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return;
      const buf = new Uint8Array(await file.arrayBuffer());
      adoptScreenshot(buf, file.name, "picker");
    },
    [adoptScreenshot],
  );

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      const buf = new Uint8Array(await file.arrayBuffer());
      adoptScreenshot(buf, file.name, "drop");
    },
    [adoptScreenshot],
  );

  const canSubmit =
    body.trim().length > 0 && (screenshot !== null || anchor !== null) && !submitting;

  const onSubmit = useCallback(async () => {
    if (!canSubmit || !anchor) return;
    setSubmitting(true);
    try {
      const route = window.location.hash || window.location.pathname || "/";
      const resp = await ipcClient().reportFriction({
        anchor,
        body: body.trim(),
        screenshot_data: screenshot ? Array.from(screenshot.bytes) : null,
        screenshot_filename: screenshot?.filename ?? null,
        workspace_id: workspaceId,
        project_id: projectId,
        route,
      });
      const tail = resp.friction_id.slice(-6);
      setToast({
        kind: "local",
        message: `Saved as #${tail}.`,
        linkToTriage: true,
      });
      // Close the widget after a beat so the user reads the toast.
      // Slightly longer than 1.4s so they have time to click Review.
      setTimeout(clearFriction, 2200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToast({ kind: "failed", message: msg });
      setSubmitting(false);
    }
  }, [anchor, body, canSubmit, projectId, screenshot, workspaceId]);

  if (!visible || !anchor) return null;

  const title = synthesizeTitle(anchor, body);
  const descriptor = anchorDescriptor(anchor);

  return (
    <div
      className="friction-widget"
      data-component="FrictionWidget"
      style={widgetStyle}
      role="dialog"
      aria-label="Capture friction"
    >
      <div className="friction-widget__header">
        <span className="friction-widget__title" title={title}>
          {descriptor}
        </span>
        <button
          type="button"
          className="friction-widget__close"
          onClick={clearFriction}
          aria-label="Close"
        >
          <X size={14} strokeWidth={1.6} />
        </button>
      </div>

      <textarea
        className="friction-widget__body"
        placeholder="What's friction-y? (required)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        autoFocus
        data-component="FrictionWidgetBody"
      />

      <div
        className="friction-widget__screenshot"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        {screenshot ? (
          <div className="friction-widget__shot-preview">
            <img src={screenshot.previewUrl} alt="screenshot preview" />
            <button
              type="button"
              className="friction-widget__shot-clear"
              onClick={() => {
                URL.revokeObjectURL(screenshot.previewUrl);
                setScreenshot(null);
              }}
              aria-label="Remove screenshot"
            >
              <Trash2 size={12} strokeWidth={1.6} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="friction-widget__shot-empty"
            onClick={() => fileInputRef.current?.click()}
          >
            <ImageIcon size={16} strokeWidth={1.6} />
            <span>⌘V to paste · drop file · click to pick</span>
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => onPickFile(e.target.files?.[0])}
        />
      </div>

      <div className="friction-widget__chips" aria-hidden="true">
        <span className="friction-widget__chip">v{APP_VERSION}</span>
        <span className="friction-widget__chip">{anchor.kind}</span>
        {anchor.kind === "dom-element" && anchor.component && (
          <span className="friction-widget__chip">{anchor.component}</span>
        )}
      </div>

      {toast && (
        <div className="friction-widget__toast" data-kind={toast.kind} role="status">
          <span>{toast.message}</span>
          {toast.linkToTriage && (
            <button
              type="button"
              className="friction-widget__toast-link"
              onClick={() => {
                clearFriction();
                openDialog("settings");
              }}
            >
              Review
            </button>
          )}
        </div>
      )}

      <div className="friction-widget__actions">
        <button
          type="button"
          className="btn"
          onClick={cancelFrictionEditing}
          disabled={submitting}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn"
          data-variant="primary"
          onClick={onSubmit}
          disabled={!canSubmit}
        >
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </div>
    </div>
  );
}
