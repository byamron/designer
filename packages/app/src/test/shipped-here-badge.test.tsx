import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShippedHereBadge } from "../blocks/ShippedHereBadge";
import type { NodeShipment } from "../ipc/client";

/**
 * Phase 22.I — `ShippedHereBadge` covers the canvas's "demonstrably alive"
 * surface: the persistent pill that lights up under a Done node once the
 * track that claimed it merges. Tests assert the audit-trail copy, the
 * multi-shipment overflow rule, and the empty-input contract — the
 * canvas-layout integration lives in the canvas suite.
 */
describe("ShippedHereBadge", () => {
  const baseShipment = (overrides: Partial<NodeShipment> = {}): NodeShipment => ({
    node_id: "phase22.i.fixture",
    workspace_id: "abcdef0123456789",
    track_id: "track-1",
    pr_url: "https://github.com/byamron/designer/pull/42",
    shipped_at: "2026-05-03T18:30:00Z",
    ...overrides,
  });

  it("renders nothing when there are no shipments", () => {
    const { container } = render(<ShippedHereBadge shipments={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one pill per shipment with the visible 'Shipped' label", () => {
    render(<ShippedHereBadge shipments={[baseShipment()]} />);
    const pill = screen.getByRole("listitem");
    expect(pill.textContent).toBe("Shipped");
    // Tooltip primitive renders the trigger as keyboard-focusable so the
    // audit-trail body surfaces via focus, not just hover.
    expect(pill.getAttribute("tabIndex")).toBe("0");
  });

  it("opens the audit-trail tooltip on hover with PR #N + YYYY-MM-DD copy", () => {
    render(<ShippedHereBadge shipments={[baseShipment()]} />);
    const pill = screen.getByRole("listitem");
    fireEvent.mouseEnter(pill);
    // Tooltip body lives in a portal layer; query by the audit-trail copy.
    const audit = screen.getByText(/Shipped by team .* via PR #42 on 2026-05-03/);
    expect(audit).toBeTruthy();
  });

  it("falls back to the raw URL in the audit copy when the PR url isn't a GitHub /pull/ URL", () => {
    render(
      <ShippedHereBadge
        shipments={[baseShipment({ pr_url: "https://example.com/merge/abc" })]}
      />,
    );
    const pill = screen.getByRole("listitem");
    fireEvent.mouseEnter(pill);
    const audit = screen.getByText(/Shipped by team .* via https:\/\/example\.com\/merge\/abc on /);
    expect(audit).toBeTruthy();
  });

  it("collapses past three shipments into a +N overflow with the correct aria-label", () => {
    const shipments: NodeShipment[] = [
      baseShipment({ track_id: "t1" }),
      baseShipment({ track_id: "t2" }),
      baseShipment({ track_id: "t3" }),
      baseShipment({ track_id: "t4" }),
      baseShipment({ track_id: "t5" }),
    ];
    render(<ShippedHereBadge shipments={shipments} />);
    const items = screen.getAllByRole("listitem");
    // Three pills + one overflow chip.
    expect(items).toHaveLength(4);
    expect(items[3].textContent).toBe("+2");
    expect(items[3].getAttribute("aria-label")).toBe("2 more shipments");
  });

  it("uses the team-label override in the audit-trail copy", () => {
    render(
      <ShippedHereBadge
        shipments={[baseShipment({ workspace_id: "ws-team-a" })]}
        teamLabel={(s) => `team(${s.workspace_id.slice(0, 4)})`}
      />,
    );
    const pill = screen.getByRole("listitem");
    fireEvent.mouseEnter(pill);
    const audit = screen.getByText(/Shipped by team team\(ws-t\) via PR #42 on 2026-05-03/);
    expect(audit).toBeTruthy();
  });
});
