import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Image as ImageIcon, MapPin, Trash2, X } from "lucide-react";
import {
  clearFriction,
  clearFrictionAnchor,
  enterFrictionSelecting,
  openDialog,
  setFrictionAutoCapture,
  useAppState,
} from "../../store/app";
import { ipcClient } from "../../ipc/client";
import { anchorDescriptor, type Anchor } from "../../lib/anchor";
import type { StreamEvent } from "../../ipc/types";

const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? "0.1.0";

type ToastKind = "local" | "confirmed" | "failed";

interface ToastState {
  kind: ToastKind;
  message: string;
  /// When set on a `local`/`confirmed` toast, the toast renders an inline
  /// action that jumps to Settings → Activity → Friction. Frees the user
  /// from hunt-and-peck navigation after submit.
  linkToTriage?: boolean;
}

interface ScreenshotState {
  bytes: Uint8Array;
  filename: string;
  previewUrl: string;
  source: "paste" | "auto" | "drop" | "picker" | "viewport";
}

/**
 * Track 13.M FrictionWidget — composer-by-default surface.
 *
 * 13.K shipped a "selection-first" flow (arm → click an element → composer
 * appears). The four-perspective review found that for a solo dogfood user,
 * the most common case is "the thing I'm looking at right now is bad" — they
 * don't need to anchor, they need a fast capture. 13.M makes the composer
 * the default surface: ⌘⇧F mounts it bottom-right, body autofocused, body
 * alone is enough to submit. Anchor and screenshot demote to opt-in:
 *
 *   ⌘↵    submit
 *   ⌘⇧S   capture viewport (Tauri shells to `screencapture`)
 *   ⌘.    enter selection mode (composer hides; overlay arms)
 *   ESC   dismiss
 *
 * Hidden when a modal scrim is open (friction is inert in those states per
 * spec). Reuses the SelectionOverlay surface for the opt-in anchor path —
 * see `SelectionOverlay.tsx`.
 */
export function FrictionWidget() {
  const mode = useAppState((s) => s.frictionMode);
  const dialog = useAppState((s) => s.dialog);
  const anchor = useAppState((s) => s.frictionAnchor);
  const autoCapture = useAppState((s) => s.frictionAutoCapture);
  const workspaceId = useAppState((s) => s.activeWorkspace);
  const projectId = useAppState((s) => s.activeProject);
  const visible = mode === "composing" && dialog === null;

  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [screenshot, setScreenshot] = useState<ScreenshotState | null>(null);
  const [hiddenForCapture, setHiddenForCapture] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const widgetRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // Submitted-id is held in a ref so the stream-event subscriber (registered
  // once on mount) can compare against it without re-binding on every render.
  const submittedIdRef = useRef<string | null>(null);

  const screenshotRef = useRef<ScreenshotState | null>(null);
  useEffect(() => {
    screenshotRef.current = screenshot;
  }, [screenshot]);

  // Final cleanup on unmount: revoke any in-flight object URL so route
  // swaps / hot reloads don't leak the previewed PNG.
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

  // Reset on enter/exit of composer mode so re-opening sees a fresh widget.
  // Stale text from a previous session would confuse the user.
  useEffect(() => {
    if (mode === "composing") {
      // Adopting a previously-captured screenshot (e.g. ⌘⇧S then anchor)
      // happens when `frictionAutoCapture` is set in the store. Don't blow
      // away the body if the user is bouncing between composer ↔ selection.
      if (autoCapture && !screenshotRef.current) {
        adoptScreenshot(autoCapture.bytes, autoCapture.filename, "auto");
      }
    } else if (mode === "off") {
      setBody("");
      setSubmitting(false);
      setCapturing(false);
      setHiddenForCapture(false);
      setToast(null);
      submittedIdRef.current = null;
      setScreenshot((prev) => {
        if (prev) URL.revokeObjectURL(prev.previewUrl);
        return null;
      });
    }
  }, [mode, autoCapture, adoptScreenshot]);

  // Autofocus the body whenever the composer becomes visible. `autoFocus` on
  // the JSX alone misses the case where the user re-opens after selection
  // mode (the textarea is the same DOM node, no re-mount).
  useEffect(() => {
    if (visible && !hiddenForCapture) {
      bodyRef.current?.focus();
    }
  }, [visible, hiddenForCapture]);

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

  // ⌘⇧S — capture the viewport. Hides the composer for one paint frame so
  // it doesn't appear in its own screenshot, then calls into Rust to grab
  // PNG bytes via `screencapture`. Failures degrade with a toast rather
  // than blowing the composer away.
  const onCaptureViewport = useCallback(async () => {
    if (capturing || submitting) return;
    setCapturing(true);
    setHiddenForCapture(true);
    try {
      // Two rAFs: the first runs after the visibility:hidden style is
      // committed, the second runs after a paint has happened. Without
      // the second rAF the capture occasionally races and includes the
      // composer's pixels.
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      const bytes = await ipcClient().captureViewport();
      adoptScreenshot(bytes, `viewport-${Date.now()}.png`, "viewport");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToast({ kind: "failed", message: `Capture failed: ${msg}` });
    } finally {
      setHiddenForCapture(false);
      setCapturing(false);
    }
  }, [adoptScreenshot, capturing, submitting]);

  const canSubmit = body.trim().length > 0 && !submitting;

  // Build a "page-level" anchor when the user submitted without anchoring.
  // Reuses the existing `dom-element` Anchor variant per the locked contract;
  // no new variant needed.
  const fallbackAnchor = (route: string): Anchor => ({
    kind: "dom-element",
    selectorPath: "body",
    route,
    component: undefined,
    stableId: undefined,
    textSnippet: undefined,
  });

  const onSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const route = window.location.hash || window.location.pathname || "/";
      const submitAnchor: Anchor = anchor ?? fallbackAnchor(route);
      const resp = await ipcClient().reportFriction({
        anchor: submitAnchor,
        body: body.trim(),
        screenshot_data: screenshot ? Array.from(screenshot.bytes) : null,
        screenshot_filename: screenshot?.filename ?? null,
        workspace_id: workspaceId,
        project_id: projectId,
        route,
      });
      submittedIdRef.current = resp.friction_id;
      const tail = resp.friction_id.slice(-6);
      setToast({
        kind: "local",
        message: "Filed locally…",
        linkToTriage: false,
      });
      // Subscribe to the event stream and upgrade the toast to "Filed as
      // #abc123" once the projection confirms the report. The unsubscribe
      // handle lives on a local ref so we can clear it on dismiss/timeout.
      const unsubscribe = ipcClient().stream((event: StreamEvent) => {
        if (event.kind !== "friction_reported") return;
        const payload = event.payload as { friction_id?: string } | undefined;
        if (!payload || payload.friction_id !== submittedIdRef.current) return;
        setToast({
          kind: "confirmed",
          message: `Filed as #${tail}`,
          linkToTriage: true,
        });
      });
      // Close the widget after a beat so the user reads the toast.
      // Slightly longer than the local→confirmed delay (~50ms typical) so
      // the user actually sees the upgrade.
      setTimeout(() => {
        unsubscribe();
        clearFriction();
      }, 2200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToast({ kind: "failed", message: msg });
      setSubmitting(false);
    }
  }, [anchor, body, canSubmit, projectId, screenshot, workspaceId]);

  // Composer-level keymap: ⌘↵ submit, ⌘⇧S capture, ⌘. anchor, ESC dismiss.
  // Bound at the document level (not the textarea) so the user can hit ⌘↵
  // from the screenshot button or anywhere else inside the widget.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "Escape") {
        e.preventDefault();
        clearFriction();
        return;
      }
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "enter" || key === "return") {
        e.preventDefault();
        void onSubmit();
      } else if (e.shiftKey && key === "s") {
        e.preventDefault();
        void onCaptureViewport();
      } else if (!e.shiftKey && key === ".") {
        e.preventDefault();
        // Persist the current body draft via state — it survives the round
        // trip through selection mode because the widget stays mounted.
        setFrictionAutoCapture(
          screenshotRef.current
            ? { bytes: screenshotRef.current.bytes, filename: screenshotRef.current.filename }
            : null,
        );
        enterFrictionSelecting();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible, onSubmit, onCaptureViewport]);

  if (!visible) return null;

  const style: React.CSSProperties = hiddenForCapture
    ? { visibility: "hidden" }
    : {};

  return (
    <div
      ref={widgetRef}
      className="friction-widget"
      data-component="FrictionWidget"
      data-anchored={anchor ? "true" : "false"}
      style={style}
      role="dialog"
      aria-label="Capture friction"
    >
      <div className="friction-widget__header">
        <span className="friction-widget__title">Friction</span>
        <div className="friction-widget__header-actions">
          <button
            type="button"
            className="friction-widget__icon-btn"
            onClick={() => {
              setFrictionAutoCapture(
                screenshotRef.current
                  ? {
                      bytes: screenshotRef.current.bytes,
                      filename: screenshotRef.current.filename,
                    }
                  : null,
              );
              enterFrictionSelecting();
            }}
            aria-label="Anchor to element (⌘.)"
            title="Anchor to element (⌘.)"
          >
            <MapPin size={14} strokeWidth={1.6} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="friction-widget__icon-btn"
            onClick={() => void onCaptureViewport()}
            disabled={capturing}
            aria-label="Capture viewport (⌘⇧S)"
            title="Capture viewport (⌘⇧S)"
          >
            <Camera size={14} strokeWidth={1.6} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="friction-widget__close"
            onClick={clearFriction}
            aria-label="Close (ESC)"
            title="Close (ESC)"
          >
            <X size={14} strokeWidth={1.6} />
          </button>
        </div>
      </div>

      {anchor && (
        <div className="friction-widget__anchor-chip" data-component="FrictionAnchorChip">
          <MapPin size={12} strokeWidth={1.6} aria-hidden="true" />
          <span className="friction-widget__anchor-text">{anchorDescriptor(anchor)}</span>
          <button
            type="button"
            className="friction-widget__anchor-clear"
            onClick={clearFrictionAnchor}
            aria-label="Clear anchor"
            title="Clear anchor"
          >
            <X size={12} strokeWidth={1.6} aria-hidden="true" />
          </button>
        </div>
      )}

      <textarea
        ref={bodyRef}
        className="friction-widget__body"
        placeholder="What's friction-y?"
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
                setFrictionAutoCapture(null);
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
            <span>⌘⇧S to capture · ⌘V to paste · drop a file</span>
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
          onClick={clearFriction}
          disabled={submitting}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn"
          data-variant="primary"
          onClick={() => void onSubmit()}
          disabled={!canSubmit}
          data-component="FrictionWidgetSubmit"
        >
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </div>

      <div
        className="friction-widget__keyhints"
        data-component="FrictionKeyHints"
        aria-hidden="true"
      >
        <span>
          <kbd>⌘↵</kbd> submit
        </span>
        <span>
          <kbd>⌘⇧S</kbd> screenshot
        </span>
        <span>
          <kbd>⌘.</kbd> anchor
        </span>
        <span>
          <kbd>esc</kbd> dismiss
        </span>
      </div>

      <div className="friction-widget__chips" aria-hidden="true">
        <span className="friction-widget__chip">v{APP_VERSION}</span>
        {anchor && <span className="friction-widget__chip">{anchor.kind}</span>}
      </div>
    </div>
  );
}
