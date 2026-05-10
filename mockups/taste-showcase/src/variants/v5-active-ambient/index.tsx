import { thread, workspaceTitle } from "../_shared/thread";
import type { Artifact } from "../_shared/types";
import { formatDuration, formatTime } from "../_shared/format";
import "./styles.css";

// v5 — Active-ambient.
// Hypothesis: hierarchy is a function of time, not just visual encoding.
// Past = ghosted, recent = full chrome, streaming = ambient lift + pulse.
// Principle 3 ("calm by default, alive on engagement") made literal.

// "Now" is the timestamp of the streaming artifact. Past artifacts decay.
const NOW = thread.find((a) => a.kind === "message" && a.streaming)?.timestamp
  ?? thread[thread.length - 1].timestamp;

function intensity(timestamp: string): "ghosted" | "muted" | "recent" | "active" {
  const ageSec = (new Date(NOW).getTime() - new Date(timestamp).getTime()) / 1000;
  if (ageSec >= 60) return "ghosted";
  if (ageSec >= 30) return "muted";
  if (ageSec >= 0) return "recent";
  return "recent"; // future-ish (e.g. approval just arrived)
}

export default function V5ActiveAmbient() {
  return (
    <section className="v5">
      <header className="v5__head">
        <h1 className="v5__head-title">{workspaceTitle}</h1>
        <p className="v5__head-sub">v5 — active-ambient</p>
      </header>
      <ol className="v5__thread">
        {thread.map((a) => {
          const i = a.kind === "message" && a.streaming
            ? "active"
            : intensity(a.timestamp);
          return (
            <li key={a.id} className="v5__row" data-intensity={i} data-kind={a.kind}>
              <Row a={a} />
            </li>
          );
        })}
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
    <div className="v5__message" data-author={a.author}>
      <p className="v5__byline">
        <span className="v5__glyph" aria-hidden>
          {a.streaming ? "▎" : a.author === "user" ? "▎" : "·"}
        </span>
        <span>{a.author === "user" ? "You" : "Agent"}</span>
        <span className="v5__time">{formatTime(a.timestamp)}</span>
      </p>
      <p className="v5__body">
        {a.body}
        {a.streaming && <span className="v5__cursor" aria-hidden />}
      </p>
    </div>
  );
}

function ToolCall({ a }: { a: Extract<Artifact, { kind: "tool-call" }> }) {
  return (
    <div className="v5__tool">
      <span className="v5__tool-verb">{a.verb.toLowerCase()}</span>
      <span className="v5__tool-target">{a.target}</span>
      {a.durationMs !== undefined && (
        <span className="v5__tool-dur">{formatDuration(a.durationMs)}</span>
      )}
    </div>
  );
}

function CodeChange({ a }: { a: Extract<Artifact, { kind: "code-change" }> }) {
  return (
    <div className="v5__code">
      <div className="v5__code-head">
        <span className="v5__code-title">{a.summary}</span>
        <span className="v5__code-stats">
          <span className="v5__code-add">+{a.added}</span>
          <span className="v5__code-rem">−{a.removed}</span>
        </span>
      </div>
      <p className="v5__code-file">{a.file}</p>
    </div>
  );
}

function Report({ a }: { a: Extract<Artifact, { kind: "report" }> }) {
  return (
    <div className="v5__report">
      <div className="v5__report-head">
        {a.classification && <span className="v5__report-class">{a.classification}</span>}
        <span className="v5__report-title">{a.title}</span>
      </div>
      <p className="v5__report-body">{a.body}</p>
    </div>
  );
}

function Approval({ a }: { a: Extract<Artifact, { kind: "approval" }> }) {
  return (
    <div className="v5__approval">
      <p className="v5__approval-label">Approval requested</p>
      <p className="v5__approval-title">{a.title}</p>
      <p className="v5__approval-context">{a.context}</p>
      <div className="v5__approval-actions">
        {a.actions.map((act) => (
          <button key={act.label} className="v5__approval-btn" data-intent={act.intent}>
            {act.label}
          </button>
        ))}
      </div>
    </div>
  );
}
