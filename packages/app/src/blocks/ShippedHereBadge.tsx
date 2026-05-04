/**
 * ShippedHereBadge — Phase 22.I.
 *
 * Renders the persistent "Shipped here" pill below a Done node's headline.
 * The badge is monochrome by default; hover (and keyboard focus) reveals
 * the audit-trail copy: "Shipped by team {team} via PR #{n} on {YYYY-MM-DD}".
 *
 * # Multi-shipment nodes
 *
 * Most nodes have at most one shipment, but the all-must-ship Done gate
 * means a node can have several (each claiming track that merges
 * contributes one entry). Stack horizontally; collapse to "+N" past
 * `COLLAPSE_AFTER` with a Tooltip overflow popover that lists the
 * remaining shipments. Mirrors `RoadmapMultiClaimStack` so the visual
 * grammar reads as "shipping history" alongside "live claims" without a
 * second component idiom.
 *
 * # Accessibility
 *
 * - Each pill is keyboard-focusable (`tabIndex={0}`) so the Tooltip
 *   surfaces audit-trail text via focus, not just hover.
 * - The visible "Shipped" text is the accessible label; the audit trail
 *   is the Tooltip body, which renders as `aria-describedby` on the
 *   trigger so screen readers announce both.
 * - Hover and focus open the Tooltip immediately (the Tooltip primitive
 *   sets `aria-describedby` and renders in a portal layer).
 *
 * # Composition rules
 *
 * Reuses the existing Tooltip primitive — no new tooltip variant. No
 * IconButton wrap because the badge is a label, not an action; turning
 * it into a button would mislead AT users about its semantics.
 */

import type { NodeShipment } from "../ipc/client";
import { Tooltip } from "../components/Tooltip";

const COLLAPSE_AFTER = 3;

interface Props {
  shipments: NodeShipment[];
  /** Optional formatter for the team identity in the audit-trail copy.
   * Phase 22.G doesn't yet thread `team_id` through `NodeShipment`; the
   * default falls back to a workspace short id, matching the team-label
   * placeholder used elsewhere on the canvas. */
  teamLabel?: (s: NodeShipment) => string;
}

export function ShippedHereBadge({ shipments, teamLabel = defaultTeamLabel }: Props) {
  if (shipments.length === 0) return null;

  const visible = shipments.slice(0, COLLAPSE_AFTER);
  const overflow = shipments.length - visible.length;

  return (
    <span
      className="roadmap-shipped-here-badge"
      data-component="ShippedHereBadge"
      role="list"
      aria-label={`${shipments.length} shipped`}
    >
      {visible.map((shipment) => (
        <Pill key={shipment.track_id} shipment={shipment} teamLabel={teamLabel} />
      ))}
      {overflow > 0 && (
        <Tooltip
          // The Tooltip primitive sets `white-space: nowrap` on its label,
          // so multiline joins collapse + ellipse. Use `; ` to keep each
          // overflow line distinguishable on a single line — mirrors
          // `RoadmapMultiClaimStack`'s `, ` overflow grammar.
          label={shipments
            .slice(COLLAPSE_AFTER)
            .map((s) => auditLine(s, teamLabel))
            .join(" ; ")}
          side="top"
        >
          <span
            className="roadmap-shipped-here-badge__overflow"
            tabIndex={0}
            role="listitem"
            aria-label={`${overflow} more shipments`}
          >
            +{overflow}
          </span>
        </Tooltip>
      )}
    </span>
  );
}

function Pill({
  shipment,
  teamLabel,
}: {
  shipment: NodeShipment;
  teamLabel: (s: NodeShipment) => string;
}) {
  return (
    <Tooltip label={auditLine(shipment, teamLabel)} side="top">
      <span
        className="roadmap-shipped-here-badge__pill"
        data-track-id={shipment.track_id}
        tabIndex={0}
        role="listitem"
      >
        Shipped
      </span>
    </Tooltip>
  );
}

function auditLine(
  shipment: NodeShipment,
  teamLabel: (s: NodeShipment) => string,
): string {
  const team = teamLabel(shipment);
  const pr = formatPrRef(shipment.pr_url);
  const date = formatShippedAt(shipment.shipped_at);
  return `Shipped by team ${team} via ${pr} on ${date}`;
}

function defaultTeamLabel(shipment: NodeShipment): string {
  // Mirrors `labelFor` in RoadmapCanvas — the same provisional identity
  // that the live-claim labels use until 22.G threads `team_id` through
  // `NodeShipment`. Keeping the placeholder consistent avoids a UI where
  // the live label and the historical label disagree on the same track.
  return `wks ${shipment.workspace_id.slice(0, 6)}`;
}

function formatPrRef(prUrl: string): string {
  // Best-effort: derive `PR #N` from the URL. GitHub URLs end in
  // `/pull/<n>`. Anything else falls back to the URL itself so the
  // audit trail is never silently empty.
  const match = prUrl.match(/\/pull\/(\d+)\b/);
  return match ? `PR #${match[1]}` : prUrl;
}

function formatShippedAt(isoTimestamp: string): string {
  // Render as YYYY-MM-DD per the spec — locale-stable, readable in any
  // mode. Falls back to the raw string if parsing fails (e.g. legacy
  // payload format we haven't seen yet).
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) return isoTimestamp;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
