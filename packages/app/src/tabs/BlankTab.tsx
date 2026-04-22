import type { Tab, Workspace } from "../ipc/types";
import { TabLayout } from "../layout/TabLayout";

export function BlankTab({ tab, workspace }: { tab: Tab; workspace: Workspace }) {
  return (
    <TabLayout>
      <header className="tab-header">
        <h2 className="tab-title">{tab.title}</h2>
        <p className="tab-subtitle">
          Empty canvas. Compose anything — `@`-reference other tabs, files, or
          agents to pull them into context.
        </p>
      </header>

      <section
        className="card"
        style={{
          minHeight: "calc(var(--space-8) * 6)",
          alignItems: "stretch",
        }}
      >
        <span className="card__kicker">Prompt suggestions</span>
        <ul
          role="list"
          style={{
            margin: 0,
            padding: 0,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "var(--space-2)",
          }}
        >
          {[
            `Summarize the last 10 events in ${workspace.name}.`,
            "Propose three directions for the next iteration.",
            "Draft a status report for Friday.",
            "Review the spec and flag anything unclear.",
          ].map((p) => (
            <li key={p}>
              <button
                type="button"
                className="btn"
                title={`Send: ${p}`}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "var(--space-3)",
                  whiteSpace: "normal",
                }}
              >
                {p}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </TabLayout>
  );
}
