import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Image as ImageIcon, MapPin, Trash2, X } from "lucide-react";
import {
  clearFriction,
  clearFrictionAnchor,
  enterFrictionSelecting,
  openDialog,
  useAppState,
} from "../../store/app";
import { ipcClient } from "../../ipc/client";
import { anchorDescriptor, pageAnchorForRoute, type Anchor } from "../../lib/anchor";
import { EVENT_KIND, type StreamEvent } from "../../ipc/types";

type ToastKind = "local" | "confirmed" | "failed";

interface ToastState {
  kind: ToastKind;
  message: string;
  /** Inline action that jumps to Settings → Activity → Friction. */
  linkToTriage?: boolean;
}

interface ScreenshotState {
  bytes: Uint8Array;
  filename: string;
  previewUrl: string;
}

const HIDDEN_STYLE: React.CSSProperties = { visibility: "hidden" };

const KEYHINTS: ReadonlyArray<{ keys: string; label: string }> = [
  { keys: "⌘↵", label: "submit" },
  { keys: "⌘⇧S", label: "screenshot" },
  { keys: "⌘.", label: "anchor" },
  { keys: "esc", label: "dismiss" },
];

/**
 * Track 13.M FrictionWidget — composer-by-default surface.
 *
 * 13.K shipped a "selection-first" flow (arm → click element → composer
 * appears). The four-perspective review found that for a solo dogfood user
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
 * Hidden when a modal scrim is open. The widget stays mounted across
 * `mode` transitions (returns null when not "composing") so component
 * state — body draft, screenshot — survives the round-trip through
 * selection mode.
 */
export function FrictionWidget() {
  const mode = useAppState((s) => s.frictionMode);
  const dialog = useAppState((s) => s.dialog);
  const anchor = useAppState((s) => s.frictionAnchor);
  const workspaceId = useAppState((s) => s.activeWorkspace);
  const projectId = useAppState((s) => s.activeProject);
  const visible = mode === "composing" && dialog === null;

  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [screenshot, setScreenshot] = useState<ScreenshotState | null>(null);
  const [hiddenForCapture, setHiddenForCapture] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Final cleanup on unmount: revoke any in-flight object URL so route
  // swaps / hot reloads don't leak the previewed PNG. The closure captures
  // the *current* screenshot via state-setter access, so we don't need a
  // ref-mirror.
  useEffect(() => {
    return () => {
      setScreenshot((cur) => {
        if (cur) URL.revokeObjectURL(cur.previewUrl);
        return null;
      });
    };
  }, []);

  const adoptScreenshot = useCallback((bytes: Uint8Array, filename: string) => {
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
      };
    });
  }, []);

  const clearScreenshot = useCallback(() => {
    setScreenshot((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  }, []);

  // Reset on full close. We avoid touching `screenshot` while bouncing into
  // selection mode — the widget stays mounted across mode flips, so state
  // persists naturally.
  useEffect(() => {
    if (mode === "off") {
      setBody("");
      setSubmitting(false);
      setSubmittedId(null);
      setCapturing(false);
      setHiddenForCapture(false);
      setToast(null);
      clearScreenshot();
    }
  }, [mode, clearScreenshot]);

  // Autofocus the body whenever the composer becomes visible. `autoFocus`
  // on the JSX alone misses the case where the user re-opens after
  // selection mode (the textarea is the same DOM node, no re-mount).
  useEffect(() => {
    if (visible && !hiddenForCapture) {
      bodyRef.current?.focus({ preventScroll: true });
    }
  }, [visible, hiddenForCapture]);

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
      adoptScreenshot(buf, file.name || "paste.png");
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [visible, adoptScreenshot]);

  const onPickFile = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return;
      const buf = new Uint8Array(await file.arrayBuffer());
      adoptScreenshot(buf, file.name);
    },
    [adoptScreenshot],
  );

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      const buf = new Uint8Array(await file.arrayBuffer());
      adoptScreenshot(buf, file.name);
    },
    [adoptScreenshot],
  );

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
      adoptScreenshot(bytes, `viewport-${Date.now()}.png`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToast({ kind: "failed", message: `Capture failed: ${msg}` });
    } finally {
      setHiddenForCapture(false);
      setCapturing(false);
    }
  }, [adoptScreenshot, capturing, submitting]);

  const canSubmit = body.trim().length > 0 && !submitting && submittedId === null;

  const onSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const route = window.location.hash || window.location.pathname || "/";
      const submitAnchor: Anchor = anchor ?? pageAnchorForRoute(route);
      const resp = await ipcClient().reportFriction({
        anchor: submitAnchor,
        body: body.trim(),
        screenshot_data: screenshot ? Array.from(screenshot.bytes) : null,
        screenshot_filename: screenshot?.filename ?? null,
        workspace_id: workspaceId,
        project_id: projectId,
        route,
      });
      setSubmittedId(resp.friction_id);
      setSubmitting(false);
      setToast({ kind: "local", message: "Filed locally" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToast({ kind: "failed", message: msg });
      setSubmitting(false);
    }
  }, [anchor, body, canSubmit, projectId, screenshot, workspaceId]);

  // After a successful submit, subscribe to the event stream and upgrade
  // the toast to "Filed as #abc123" once the projection confirms the
  // report. Effect-managed so React tears the subscription down on
  // unmount or follow-up submits without leaking listeners.
  useEffect(() => {
    if (!submittedId) return;
    const tail = submittedId.slice(-6);
    const unsubscribe = ipcClient().stream((event: StreamEvent) => {
      if (event.kind !== EVENT_KIND.FRICTION_REPORTED) return;
      const payload = event.payload as { friction_id?: string } | undefined;
      if (payload?.friction_id !== submittedId) return;
      setToast({
        kind: "confirmed",
        message: `Filed as #${tail}`,
        linkToTriage: true,
      });
    });
    // Close the widget after a beat so the user sees the upgrade.
    const closeTimer = window.setTimeout(clearFriction, 2200);
    return () => {
      unsubscribe();
      window.clearTimeout(closeTimer);
    };
  }, [submittedId]);

  // Composer-level keymap: ⌘↵ submit, ⌘⇧S capture, ⌘. anchor, ESC dismiss.
  // Bound at the document level so the user can hit ⌘↵ from the screenshot
  // button or anywhere else inside the widget.
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
        enterFrictionSelecting();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible, onSubmit, onCaptureViewport]);

  if (!visible) return null;

  const style = hiddenForCapture ? HIDDEN_STYLE : undefined;
  const submitLabel = submitting
    ? "Submitting…"
    : submittedId
      ? "Filed"
      : "Submit";

  return (
    <div
      className="friction-widget"
      data-component="FrictionWidget"
      data-anchored={anchor ? "true" : "false"}
      style={style}
      role="dialog"
      aria-label="Capture friction"
      aria-keyshortcuts="Meta+Enter Meta+Shift+S Meta+Period Escape"
    >
      <div className="friction-widget__header">
        <span className="friction-widget__title">Friction</span>
        <div className="friction-widget__header-actions">
          <button
            type="button"
            className="friction-widget__icon-btn"
            onClick={enterFrictionSelecting}
            aria-label="Anchor to element (⌘.)"
            aria-keyshortcuts="Meta+Period"
            title="Anchor to element (⌘.)"
          >
            <MapPin size={14} strokeWidth={1.6} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="friction-widget__icon-btn"
            onClick={() => void onCaptureViewport()}
            disabled={capturing || submitting}
            aria-label="Capture viewport (⌘⇧S)"
            aria-keyshortcuts="Meta+Shift+S"
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
            <X size={14} strokeWidth={1.6} aria-hidden="true" />
          </button>
        </div>
      </div>

      {anchor && (
        <div
          className="friction-widget__anchor-chip"
          data-component="FrictionAnchorChip"
        >
          <MapPin size={12} strokeWidth={1.6} aria-hidden="true" />
          <span className="friction-widget__anchor-text">
            {anchorDescriptor(anchor)}
          </span>
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
              onClick={clearScreenshot}
              aria-label="Remove screenshot"
            >
              <Trash2 size={12} strokeWidth={1.6} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="friction-widget__shot-empty"
            onClick={() => fileInputRef.current?.click()}
          >
            <ImageIcon size={16} strokeWidth={1.6} aria-hidden="true" />
            <span>Drop · paste · click to pick</span>
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
        <div
          className="friction-widget__toast"
          data-kind={toast.kind}
          role="status"
          aria-live="polite"
        >
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
          {submitLabel}
        </button>
      </div>

      <div
        className="friction-widget__keyhints"
        data-component="FrictionKeyHints"
        aria-hidden="true"
      >
        {KEYHINTS.map(({ keys, label }) => (
          <span key={label}>
            <kbd>{keys}</kbd> {label}
          </span>
        ))}
      </div>
    </div>
  );
}
