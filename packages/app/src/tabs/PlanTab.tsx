import { useRef, useState } from "react";
import { StreamingText } from "../components/StreamingText";
import { TabLayout } from "../layout/TabLayout";
import type { Tab, Workspace } from "../ipc/types";

interface Message {
  id: string;
  author: "you" | "team-lead" | "design-reviewer" | "test-runner";
  body: string;
  streaming?: boolean;
}

interface Attachment {
  id: string;
  name: string;
  size: number;
}

type Model = "opus-4.7" | "sonnet-4.6" | "haiku-4.5";
type Effort = "low" | "medium" | "high";

const MODEL_LABEL: Record<Model, string> = {
  "opus-4.7": "Opus 4.7",
  "sonnet-4.6": "Sonnet 4.6",
  "haiku-4.5": "Haiku 4.5",
};

const EFFORT_LABEL: Record<Effort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export function PlanTab({ tab, workspace }: { tab: Tab; workspace: Workspace }) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "seed-1",
      author: "team-lead",
      body: `I've reviewed the workspace context. We're on ${workspace.base_branch}. Ready when you are — what's the outcome we're shooting for?`,
    },
  ]);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [model, setModel] = useState<Model>("opus-4.7");
  const [effort, setEffort] = useState<Effort>("medium");
  const [planMode, setPlanMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const send = () => {
    const trimmed = draft.trim();
    if (!trimmed && attachments.length === 0) return;
    // Pack the compose config + attachments into the outgoing body until the
    // real IPC schema (Phase 13.D) carries them as first-class fields. This
    // keeps model/effort/planMode visible in the event stream today.
    const configLine = `[model=${model} · effort=${effort}${planMode ? " · plan-mode" : ""}]`;
    const attachLine = attachments.length
      ? `\n\n(attached: ${attachments.map((a) => a.name).join(", ")})`
      : "";
    const you: Message = {
      id: crypto.randomUUID(),
      author: "you",
      body: `${configLine}\n${trimmed}${attachLine}`,
    };
    const reply: Message = {
      id: crypto.randomUUID(),
      author: "team-lead",
      body: ackFor(trimmed, planMode),
      streaming: true,
    };
    setMessages((m) => [...m, you, reply]);
    setDraft("");
    setAttachments([]);
  };

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    const added: Attachment[] = [];
    for (const f of Array.from(files)) {
      added.push({ id: crypto.randomUUID(), name: f.name, size: f.size });
    }
    if (added.length) setAttachments((a) => [...a, ...added]);
  };

  return (
    <TabLayout
      dock={
        <form
          className="compose"
          data-dragging={dragging}
          aria-label="Send a message"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleFiles(e.dataTransfer.files);
          }}
        >
          {attachments.length > 0 && (
            <ul className="compose__attach-list" aria-label="Attachments">
              {attachments.map((a) => (
                <li key={a.id} className="compose__chip">
                  <span className="compose__chip-name">{a.name}</span>
                  <button
                    type="button"
                    className="compose__chip-remove"
                    aria-label={`Remove ${a.name}`}
                    title={`Remove ${a.name}`}
                    onClick={() => setAttachments((list) => list.filter((x) => x.id !== a.id))}
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                      <path d="M2 2l6 6" />
                      <path d="M8 2l-6 6" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="compose__body">
            <textarea
              className="compose__input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={dragging ? "Drop files to attach…" : "Say something to the team…"}
              rows={3}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  send();
                }
              }}
              aria-label="Message"
              title="Message to the team · ⌘↵ to send"
            />
            <div className="compose__inline-actions">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  handleFiles(e.target.files);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              />
              <button
                type="button"
                className="compose__icon-btn"
                aria-label="Attach file"
                title="Attach file"
                onClick={() => fileInputRef.current?.click()}
              >
                <IconAttach />
              </button>
              <button
                type="button"
                className="compose__icon-btn"
                aria-label="Dictation — coming soon"
                title="Dictation — coming soon"
                disabled
              >
                <IconMic />
              </button>
            </div>
          </div>

          <div className="compose__footer">
            <div className="compose__footer-left">
              <label className="compose__select">
                <span className="compose__select-label">Model</span>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value as Model)}
                  aria-label="Model"
                  title="Model used for this message"
                >
                  {(Object.keys(MODEL_LABEL) as Model[]).map((m) => (
                    <option key={m} value={m}>{MODEL_LABEL[m]}</option>
                  ))}
                </select>
              </label>
              <label className="compose__select">
                <span className="compose__select-label">Effort</span>
                <select
                  value={effort}
                  onChange={(e) => setEffort(e.target.value as Effort)}
                  aria-label="Effort"
                  title="How much reasoning the agent should spend"
                >
                  {(Object.keys(EFFORT_LABEL) as Effort[]).map((e) => (
                    <option key={e} value={e}>{EFFORT_LABEL[e]}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="compose__toggle"
                aria-pressed={planMode}
                onClick={() => setPlanMode((p) => !p)}
                title="Plan mode — propose before acting"
              >
                <IconPlanMode />
                <span>Plan mode</span>
              </button>
            </div>
            <button
              type="submit"
              className="compose__send"
              aria-label="Send"
              title="Send (⌘↵)"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M7 11V3" />
                <path d="M3.5 6.5L7 3l3.5 3.5" />
              </svg>
            </button>
          </div>
        </form>
      }
    >
      <header className="tab-header">
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
    </TabLayout>
  );
}

function IconAttach() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 3.5L5 8.5a1.5 1.5 0 0 0 2.1 2.1l5-5a3 3 0 0 0-4.2-4.2L2.7 6.5a4.5 4.5 0 0 0 6.4 6.4l4.4-4.4" />
    </svg>
  );
}

function IconMic() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="1.5" width="4" height="7" rx="2" />
      <path d="M2.5 6.5a4.5 4.5 0 0 0 9 0" />
      <path d="M7 11v1.5" />
    </svg>
  );
}

function IconPlanMode() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="2" width="8" height="8" rx="1.25" />
      <path d="M4 5h4" />
      <path d="M4 7h2.5" />
    </svg>
  );
}

function ackFor(userText: string, planMode: boolean): string {
  const prefix = planMode
    ? "Plan mode on — I'll propose before acting. Draft plan:"
    : "Got it. I'll work this into a spec and come back with a draft. Here's what I'll cover:";
  return `${prefix}
• Restate goals and success criteria
• Flag constraints and dependencies
• Propose a path plus two alternatives

I heard: "${userText.slice(0, 140)}${userText.length > 140 ? "…" : ""}"`;
}
