import { thread, workspaceTitle } from "../_shared/thread";
import type { Artifact } from "../_shared/types";
import { formatDuration, formatTime } from "../_shared/format";
import "./styles.css";

// v1 — Color-hierarchy maximalist.
// Hypothesis: axiom 16 ("hierarchy is color-before-weight-before-size") does the work.
// All artifacts share indent and weight; color delta carries everything.

export default function V1ColorHierarchy() {
  return (
    <section className="v1">
      <header className="v1__head">
        <h1 className="v1__head-title">{workspaceTitle}</h1>
        <p className="v1__head-sub">v1 — color-hierarchy</p>
      </header>
      <ol className="v1__thread">
        {thread.map((a) => (
          <li key={a.id} className="v1__row">
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
    <div className="v1__message" data-author={a.author}>
      <div className="v1__byline">
        <span className="v1__byline-name">{a.author === "user" ? "You" : "Agent"}</span>
        <span className="v1__byline-time">{formatTime(a.timestamp)}</span>
      </div>
      <p className="v1__body">
        {a.body}
        {a.streaming && <span className="v1__cursor" aria-hidden />}
      </p>
    </div>
  );
}

function ToolCall({ a }: { a: Extract<Artifact, { kind: "tool-call" }> }) {
  return (
    <div className="v1__tool">
      <span className="v1__tool-verb">{a.verb}</span>
      <span className="v1__tool-target">{a.target}</span>
      {a.durationMs !== undefined && (
        <span className="v1__tool-dur">{formatDuration(a.durationMs)}</span>
      )}
    </div>
  );
}

function CodeChange({ a }: { a: Extract<Artifact, { kind: "code-change" }> }) {
  return (
    <div className="v1__code">
      <div className="v1__code-head">
        <span className="v1__code-title">{a.summary}</span>
        <span className="v1__code-stats">
          <span className="v1__code-add">+{a.added}</span>
          <span className="v1__code-rem">−{a.removed}</span>
        </span>
      </div>
      <div className="v1__code-file">{a.file}</div>
      {a.diffPreview && <pre className="v1__code-diff">{a.diffPreview}</pre>}
    </div>
  );
}

function Report({ a }: { a: Extract<Artifact, { kind: "report" }> }) {
  return (
    <div className="v1__report">
      <div className="v1__report-head">
        {a.classification && <span className="v1__report-class">{a.classification}</span>}
        <span className="v1__report-title">{a.title}</span>
      </div>
      <p className="v1__report-body">{a.body}</p>
    </div>
  );
}

function Approval({ a }: { a: Extract<Artifact, { kind: "approval" }> }) {
  return (
    <div className="v1__approval">
      <div className="v1__approval-head">
        <span className="v1__approval-label">Approval</span>
        <span className="v1__approval-title">{a.title}</span>
      </div>
      <p className="v1__approval-context">{a.context}</p>
      <div className="v1__approval-actions">
        {a.actions.map((act) => (
          <button key={act.label} className="v1__approval-btn" data-intent={act.intent}>
            {act.label}
          </button>
        ))}
      </div>
    </div>
  );
}
