import type { ComponentType } from "react";
import type { ArtifactKind, ArtifactSummary, PayloadRef } from "../ipc/types";

/**
 * Block renderer contract. Every block renders an artifact; pinning and
 * expand/collapse are controlled by the parent (the thread).
 *
 * Renderer components should not fetch data — the parent passes the
 * resolved `payload` when it needs one. Speculative kinds whose payload
 * source isn't wired yet can render from `artifact.summary` alone.
 */
export interface BlockProps {
  artifact: ArtifactSummary;
  payload: PayloadRef | null;
  isPinned: boolean;
  onTogglePin: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}

export type BlockRenderer = ComponentType<BlockProps>;

const registry = new Map<ArtifactKind, BlockRenderer>();

export function registerBlockRenderer(
  kind: ArtifactKind,
  renderer: BlockRenderer,
): void {
  registry.set(kind, renderer);
}

/**
 * Lookup a renderer. Returns `null` for unknown kinds — the caller should
 * render `GenericBlock` so new event types never crash the thread.
 */
export function getBlockRenderer(kind: ArtifactKind): BlockRenderer | null {
  return registry.get(kind) ?? null;
}

export function registeredKinds(): ArtifactKind[] {
  return Array.from(registry.keys());
}
