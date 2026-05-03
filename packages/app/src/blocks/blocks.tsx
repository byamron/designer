import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { BlockProps } from "./registry";
import { humanizeKind, humanizeRole } from "../util/humanize";
import { formatRelativeTime } from "../util/time";
import { ipcClient } from "../ipc/client";
import type { PayloadRef, StreamEvent } from "../ipc/types";

/**
 * Block renderers — DP-B (2026-04-30) pass-through pivot.
 *
 * Designer's chat is now pass-through Claude Code by default. Only two
 * surfaces still earn custom card chrome:
 *
 *   • MessageBlock   — turns; the asymmetry (user bubble vs. agent flat)
 *                      is the one piece of identity the chat needs.
 *   • ApprovalBlock  — the must-intercept exception. Managers act here.
 *
 * Everything else is one of:
 *
 *   • ToolUseLine             — single-line `· Read src/foo.rs` register
 *                               for tool-use reports (Read/Wrote/Edited/
 *                               Searched/Ran/Used). Mirrors Claude Code
 *                               CLI compactness; no card chrome.
 *   • ArtifactReferenceBlock  — one-line clickable reference for rich
 *                               artifacts (specs, PRs, code-changes,
 *                               recap reports, prototypes, diagrams,
 *                               etc.). Click → focuses the matching
 *                               row in the ActivitySpine sidebar.
 *
 * Recap reports (`author_role === "recap"`) are rich artifacts and
 * render as ArtifactReferenceBlock; tool-use reports render as
 * ToolUseLine. The dispatcher lives in `ReportBlock` below.
 */

// ---------------------------------------------------------------------------
// MessageBlock — preserved verbatim from the prior pass.
//
// Asymmetric authorship is the canonical chat pattern: user → right-aligned
// bubble; agent → flat-on-surface prose. data-author wires role → CSS.
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
// Inline only: bold, italic, inline code, line breaks, bare URLs. Block
// constructs (lists, headings, fences) intentionally NOT handled — those
// belong to richer artifact kinds, not the chat surface itself.
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
// ToolUseLine — terse single-line render for tool-use reports.
//
// Format: `· Read src/foo.rs` (subtle dot, monospace target). Click to
// expand a single detail line beneath if the artifact carries an
// inline payload. Mirrors Claude Code CLI's compact tool rendering.
// ---------------------------------------------------------------------------

const TOOL_USE_TITLE_PREFIXES = [
  "Used ",
  "Read ",
  "Wrote ",
  "Writing ",
  "Edited ",
  "Editing ",
  "Searched ",
  "Searching ",
  "Ran ",
  "Running ",
];

function isToolUseReport(artifact: BlockProps["artifact"]): boolean {
  if (artifact.kind !== "report") return false;
  if (artifact.author_role === "recap") return false;
  if (artifact.author_role === "auditor") return false;
  return TOOL_USE_TITLE_PREFIXES.some((p) => artifact.title.startsWith(p));
}

// Mirrors a typical terminal viewport at common laptop sizes; revisit
// if dogfood says it's wrong.
const TOOL_USE_TRUNCATE_LINES = 40;

export function ToolUseLine({ artifact }: BlockProps) {
  const [expanded, setExpanded] = useState(false);
  const [payload, setPayload] = useState<PayloadRef | null>(null);
  const [showFull, setShowFull] = useState(false);
  // Dedupe rapid double-clicks: a request that's already settled won't
  // refire, and a request in flight won't spawn a second one.
  const fetchedRef = useRef(false);
  const inflightRef = useRef(false);
  const previewSummary =
    !expanded && artifact.summary && artifact.summary !== artifact.title
      ? artifact.summary
      : null;

  const fetchPayload = useCallback(() => {
    if (fetchedRef.current || inflightRef.current) return;
    inflightRef.current = true;
    void ipcClient()
      .getArtifact(artifact.id)
      .then((detail) => {
        fetchedRef.current = true;
        setPayload(detail.payload);
      })
      .catch(() => {
        // Speculative kinds whose emitters aren't wired may 404 — leave
        // the head visible without a body rather than crashing the row.
      })
      .finally(() => {
        inflightRef.current = false;
      });
  }, [artifact.id]);

  const onToggle = () => {
    setExpanded((prev) => {
      const next = !prev;
      if (next) fetchPayload();
      return next;
    });
  };

  const body = payload?.kind === "inline" ? payload.body : "";
  const lines = body.length > 0 ? body.split("\n") : [];
  const overflow = lines.length > TOOL_USE_TRUNCATE_LINES;
  const visibleBody =
    overflow && !showFull
      ? lines.slice(0, TOOL_USE_TRUNCATE_LINES).join("\n")
      : body;
  const hiddenLineCount = overflow ? lines.length - TOOL_USE_TRUNCATE_LINES : 0;

  return (
    <div
      className="tool-line"
      data-component="ToolUseLine"
      data-expanded={expanded}
    >
      <button
        type="button"
        className="tool-line__head"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className="tool-line__dot" aria-hidden="true">
          ·
        </span>
        <span className="tool-line__title">{artifact.title}</span>
        {previewSummary && (
          <span className="tool-line__detail">{previewSummary}</span>
        )}
      </button>
      {expanded && body && (
        <pre
          className="tool-line__pre"
          role="region"
          aria-label={`${artifact.title} output`}
        >
          {visibleBody}
        </pre>
      )}
      {expanded && overflow && !showFull && (
        <button
          type="button"
          className="tool-line__show-full"
          onClick={() => setShowFull(true)}
        >
          Show full ({hiddenLineCount} more lines)
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ArtifactReferenceBlock — one-line reference into the sidebar.
//
// Replaces what used to be SpecBlock, PrBlock, CodeChangeBlock,
// PrototypeBlock, DiagramBlock, VariantBlock, TaskListBlock,
// TrackRollupBlock, and recap-flavored ReportBlock. Click → dispatches
// `designer:focus-artifact`; ActivitySpine listens, scrolls the matching
// row into view, and flashes it briefly.
// ---------------------------------------------------------------------------

export function ArtifactReferenceBlock({ artifact }: BlockProps) {
  const onClick = () => {
    window.dispatchEvent(
      new CustomEvent("designer:focus-artifact", {
        detail: { id: artifact.id },
      }),
    );
  };
  return (
    <button
      type="button"
      className="artifact-ref"
      data-component="ArtifactReferenceBlock"
      data-kind={artifact.kind}
      onClick={onClick}
      aria-label={`Open ${humanizeKind(artifact.kind)} ${artifact.title} in the sidebar`}
    >
      <ArrowRight
        size={14}
        strokeWidth={1.5}
        className="artifact-ref__arrow"
        aria-hidden="true"
      />
      <span className="artifact-ref__kind">{humanizeKind(artifact.kind)}</span>
      <span className="artifact-ref__title">{artifact.title}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// ReportBlock — dispatcher.
//
// `report` covers two distinct artifact lineages:
//   - tool-use reports (titles start with Used/Read/Wrote/...) → terse line
//   - recap / auditor / freeform reports → sidebar reference
// One registered renderer; routes by content.
// ---------------------------------------------------------------------------

export function ReportBlock(props: BlockProps) {
  if (isToolUseReport(props.artifact)) {
    return <ToolUseLine {...props} />;
  }
  return <ArtifactReferenceBlock {...props} />;
}

// ---------------------------------------------------------------------------
// ApprovalBlock — the one inline card that survives the pass-through pivot.
//
// Approvals are the manager's actionable surface; they earn the chrome.
// Header is now inlined (no shared BlockHeader dependency).
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

export function ApprovalBlock({ artifact, payload }: BlockProps) {
  const inline =
    payload?.kind === "inline" ? parseApprovalPayload(payload.body) : {};
  const approvalId = inline.approval_id ?? null;
  const [resolution, setResolution] = useState<ApprovalResolution>("pending");
  const [busy, setBusy] = useState(false);
  const resolvedRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (resolution !== "pending") {
      resolvedRef.current?.focus();
    }
  }, [resolution]);

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
    const optimistic: ApprovalResolution = granted ? "granted" : "denied";
    setResolution(optimistic);
    setBusy(true);
    try {
      await ipcClient().resolveApproval(approvalId, granted);
    } catch {
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
      <header className="block__header-row">
        <span className="block__kind-badge" data-kind={artifact.kind}>
          {humanizeKind(artifact.kind)}
        </span>
        <h3 className="block__title">{artifact.title}</h3>
      </header>
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
          {resolution === "granted" ? "Approved" : "Denied"}
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
        {humanizeRole(artifact.author_role)}
      </div>
      <div className="block__comment-body">{artifact.summary}</div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// GenericBlock — fallback for unknown kinds. Same compact one-liner as
// ArtifactReferenceBlock, so unknown kinds never crash the thread or
// introduce mystery card chrome.
// ---------------------------------------------------------------------------

export function GenericBlock(props: BlockProps) {
  return <ArtifactReferenceBlock {...props} />;
}
