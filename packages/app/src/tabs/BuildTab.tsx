import { useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import type { Tab, Workspace } from "../ipc/types";
import { ipcClient } from "../ipc/client";
import { TabLayout } from "../layout/TabLayout";
import { StreamingText } from "../components/StreamingText";
import { IconButton } from "../components/IconButton";
import { Tooltip } from "../components/Tooltip";

interface Line {
  id: string;
  author: "you" | "builder";
  body: string;
  streaming?: boolean;
}

/**
 * Build — a chat / terminal-style surface where code actually gets built.
 * No task-board chrome: the builder agent (team-lead on the Claude Code
 * runtime) streams its work here, and the user drops instructions back.
 * The merge gate is a slash command ("/merge") rather than a separate
 * approval panel — the gate itself is still enforced in the Rust core
 * (see spec §5); this is just the UI affordance for asking.
 */
export function BuildTab({ workspace }: { tab: Tab; workspace: Workspace }) {
  /* `tab` is part of the shared TabContent prop shape but BuildTab renders
   * the same chat for any tab of template "build"; no tab-specific state. */
  const [lines, setLines] = useState<Line[]>([
    {
      id: "seed",
      author: "builder",
      body: `I'm on ${workspace.base_branch}. Type an instruction or /merge when ready.`,
    },
  ]);
  const [draft, setDraft] = useState("");
  const [merging, setMerging] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    const id = crypto.randomUUID();
    setLines((l) => [...l, { id, author: "you", body: text }]);
    setDraft("");

    if (text === "/merge") {
      setMerging(true);
      const approvalId = await ipcClient().requestApproval(
        workspace.id,
        "merge",
        `Merge workspace '${workspace.name}' into ${workspace.base_branch}`,
      );
      setLines((l) => [
        ...l,
        {
          id: crypto.randomUUID(),
          author: "builder",
          body: `Approval gate requested (${approvalId}). Waiting on your confirmation — gate is enforced in core, not here.`,
          streaming: true,
        },
      ]);
      setTimeout(async () => {
        await ipcClient().resolveApproval(approvalId, true);
        setLines((l) => [
          ...l,
          {
            id: crypto.randomUUID(),
            author: "builder",
            body: `Merged ${workspace.name} → ${workspace.base_branch}.`,
            streaming: true,
          },
        ]);
        setMerging(false);
      }, 900);
      return;
    }

    setLines((l) => [
      ...l,
      {
        id: crypto.randomUUID(),
        author: "builder",
        body: `Working on it. I'll stream diffs and test output here as the run progresses.`,
        streaming: true,
      },
    ]);
  };

  return (
    <TabLayout
      dock={
        <form
          className="compose"
          aria-label="Send an instruction to the builder"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <div className="compose__body">
            <textarea
              ref={inputRef}
              className="compose__input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={
                merging
                  ? "Waiting on approval…"
                  : "Instruction, diff request, or /merge…"
              }
              rows={2}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  send();
                }
              }}
              aria-label="Instruction"
              disabled={merging}
            />
          </div>
          <div className="compose__footer">
            <div className="compose__footer-left">
              <Tooltip label="Slash commands run locally first and enter the approval gate before any write.">
                <span className="compose__hint">
                  /plan · /diff · /test · /merge
                </span>
              </Tooltip>
            </div>
            <div className="compose__actions">
              <IconButton
                type="submit"
                label="Run"
                shortcut="⌘↵"
                className="btn-icon--primary"
                disabled={merging}
              >
                <ArrowUp size={14} strokeWidth={1.5} aria-hidden="true" />
              </IconButton>
            </div>
          </div>
        </form>
      }
    >
      <section
        className="chat chat--build"
        aria-label="Build stream"
        aria-live="polite"
      >
        {lines.map((m) => (
          <article
            key={m.id}
            className="chat__message"
            data-author={m.author === "you" ? "you" : "agent"}
          >
            {m.author !== "you" && (
              <span className="chat__author">{m.author}</span>
            )}
            <span className="chat__body chat__body--mono">
              {m.streaming ? <StreamingText text={m.body} /> : m.body}
            </span>
          </article>
        ))}
      </section>
    </TabLayout>
  );
}
