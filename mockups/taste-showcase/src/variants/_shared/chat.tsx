// Shared chat-shell helpers used across cycle-2 variants.
// All variants honor: centered narrow column, filled-bubble user / flat-prose agent,
// coalesced tool-call header, scroll-to-bottom pill, compose dock at the bottom.
// Variant-specific lens pushes layer on top via their own components and CSS.

import type { ToolCallArtifact, Artifact } from "./types";

export type Group =
  | { kind: "single"; a: Artifact }
  | { kind: "tool-run"; calls: ToolCallArtifact[]; messages: number };

/**
 * Group consecutive tool calls (and adjacent micro-messages-from-agent that
 * belong to the same thinking burst) into one "tool-run" group. Other artifacts
 * pass through as singles. Designer's live ref renders these as
 * "N tool calls, M messages" headers with caption-log lines beneath.
 */
export function groupArtifacts(artifacts: Artifact[]): Group[] {
  const out: Group[] = [];
  for (const a of artifacts) {
    const prev = out[out.length - 1];
    if (a.kind === "tool-call") {
      if (prev && prev.kind === "tool-run") {
        prev.calls.push(a);
      } else {
        out.push({ kind: "tool-run", calls: [a], messages: 0 });
      }
    } else {
      out.push({ kind: "single", a });
    }
  }
  return out;
}

/** Truncate a string to maxLen with an ellipsis. */
export function truncate(s: string, maxLen = 64): string {
  return s.length > maxLen ? s.slice(0, maxLen - 1) + "…" : s;
}
