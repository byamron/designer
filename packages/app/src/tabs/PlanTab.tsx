import { useState } from "react";
import { StreamingText } from "../components/StreamingText";
import type { Tab, Workspace } from "../ipc/types";

interface Message {
  id: string;
  author: "you" | "team-lead" | "design-reviewer" | "test-runner";
  body: string;
  streaming?: boolean;
}

export function PlanTab({ tab, workspace }: { tab: Tab; workspace: Workspace }) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "seed-1",
      author: "team-lead",
      body: `I've reviewed the workspace context. We're on ${workspace.base_branch}. Ready when you are — what's the outcome we're shooting for?`,
    },
  ]);
  const [draft, setDraft] = useState("");

  const send = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const you: Message = { id: crypto.randomUUID(), author: "you", body: trimmed };
    const reply: Message = {
      id: crypto.randomUUID(),
      author: "team-lead",
      body: ackFor(trimmed),
      streaming: true,
    };
    setMessages((m) => [...m, you, reply]);
    setDraft("");
  };

  return (
    <>
      <header style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <span className="card__kicker">Plan</span>
        <h2 className="tab-title">{tab.title}</h2>
        <p className="tab-subtitle">
          Chat with the team lead. Shared context: {workspace.name} on {workspace.base_branch}.
        </p>
      </header>

      <section className="chat" aria-label="Plan conversation">
        {messages.map((m) => (
          <article
            key={m.id}
            className="chat__message"
            data-author={m.author === "you" ? "you" : "agent"}
          >
            <span className="chat__author">{m.author}</span>
            <span className="chat__body">
              {m.streaming ? <StreamingText text={m.body} /> : m.body}
            </span>
          </article>
        ))}
      </section>

      <form
        aria-label="Send a message"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        style={{
          display: "flex",
          gap: "var(--space-2)",
          padding: "var(--space-3)",
          background: "var(--color-surface-flat)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-card)",
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Say something to the team…"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
          style={{
            all: "unset",
            flex: 1,
            minHeight: "var(--space-6)",
            padding: "var(--space-2) var(--space-3)",
            color: "var(--color-foreground)",
            background: "var(--color-background)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-button)",
            fontFamily: "var(--type-family-sans)",
            fontSize: "var(--type-body-size)",
          }}
          aria-label="Message"
        />
        <button type="submit" className="btn" data-variant="primary">
          Send <kbd style={{ marginLeft: "var(--space-1)" }}>⌘↵</kbd>
        </button>
      </form>

      <footer style={{ color: "var(--color-muted)", fontSize: "var(--type-caption-size)" }}>
        Messages flow through the team's mailbox; agents cannot open tabs on
        their own. Artifacts appear as attachments; click to open.
      </footer>
    </>
  );
}

function ackFor(userText: string): string {
  // In a real session, this is where the orchestrator fans out to the team.
  // In demo mode, we produce an acknowledging stub.
  return `Got it. I'll work this into a spec and come back to you with a draft. Here's what I'll cover:
• Restate goals and success criteria
• Flag constraints and dependencies
• Propose a path plus two alternatives

I heard: "${userText.slice(0, 140)}${userText.length > 140 ? "…" : ""}"`;
}
