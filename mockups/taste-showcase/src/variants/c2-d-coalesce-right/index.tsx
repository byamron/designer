import { useState } from "react";
import { thread, workspaceTitle } from "../_shared/thread";
import type { Artifact, MessageArtifact, ToolCallArtifact } from "../_shared/types";
import { groupArtifacts, truncate } from "../_shared/chat";
import { formatDuration, formatTime } from "../_shared/format";
import "../_shared/chat-baseline.css";
import "./styles.css";

// c2-d — Coalesce-done-right.
// Pushes Reduction + Three-Slider Problem within the chat baseline.
// Tool-run header matches Designer's live "3 tool calls, 2 messages" pattern.
// Code-changes and reports collapse-by-default with progressive disclosure.

export default function C2DCoalesceRight() {
  const groups = groupArtifacts(thread);
  return (
    <div className="chat c2-d">
      <header className="chat__head">
        <h1 className="chat__head-title">{workspaceTitle}</h1>
        <p className="chat__head-sub">c2-d — coalesce-right</p>
      </header>
      <div className="chat__thread-wrap">
        <ol className="chat__thread">
          {groups.map((g, i) => (
            <li
              key={i}
              className="chat__row"
              data-kind={g.kind === "single" ? g.a.kind : "tool-run"}
              data-author={g.kind === "single" ? g.a.author : "agent"}
            >
              {g.kind === "tool-run" ? <ToolRun calls={g.calls} /> : <Single a={g.a} />}
            </li>
          ))}
        </ol>
        <div className="chat__pill">↓ Jump to latest</div>
      </div>
      <footer className="chat__compose">
        <div className="chat__compose-inner">
          <input className="chat__compose-input" placeholder="Message agent…" />
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
    return <div className="chat__bubble">{a.body}</div>;
  }
  return (
    <div className="chat__prose">
      <p>
        {a.body}
        {a.streaming && <span className="chat__cursor" aria-hidden />}
      </p>
    </div>
  );
}

function ToolRun({ calls }: { calls: ToolCallArtifact[] }) {
  // Default collapsed — reduction is the bet.
  const [expanded, setExpanded] = useState(false);
  const total = calls.reduce((s, c) => s + (c.durationMs ?? 0), 0);
  // Designer's live ref pattern: count + a running synopsis of what was done
  const verbs = Array.from(new Set(calls.map((c) => c.verb.toLowerCase()))).slice(0, 3);
  const synopsis = verbs.join(" · ");
  return (
    <div className="chat__tool-run c2-d__tool-run">
      <button
        className="chat__tool-head"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="chat__tool-head-chevron" aria-hidden data-expanded={expanded}>›</span>
        <span className="chat__tool-head-count">
          {calls.length} tool {calls.length === 1 ? "call" : "calls"}
        </span>
        <span className="c2-d__synopsis">— {synopsis}</span>
        <span className="chat__tool-head-time">{formatDuration(total)}</span>
      </button>
      {expanded && (
        <ul className="chat__tool-lines">
          {calls.map((c) => (
            <li key={c.id} className="chat__tool-line c2-d__tool-line">
              <span className="chat__tool-line-verb">{c.verb}</span>
              <span className="chat__tool-line-target">— {truncate(c.target, 64)}</span>
              <span className="c2-d__tool-line-dur">{formatDuration(c.durationMs)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CodeChange({ a }: { a: Extract<Artifact, { kind: "code-change" }> }) {
  // Collapse-by-default — title + stats + file path, expand for diff
  const [expanded, setExpanded] = useState(false);
  return (
    <button
      type="button"
      className="c2-d__code"
      data-expanded={expanded}
      onClick={() => setExpanded((v) => !v)}
      aria-expanded={expanded}
    >
      <div className="c2-d__code-row">
        <span className="chat__tool-head-chevron" aria-hidden data-expanded={expanded}>›</span>
        <span className="chat__code-title">{a.summary}</span>
        <span className="chat__code-stats">
          <span className="chat__code-add">+{a.added}</span>
          <span className="chat__code-rem">−{a.removed}</span>
        </span>
      </div>
      <p className="chat__code-file">{a.file}</p>
      {expanded && a.diffPreview && <pre className="chat__code-diff">{a.diffPreview}</pre>}
    </button>
  );
}

function Report({ a }: { a: Extract<Artifact, { kind: "report" }> }) {
  // Collapse-after-read pattern: title + 1-line summary visible, body on click
  const [expanded, setExpanded] = useState(false);
  const oneLine = a.body.split(".")[0] + ".";
  return (
    <button
      type="button"
      className="chat__report c2-d__report"
      data-expanded={expanded}
      onClick={() => setExpanded((v) => !v)}
      aria-expanded={expanded}
    >
      <div className="chat__report-head">
        {a.classification && <span className="chat__report-class">{a.classification}</span>}
        <span className="chat__report-title">{a.title}</span>
        <span className="chat__report-time">{formatTime(a.timestamp)}</span>
      </div>
      <p className="chat__report-body">{expanded ? a.body : oneLine}</p>
    </button>
  );
}

function Approval({ a }: { a: Extract<Artifact, { kind: "approval" }> }) {
  return (
    <div className="chat__approval">
      <p className="chat__approval-label">Approval requested</p>
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
