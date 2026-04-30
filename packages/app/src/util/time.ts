/**
 * Relative-time formatter. Designed for chat message metadata where a
 * full timestamp is overkill but knowing "just now" vs "10m ago" vs
 * "yesterday" is the difference between a live conversation and a
 * scrollback wall. Tuned for under-a-minute granularity since the
 * agent stream lands quickly.
 *
 * Returns a string suitable for inline display. Pair with the absolute
 * `iso` string in a `title` attribute for hover precision.
 */
export function formatRelativeTime(
  iso: string,
  now: number = Date.now(),
): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const deltaSec = Math.round((now - t) / 1000);
  if (deltaSec < 5) return "just now";
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const deltaMin = Math.round(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin}m ago`;
  const deltaHr = Math.round(deltaMin / 60);
  if (deltaHr < 24) return `${deltaHr}h ago`;
  const deltaDay = Math.round(deltaHr / 24);
  if (deltaDay === 1) return "yesterday";
  if (deltaDay < 7) return `${deltaDay}d ago`;
  // Past a week, fall back to a short calendar form. The user is
  // looking at scrollback at this point — knowing it was "Mar 12" is
  // more useful than "12d ago".
  return new Date(t).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
