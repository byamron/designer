import type { CSSProperties } from "react";

/**
 * Component catalog. Renders each Mini archetype once with its default state
 * so the user can see tokens applied live. When tokens change (gray flavor,
 * radius, motion), the catalog updates automatically because it references
 * token variables, not frozen values.
 */
export function ComponentCatalog() {
  const tiles: Array<{
    name: string;
    hint: string;
    render: () => JSX.Element;
  }> = [
    {
      name: "Button (primary)",
      hint: "token: --radius-button / --color-foreground",
      render: () => (
        <button className="btn" data-variant="primary">
          Publish
        </button>
      ),
    },
    {
      name: "Button (secondary)",
      hint: "token: --color-surface-raised",
      render: () => (
        <button className="btn">Review</button>
      ),
    },
    {
      name: "Danger action",
      hint: "token: --danger-3 / --danger-7",
      render: () => (
        <button className="btn" data-variant="danger">
          Discard worktree
        </button>
      ),
    },
    {
      name: "State dots",
      hint: "active / idle / blocked / needs-you / errored",
      render: () => (
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
          {(["active", "idle", "blocked", "needs_you", "errored"] as const).map((s) => (
            <span key={s} style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
              <span className="state-dot" data-state={s} aria-hidden="true" />
              <span className="workspace-row__meta">{s}</span>
            </span>
          ))}
        </div>
      ),
    },
    {
      name: "Input",
      hint: "token: --radius-button / --color-border",
      render: () => (
        <input
          aria-label="Example input"
          placeholder="Workspace name…"
          style={{
            all: "unset",
            padding: "var(--space-2) var(--space-3)",
            background: "var(--color-background)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-button)",
            color: "var(--color-foreground)",
            minWidth: "calc(var(--space-8) * 3)",
          }}
        />
      ),
    },
    {
      name: "Kbd hint",
      hint: "token: --radius-badge / --color-surface-overlay",
      render: () => (
        <div style={{ display: "flex", gap: "var(--space-1)", alignItems: "center" }}>
          <kbd>⌘</kbd><kbd>K</kbd>
        </div>
      ),
    },
    {
      name: "Card",
      hint: "token: --elevation-raised / --radius-card",
      render: () => (
        <div
          style={{
            background: "var(--color-surface-raised)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-card)",
            padding: "var(--space-3)",
            boxShadow: "var(--elevation-raised)",
            width: "100%",
          }}
        >
          Streamed tokens land here.
        </div>
      ),
    },
    {
      name: "Streaming cursor",
      hint: "motion: 700ms blink · reduced-motion: static",
      render: () => (
        <span>
          Typing
          <span className="streaming-cursor" aria-hidden="true" />
        </span>
      ),
    },
    {
      name: "Semantic chips",
      hint: "--success / --warning / --danger / --info",
      render: () => (
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <Chip tone="success">Passed</Chip>
          <Chip tone="warning">Backed off</Chip>
          <Chip tone="danger">Errored</Chip>
          <Chip tone="info">Noticed</Chip>
        </div>
      ),
    },
  ];

  return (
    <div className="lab-grid">
      {tiles.map((t) => (
        <article key={t.name} className="lab-tile" aria-labelledby={slug(t.name)}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-2)" }}>
            <h3 id={slug(t.name)} className="lab-tile__name">{t.name}</h3>
          </div>
          <span className="lab-tile__hint">{t.hint}</span>
          <div className="lab-tile__example">{t.render()}</div>
        </article>
      ))}
    </div>
  );
}

type Tone = "success" | "warning" | "danger" | "info";
function Chip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const style: CSSProperties = {
    padding: "var(--space-1) var(--space-2)",
    borderRadius: "var(--radius-pill)",
    fontSize: "var(--type-caption-size)",
    fontFamily: "var(--type-family-mono)",
    border: `1px solid var(--${tone}-7)`,
    background: `var(--${tone}-3)`,
    color: `var(--${tone}-12)`,
  };
  return <span style={style}>{children}</span>;
}

function slug(s: string) {
  return s.toLowerCase().replace(/\W+/g, "-");
}
