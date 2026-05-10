import { useState } from "react";
import { thread, workspaceTitle } from "../_shared/thread";
import type { Artifact, MessageArtifact, ToolCallArtifact } from "../_shared/types";
import { groupArtifacts, truncate } from "../_shared/chat";
import { formatDuration, formatTime } from "../_shared/format";
import "../_shared/chat-baseline.css";
import "./styles.css";

// c4-a — synthesis of confirmed wins from c2-d + c3 + c2-b feedback (cycle 3 ledger):
//   - c2-d as base ("really solid chat experience overall")
//   - c3-style bordered diff box ("clear how to expand, distinct from non-code-changes")
//   - Rich inline-code prose from c2-b
//   - No invented glyphs (▎ ◇ ◆ removed)
//   - Tool-run header: chevron alone, no rail, no italics, explicitly center-aligned
//   - Report: clean bordered container, NO accent rail, NO chip — success lives in the prose
//   - User bubble padding bumped one step
//   - Narrative ↔ tool-run vertical spacing tightened

export default function C4ACleanReport() {
  const groups = groupArtifacts(thread);
  return (
    <div className="chat c4 c4-a">
      <header className="chat__head">
        <h1 className="chat__head-title">{workspaceTitle}</h1>
        <p className="chat__head-sub">c4-a — clean report</p>
        <span className="c4__resumed">resumed after 12 min</span>
      </header>
      <div className="chat__thread-wrap">
        <ol className="chat__thread c4__thread">
          <li className="chat__row c4__date-stamp">
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
      <div className="chat__bubble c4__bubble" title={formatTime(a.timestamp)}>
        {a.body}
      </div>
    );
  }
  if (a.id === "a8") {
    return (
      <div className="chat__prose c4__prose">
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
  return (
    <div className="chat__prose c4__prose">
      <p>
        {a.body}
        {a.streaming && <span className="chat__cursor c4__cursor" aria-hidden />}
      </p>
    </div>
  );
}

function ToolRun({ calls }: { calls: ToolCallArtifact[] }) {
  const [expanded, setExpanded] = useState(false);
  const total = calls.reduce((s, c) => s + (c.durationMs ?? 0), 0);
  const verbs = Array.from(new Set(calls.map((c) => c.verb.toLowerCase()))).slice(0, 3);
  const synopsis = verbs.join(" · ");
  return (
    <div className="chat__tool-run c4__tool-run">
      <button
        className="chat__tool-head c4__tool-head"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <Chevron expanded={expanded} />
        <span className="chat__tool-head-count">
          {calls.length} tool {calls.length === 1 ? "call" : "calls"}
        </span>
        <span className="c4__synopsis">— {synopsis}</span>
        <span className="chat__tool-head-time">{formatDuration(total)}</span>
      </button>
      {expanded && (
        <ul className="chat__tool-lines c4__tool-lines">
          {calls.map((c) => (
            <li key={c.id} className="chat__tool-line c4__tool-line">
              <span className="c4__tool-line-verb">{c.verb}</span>
              <span className="chat__tool-line-target">— {truncate(c.target, 64)}</span>
              <span className="c4__tool-line-dur">{formatDuration(c.durationMs)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CodeChange({ a }: { a: Extract<Artifact, { kind: "code-change" }> }) {
  const [diffOpen, setDiffOpen] = useState(false);
  return (
    <div className="c4__code-block">
      <div className="c4__code-head">
        <span className="chat__code-title">{a.summary}</span>
        <span className="chat__code-stats">
          <span className="chat__code-add">+{a.added}</span>
          <span className="chat__code-rem">−{a.removed}</span>
          {a.diffPreview && (
            <button
              className="c4__diff-toggle"
              onClick={() => setDiffOpen((v) => !v)}
              onMouseUp={(e) => e.currentTarget.blur()}
              aria-expanded={diffOpen}
            >
              {diffOpen ? "Hide" : "Show"}
            </button>
          )}
        </span>
      </div>
      <p className="chat__code-file">{a.file}</p>
      {diffOpen && a.diffPreview && <Diff text={a.diffPreview} />}
    </div>
  );
}

function Report({ a }: { a: Extract<Artifact, { kind: "report" }> }) {
  // c4-a variant: clean bordered container. No accent rail, no status chip.
  // The success lives in the prose — let it speak.
  return (
    <div className="c4-a__report">
      <p className="c4-a__report-title">{a.title}</p>
      <p className="c4-a__report-body">{a.body}</p>
    </div>
  );
}

function Approval({ a }: { a: Extract<Artifact, { kind: "approval" }> }) {
  return (
    <div className="chat__approval c4__approval">
      <p className="chat__approval-label c4__approval-label">Needs your call</p>
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

function Diff({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <pre className="c4__diff">
      {lines.map((line, i) => {
        const kind = line.startsWith("+") ? "add" : line.startsWith("-") ? "rem" : "ctx";
        return (
          <div key={i} className="c4__diff-line" data-kind={kind}>
            <span className="c4__diff-marker">{line[0] ?? " "}</span>
            <span className="c4__diff-text">{line.slice(1)}</span>
          </div>
        );
      })}
    </pre>
  );
}

function Chevron({ expanded }: { expanded: boolean }) {
  // SVG chevron — reliable vertical alignment vs the textual ›
  return (
    <svg
      className="c4__chevron"
      data-expanded={expanded}
      viewBox="0 0 12 12"
      width="12"
      height="12"
      aria-hidden
    >
      <path
        d="M4.5 2.5 L8 6 L4.5 9.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
