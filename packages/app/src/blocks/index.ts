/**
 * Block registry bootstrap. Import this module once (from the app shell) to
 * register every built-in block renderer. New kinds land here alongside
 * their renderer.
 */

import { registerBlockRenderer } from "./registry";
import {
  ApprovalBlock,
  CodeChangeBlock,
  CommentBlock,
  DiagramBlock,
  MessageBlock,
  PrBlock,
  PrototypeBlock,
  ReportBlock,
  SpecBlock,
  TaskListBlock,
  TrackRollupBlock,
  VariantBlock,
} from "./blocks";

registerBlockRenderer("message", MessageBlock);
registerBlockRenderer("spec", SpecBlock);
registerBlockRenderer("code-change", CodeChangeBlock);
registerBlockRenderer("pr", PrBlock);
registerBlockRenderer("approval", ApprovalBlock);
registerBlockRenderer("comment", CommentBlock);
registerBlockRenderer("task-list", TaskListBlock);
// Speculative kinds — registered stubs until their data source ships.
registerBlockRenderer("report", ReportBlock);
registerBlockRenderer("prototype", PrototypeBlock);
registerBlockRenderer("diagram", DiagramBlock);
registerBlockRenderer("variant", VariantBlock);
registerBlockRenderer("track-rollup", TrackRollupBlock);

export { getBlockRenderer, registerBlockRenderer } from "./registry";
export type { BlockProps, BlockRenderer } from "./registry";
export { GenericBlock } from "./blocks";
