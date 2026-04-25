import { useMemo, useState } from "react";
import type { Workspace } from "../ipc/types";
import { AnnotationLayer } from "./AnnotationLayer";
import { VariantExplorer } from "./VariantExplorer";

/**
 * Sandboxed prototype preview. Strategy:
 *
 *   1. Build the full HTML document as a string (agent-authored content).
 *   2. Prepend a `<meta http-equiv="Content-Security-Policy">` with strict
 *      defaults — `default-src 'none'; style-src 'self' 'unsafe-inline'; ...`
 *      mirroring the Rust-side `CspBuilder::strict()`.
 *   3. Serve via `srcdoc` on an iframe with `sandbox="allow-forms allow-pointer-lock"`.
 *      `allow-scripts` is intentionally omitted; no JS executes.
 *
 * This is the Phase 10 deliverable: agent-produced prototypes never run in the
 * trust context. The CSP + sandbox combination enforces that.
 *
 * Phase 13.F adds the `inlineHtml` form: the workspace-thread `PrototypeBlock`
 * passes the artifact's inline payload directly. The component skips the
 * variant explorer in that mode and renders just the sandboxed iframe.
 */
type PrototypePreviewProps =
  | { workspace: Workspace; inlineHtml?: undefined }
  | { workspace?: undefined; inlineHtml: string; title?: string };

export function PrototypePreview(props: PrototypePreviewProps) {
  if (props.inlineHtml !== undefined) {
    return (
      <iframe
        title={props.title ?? "Prototype"}
        className="prototype-frame"
        sandbox="allow-forms allow-pointer-lock"
        srcDoc={props.inlineHtml}
      />
    );
  }
  return <PrototypePreviewLab workspace={props.workspace!} />;
}

function PrototypePreviewLab({ workspace }: { workspace: Workspace }) {
  const [variant, setVariant] = useState<"A" | "B" | "C">("A");
  const [showAnnotations, setShowAnnotations] = useState(true);

  const html = useMemo(() => buildVariant(variant, workspace.name), [variant, workspace.name]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
        <VariantExplorer selected={variant} onSelect={setVariant} />
        <div style={{ flex: 1 }} />
        <label
          style={{
            display: "inline-flex",
            gap: "var(--space-1)",
            alignItems: "center",
            color: "var(--color-muted)",
            fontSize: "var(--type-caption-size)",
          }}
        >
          <input
            type="checkbox"
            checked={showAnnotations}
            onChange={(e) => setShowAnnotations(e.target.checked)}
            title="Show the annotation overlay on this prototype"
          />
          Annotations
        </label>
      </div>

      <div style={{ position: "relative" }}>
        <iframe
          title={`Prototype ${variant}`}
          className="prototype-frame"
          sandbox="allow-forms allow-pointer-lock"
          srcDoc={html}
        />
        {showAnnotations && <AnnotationLayer variant={variant} />}
      </div>

      <p
        style={{
          margin: 0,
          color: "var(--color-muted)",
          fontSize: "var(--type-caption-size)",
          fontFamily: "var(--type-family-mono)",
        }}
        aria-live="polite"
      >
        CSP: default-src 'none' · script-src 'none' · style-src 'self' 'unsafe-inline' · object-src 'none' · iframe sandbox allow-forms,pointer-lock
      </p>
    </div>
  );
}

function buildVariant(variant: "A" | "B" | "C", workspaceName: string): string {
  // NOTE: this is deliberately a plain string; agents would supply it from
  // their rendering output. The key invariant is that we *never* run any
  // script the agent emits — CSP + sandbox enforce this.
  const content = variantContent(variant, workspaceName);
  const csp = [
    "default-src 'none'",
    "script-src 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'none'",
    "font-src 'self' data:",
    "frame-src 'none'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "worker-src 'none'",
  ].join("; ");
  return `<!doctype html><html lang="en"><head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <style>
      /* Sandboxed agent-authored content. Uses CSS system colors so the
       * prototype blends with the host's light/dark scheme automatically —
       * the agent doesn't need to know Designer's token set. */
      html, body { margin: 0; padding: 1.5rem; font: 0.875rem/1.4 ui-sans-serif, system-ui; background: Canvas; color: CanvasText; }
      h1 { font-size: 1.75rem; margin: 0 0 0.75rem; letter-spacing: -0.02em; }
      p { margin: 0 0 0.75rem; }
      .primary { display: inline-block; padding: 0.5rem 0.875rem; border-radius: 0.375rem; background: CanvasText; color: Canvas; border: none; font: inherit; cursor: pointer; }
      .card { border: 0.0625rem solid GrayText; border-radius: 0.625rem; padding: 1rem; margin: 1rem 0; background: Canvas; }
      .muted { color: GrayText; }
      .row { display: flex; gap: 0.75rem; align-items: center; margin-top: 1rem; }
    </style>
  </head><body>${content}</body></html>`;
}

function variantContent(variant: "A" | "B" | "C", workspaceName: string): string {
  const shared = `<h1>Welcome to ${escape(workspaceName)}</h1>`;
  if (variant === "A") {
    return `${shared}
      <p>Variant A — calm-by-default copy. Three steps, then a primary CTA.</p>
      <div class="card"><p><strong>Step 1.</strong> Introduce yourself.</p></div>
      <div class="card"><p><strong>Step 2.</strong> Pick what you want to build.</p></div>
      <div class="card"><p><strong>Step 3.</strong> Invite your team.</p></div>
      <div class="row"><button class="primary">Start</button><span class="muted">~2 min</span></div>`;
  }
  if (variant === "B") {
    return `${shared}
      <p>Variant B — two-column hero. Short on the left, testimony on the right.</p>
      <div class="card">
        <p><strong>You set direction.</strong> Agents handle execution. Git becomes plumbing.</p>
        <p class="muted">"The first tool that matched my mental model." — early user</p>
        <div class="row"><button class="primary">Start</button></div>
      </div>`;
  }
  return `${shared}
      <p>Variant C — sparser, confident.</p>
      <p>One workspace. One outcome. A team that ships.</p>
      <div class="row"><button class="primary">Start now</button></div>`;
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
