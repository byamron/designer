import { useEffect, useId, useRef, useState } from "react";
import type { BlockProps } from "./registry";
import { humanizeKind, humanizeRole } from "../util/humanize";
import { formatRelativeTime } from "../util/time";
import { ipcClient } from "../ipc/client";
import type { StreamEvent } from "../ipc/types";
import { PrototypePreview } from "../lab/PrototypePreview";

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
    <header className="block__header" data-component="BlockHeader">
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
// MessageBlock — a single turn in the conversation.
//
// Asymmetric authorship is the canonical pattern (Claude, ChatGPT, Cursor,
// Linear AI): user messages render as right-aligned bubbles ("I said
// this") and agent messages render directly on the surface ("here's
// the reply, no chrome"). The `data-author` attribute is the wire from
// artifact role → CSS selector; without it both authorships look
// identical (B4).
//
// Agent messages also carry a humanized role label and a relative
// timestamp so the surface reads as a conversation with a named
// teammate, not a dump of raw events. User messages keep the chrome
// minimal — the bubble already differentiates them; a label would
// double up.
// ---------------------------------------------------------------------------

function isUserAuthor(role: string | null): boolean {
  if (!role) return true;
  const r = role.toLowerCase();
  return r === "user" || r === "you";
}

export function MessageBlock({ artifact }: BlockProps) {
  const author = isUserAuthor(artifact.author_role) ? "you" : "agent";
  const displayName = humanizeRole(artifact.author_role);
  const relTime = formatRelativeTime(artifact.created_at);
  return (
    <article
      className="block block--message"
      data-component="MessageBlock"
      data-author={author}
      aria-label={`Message by ${author === "you" ? "you" : displayName}`}
    >
      {author === "agent" && (
        <header className="block__message-meta">
          <span className="block__message-author">{displayName}</span>
          {relTime && (
            <time
              className="block__message-time"
              dateTime={artifact.created_at}
              title={new Date(artifact.created_at).toLocaleString()}
            >
              {relTime}
            </time>
          )}
        </header>
      )}
      <div className="block__message-body">
        <MessageProse text={artifact.summary} />
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// MessageProse — minimal markdown-ish renderer for chat messages.
//
// Real prose feels like a conversation. Plain `pre-wrap` text reads as a
// wall. We support the ~5 inline formats agents actually emit: bold,
// italic, inline code, line breaks, and bare URLs. Block-level markdown
// (lists, headings, fences) is intentionally NOT handled here — those
// land in their own artifact kinds (TaskListBlock, SpecBlock,
// CodeChangeBlock) so the chat surface stays a chat surface, not a
// markdown viewer. Same approach as Linear AI and Cursor.
//
// We hand-roll a tiny tokenizer instead of pulling react-markdown so
// the bundle stays small and the parser doesn't surprise us with HTML
// passthrough (which would be an XSS vector for any user-authored
// message).
// ---------------------------------------------------------------------------
const INLINE_PATTERN =
  /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|https?:\/\/[^\s)]+)/g;

function MessageProse({ text }: { text: string }) {
  if (!text) return null;
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, lineIdx) => {
        const segments: React.ReactNode[] = [];
        let lastIdx = 0;
        let match: RegExpExecArray | null;
        // Reset for each line so the regex iterates from the start.
        INLINE_PATTERN.lastIndex = 0;
        while ((match = INLINE_PATTERN.exec(line)) !== null) {
          if (match.index > lastIdx) {
            segments.push(line.slice(lastIdx, match.index));
          }
          const tok = match[0];
          if (tok.startsWith("**") && tok.endsWith("**")) {
            segments.push(<strong key={`b${match.index}`}>{tok.slice(2, -2)}</strong>);
          } else if (tok.startsWith("*") && tok.endsWith("*")) {
            segments.push(<em key={`i${match.index}`}>{tok.slice(1, -1)}</em>);
          } else if (tok.startsWith("`") && tok.endsWith("`")) {
            segments.push(<code key={`c${match.index}`}>{tok.slice(1, -1)}</code>);
          } else if (tok.startsWith("http")) {
            segments.push(
              <a
                key={`l${match.index}`}
                href={tok}
                target="_blank"
                rel="noreferrer"
              >
                {tok}
              </a>,
            );
          }
          lastIdx = match.index + tok.length;
        }
        if (lastIdx < line.length) {
          segments.push(line.slice(lastIdx));
        }
        return (
          <span key={lineIdx} className="block__message-line">
            {segments.length > 0 ? segments : line}
            {lineIdx < lines.length - 1 ? "\n" : null}
          </span>
        );
      })}
    </>
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
    <article className="block block--spec" data-component="SpecBlock">
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
    <article className="block block--code-change" data-component="CodeChangeBlock">
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
    <article className="block block--pr" data-component="PrBlock">
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

type ApprovalResolution = "pending" | "granted" | "denied";

interface ApprovalPayload {
  approval_id?: string;
  tool?: string;
  gate?: string;
  reason?: string;
}

function parseApprovalPayload(body: string): ApprovalPayload {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object") return parsed as ApprovalPayload;
  } catch {
    /* fall through — pre-13.G payloads were free-text */
  }
  return {};
}

export function ApprovalBlock({ artifact, payload, isPinned, onTogglePin }: BlockProps) {
  const inline =
    payload?.kind === "inline" ? parseApprovalPayload(payload.body) : {};
  const approvalId = inline.approval_id ?? null;
  const [resolution, setResolution] = useState<ApprovalResolution>("pending");
  const [busy, setBusy] = useState(false);
  // After resolve, focus the resolution status so screen readers and
  // keyboard users land on the new state instead of nowhere.
  const resolvedRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (resolution !== "pending") {
      resolvedRef.current?.focus();
    }
  }, [resolution]);

  // Subscribe to the event stream — projector becomes truth. If the block
  // mounts after a `cmd_resolve_approval` round-trip lands (e.g. the user
  // reloads), we still flip to the resolved state via the event.
  useEffect(() => {
    if (!approvalId) return;
    const unsubscribe = ipcClient().stream((ev: StreamEvent) => {
      if (ev.kind !== "approval_granted" && ev.kind !== "approval_denied") return;
      const evApprovalId = (ev.payload as { approval_id?: string } | undefined)?.approval_id;
      if (evApprovalId !== approvalId) return;
      setResolution(ev.kind === "approval_granted" ? "granted" : "denied");
      setBusy(false);
    });
    return unsubscribe;
  }, [approvalId]);

  const resolve = async (granted: boolean) => {
    if (busy || !approvalId) return;
    // Optimistic flip — the event-stream listener above will confirm or
    // (in the unlikely case of a server-side reject) re-set on a follow-up.
    const optimistic: ApprovalResolution = granted ? "granted" : "denied";
    setResolution(optimistic);
    setBusy(true);
    try {
      await ipcClient().resolveApproval(approvalId, granted);
    } catch {
      // Rolling back the optimistic state surfaces the failure clearly;
      // the user can retry. The block stays interactive.
      setResolution("pending");
      setBusy(false);
    }
  };

  return (
    <article
      className="block block--approval"
      data-component="ApprovalBlock"
      data-state={resolution}
      aria-label={`Approval: ${artifact.title}`}
      aria-busy={busy || undefined}
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
            onClick={() => void resolve(true)}
            disabled={busy || !approvalId}
          >
            Grant
          </button>
          <button
            type="button"
            className="block__approval-btn block__approval-btn--deny"
            onClick={() => void resolve(false)}
            disabled={busy || !approvalId}
          >
            Deny
          </button>
        </div>
      ) : (
        <div
          ref={resolvedRef}
          tabIndex={-1}
          className="block__approval-resolved"
          role="status"
        >
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
    <article className="block block--comment" data-component="CommentBlock">
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
  const { artifact, payload, expanded, onToggleExpanded, isPinned, onTogglePin } = props;
  const body = payload?.kind === "inline" ? payload.body : null;
  const panelId = useId();
  const expandable = Boolean(body);
  return (
    <article className="block block--report" data-component="ReportBlock">
      <BlockHeader
        title={artifact.title}
        authorRole={artifact.author_role}
        kind={artifact.kind}
        isPinned={isPinned}
        onTogglePin={onTogglePin}
        onToggleExpanded={expandable ? onToggleExpanded : undefined}
        expanded={expanded}
        panelId={expandable ? panelId : undefined}
      />
      <p className="block__summary">{artifact.summary}</p>
      {expandable && expanded ? (
        <pre id={panelId} className="block__prose">
          {body}
        </pre>
      ) : null}
    </article>
  );
}

export function PrototypeBlock(props: BlockProps) {
  const html = props.payload?.kind === "inline" ? props.payload.body : null;
  return (
    <article className="block block--prototype" data-component="PrototypeBlock">
      <BlockHeader
        title={props.artifact.title}
        authorRole={props.artifact.author_role}
        kind={props.artifact.kind}
        isPinned={props.isPinned}
        onTogglePin={props.onTogglePin}
      />
      <p className="block__summary">{props.artifact.summary}</p>
      {html ? (
        <PrototypePreview inlineHtml={html} title={props.artifact.title} />
      ) : (
        <div className="block__prototype-placeholder" role="presentation">
          Prototype preview pending payload.
        </div>
      )}
    </article>
  );
}

export function DiagramBlock(props: BlockProps) {
  return (
    <article className="block block--diagram" data-component="DiagramBlock">
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
