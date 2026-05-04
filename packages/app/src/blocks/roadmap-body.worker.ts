/**
 * Roadmap body markdown → HTML worker (Phase 22.A).
 *
 * Bodies are byte slices into `RoadmapTreeView.source`. The main thread
 * extracts the slice and posts it here; the worker renders to HTML and
 * posts back. Off-main-thread keeps the canvas fluid when a user expands
 * a chunky body section while presence updates are streaming.
 *
 * Bundle: `marked` (~30 KB gzipped) — adequate, simpler than micromark,
 * doesn't pull a CommonMark spec test suite into the bundle.
 */

import { marked } from "marked";

export interface BodyRenderRequest {
  /** Stable id so the main thread can match responses to nodes. */
  reqId: string;
  /** The markdown body slice (already extracted on the main thread). */
  body: string;
}

export interface BodyRenderResponse {
  reqId: string;
  html: string;
  error?: string;
}

marked.setOptions({
  // We're rendering trusted local markdown — no need for the heavier
  // sanitizer stack. Designer's own roadmap.md is the input.
  gfm: true,
  breaks: false,
});

self.addEventListener("message", (event: MessageEvent<BodyRenderRequest>) => {
  const { reqId, body } = event.data;
  try {
    const html = marked.parse(body, { async: false }) as string;
    const response: BodyRenderResponse = { reqId, html };
    (self as unknown as Worker).postMessage(response);
  } catch (err) {
    const response: BodyRenderResponse = {
      reqId,
      html: "",
      error: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(response);
  }
});
