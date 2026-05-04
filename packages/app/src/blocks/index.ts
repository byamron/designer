/**
 * Block registry bootstrap. Import this module once (from the app shell) to
 * register every built-in block renderer. New kinds land here alongside
 * their renderer.
 *
 * DP-B (2026-04-30) pivot: most kinds now route to ArtifactReferenceBlock,
 * a one-line clickable reference that focuses the matching row in the
 * ActivitySpine sidebar. Only `message` and `approval` carry custom chrome.
 * `report` dispatches between ToolUseLine (tool-use) and
 * ArtifactReferenceBlock (recap/auditor/freeform) inside ReportBlock.
 */

import { registerBlockRenderer } from "./registry";
import {
  ApprovalBlock,
  ArtifactReferenceBlock,
  CommentBlock,
  MessageBlock,
  ReportBlock,
} from "./blocks";
import {
  CompletionClaimBlock,
  RoadmapBlock,
  RoadmapEditProposalBlock,
} from "./RoadmapBlock";

registerBlockRenderer("message", MessageBlock);
registerBlockRenderer("approval", ApprovalBlock);
registerBlockRenderer("comment", CommentBlock);
registerBlockRenderer("report", ReportBlock);
// Rich artifacts pass through to a calm one-line reference; full content
// lives in the sidebar Artifacts list.
registerBlockRenderer("spec", ArtifactReferenceBlock);
registerBlockRenderer("code-change", ArtifactReferenceBlock);
registerBlockRenderer("pr", ArtifactReferenceBlock);
registerBlockRenderer("task-list", ArtifactReferenceBlock);
registerBlockRenderer("prototype", ArtifactReferenceBlock);
// Phase 22.A — roadmap canvas + reserved 22.D stubs (claim the slots so
// 22.D doesn't fight for them on landing; both stubs fall through to
// GenericBlock until 22.D ships).
registerBlockRenderer("roadmap", RoadmapBlock);
registerBlockRenderer("roadmap-edit-proposal", RoadmapEditProposalBlock);
registerBlockRenderer("completion-claim", CompletionClaimBlock);
// TODO(DP-C): re-register `diagram` / `variant` / `track-rollup` once
// their payload sources ship. Stubs were misleading — they exposed
// only title + summary with no real body. WorkspaceThread falls back
// to GenericBlock (also ArtifactReferenceBlock) for unregistered
// kinds, so any stray artifact still renders harmlessly. Audit table:
// core-docs/plan.md § Feature readiness.
// registerBlockRenderer("diagram", ArtifactReferenceBlock);
// registerBlockRenderer("variant", ArtifactReferenceBlock);
// registerBlockRenderer("track-rollup", ArtifactReferenceBlock);

export { getBlockRenderer, registerBlockRenderer } from "./registry";
export type { BlockProps, BlockRenderer } from "./registry";
export { GenericBlock } from "./blocks";
