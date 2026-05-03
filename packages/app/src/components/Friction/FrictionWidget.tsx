import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Check, Image as ImageIcon, MapPin, Trash2, X } from "lucide-react";
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
import { prefersReducedMotion } from "../../theme";

/** Filed-slab read window before the widget begins fading out. Long enough
 *  that a screen reader can announce the polite-aria toast ("Filed as
 *  #abc123") before the widget unmounts (NVDA / VoiceOver typically
 *  delay 250–500 ms before they speak), short enough to not feel like a
 *  hang (frc_019de6f8). The slab's --motion-emphasized fade-in (400 ms)
 *  finishes well before this window does. */
const FRICTION_FILED_HOLD_MS = 600;

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
  /**
   * `data:image/...` URL used as the preview <img>'s src. We use a
   * data URL rather than `URL.createObjectURL` because the bundled
   * window's CSP only whitelists `'self' data:` for img-src — a
   * `blob:` URL silently fails to load (the friction report user saw
   * an empty preview after dropping a file). data URLs are slower
   * for huge images but the screenshot path here is < 1MB in
   * practice, and the bytes are still kept separately for upload.
   */
  previewUrl: string;
}

/**
 * Maximum image size for the friction preview. Above this, the file
 * is rejected with an inline error rather than silently failing.
 */
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024; // 10 MB

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
  const [closing, setClosing] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [screenshot, setScreenshot] = useState<ScreenshotState | null>(null);
  const [hiddenForCapture, setHiddenForCapture] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const adoptScreenshot = useCallback(
    (bytes: Uint8Array, filename: string, mimeType: string = "image/png") => {
      // Build a data: URL for the preview — `blob:` URLs are blocked
      // by the Tauri window CSP (img-src 'self' data:), so an
      // object-URL preview silently 404s. The byte buffer is still
      // kept verbatim for upload.
      let binary = "";
      // Chunk the loop to avoid blowing the stack on large buffers
      // when calling String.fromCharCode.apply with the spread form.
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const end = Math.min(i + chunkSize, bytes.length);
        binary += String.fromCharCode(...bytes.subarray(i, end));
      }
      const dataUrl = `data:${mimeType};base64,${btoa(binary)}`;
      setScreenshot({ bytes, filename, previewUrl: dataUrl });
    },
    [],
  );

  const clearScreenshot = useCallback(() => {
    setScreenshot(null);
  }, []);

  // Reset on full close. We avoid touching `screenshot` while bouncing into
  // selection mode — the widget stays mounted across mode flips, so state
  // persists naturally.
  useEffect(() => {
    if (mode === "off") {
      setBody("");
      setSubmitting(false);
      setSubmittedId(null);
      setClosing(false);
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

  // Validates an incoming file, reads its bytes, and feeds the
  // screenshot pipeline. Centralized so paste / pick / drop all
  // surface the same inline error shape on rejection rather than
  // silently dropping the file (the friction report's "no feedback"
  // root cause).
  const ingestFile = useCallback(
    async (file: File): Promise<void> => {
      if (!file.type.startsWith("image/")) {
        setToast({
          kind: "failed",
          message: "Only image files are supported.",
        });
        return;
      }
      if (file.size > MAX_SCREENSHOT_BYTES) {
        const mb = (file.size / (1024 * 1024)).toFixed(1);
        setToast({
          kind: "failed",
          message: `Image too large (${mb} MB; max 10 MB).`,
        });
        return;
      }
      const buf = new Uint8Array(await file.arrayBuffer());
      adoptScreenshot(buf, file.name || "image.png", file.type);
      // Clear any prior failure toast — a successful ingest replaces it.
      setToast((prev) => (prev?.kind === "failed" ? null : prev));
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
      await ingestFile(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [visible, ingestFile]);

  const onPickFile = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return;
      await ingestFile(file);
    },
    [ingestFile],
  );

  // Lift drag/drop onto the *entire* widget (not just the small
  // screenshot row) so the user can drop anywhere on the floating
  // composer. The original drop zone was a ~40px row at the bottom,
  // which is the proximate cause of "the file drop … doesn't work":
  // most drops landed on the textarea or the header and were lost
  // to the browser's default file-handling. preventDefault on
  // dragOver is what keeps the browser from navigating to the file.
  const onWidgetDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const onWidgetDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      await ingestFile(file);
    },
    [ingestFile],
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
  //
  // Closing cadence (frc_019de6f8): the filed slab fades in over the
  // composer interior, holds for FRICTION_FILED_HOLD_MS so the user
  // can read it, then the widget itself begins fading out. Unmount
  // is driven by the widget's `transitionend` (or immediately under
  // prefers-reduced-motion, where no transition fires) so the timing
  // collapses cleanly without a trailing setTimeout.
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
    const startCloseTimer = window.setTimeout(() => {
      setClosing(true);
    }, FRICTION_FILED_HOLD_MS);
    return () => {
      unsubscribe();
      window.clearTimeout(startCloseTimer);
    };
  }, [submittedId]);

  // When `closing` flips on, the widget gets `data-closing="true"` and
  // CSS fades opacity to 0 over --motion-emphasized. The transitionend
  // handler on the root node calls clearFriction() to unmount.
  // Reduced-motion users skip the transition entirely; schedule the
  // unmount on the next tick so the closing state still hits the DOM
  // before we tear down (avoids a flash of the "Filed." slab).
  useEffect(() => {
    if (!closing) return;
    if (!prefersReducedMotion()) return;
    const id = window.setTimeout(clearFriction, 0);
    return () => window.clearTimeout(id);
  }, [closing]);

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
      data-closing={closing ? "true" : undefined}
      style={style}
      role="dialog"
      aria-label="Capture friction"
      // Pair with `pointer-events: none` in CSS — once the widget is
      // closing, AT users should also see it as gone. The dialog
      // re-mounts on the next ⌘⇧F so this never gates a return path.
      aria-hidden={closing ? "true" : undefined}
      aria-keyshortcuts="Meta+Enter Meta+Shift+S Meta+Period Escape"
      onDragOver={onWidgetDragOver}
      onDrop={onWidgetDrop}
      onTransitionEnd={(e) => {
        // The widget root is the only element with an opacity
        // transition today, but a future child could grow one and
        // bubble a stray transitionend up to this handler. Restrict
        // to the root's own event so child motion can't tear the
        // widget down before the root fade finishes.
        if (e.target !== e.currentTarget) return;
        if (e.propertyName !== "opacity") return;
        if (!closing) return;
        clearFriction();
      }}
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

      <div className="friction-widget__screenshot">
        {screenshot ? (
          <div
            className="friction-widget__shot-preview"
            data-component="FrictionWidgetPreview"
          >
            <img
              src={screenshot.previewUrl}
              alt="screenshot preview"
              key={screenshot.previewUrl}
            />
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

      {submittedId && (
        // The slab is a *visual* confirmation; the existing toast
        // (role="status" aria-live="polite") owns the SR announcement.
        // Two simultaneous polite live-regions get either de-duped or
        // read twice — both are bad. Keep the slab silent for AT.
        <div
          className="friction-widget__filed-slab"
          data-component="FrictionFiledSlab"
          aria-hidden="true"
        >
          <Check
            className="friction-widget__filed-icon"
            size={20}
            strokeWidth={1.6}
            aria-hidden="true"
          />
          <span>Filed.</span>
        </div>
      )}
    </div>
  );
}
