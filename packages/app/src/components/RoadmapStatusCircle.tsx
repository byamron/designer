import type { NodeStatus } from "../ipc/client";

/**
 * RoadmapStatusCircle — the conic-arc status glyph for the roadmap canvas.
 *
 * Forked from `WorkspaceStatusIcon` (which is a Lucide-glyph wrapper) per
 * staff design-engineer review: the canvas needs an animated SVG arc, not
 * a glyph swap. Sharing the file would have broken every workspace row
 * the day we wired the conic-arc transition.
 *
 * Implementation: SVG circle with `stroke-dasharray` + `stroke-dashoffset`
 * for the partial-fill states. CSS `conic-gradient` does NOT transition
 * between stops (a known bug across browsers — confirmed in the spec), so
 * we draw the arc as a stroked path instead. Reduced-motion: instant flip
 * (no transition) via the `@media (prefers-reduced-motion: reduce)` rule
 * in `roadmap.css`.
 *
 * Minimum render size: `--icon-md` (14 px). Below that the dasharray
 * progression reads as a tick, not an arc — fall back to a filled dot at
 * the corresponding semantic color via the `data-tiny` attribute.
 */

export type RoadmapStatusVariant = "team" | "neutral" | "shipped";

export interface RoadmapStatusCircleProps {
  status: NodeStatus;
  /** Optional inline CSS color used for partially-filled states. */
  accentColor?: string;
  /** Render at 12 px instead of 14 px → fall back to filled dot. */
  tiny?: boolean;
  /** ARIA-friendly name for the rendered status. */
  ariaLabel?: string;
}

const STATUS_TO_FILL_PCT: Record<NodeStatus, number> = {
  backlog: 0,
  todo: 0,
  blocked: 0,
  "in-progress": 0.5,
  "in-review": 0.85,
  done: 1,
  canceled: 0,
};

const STATUS_LABEL: Record<NodeStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  "in-progress": "In progress",
  "in-review": "In review",
  done: "Done",
  canceled: "Canceled",
  blocked: "Blocked",
};

export function RoadmapStatusCircle({
  status,
  accentColor,
  tiny,
  ariaLabel,
}: RoadmapStatusCircleProps) {
  const label = ariaLabel ?? STATUS_LABEL[status];

  if (tiny) {
    // Below 14px, dasharray segments read as ticks, not arcs. Fall back
    // to a filled dot at the semantic color.
    return (
      <span
        className="roadmap-status-circle"
        data-status={status}
        data-tiny="true"
        aria-label={label}
        title={label}
      >
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <circle
            cx="6"
            cy="6"
            r="4"
            fill={status === "backlog" || status === "todo" ? "transparent" : "currentColor"}
            stroke="currentColor"
            strokeWidth="1"
          />
        </svg>
      </span>
    );
  }

  // Standard 14px size.
  // r=6, circumference = 2πr ≈ 37.699.
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  const fill = STATUS_TO_FILL_PCT[status];
  const dashLen = circumference * fill;
  const gapLen = circumference - dashLen;
  const isShipped = status === "done";
  const isCanceled = status === "canceled";

  return (
    <span
      className="roadmap-status-circle"
      data-status={status}
      data-tiny="false"
      aria-label={label}
      title={label}
      style={accentColor ? { color: accentColor } : undefined}
    >
      <svg
        viewBox="0 0 14 14"
        width="14"
        height="14"
        aria-hidden="true"
        className="roadmap-status-circle__svg"
      >
        {/* Track: always visible. */}
        <circle
          cx="7"
          cy="7"
          r={radius}
          fill="transparent"
          stroke="currentColor"
          strokeOpacity="0.3"
          strokeWidth="1.25"
        />
        {/* Filled segment: animated stroke-dasharray for InProgress/InReview. */}
        {fill > 0 && fill < 1 && (
          <circle
            cx="7"
            cy="7"
            r={radius}
            fill="transparent"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="butt"
            strokeDasharray={`${dashLen} ${gapLen}`}
            transform="rotate(-90 7 7)"
            className="roadmap-status-circle__arc"
          />
        )}
        {/* Done: solid fill + checkmark. */}
        {isShipped && (
          <>
            <circle
              cx="7"
              cy="7"
              r={radius}
              fill="var(--color-success, currentColor)"
              stroke="var(--color-success, currentColor)"
              strokeWidth="1.25"
            />
            <path
              d="M4.5 7.2 L6.2 8.9 L9.5 5.4"
              stroke="var(--color-on-success, white)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </>
        )}
        {/* Canceled: diagonal slash. */}
        {isCanceled && (
          <line
            x1="3.5"
            y1="3.5"
            x2="10.5"
            y2="10.5"
            stroke="currentColor"
            strokeOpacity="0.6"
            strokeWidth="1.25"
            strokeLinecap="round"
          />
        )}
      </svg>
    </span>
  );
}
