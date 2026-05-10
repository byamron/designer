import { useState } from "react";
import { thread, workspaceTitle } from "../_shared/thread";
import type { Artifact, MessageArtifact, ToolCallArtifact } from "../_shared/types";
import { groupArtifacts, truncate } from "../_shared/chat";
import { formatDuration, formatTime } from "../_shared/format";
import "../_shared/chat-baseline.css";
import "./styles.css";

// c3 — Synthesis.
// Implements D-0003: every artifact is classified as conversation or operation.
//   Conversation (user msg, agent msg, code-change, report, approval) → default visible, warm chrome.
//   Operation (tool calls, thinking) → default collapsed into a quiet "N tool calls" header.
// Plus c2-a's warmth gestures, c2-b's rich agent prose, c2-c's toned streaming.

export default function C3Synthesis() {
  const groups = groupArtifacts(thread);
  return (
    <div className="chat c3">
      <header className="chat__head">
        <h1 className="chat__head-title">{workspaceTitle}</h1>
        <p className="chat__head-sub">c3 — synthesis</p>
        <span className="c3__resumed">resumed after 12 min</span>
      </header>
      <div className="chat__thread-wrap">
        <ol className="chat__thread">
          <li className="chat__row c3__date-stamp">
            <span>Today · 9:42 PM</span>
          </li>
          {groups.map((g, i) => (
            <li
              key={i}
              className="chat__row"
              data-kind={g.kind === "single" ? g.a.kind : "tool-run"}
              data-author={g.kind === "single" ? g.a.author : "agent"}
              data-streaming={
                g.kind === "single" && g.a.kind === "message" && g.a.streaming
                  ? "true"
                  : undefined
              }
            >
              {g.kind === "tool-run" ? <ToolRun calls={g.calls} /> : <Single a={g.a} />}
            </li>
          ))}
        </ol>
        <div className="chat__pill">↓ Jump to latest</div>
      </div>
      <footer className="chat__compose">
        <div className="chat__compose-inner">
          <input
            className="chat__compose-input"
            placeholder="Ask agent or describe what's next…"
          />
          <button className="chat__compose-send">Send</button>
        </div>
      </footer>
    </div>
  );
}

function Single({ a }: { a: Artifact }) {
  switch (a.kind) {
    case "message":
      return <Message a={a} />;
    case "code-change":
      return <CodeChange a={a} />;
    case "report":
      return <Report a={a} />;
    case "approval":
      return <Approval a={a} />;
    case "tool-call":
      return null;
  }
}

function Message({ a }: { a: MessageArtifact }) {
  if (a.author === "user") {
    return (
      <div className="chat__bubble" title={formatTime(a.timestamp)}>
        {a.body}
      </div>
    );
  }
  // Agent: rich prose. Hand-author the canonical implementation message.
  if (a.id === "a8") {
    return (
      <div className="chat__prose">
        <h3>Implementation</h3>
        <p>
          Found the scroll setup. The thread container has{" "}
          <code>overflow-y: auto</code> but no scroll tracking. The audit's pattern
          is the iMessage / Linear "stickiness" approach — only auto-scroll if the
          user is already pinned to the bottom.
        </p>
        <ol>
          <li>
            Add <code>threadRef</code> + <code>stickRef</code> to{" "}
            <code>WorkspaceThread.tsx</code>.
          </li>
          <li>
            Track scroll position with an <code>onScroll</code> handler that flips{" "}
            <code>stickRef</code> when the user is &lt; 32px from bottom.
          </li>
          <li>
            <code>useLayoutEffect</code> on <code>[artifacts?.length]</code> auto-scrolls
            only when <code>stickRef.current === true</code>.
          </li>
          <li>Wire a "Jump to latest" pill that appears when scrolled up and content arrives.</li>
        </ol>
        <p>Adding tests for both the pinned and scrolled-up cases.</p>
      </div>
    );
  }
  // Other agent messages render as flat prose — including the streaming follow-up
  return (
    <div className={`chat__prose ${a.streaming ? "c3__streaming" : ""}`}>
      <p>
        {a.body}
        {a.streaming && <span className="chat__cursor c3__cursor" aria-hidden />}
      </p>
    </div>
  );
}

function ToolRun({ calls }: { calls: ToolCallArtifact[] }) {
  // OPERATION LAYER — default collapsed. Quiet caption header.
  const [expanded, setExpanded] = useState(false);
  const total = calls.reduce((s, c) => s + (c.durationMs ?? 0), 0);
  return (
    <div className="chat__tool-run c3__tool-run">
      <button
        className="chat__tool-head"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="chat__tool-head-chevron" aria-hidden data-expanded={expanded}>›</span>
        <span className="chat__tool-head-count">
          {calls.length} tool {calls.length === 1 ? "call" : "calls"}
        </span>
        <span className="chat__tool-head-time">{formatDuration(total)}</span>
      </button>
      {expanded && (
        <ul className="chat__tool-lines">
          {calls.map((c) => (
            <li key={c.id} className="chat__tool-line c3__tool-line">
              <span className="chat__tool-line-verb">{c.verb}</span>
              <span className="chat__tool-line-target">— {truncate(c.target, 64)}</span>
              <span className="c3__tool-line-dur">{formatDuration(c.durationMs)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CodeChange({ a }: { a: Extract<Artifact, { kind: "code-change" }> }) {
  // CONVERSATION LAYER — visible. The agent shipped this; it's not noise to hide.
  // Diff stays collapsed by default (it IS detail), but the header announces clearly.
  const [diffOpen, setDiffOpen] = useState(false);
  return (
    <div className="chat__prose c3__code-block">
      <div className="c3__code-head">
        <span className="c3__code-icon" aria-hidden>◆</span>
        <span className="chat__code-title">{a.summary}</span>
        <span className="chat__code-stats">
          <span className="chat__code-add">+{a.added}</span>
          <span className="chat__code-rem">−{a.removed}</span>
        </span>
      </div>
      <p className="chat__code-file">{a.file}</p>
      {a.diffPreview && (
        <>
          <button
            className="c3__diff-toggle"
            onClick={() => setDiffOpen((v) => !v)}
            aria-expanded={diffOpen}
          >
            {diffOpen ? "Hide diff" : "Show diff"}
          </button>
          {diffOpen && <pre className="chat__code-diff">{a.diffPreview}</pre>}
        </>
      )}
    </div>
  );
}

function Report({ a }: { a: Extract<Artifact, { kind: "report" }> }) {
  // CONVERSATION LAYER — visible. This is the agent telling you what it shipped.
  return (
    <div className="chat__report c3__report">
      <div className="chat__report-head">
        {a.classification && <span className="chat__report-class">{a.classification}</span>}
        <span className="chat__report-title">{a.title}</span>
        <span className="chat__report-time">{formatTime(a.timestamp)}</span>
      </div>
      <p className="chat__report-body">{a.body}</p>
    </div>
  );
}

function Approval({ a }: { a: Extract<Artifact, { kind: "approval" }> }) {
  // CONVERSATION LAYER — most prominent. Action required.
  return (
    <div className="chat__approval c3__approval">
      <p className="chat__approval-label">Needs your call</p>
      <p className="chat__approval-title">{a.title}</p>
      <p className="chat__approval-context">{a.context}</p>
      <div className="chat__approval-actions">
        {a.actions.map((act) => (
          <button key={act.label} className="chat__btn" data-intent={act.intent}>
            {act.label}
          </button>
        ))}
      </div>
    </div>
  );
}
