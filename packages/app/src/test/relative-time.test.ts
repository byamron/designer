import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "../util/time";

// CC3 — every chat message carries a relative-time label. Live
// conversations need "just now" / "10s ago" granularity for the first
// minute, then degrade gracefully so a scrollback wall of "1d ago" is
// never the only signal of when something happened.
describe("formatRelativeTime (CC3)", () => {
  const NOW = Date.parse("2026-04-30T12:00:00Z");

  it("returns 'just now' for the first 5 seconds", () => {
    expect(formatRelativeTime("2026-04-30T12:00:00Z", NOW)).toBe("just now");
    expect(formatRelativeTime("2026-04-30T11:59:58Z", NOW)).toBe("just now");
  });

  it("returns Ns for sub-minute deltas", () => {
    expect(formatRelativeTime("2026-04-30T11:59:50Z", NOW)).toBe("10s ago");
    expect(formatRelativeTime("2026-04-30T11:59:01Z", NOW)).toBe("59s ago");
  });

  it("returns Nm for sub-hour deltas", () => {
    expect(formatRelativeTime("2026-04-30T11:55:00Z", NOW)).toBe("5m ago");
    expect(formatRelativeTime("2026-04-30T11:01:00Z", NOW)).toBe("59m ago");
  });

  it("returns Nh for sub-day deltas", () => {
    expect(formatRelativeTime("2026-04-30T09:00:00Z", NOW)).toBe("3h ago");
  });

  it("returns 'yesterday' for ~1 day ago", () => {
    expect(formatRelativeTime("2026-04-29T12:00:00Z", NOW)).toBe("yesterday");
  });

  it("returns Nd for sub-week deltas", () => {
    expect(formatRelativeTime("2026-04-27T12:00:00Z", NOW)).toBe("3d ago");
  });

  it("falls back to a calendar form past a week", () => {
    const out = formatRelativeTime("2026-04-15T12:00:00Z", NOW);
    expect(out).toMatch(/Apr/);
  });

  it("returns empty string on an unparseable input rather than NaN noise", () => {
    expect(formatRelativeTime("not a date", NOW)).toBe("");
  });
});
