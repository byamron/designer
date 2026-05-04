/**
 * Block-renderer wrappers for Phase 22.A roadmap artifacts.
 *
 * - `RoadmapBlock` mounts the actual canvas. The artifact's `summary`
 *   carries the project_id so the block-renderer slot doesn't need to
 *   know about the host project context.
 * - `RoadmapEditProposalBlock` and `CompletionClaimBlock` are stubs
 *   reserved for 22.D — they fall through to `GenericBlock` so the
 *   registry slot is claimed and 22.D doesn't have to fight for it
 *   on landing.
 */

import type { BlockProps } from "./registry";
import { GenericBlock } from "./blocks";
import { RoadmapCanvas } from "../components/RoadmapCanvas";
import type { ProjectId } from "../ipc/types";

export function RoadmapBlock(props: BlockProps) {
  // The artifact's `summary` is the project_id this canvas belongs to.
  // Producers of the `roadmap` artifact set summary = project_id; the
  // canvas reads it as a string and trusts the type at the boundary.
  const projectId = props.artifact.summary as ProjectId;
  if (!projectId) {
    return (
      <article className="block block--roadmap" data-component="RoadmapBlock">
        <p>Roadmap artifact is missing its project context.</p>
      </article>
    );
  }
  return (
    <article className="block block--roadmap" data-component="RoadmapBlock">
      <RoadmapCanvas projectId={projectId} />
    </article>
  );
}

/** Stub — 22.D ships the inline diff card. Falls through to GenericBlock. */
export function RoadmapEditProposalBlock(props: BlockProps) {
  return <GenericBlock {...props} />;
}

/** Stub — 22.D ships the status-change card. Falls through to GenericBlock. */
export function CompletionClaimBlock(props: BlockProps) {
  return <GenericBlock {...props} />;
}
