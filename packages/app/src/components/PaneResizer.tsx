import { useCallback, useEffect, useRef, useState } from "react";
import { clampPaneWidth, PANE_MAX_WIDTH, PANE_MIN_WIDTH } from "../store/app";

/**
 * Edge drag handle for the workspace sidebar / activity spine. Pointer-move
 * writes in-memory (via `onLiveChange`); pointer-up flushes to the persisted
 * store (via `onCommit`). This is the key fix over an earlier draft that
 * synchronously wrote to localStorage on every pointermove — mobile Safari
 * serializes localStorage across tabs with a file lock, and a per-pixel
 * write cadence janked pane drags.
 *
 * Stickiness: as the dragged width approaches `defaultWidth`, the handle
 * snaps to it when the delta falls inside SNAP_RADIUS (12px). The snap
 * is one-shot per pass (tracked in snappedRef) so that once the user
 * keeps dragging past the default, the pane breaks free smoothly and
 * doesn't flicker. On entry to the snap zone we fire a subtle haptic
 * pulse via `navigator.vibrate` — where supported — to mimic macOS's
 * magnet-at-center pattern that Finder and Preview use.
 *
 * Keyboard: ← / → adjust by 16px (48px with shift) and commit immediately.
 * Double-click snaps to default and commits.
 */

const SNAP_RADIUS = 12;
const SNAP_RELEASE = 20;

export function PaneResizer({
  side,
  width,
  onLiveChange,
  onCommit,
  defaultWidth,
  ariaLabel,
}: {
  side: "left" | "right";
  width: number;
  onLiveChange: (w: number) => void;
  onCommit: () => void;
  defaultWidth: number;
  ariaLabel: string;
}) {
  const [dragging, setDragging] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const snappedRef = useRef(false);

  const signedDelta = useCallback(
    (deltaX: number) =>
      // side="right" (workspace sidebar, handle at right edge): drag-right grows.
      // side="left"  (activity spine, handle at left edge):     drag-right shrinks.
      side === "right" ? deltaX : -deltaX,
    [side],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      startXRef.current = e.clientX;
      startWidthRef.current = width;
      snappedRef.current = false;
      setDragging(true);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [width],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      const raw = startWidthRef.current + signedDelta(e.clientX - startXRef.current);
      const distance = Math.abs(raw - defaultWidth);
      let next = raw;
      if (!snappedRef.current && distance <= SNAP_RADIUS) {
        next = defaultWidth;
        snappedRef.current = true;
        // `navigator.vibrate` is the closest web approximation of a macOS
        // haptic tick. Unsupported browsers (Safari macOS) silently no-op
        // which matches the spec's best-effort contract.
        navigator.vibrate?.(8);
      } else if (snappedRef.current && distance >= SNAP_RELEASE) {
        snappedRef.current = false;
      } else if (snappedRef.current) {
        next = defaultWidth;
      }
      onLiveChange(clampPaneWidth(next));
    },
    [dragging, defaultWidth, onLiveChange, signedDelta],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      setDragging(false);
      const target = e.target as HTMLElement;
      if (target.hasPointerCapture?.(e.pointerId)) {
        target.releasePointerCapture(e.pointerId);
      }
      onCommit();
    },
    [dragging, onCommit],
  );

  const onDoubleClick = useCallback(() => {
    onLiveChange(clampPaneWidth(defaultWidth));
    onCommit();
  }, [defaultWidth, onLiveChange, onCommit]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 48 : 16;
      const towards = (dir: 1 | -1) => {
        e.preventDefault();
        onLiveChange(clampPaneWidth(width + signedDelta(dir * step)));
        onCommit();
      };
      if (e.key === "ArrowRight") towards(1);
      else if (e.key === "ArrowLeft") towards(-1);
    },
    [onCommit, onLiveChange, signedDelta, width],
  );

  useEffect(() => {
    if (!dragging) return;
    const prev = document.body.style.cursor;
    document.body.style.cursor = "col-resize";
    return () => {
      document.body.style.cursor = prev;
    };
  }, [dragging]);

  return (
    <div
      role="separator"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={PANE_MIN_WIDTH}
      aria-valuemax={PANE_MAX_WIDTH}
      tabIndex={0}
      className="pane-resizer"
      data-side={side}
      data-dragging={dragging ? "true" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
    />
  );
}
