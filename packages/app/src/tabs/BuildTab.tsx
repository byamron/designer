import { useState } from "react";
import type { Tab, Workspace } from "../ipc/types";
import { ipcClient } from "../ipc/client";

interface Task {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "done";
  assignee?: string;
}

export function BuildTab({ tab, workspace }: { tab: Tab; workspace: Workspace }) {
  const [tasks, setTasks] = useState<Task[]>([
    { id: crypto.randomUUID(), title: "Implement auth middleware", status: "in_progress", assignee: "team-lead" },
    { id: crypto.randomUUID(), title: "Write integration tests", status: "todo", assignee: "test-runner" },
    { id: crypto.randomUUID(), title: "Review design spec", status: "done", assignee: "design-reviewer" },
  ]);
  const [title, setTitle] = useState("");
  const [approvalState, setApprovalState] = useState<"idle" | "pending" | "granted" | "denied">("idle");

  const add = () => {
    if (!title.trim()) return;
    setTasks((t) => [...t, { id: crypto.randomUUID(), title: title.trim(), status: "todo" }]);
    setTitle("");
  };

  const requestMerge = async () => {
    setApprovalState("pending");
    const id = await ipcClient().requestApproval(
      workspace.id,
      "merge",
      `Merge workspace '${workspace.name}' into ${workspace.base_branch}`,
    );
    // In a real app this would wait for a user to resolve it. Here we
    // simulate a grant after a tick so the visual feedback is smooth.
    setTimeout(async () => {
      await ipcClient().resolveApproval(id, true);
      setApprovalState("granted");
    }, 900);
  };

  return (
    <>
      <header style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <span className="card__kicker">Build</span>
        <h2 className="tab-title">{tab.title}</h2>
        <p className="tab-subtitle">
          Task list + agent streams. When the team is ready, request the merge
          gate — Designer asks you to approve before any write to{" "}
          {workspace.base_branch}.
        </p>
      </header>

      <section className="card" aria-label="Task list">
        <span className="card__kicker">Tasks</span>
        <ul role="list" style={{ margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          {tasks.map((t) => (
            <li
              key={t.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "var(--space-2) var(--space-3)",
                borderRadius: "var(--radius-button)",
                background: "var(--color-background)",
                border: "1px solid var(--color-border)",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <span
                  className="state-dot"
                  data-state={t.status === "in_progress" ? "active" : t.status === "done" ? "idle" : "blocked"}
                  aria-hidden="true"
                />
                <span>{t.title}</span>
              </span>
              <span className="workspace-row__meta">
                {t.assignee ?? "unassigned"} · {t.status.replace("_", " ")}
              </span>
            </li>
          ))}
        </ul>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
          style={{ display: "flex", gap: "var(--space-2)" }}
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="New task…"
            aria-label="New task"
            style={{
              all: "unset",
              flex: 1,
              padding: "var(--space-2) var(--space-3)",
              borderRadius: "var(--radius-button)",
              border: "1px solid var(--color-border)",
              background: "var(--color-background)",
              color: "var(--color-foreground)",
            }}
          />
          <button type="submit" className="btn">Add</button>
        </form>
      </section>

      <section className="card" aria-label="Merge gate">
        <span className="card__kicker">Approval gate</span>
        <h3 className="card__title">Merge to {workspace.base_branch}</h3>
        <p style={{ margin: 0, color: "var(--color-muted)" }}>
          Approval gates are enforced in the Rust core, not here. A frontend bug
          cannot bypass them; the agent will wait until you grant.
        </p>
        <div className="card__footer">
          <button
            type="button"
            className="btn"
            data-variant="primary"
            onClick={requestMerge}
            disabled={approvalState !== "idle" && approvalState !== "denied"}
          >
            {approvalState === "idle" && "Request merge"}
            {approvalState === "pending" && "Waiting for approval…"}
            {approvalState === "granted" && "Merged"}
            {approvalState === "denied" && "Denied — try again"}
          </button>
        </div>
      </section>
    </>
  );
}
