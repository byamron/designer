import { useId, useState } from "react";
import type { BlockProps } from "./registry";
import { humanizeKind } from "../util/humanize";

/**
 * Block renderers — each artifact kind gets a classed component. Visual
 * tokens come exclusively from `app.css` (`.block__*`); renderers never
 * set inline styles or arbitrary colors. Speculative kinds whose payload
 * source isn't wired yet render from `artifact.summary` alone.
 */

// ---------------------------------------------------------------------------
// Header (shared by all blocks)
// ---------------------------------------------------------------------------

function BlockHeader({
  title,
  authorRole,
  kind,
  isPinned,
  onTogglePin,
  onToggleExpanded,
  expanded,
  panelId,
  pinnable = true,
}: {
  title: string;
  authorRole: string | null;
  kind: string;
  isPinned: boolean;
  onTogglePin: () => void;
  onToggleExpanded?: () => void;
  expanded?: boolean;
  /** Id of the expandable panel this header controls. Required when
   *  `onToggleExpanded` is provided so screen readers can map the
   *  control to its target region. */
  panelId?: string;
  pinnable?: boolean;
}) {
  return (
    <header className="block__header">
      <div className="block__header-row">
        <span className="block__kind-badge" data-kind={kind}>
          {humanizeKind(kind)}
        </span>
        <h3 className="block__title">{title}</h3>
      </div>
      <div className="block__actions">
        {authorRole && <span className="block__author">{authorRole}</span>}
        {onToggleExpanded && (
          <button
            type="button"
            className="block__action"
            onClick={onToggleExpanded}
            aria-expanded={expanded}
            aria-controls={panelId}
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
        )}
        {pinnable && (
          // Stable verb keeps SR from double-announcing on toggle. The
          // pressed state carries the on/off semantics; the label
          // describes the action target ("Pin to rail").
          <button
            type="button"
            className="block__action"
            onClick={onTogglePin}
            aria-pressed={isPinned}
            aria-label="Pin to rail"
          >
            {isPinned ? "Pinned" : "Pin"}
          </button>
        )}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// MessageBlock — plain chat message in the thread.
// ---------------------------------------------------------------------------

export function MessageBlock({ artifact }: BlockProps) {
  return (
    <article className="block block--message" aria-label={`Message by ${artifact.author_role ?? "user"}`}>
      <div className="block__message-author">{artifact.author_role ?? "user"}</div>
      <div className="block__message-body">{artifact.summary}</div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// SpecBlock — markdown spec, collapsible, pinnable.
// ---------------------------------------------------------------------------

export function SpecBlock(props: BlockProps) {
  const { artifact, payload, expanded, onToggleExpanded, isPinned, onTogglePin } = props;
  const body = payload?.kind === "inline" ? payload.body : artifact.summary;
  const panelId = useId();
  return (
    <article className="block block--spec">
      <BlockHeader
        title={artifact.title}
        authorRole={artifact.author_role}
        kind={artifact.kind}
        isPinned={isPinned}
        onTogglePin={onTogglePin}
        onToggleExpanded={onToggleExpanded}
        expanded={expanded}
        panelId={panelId}
      />
      {expanded ? (
        <pre id={panelId} className="block__prose">{body}</pre>
      ) : (
        <p className="block__summary">{artifact.summary}</p>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// CodeChangeBlock — semantic summary + file list.
// ---------------------------------------------------------------------------

export function CodeChangeBlock(props: BlockProps) {
  const { artifact, payload, expanded, onToggleExpanded, isPinned, onTogglePin } = props;
  const files =
    payload?.kind === "inline"
      ? payload.body.split("\n").filter((s) => s.trim().length > 0)
      : [];
  const panelId = useId();
  return (
    <article className="block block--code-change">
      <BlockHeader
        title={artifact.title}
        authorRole={artifact.author_role}
        kind={artifact.kind}
        isPinned={isPinned}
        onTogglePin={onTogglePin}
        onToggleExpanded={onToggleExpanded}
        expanded={expanded}
        panelId={panelId}
      />
      <p className="block__summary">{artifact.summary}</p>
      {expanded && files.length > 0 && (
        <ul id={panelId} className="block__file-list" aria-label="Files in this change">
          {files.map((f) => (
            <li key={f} className="block__file">
              {f}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// PrBlock — status card.
// ---------------------------------------------------------------------------

export function PrBlock({ artifact, isPinned, onTogglePin, payload }: BlockProps) {
  const url = payload?.kind === "inline" ? payload.body.trim() : null;
  return (
    <article className="block block--pr">
      <BlockHeader
        title={artifact.title}
        authorRole={artifact.author_role}
        kind={artifact.kind}
        isPinned={isPinned}
        onTogglePin={onTogglePin}
      />
      <p className="block__summary">{artifact.summary}</p>
      {url && (
        <a className="block__link" href={url} target="_blank" rel="noreferrer">
          Open on GitHub
        </a>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// ApprovalBlock — grant/deny action surface.
// ---------------------------------------------------------------------------

export function ApprovalBlock({ artifact, isPinned, onTogglePin }: BlockProps) {
  const [resolution, setResolution] = useState<"pending" | "granted" | "denied">(
    "pending",
  );
  return (
    <article
      className="block block--approval"
      data-state={resolution}
      aria-label={`Approval: ${artifact.title}`}
    >
      <BlockHeader
        title={artifact.title}
        authorRole={artifact.author_role}
        kind={artifact.kind}
        isPinned={isPinned}
        onTogglePin={onTogglePin}
        pinnable={false}
      />
      <p className="block__summary">{artifact.summary}</p>
      {resolution === "pending" ? (
        <div className="block__approval-actions">
          <button
            type="button"
            className="block__approval-btn block__approval-btn--grant"
            onClick={() => setResolution("granted")}
          >
            Grant
          </button>
          <button
            type="button"
            className="block__approval-btn block__approval-btn--deny"
            onClick={() => setResolution("denied")}
          >
            Deny
          </button>
        </div>
      ) : (
        <div className="block__approval-resolved" role="status">
          {resolution}
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// CommentBlock — inline comment anchored to another artifact.
// ---------------------------------------------------------------------------

export function CommentBlock({ artifact }: BlockProps) {
  return (
    <article className="block block--comment">
      <div className="block__comment-author">
        {artifact.author_role ?? "user"}
      </div>
      <div className="block__comment-body">{artifact.summary}</div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// TaskListBlock — checklist.
// ---------------------------------------------------------------------------

export function TaskListBlock(props: BlockProps) {
  const { artifact, payload, expanded, onToggleExpanded, isPinned, onTogglePin } = props;
  const lines =
    payload?.kind === "inline"
      ? payload.body.split("\n").filter((s) => s.trim().length > 0)
      : [];
  const panelId = useId();
  return (
    <article className="block block--task-list">
      <BlockHeader
        title={artifact.title}
        authorRole={artifact.author_role}
        kind={artifact.kind}
        isPinned={isPinned}
        onTogglePin={onTogglePin}
        onToggleExpanded={onToggleExpanded}
        expanded={expanded}
        panelId={panelId}
      />
      <p className="block__summary">{artifact.summary}</p>
      {expanded && (
        <ul id={panelId} className="block__task-items">
          {lines.map((l, i) => (
            <li key={i} className="block__task-item">
              <input type="checkbox" className="block__task-check" readOnly />
              <span>{l.replace(/^[-*]\s*/, "")}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Speculative / stub renderers — kinds whose backend isn't emitting yet.
// Each is a real registered renderer that cleanly shows what's available
// (title + summary) until Phase 13.D/E/F/G wires the data source.
// ---------------------------------------------------------------------------

export function ReportBlock(props: BlockProps) {
  return (
    <article className="block block--report">
      <BlockHeader
        title={props.artifact.title}
        authorRole={props.artifact.author_role}
        kind={props.artifact.kind}
        isPinned={props.isPinned}
        onTogglePin={props.onTogglePin}
        onToggleExpanded={props.onToggleExpanded}
        expanded={props.expanded}
      />
      <p className="block__summary">{props.artifact.summary}</p>
    </article>
  );
}

export function PrototypeBlock(props: BlockProps) {
  return (
    <article className="block block--prototype">
      <BlockHeader
        title={props.artifact.title}
        authorRole={props.artifact.author_role}
        kind={props.artifact.kind}
        isPinned={props.isPinned}
        onTogglePin={props.onTogglePin}
      />
      <p className="block__summary">{props.artifact.summary}</p>
      <div className="block__prototype-placeholder" role="presentation">
        Prototype preview wires through in Phase 13.F.
      </div>
    </article>
  );
}

export function DiagramBlock(props: BlockProps) {
  return (
    <article className="block block--diagram">
      <BlockHeader
        title={props.artifact.title}
        authorRole={props.artifact.author_role}
        kind={props.artifact.kind}
        isPinned={props.isPinned}
        onTogglePin={props.onTogglePin}
      />
      <p className="block__summary">{props.artifact.summary}</p>
    </article>
  );
}

export function VariantBlock(props: BlockProps) {
  return (
    <article className="block block--variant">
      <BlockHeader
        title={props.artifact.title}
        authorRole={props.artifact.author_role}
        kind={props.artifact.kind}
        isPinned={props.isPinned}
        onTogglePin={props.onTogglePin}
      />
      <p className="block__summary">{props.artifact.summary}</p>
    </article>
  );
}

export function TrackRollupBlock(props: BlockProps) {
  return (
    <article className="block block--track-rollup">
      <BlockHeader
        title={props.artifact.title}
        authorRole={props.artifact.author_role}
        kind={props.artifact.kind}
        isPinned={props.isPinned}
        onTogglePin={props.onTogglePin}
        onToggleExpanded={props.onToggleExpanded}
        expanded={props.expanded}
      />
      <p className="block__summary">{props.artifact.summary}</p>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Generic fallback — unknown kinds never crash the thread.
// ---------------------------------------------------------------------------

export function GenericBlock(props: BlockProps) {
  return (
    <article className="block block--generic">
      <BlockHeader
        title={props.artifact.title}
        authorRole={props.artifact.author_role}
        kind={props.artifact.kind}
        isPinned={props.isPinned}
        onTogglePin={props.onTogglePin}
      />
      <p className="block__summary">{props.artifact.summary}</p>
    </article>
  );
}
