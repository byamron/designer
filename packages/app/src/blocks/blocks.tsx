import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronRight } from "lucide-react";
import type { BlockProps } from "./registry";
import { humanizeKind, humanizeRole } from "../util/humanize";
import { formatRelativeTime } from "../util/time";
import { ipcClient } from "../ipc/client";
import type { ActivityChanged, PayloadRef, StreamEvent } from "../ipc/types";

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

// `first_line_truncate(body, 140)` in the Rust backend appends U+2026
// when the body exceeds 140 chars OR when only the first line was
// taken from a multi-line body. Either case means the rendered
// summary is incomplete; fetch the full payload body and render that
// instead. False-positives (a message legitimately ending in "…") are
// harmless — the fetched body is the same string.
//
// Phase-24-pending workaround. When Phase 24 lands the artifact
// transform goes away and chat consumes AgentTurn* events directly;
// this fetch becomes unnecessary.
const TRUNCATION_MARKER = "…";

export function MessageBlock({ artifact }: BlockProps) {
  const author = isUserAuthor(artifact.author_role) ? "you" : "agent";
  const displayName = humanizeRole(artifact.author_role);
  const relTime = formatRelativeTime(artifact.created_at);

  const summary = artifact.summary ?? "";
  const likelyTruncated = summary.endsWith(TRUNCATION_MARKER);

  const [fullBody, setFullBody] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    if (!likelyTruncated) return;
    let cancelled = false;
    void ipcClient()
      .getArtifact(artifact.id)
      .then((detail) => {
        if (cancelled || !mountedRef.current) return;
        if (detail.payload.kind === "inline") {
          setFullBody(detail.payload.body);
        }
      })
      .catch(() => {
        // Best-effort. Fall back to the truncated summary on failure.
      });
    return () => {
      cancelled = true;
    };
  }, [artifact.id, likelyTruncated]);

  const text = fullBody ?? summary;

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
        <MessageProse text={text} />
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

export function MessageProse({ text }: { text: string }) {
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

type ToolUsePhase = "idle" | "loading" | "loaded" | "error";

export function ToolUseLine({ artifact }: BlockProps) {
  const [expanded, setExpanded] = useState(false);
  const [payload, setPayload] = useState<PayloadRef | null>(null);
  const [phase, setPhase] = useState<ToolUsePhase>("idle");
  const [showFull, setShowFull] = useState(false);
  // Dedupe rapid double-clicks: a request that's already settled won't
  // refire, and a request in flight won't spawn a second one.
  const fetchedRef = useRef(false);
  const inflightRef = useRef(false);
  // Don't write state after unmount; the IPC promise outlives the row
  // when the tab closes mid-fetch.
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );
  const previewSummary =
    !expanded && artifact.summary && artifact.summary !== artifact.title
      ? artifact.summary
      : null;

  const fetchPayload = useCallback(() => {
    if (fetchedRef.current || inflightRef.current) return;
    inflightRef.current = true;
    setPhase("loading");
    void ipcClient()
      .getArtifact(artifact.id)
      .then((detail) => {
        fetchedRef.current = true;
        if (!mountedRef.current) return;
        setPayload(detail.payload);
        setPhase("loaded");
      })
      .catch(() => {
        // 404s on speculative kinds whose emitters aren't wired are
        // expected; surface "No output captured" rather than leaving
        // the user staring at an empty box.
        fetchedRef.current = true;
        if (mountedRef.current) setPhase("error");
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

  // Retry path — sidesteps roadmap item 23.C.f4 (Rust-side error
  // classification) by letting the user choose to refetch. Clears the
  // dedupe flags so the next `fetchPayload` actually fires; transient
  // failures (network glitch, IPC hiccup) recover with one click.
  const retry = () => {
    fetchedRef.current = false;
    inflightRef.current = false;
    fetchPayload();
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
        {/* Discoverability affordance — replaces the prior `·` dot.
            Chevron rotates 90° on expand via CSS transform on the
            parent button when aria-expanded=true; carries the same
            tiny visual weight as the dot but signals click-to-expand
            without ambiguity. axiom #13: lucide-react size 12,
            strokeWidth 1.5. */}
        <ChevronRight
          size={12}
          strokeWidth={1.5}
          className="tool-line__chevron"
          aria-hidden="true"
        />
        <span className="tool-line__title">{artifact.title}</span>
        {previewSummary && (
          <span className="tool-line__detail">{previewSummary}</span>
        )}
      </button>
      {/* Expanded surface — the region wrapper carries the live-update
          announcement and the box chrome so loading / loaded / error
          all share one footprint and the payload arrival doesn't shift
          the layout. The inner `<pre>` keeps its monospace register but
          delegates `role="region"` + `aria-label` to the wrapper, which
          is a more predictable surface for screen readers than a long
          aria-live `<pre>` (some SRs read the whole pre content on
          insertion). The wrapper is intentionally not focusable —
          `role="region"` should not steal Tab order; the head button
          and the optional "Show full" button are the only stops. */}
      {expanded && (
        <div
          className="tool-line__region"
          data-phase={phase}
          role="region"
          aria-label={`${artifact.title} output`}
          aria-live="polite"
          aria-busy={phase === "loading" || undefined}
        >
          {phase === "loading" && (
            <p className="tool-line__status">Loading output…</p>
          )}
          {phase === "error" && (
            <div className="tool-line__error">
              <p className="tool-line__status">Nothing to show.</p>
              {/* Retry path for transient failures (network glitch,
                  IPC hiccup). For permanent 404s the second fetch
                  also rejects and the error state re-renders — the
                  user pays one extra IPC call but recovers transient
                  cases without a Rust-side error-classification pass
                  (parked as roadmap item 23.C.f4). */}
              <button
                type="button"
                className="tool-line__retry"
                onClick={retry}
              >
                Try again
              </button>
            </div>
          )}
          {phase === "loaded" && body && (
            <pre className="tool-line__pre">{visibleBody}</pre>
          )}
          {phase === "loaded" && overflow && !showFull && (
            <button
              type="button"
              className="tool-line__show-full"
              onClick={() => setShowFull(true)}
            >
              Show full ({hiddenLineCount} more{" "}
              {hiddenLineCount === 1 ? "line" : "lines"})
            </button>
          )}
        </div>
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

/// `kind` differentiates a user click from a backend timeout so the
/// resolved-state copy can read either as "Denied by you · 2m ago" or
/// "Denied — you didn't respond in 5 min". Pulled from the
/// `ApprovalDenied.reason` field — `Some("timeout")` from the inbox
/// handler, `None` from a user click (the frontend doesn't pass a
/// reason on Deny). Optimistic local denials default to `user`.
type DenyKind = "user" | "timeout";

interface ApprovalPayload {
  approval_id?: string;
  tool?: string;
  gate?: string;
  reason?: string;
  /** Stripped repo-relative path computed in inbox_permission.rs.
   *  Present for Write/Edit/MultiEdit/NotebookEdit; absent for Bash etc. */
  path?: string | null;
  /** Raw tool input from Claude (file contents for Write, command for
   *  Bash, old/new strings for Edit). Opaque shape — block reads only
   *  the fields it knows by tool. */
  input?: Record<string, unknown>;
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

// Mirrors the tool-line truncation feel: ~10 lines collapsed before the
// "Show full" disclosure mounts. The threshold is independent from the
// 40-line tool-output truncate because the approval surface is meant to
// stay glance-able — file content drilldown is a confirmation cue, not
// a code review viewer.
const APPROVAL_PREVIEW_LINES = 10;

function previewBody(payload: ApprovalPayload): { body: string | null; lang: "diff" | "plain" } {
  const tool = payload.tool ?? "";
  const input = (payload.input ?? {}) as Record<string, unknown>;
  if (tool === "Write") {
    const content = typeof input.content === "string" ? input.content : null;
    return { body: content, lang: "plain" };
  }
  if (tool === "Edit" || tool === "MultiEdit" || tool === "NotebookEdit") {
    const oldStr = typeof input.old_string === "string" ? input.old_string : "";
    const newStr = typeof input.new_string === "string" ? input.new_string : "";
    if (!oldStr && !newStr) return { body: null, lang: "diff" };
    // Plain unified-style hunk — no parser, just visual cue. The minus
    // and plus prefixes give the eye the diff register without pulling
    // in a real diff lib for what is a confirmation preview.
    const minus = oldStr ? oldStr.split("\n").map((l) => `- ${l}`).join("\n") : "";
    const plus = newStr ? newStr.split("\n").map((l) => `+ ${l}`).join("\n") : "";
    const joined = [minus, plus].filter(Boolean).join("\n");
    return { body: joined, lang: "diff" };
  }
  return { body: null, lang: "plain" };
}

/// Resolution timestamps captured at the moment we know the approval
/// terminated, used to render `Allowed by you · 2m ago`. We re-read
/// `Date.now()` lazily so a clock that's been open for a long time
/// still shows a sensible relative label.
interface ResolvedMeta {
  at: number;
  denyKind?: DenyKind;
}

export function ApprovalBlock({ artifact, payload }: BlockProps) {
  const inline = useMemo<ApprovalPayload>(
    () => (payload?.kind === "inline" ? parseApprovalPayload(payload.body) : {}),
    [payload],
  );
  const approvalId = inline.approval_id ?? null;
  const tool = inline.tool ?? "";
  const path = inline.path ?? null;
  const command =
    tool === "Bash" && typeof inline.input?.command === "string"
      ? (inline.input.command as string)
      : null;
  const description =
    tool === "Bash" && typeof inline.input?.description === "string"
      ? (inline.input.description as string)
      : null;
  const preview = useMemo(() => previewBody(inline), [inline]);

  const [resolution, setResolution] = useState<ApprovalResolution>("pending");
  const [resolvedMeta, setResolvedMeta] = useState<ResolvedMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [showFull, setShowFull] = useState(false);
  // Working-state copy mounts only after a grant resolves AND the
  // workspace transitions to `working` — a grant alone isn't enough,
  // since the agent may exit immediately without firing activity.
  const [working, setWorking] = useState(false);
  const resolvedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (resolution !== "pending") {
      resolvedRef.current?.focus();
    }
  }, [resolution]);

  // Subscribe to terminal events so a grant/deny landed via another
  // surface (CLI tool, sibling tab, sweep) flips this card too.
  useEffect(() => {
    if (!approvalId) return;
    const unsubscribe = ipcClient().stream((ev: StreamEvent) => {
      if (ev.kind !== "approval_granted" && ev.kind !== "approval_denied") return;
      const evPayload = ev.payload as
        | { approval_id?: string; reason?: string | null }
        | undefined;
      if (evPayload?.approval_id !== approvalId) return;
      const at = Date.parse(ev.timestamp);
      const meta: ResolvedMeta = {
        at: Number.isFinite(at) ? at : Date.now(),
      };
      if (ev.kind === "approval_denied") {
        meta.denyKind = evPayload?.reason === "timeout" ? "timeout" : "user";
      }
      setResolution(ev.kind === "approval_granted" ? "granted" : "denied");
      setResolvedMeta(meta);
      setBusy(false);
    });
    return unsubscribe;
  }, [approvalId]);

  // Working indicator: only mount after a successful grant. Match on
  // workspace_id (approvals are workspace-scoped; the artifact carries
  // no tab_id). Drop back to idle when the workspace transitions out
  // of `working`.
  useEffect(() => {
    if (resolution !== "granted") return;
    const unsubscribe = ipcClient().activityStream((ev: ActivityChanged) => {
      if (ev.workspace_id !== artifact.workspace_id) return;
      if (ev.state === "working") setWorking(true);
      else setWorking(false);
    });
    return unsubscribe;
  }, [resolution, artifact.workspace_id]);

  const resolve = async (granted: boolean) => {
    if (busy || !approvalId) return;
    const optimistic: ApprovalResolution = granted ? "granted" : "denied";
    setResolution(optimistic);
    setResolvedMeta({
      at: Date.now(),
      denyKind: granted ? undefined : "user",
    });
    setBusy(true);
    try {
      await ipcClient().resolveApproval(approvalId, granted);
    } catch {
      setResolution("pending");
      setResolvedMeta(null);
      setBusy(false);
    }
  };

  const lines = preview.body ? preview.body.split("\n") : [];
  const overflow = lines.length > APPROVAL_PREVIEW_LINES;
  const visibleBody =
    overflow && !showFull
      ? lines.slice(0, APPROVAL_PREVIEW_LINES).join("\n")
      : preview.body ?? "";
  const hiddenLineCount = overflow ? lines.length - APPROVAL_PREVIEW_LINES : 0;

  const showsScopeLine = Boolean(path) || tool === "Bash";

  return (
    <article
      className="block block--approval"
      data-component="ApprovalBlock"
      data-state={resolution}
      data-deny-kind={resolution === "denied" ? resolvedMeta?.denyKind ?? "user" : undefined}
      aria-label={artifact.title}
      aria-busy={busy || undefined}
    >
      <header className="block__approval-header">
        <h3 className="block__title">{artifact.title}</h3>
      </header>

      {(path || command) && (
        <div className="block__approval-target">
          {path && <code className="block__approval-path">{path}</code>}
          {command && !path && (
            <code className="block__approval-command">{command}</code>
          )}
          {showsScopeLine && (
            <p className="block__approval-scope">
              in this track&rsquo;s isolated workspace · your main checkout is
              untouched
            </p>
          )}
        </div>
      )}

      {description && (
        <p className="block__approval-description">{description}</p>
      )}

      {preview.body && (
        <div className="block__approval-preview" data-lang={preview.lang}>
          <pre className="block__approval-pre">{visibleBody}</pre>
          {overflow && !showFull && (
            <button
              type="button"
              className="block__approval-show-full"
              onClick={() => setShowFull(true)}
            >
              Show full ({hiddenLineCount} more{" "}
              {hiddenLineCount === 1 ? "line" : "lines"})
            </button>
          )}
        </div>
      )}

      {resolution === "pending" ? (
        <div className="block__approval-actions">
          <button
            type="button"
            className="block__approval-btn block__approval-btn--grant"
            onClick={() => void resolve(true)}
            disabled={busy || !approvalId}
          >
            Allow
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
        <div className="block__approval-footer">
          <div
            ref={resolvedRef}
            tabIndex={-1}
            className="block__approval-resolved"
            role="status"
          >
            {resolvedLabel(resolution, resolvedMeta)}
          </div>
          {working && (
            <div className="block__approval-working" role="status">
              <span
                className="block__approval-working-dots"
                aria-hidden="true"
              >
                <span />
                <span />
                <span />
              </span>
              <span>Working…</span>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function resolvedLabel(
  resolution: Exclude<ApprovalResolution, "pending">,
  meta: ResolvedMeta | null,
): string {
  const denyKind = meta?.denyKind ?? "user";
  const at = meta?.at ?? Date.now();
  const rel = formatRelativeTime(new Date(at).toISOString());
  if (resolution === "granted") return `Allowed by you · ${rel}`;
  if (denyKind === "timeout") return "Denied — you didn’t respond in 5 min";
  return `Denied by you · ${rel}`;
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
