import { useState } from "react";
import { thread, workspaceTitle } from "../_shared/thread";
import type { Artifact, ToolCallArtifact } from "../_shared/types";
import { formatDuration, formatTime } from "../_shared/format";
import "./styles.css";

// v4 — Coalesce-disclose.
// Hypothesis: tool-call noise was the real complaint, not hierarchy.
// Reduce hard via progressive disclosure. Messages stay simple.

type Group =
  | { kind: "single"; a: Artifact }
  | { kind: "tool-run"; calls: ToolCallArtifact[] };

function group(artifacts: Artifact[]): Group[] {
  const out: Group[] = [];
  for (const a of artifacts) {
    const prev = out[out.length - 1];
    if (a.kind === "tool-call") {
      if (prev && prev.kind === "tool-run") {
        prev.calls.push(a);
      } else {
        out.push({ kind: "tool-run", calls: [a] });
      }
    } else {
      out.push({ kind: "single", a });
    }
  }
  return out;
}

export default function V4CoalesceDisclose() {
  const groups = group(thread);
  return (
    <section className="v4">
      <header className="v4__head">
        <h1 className="v4__head-title">{workspaceTitle}</h1>
        <p className="v4__head-sub">v4 — coalesce-disclose</p>
      </header>
      <ol className="v4__thread">
        {groups.map((g, i) =>
          g.kind === "tool-run" ? (
            <li key={i} className="v4__row"><ToolRun calls={g.calls} /></li>
          ) : (
            <li key={i} className="v4__row"><Row a={g.a} /></li>
          ),
        )}
      </ol>
    </section>
  );
}

function Row({ a }: { a: Artifact }) {
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

function Message({ a }: { a: Extract<Artifact, { kind: "message" }> }) {
  return (
    <div className="v4__message" data-author={a.author}>
      <p className="v4__byline">
        <span className="v4__byline-glyph" aria-hidden>
          {a.author === "user" ? "▎" : "◇"}
        </span>
        <span>{a.author === "user" ? "You" : "Agent"}</span>
        <span className="v4__byline-time">{formatTime(a.timestamp)}</span>
      </p>
      <p className="v4__body">
        {a.body}
        {a.streaming && <span className="v4__cursor" aria-hidden />}
      </p>
    </div>
  );
}

function ToolRun({ calls }: { calls: ToolCallArtifact[] }) {
  const [expanded, setExpanded] = useState(false);
  const total = calls.reduce((sum, c) => sum + (c.durationMs ?? 0), 0);
  const summary = calls.map((c) => c.target.split("/").pop()).slice(0, 4).join(", ");
  const more = calls.length > 4 ? `, +${calls.length - 4} more` : "";

  return (
    <div className="v4__tool-run">
      <button
        className="v4__tool-summary"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="v4__tool-chevron" aria-hidden data-expanded={expanded}>›</span>
        <span className="v4__tool-count">Used {calls.length} tools</span>
        <span className="v4__tool-list">— {summary}{more}</span>
        <span className="v4__tool-dur">{formatDuration(total)}</span>
      </button>
      {expanded && (
        <ul className="v4__tool-detail">
          {calls.map((c) => (
            <li key={c.id} className="v4__tool-line">
              <span className="v4__tool-verb">{c.verb.toLowerCase()}</span>
              <span className="v4__tool-target">{c.target}</span>
              {c.durationMs !== undefined && (
                <span className="v4__tool-dur-each">{formatDuration(c.durationMs)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CodeChange({ a }: { a: Extract<Artifact, { kind: "code-change" }> }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="v4__code">
      <button
        className="v4__code-summary"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="v4__code-chevron" aria-hidden data-expanded={expanded}>›</span>
        <span className="v4__code-title">{a.summary}</span>
        <span className="v4__code-stats">
          <span className="v4__code-add">+{a.added}</span>
          <span className="v4__code-rem">−{a.removed}</span>
        </span>
      </button>
      {expanded && (
        <div className="v4__code-detail">
          <p className="v4__code-file">{a.file}</p>
          {a.diffPreview && <pre className="v4__code-diff">{a.diffPreview}</pre>}
        </div>
      )}
    </div>
  );
}

function Report({ a }: { a: Extract<Artifact, { kind: "report" }> }) {
  const [expanded, setExpanded] = useState(false);
  const oneLine = a.body.split(".")[0] + ".";
  return (
    <div className="v4__report">
      <button
        className="v4__report-summary"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="v4__report-chevron" aria-hidden data-expanded={expanded}>›</span>
        {a.classification && <span className="v4__report-class">{a.classification}</span>}
        <span className="v4__report-title">{a.title}</span>
        {!expanded && <span className="v4__report-snip">— {oneLine}</span>}
      </button>
      {expanded && <p className="v4__report-body">{a.body}</p>}
    </div>
  );
}

function Approval({ a }: { a: Extract<Artifact, { kind: "approval" }> }) {
  return (
    <div className="v4__approval">
      <p className="v4__approval-label">Approval requested</p>
      <p className="v4__approval-title">{a.title}</p>
      <p className="v4__approval-context">{a.context}</p>
      <div className="v4__approval-actions">
        {a.actions.map((act) => (
          <button key={act.label} className="v4__approval-btn" data-intent={act.intent}>
            {act.label}
          </button>
        ))}
      </div>
    </div>
  );
}
