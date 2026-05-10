import { thread, workspaceTitle } from "../_shared/thread";
import type { Artifact } from "../_shared/types";
import { formatTime } from "../_shared/format";
import "./styles.css";

// v3 — Document register.
// Hypothesis: drop the chat metaphor. The thread reads as a document with bylines,
// paragraphs, and footnote-like tool calls. Manager's-cockpit-not-chat made literal.

export default function V3DocumentRegister() {
  return (
    <article className="v3">
      <header className="v3__head">
        <p className="v3__head-eyebrow">Workspace</p>
        <h1 className="v3__head-title">{workspaceTitle}</h1>
        <p className="v3__head-sub">v3 — document register</p>
      </header>
      <div className="v3__thread">
        {thread.map((a) => (
          <Row key={a.id} a={a} />
        ))}
      </div>
    </article>
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

function Byline({ author, timestamp }: { author: "user" | "agent"; timestamp: string }) {
  return (
    <p className="v3__byline">
      <span className="v3__byline-name">{author === "user" ? "You" : "Agent"}</span>
      <span className="v3__byline-rule" aria-hidden />
      <span className="v3__byline-time">{formatTime(timestamp)}</span>
    </p>
  );
}

function Message({ a }: { a: Extract<Artifact, { kind: "message" }> }) {
  return (
    <section className="v3__message">
      <Byline author={a.author} timestamp={a.timestamp} />
      <p className="v3__body">
        {a.body}
        {a.streaming && <span className="v3__cursor" aria-hidden />}
      </p>
    </section>
  );
}

function ToolCall({ a }: { a: Extract<Artifact, { kind: "tool-call" }> }) {
  return (
    <p className="v3__footnote">
      <span aria-hidden>—</span> {a.verb.toLowerCase()} <em>{a.target}</em>
    </p>
  );
}

function CodeChange({ a }: { a: Extract<Artifact, { kind: "code-change" }> }) {
  return (
    <figure className="v3__figure">
      <figcaption className="v3__figcap">
        <span className="v3__figcap-label">Change</span>
        <span className="v3__figcap-title">{a.summary}</span>
      </figcaption>
      <p className="v3__figure-meta">
        <code>{a.file}</code> <span className="v3__figure-stats">+{a.added} / −{a.removed}</span>
      </p>
      {a.diffPreview && <pre className="v3__figure-diff">{a.diffPreview}</pre>}
    </figure>
  );
}

function Report({ a }: { a: Extract<Artifact, { kind: "report" }> }) {
  return (
    <aside className="v3__report">
      <p className="v3__report-eyebrow">{a.classification ?? "report"}</p>
      <h2 className="v3__report-title">{a.title}</h2>
      <p className="v3__report-body">{a.body}</p>
    </aside>
  );
}

function Approval({ a }: { a: Extract<Artifact, { kind: "approval" }> }) {
  return (
    <section className="v3__request">
      <p className="v3__request-eyebrow">Request</p>
      <h2 className="v3__request-title">{a.title}</h2>
      <p className="v3__request-context">{a.context}</p>
      <div className="v3__request-actions">
        {a.actions.map((act) => (
          <button key={act.label} className="v3__request-btn" data-intent={act.intent}>
            {act.label}
          </button>
        ))}
      </div>
    </section>
  );
}
