import { thread, workspaceTitle } from "../_shared/thread";
import type { Artifact } from "../_shared/types";
import { formatDuration, formatTime } from "../_shared/format";
import "./styles.css";

// v2 — Spatial-rhythm.
// Hypothesis: hierarchy carried by gutter rules + indent, not color.
// Single foreground color throughout. User has a 2px gutter rail; agent doesn't.
// Tool calls indent under their owning agent message with tree-style connectors.

export default function V2SpatialRhythm() {
  return (
    <section className="v2">
      <header className="v2__head">
        <h1 className="v2__head-title">{workspaceTitle}</h1>
        <p className="v2__head-sub">v2 — spatial-rhythm</p>
      </header>
      <ol className="v2__thread">
        {thread.map((a) => (
          <li key={a.id} className="v2__row" data-kind={a.kind} data-author={a.author}>
            <Row a={a} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function Row({ a }: { a: Artifact }) {
  switch (a.kind) {
    case "message":
      return <Message a={a} />;
    case "tool-call":
      return <ToolCall a={a} />;
    case "code-change":
      return <CodeChange a={a} />;
    case "report":
      return <Report a={a} />;
    case "approval":
      return <Approval a={a} />;
  }
}

function Message({ a }: { a: Extract<Artifact, { kind: "message" }> }) {
  return (
    <div className="v2__message">
      <div className="v2__byline">
        <span>{a.author === "user" ? "You" : "Agent"}</span>
        <span aria-hidden>·</span>
        <span>{formatTime(a.timestamp)}</span>
      </div>
      <p className="v2__body">
        {a.body}
        {a.streaming && <span className="v2__cursor" aria-hidden />}
      </p>
    </div>
  );
}

function ToolCall({ a }: { a: Extract<Artifact, { kind: "tool-call" }> }) {
  return (
    <div className="v2__tool">
      <span className="v2__tool-connector" aria-hidden>└─</span>
      <span className="v2__tool-verb">{a.verb}</span>
      <span className="v2__tool-target">{a.target}</span>
      {a.durationMs !== undefined && (
        <span className="v2__tool-dur">{formatDuration(a.durationMs)}</span>
      )}
    </div>
  );
}

function CodeChange({ a }: { a: Extract<Artifact, { kind: "code-change" }> }) {
  return (
    <div className="v2__code">
      <div className="v2__code-head">
        <span className="v2__code-connector" aria-hidden>└─</span>
        <span className="v2__code-title">{a.summary}</span>
        <span className="v2__code-stats">
          <span className="v2__code-add">+{a.added}</span>
          <span className="v2__code-rem">−{a.removed}</span>
        </span>
      </div>
      <div className="v2__code-file">{a.file}</div>
      {a.diffPreview && <pre className="v2__code-diff">{a.diffPreview}</pre>}
    </div>
  );
}

function Report({ a }: { a: Extract<Artifact, { kind: "report" }> }) {
  return (
    <div className="v2__report">
      <div className="v2__report-head">
        {a.classification && <span className="v2__report-class">{a.classification}</span>}
        <span className="v2__report-title">{a.title}</span>
        <span className="v2__report-time">{formatTime(a.timestamp)}</span>
      </div>
      <p className="v2__report-body">{a.body}</p>
    </div>
  );
}

function Approval({ a }: { a: Extract<Artifact, { kind: "approval" }> }) {
  return (
    <div className="v2__approval">
      <div className="v2__approval-head">
        <span className="v2__approval-label">Approval requested</span>
        <span className="v2__approval-title">{a.title}</span>
      </div>
      <p className="v2__approval-context">{a.context}</p>
      <div className="v2__approval-actions">
        {a.actions.map((act) => (
          <button key={act.label} className="v2__approval-btn" data-intent={act.intent}>
            {act.label}
          </button>
        ))}
      </div>
    </div>
  );
}
