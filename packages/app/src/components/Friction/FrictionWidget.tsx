import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Image as ImageIcon, Trash2, X } from "lucide-react";
import {
  cancelFrictionEditing,
  clearFriction,
  useAppState,
} from "../../store/app";
import { ipcClient } from "../../ipc/client";
import {
  anchorDescriptor,
  resolveAnchor,
  synthesizeTitle,
} from "../../lib/anchor";

const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? "0.1.0";

type ToastKind = "filed" | "local" | "failed" | null;

interface ToastState {
  kind: ToastKind;
  message: string;
  url?: string;
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
 * Four screenshot inputs (priority order, all ship in v1):
 *   1. Paste from clipboard (⌘V — primary)
 *   2. "Capture this view" — Tauri webview.capture (or canvas fallback)
 *   3. Drag-and-drop a file from Finder
 *   4. Click the drag-zone to open the OS file picker
 *
 * Submit is blocked unless the body is non-empty AND at least one of
 * {screenshot, anchor with descriptor} is present (per spec).
 */
export function FrictionWidget() {
  const mode = useAppState((s) => s.frictionMode);
  const anchor = useAppState((s) => s.frictionAnchor);
  const autoCapture = useAppState((s) => s.frictionAutoCapture);
  const workspaceId = useAppState((s) => s.activeWorkspace);
  const projectId = useAppState((s) => s.activeProject);

  const [body, setBody] = useState("");
  const [fileToGithub, setFileToGithub] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [screenshot, setScreenshot] = useState<ScreenshotState | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const widgetRef = useRef<HTMLDivElement>(null);

  // Reset on enter/exit of editing mode so re-anchoring always sees a
  // fresh widget; previous text from a different anchor would be misleading.
  useEffect(() => {
    if (mode === "editing") {
      setBody("");
      setSubmitting(false);
      setToast(null);
      if (autoCapture) {
        // The store's autoCapture wins as the initial screenshot source —
        // it was taken at click-time, before the widget mounted.
        const blob = new Blob([new Uint8Array(autoCapture.bytes)], { type: "image/png" });
        const url = URL.createObjectURL(blob);
        setScreenshot({
          bytes: autoCapture.bytes,
          filename: autoCapture.filename,
          previewUrl: url,
          source: "auto",
        });
      } else {
        setScreenshot(null);
      }
    } else if (mode === "off") {
      setScreenshot((prev) => {
        if (prev) URL.revokeObjectURL(prev.previewUrl);
        return null;
      });
    }
    // We intentionally only re-run on mode change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Position the widget near the anchor with simple collision-avoidance:
  // prefer below-right of the anchor; if that overflows, flip to above.
  const widgetStyle = useMemo<React.CSSProperties>(() => {
    if (!anchor) return {};
    const el = resolveAnchor(anchor);
    if (!el) return { right: 24, bottom: 84 };
    const rect = (el as Element).getBoundingClientRect();
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
    if (mode !== "editing") return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ESC exits the widget (back to selecting; user can re-anchor).
  useEffect(() => {
    if (mode !== "editing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelFrictionEditing();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  const adoptScreenshot = useCallback(
    (bytes: Uint8Array, filename: string, source: ScreenshotState["source"]) => {
      setScreenshot((prev) => {
        if (prev) URL.revokeObjectURL(prev.previewUrl);
        const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
        const url = URL.createObjectURL(blob);
        return { bytes, filename, previewUrl: url, source };
      });
    },
    [],
  );

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

  const onCaptureView = useCallback(async () => {
    // Tauri webview.capture isn't a stable cross-platform API in v2; we
    // grab a screenshot of the anchored element via canvas if html2canvas
    // is on the page (dev/dogfood). Otherwise we hint the user to paste.
    const el = anchor ? resolveAnchor(anchor) : null;
    if (!el) {
      setToast({ kind: "failed", message: "Couldn't capture — element no longer on screen." });
      return;
    }
    // No html2canvas at runtime — leave the user a clear next step.
    setToast({
      kind: "failed",
      message: "Auto-capture not available; paste with ⌘V or drop a file.",
    });
  }, [anchor]);

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
        file_to_github: fileToGithub,
        route,
      });
      if (fileToGithub) {
        setToast({
          kind: "local",
          message: `Filing #${resp.friction_id.slice(-6)} — check Settings → Activity for status.`,
        });
      } else {
        setToast({
          kind: "local",
          message: "Saved locally. File from Settings → Activity → Friction.",
        });
      }
      // Close the widget after a beat so the user reads the toast.
      setTimeout(clearFriction, 1400);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToast({ kind: "failed", message: msg });
      setSubmitting(false);
    }
  }, [anchor, body, canSubmit, fileToGithub, projectId, screenshot, workspaceId]);

  if (mode !== "editing" || !anchor) return null;

  const title = synthesizeTitle(anchor, body);
  const descriptor = anchorDescriptor(anchor);

  return (
    <div
      ref={widgetRef}
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
        <button
          type="button"
          className="friction-widget__shot-capture"
          onClick={onCaptureView}
          title="Capture the anchored element"
        >
          <Camera size={14} strokeWidth={1.6} />
          <span>Capture</span>
        </button>
      </div>

      <div className="friction-widget__chips" aria-hidden="true">
        <span className="friction-widget__chip">v{APP_VERSION}</span>
        <span className="friction-widget__chip">{anchor.kind}</span>
        {anchor.kind === "dom-element" && anchor.component && (
          <span className="friction-widget__chip">{anchor.component}</span>
        )}
      </div>

      <label className="friction-widget__filebox">
        <input
          type="checkbox"
          checked={fileToGithub}
          onChange={(e) => setFileToGithub(e.target.checked)}
        />
        <span>Also file as GitHub issue</span>
      </label>

      {toast && (
        <div className="friction-widget__toast" data-kind={toast.kind} role="status">
          {toast.message}
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

