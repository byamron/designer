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
    const html = "<!doctype html><html><body><h1>Variant A</h1></body></html>";
    const { container } = renderBlock({ kind: "inline", body: html });
    const iframe = container.querySelector("iframe.prototype-frame");
    expect(iframe).not.toBeNull();
    // Sandbox attribute must omit allow-scripts; only forms + pointer-lock.
    expect(iframe!.getAttribute("sandbox")).toBe("allow-forms allow-pointer-lock");
    expect(iframe!.getAttribute("srcdoc")).toBe(html);
    expect(iframe!.getAttribute("title")).toBe("Onboarding flow A");
    // Placeholder is gone.
    expect(container.querySelector(".block__prototype-placeholder")).toBeNull();
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
