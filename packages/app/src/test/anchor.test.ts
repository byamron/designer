// Anchor enum — round-trip + smart-snap + stale-detection coverage.
// Locked contract per Track 13.K spec (`core-docs/roadmap.md`).

import { describe, expect, it } from "vitest";
import {
  anchorDescriptor,
  anchorFromElement,
  resolveAnchor,
  selectorFor,
  snapTarget,
  synthesizeTitle,
  type Anchor,
} from "../lib/anchor";

describe("Anchor", () => {
  it("snapTarget walks up to the nearest data-component ancestor", () => {
    document.body.innerHTML = `
      <main>
        <section data-component="WorkspaceSidebar">
          <ul>
            <li role="row" data-track-id="trk_1"><span class="atom">Track A</span></li>
          </ul>
        </section>
      </main>
    `;
    const atom = document.querySelector(".atom") as HTMLElement;
    expect(atom).not.toBeNull();
    const snap = snapTarget(atom)!;
    // Closest snap target is the row (carries role + stable id), not the
    // outer component shell. Holding Alt would override to `atom` itself.
    expect((snap as HTMLElement).getAttribute("role")).toBe("row");
  });

  it("snapTarget returns null when no snap-eligible ancestor exists", () => {
    document.body.innerHTML = `<div><p>just text</p></div>`;
    const p = document.querySelector("p")!;
    expect(snapTarget(p)).toBeNull();
  });

  it("selectorFor prefers data-component + stable-id qualifier", () => {
    document.body.innerHTML = `
      <div data-component="WorkspaceSidebar" data-workspace-id="ws_1">x</div>
    `;
    const el = document.querySelector("div")!;
    expect(selectorFor(el)).toBe(
      `[data-component="WorkspaceSidebar"][data-workspace-id="ws_1"]`,
    );
  });

  it("anchorFromElement -> resolveAnchor round-trips to the same element", () => {
    document.body.innerHTML = `
      <div data-component="ComposeDock" data-workspace-id="ws_42">
        <span>compose</span>
      </div>
    `;
    const el = document.querySelector("[data-component='ComposeDock']")!;
    const anchor = anchorFromElement(el, "/workspace/ws_42");
    expect(anchor.kind).toBe("dom-element");
    const back = resolveAnchor(anchor);
    expect(back).toBe(el);
  });

  it("resolveAnchor returns null when the element no longer exists", () => {
    document.body.innerHTML = `<div data-component="ComposeDock">a</div>`;
    const anchor = anchorFromElement(
      document.querySelector("[data-component='ComposeDock']")!,
      "/r",
    );
    document.body.innerHTML = "";
    expect(resolveAnchor(anchor)).toBeNull();
  });

  it("synthesizeTitle is descriptor + first 60 chars of body", () => {
    const anchor: Anchor = {
      kind: "dom-element",
      selectorPath: "x",
      route: "/r",
      component: "WorkspaceSidebar",
    };
    expect(synthesizeTitle(anchor, "the row layout looks off when collapsed")).toBe(
      "WorkspaceSidebar: the row layout looks off when collapsed",
    );
    const long = "x".repeat(120);
    const out = synthesizeTitle(anchor, long);
    // Descriptor + ": " + 60 chars total of body (59 + ellipsis).
    expect(out.length).toBeLessThanOrEqual("WorkspaceSidebar: ".length + 60);
    expect(out.endsWith("…")).toBe(true);
  });

  it("synthesizeTitle falls back to route when no anchor", () => {
    expect(synthesizeTitle(null, "some friction")).toBe("Designer: some friction");
  });

  it("anchorDescriptor falls back through component → stable id → route", () => {
    expect(
      anchorDescriptor({
        kind: "dom-element",
        selectorPath: "x",
        route: "/r",
      }),
    ).toBe("/r");
    expect(
      anchorDescriptor({
        kind: "dom-element",
        selectorPath: "x",
        route: "/r",
        stableId: "ws_1",
      }),
    ).toBe("ws_1");
  });
});
