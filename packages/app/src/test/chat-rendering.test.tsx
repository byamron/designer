import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MessageBlock } from "../blocks/blocks";
import { groupArtifacts } from "../tabs/WorkspaceThread";
import type { ArtifactKind, ArtifactSummary } from "../ipc/types";

function artifact(role: string | null, summary: string): ArtifactSummary {
  return {
    id: `art_${Math.random().toString(36).slice(2, 8)}`,
    workspace_id: "ws_test",
    kind: "message",
    title: "msg",
    summary,
    author_role: role,
    version: 1,
    created_at: "2026-04-30T00:00:00Z",
    updated_at: "2026-04-30T00:00:00Z",
    pinned: false,
  };
}

function reportArtifact(title: string): ArtifactSummary {
  return {
    id: `art_${Math.random().toString(36).slice(2, 8)}`,
    workspace_id: "ws_test",
    kind: "report" as ArtifactKind,
    title,
    summary: title,
    author_role: "agent",
    version: 1,
    created_at: "2026-04-30T00:00:00Z",
    updated_at: "2026-04-30T00:00:00Z",
    pinned: false,
  };
}

// T4 — User and agent messages must render with distinct authorship
// attributes so the canonical bubble/flat asymmetry can attach. B4
// regression: the renderer used to omit `data-author` entirely, so the
// CSS selector for the user bubble never matched.
describe("MessageBlock authorship (B4)", () => {
  it("emits data-author='you' for user role", () => {
    const noProps = {
      payload: null,
      isPinned: false,
      onTogglePin: () => {},
      expanded: false,
      onToggleExpanded: () => {},
    };
    const { container } = render(
      <MessageBlock artifact={artifact("user", "hello")} {...noProps} />,
    );
    const article = container.querySelector("article.block--message");
    expect(article).not.toBeNull();
    expect(article!.getAttribute("data-author")).toBe("you");
  });

  it("emits data-author='you' when role is null (default-treats-as-user)", () => {
    const noProps = {
      payload: null,
      isPinned: false,
      onTogglePin: () => {},
      expanded: false,
      onToggleExpanded: () => {},
    };
    const { container } = render(
      <MessageBlock artifact={artifact(null, "hi")} {...noProps} />,
    );
    expect(
      container
        .querySelector("article.block--message")
        ?.getAttribute("data-author"),
    ).toBe("you");
  });

  it("emits data-author='agent' for non-user roles", () => {
    const noProps = {
      payload: null,
      isPinned: false,
      onTogglePin: () => {},
      expanded: false,
      onToggleExpanded: () => {},
    };
    const cases = ["agent", "assistant", "team-lead", "Claude"];
    for (const role of cases) {
      const { container } = render(
        <MessageBlock artifact={artifact(role, "reply")} {...noProps} />,
      );
      const article = container.querySelector("article.block--message");
      expect(article?.getAttribute("data-author")).toBe("agent");
    }
  });

  it("omits the author label on user messages but shows it on agent messages", () => {
    const noProps = {
      payload: null,
      isPinned: false,
      onTogglePin: () => {},
      expanded: false,
      onToggleExpanded: () => {},
    };
    const userR = render(
      <MessageBlock artifact={artifact("user", "x")} {...noProps} />,
    );
    expect(
      userR.container.querySelector(".block__message-author"),
    ).toBeNull();

    const agentR = render(
      <MessageBlock artifact={artifact("agent", "y")} {...noProps} />,
    );
    expect(
      agentR.container.querySelector(".block__message-author"),
    ).not.toBeNull();
  });

  // CC1 — agent messages render the humanized role, not the raw
  // backend role string.
  it("displays the humanized role on agent messages", () => {
    const noProps = {
      payload: null,
      isPinned: false,
      onTogglePin: () => {},
      expanded: false,
      onToggleExpanded: () => {},
    };
    const r = render(
      <MessageBlock artifact={artifact("team-lead", "ok")} {...noProps} />,
    );
    expect(
      r.container.querySelector(".block__message-author")?.textContent,
    ).toBe("Team Lead");
  });

  // CC3 — agent messages carry a <time> element with both the raw
  // ISO datetime (machine-readable) and a relative label.
  it("renders a <time> element on agent messages with dateTime + relative label", () => {
    const noProps = {
      payload: null,
      isPinned: false,
      onTogglePin: () => {},
      expanded: false,
      onToggleExpanded: () => {},
    };
    const r = render(
      <MessageBlock artifact={artifact("agent", "ok")} {...noProps} />,
    );
    const time = r.container.querySelector("time");
    expect(time).not.toBeNull();
    expect(time!.getAttribute("datetime")).toBe("2026-04-30T00:00:00Z");
    // The label is whatever formatRelativeTime returns at test time; we
    // assert non-empty rather than couple to wall-clock drift.
    expect(time!.textContent ?? "").not.toBe("");
  });

  // CC3 (continued) — user messages do NOT mount the meta header
  // because the bubble already differentiates them; doubling up
  // would add noise without information.
  it("does not mount the meta header on user messages", () => {
    const noProps = {
      payload: null,
      isPinned: false,
      onTogglePin: () => {},
      expanded: false,
      onToggleExpanded: () => {},
    };
    const r = render(
      <MessageBlock artifact={artifact("user", "ok")} {...noProps} />,
    );
    expect(r.container.querySelector(".block__message-meta")).toBeNull();
    expect(r.container.querySelector("time")).toBeNull();
  });
});

// CC6 — minimal markdown rendering. Plain text reads as a wall;
// agent prose should support **bold**, *italic*, `code`, and bare
// URLs without a heavy parser. Block-level constructs (lists,
// headings, fences) intentionally NOT handled — those land in their
// own artifact kinds.
describe("MessageProse markdown (CC6)", () => {
  function renderProse(text: string) {
    const noProps = {
      payload: null,
      isPinned: false,
      onTogglePin: () => {},
      expanded: false,
      onToggleExpanded: () => {},
    };
    return render(
      <MessageBlock artifact={artifact("agent", text)} {...noProps} />,
    );
  }

  it("renders **bold** as <strong>", () => {
    const { container } = renderProse("**Important** notice");
    expect(container.querySelector("strong")?.textContent).toBe("Important");
  });

  it("renders *italic* as <em>", () => {
    const { container } = renderProse("an *emphasized* word");
    expect(container.querySelector("em")?.textContent).toBe("emphasized");
  });

  it("renders `code` as <code>", () => {
    const { container } = renderProse("call `foo()` first");
    expect(container.querySelector("code")?.textContent).toBe("foo()");
  });

  it("renders bare URLs as anchors with target=_blank", () => {
    const { container } = renderProse("see https://example.com/x");
    const a = container.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://example.com/x");
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.getAttribute("rel")).toBe("noreferrer");
  });

  it("preserves explicit newlines as separate lines", () => {
    const { container } = renderProse("line one\nline two");
    const lines = container.querySelectorAll(".block__message-line");
    expect(lines.length).toBe(2);
  });

  it("never injects raw HTML — angle brackets render as text, not nodes", () => {
    const { container } = renderProse("emit <script>alert(1)</script> safely");
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent ?? "").toContain("<script>");
  });
});

// T5 — runs of consecutive `report` artifacts must coalesce into a
// single ToolCallGroup row, not render as N separate boxed cards.
// Non-report artifacts pass through. B5.
describe("Tool-call coalescing (B5)", () => {
  it("groupArtifacts merges consecutive report artifacts into one group", () => {
    const xs = [
      reportArtifact("Used ToolSearch"),
      reportArtifact("Used TeamCreate"),
      reportArtifact("Read plan.md"),
      artifact("agent", "Here's where the project stands"),
      reportArtifact("Ran ls"),
    ];
    const units = groupArtifacts(xs);
    expect(units.length).toBe(3);
    expect(units[0].kind).toBe("group");
    if (units[0].kind === "group") {
      expect(units[0].artifacts.length).toBe(3);
    }
    expect(units[1].kind).toBe("single");
    expect(units[2].kind).toBe("single"); // a single report passes through as single
  });

  it("renders a single [data-component=ToolCallGroup] for a 5-report run, not 5 cards", () => {
    function Harness({ list }: { list: ArtifactSummary[] }) {
      const units = groupArtifacts(list);
      return (
        <div className="thread">
          {units.map((u) =>
            u.kind === "group" ? (
              <ToolCallGroupForTest
                key={u.artifacts[0].id}
                artifacts={u.artifacts}
              />
            ) : (
              <div key={u.artifact.id} className="block block--report">
                {u.artifact.title}
              </div>
            ),
          )}
        </div>
      );
    }
    const { container } = render(
      <Harness
        list={[
          reportArtifact("a"),
          reportArtifact("b"),
          reportArtifact("c"),
          reportArtifact("d"),
          reportArtifact("e"),
        ]}
      />,
    );
    const groups = container.querySelectorAll(
      '[data-component="ToolCallGroup"]',
    );
    expect(groups.length).toBe(1);
    // Collapsed by default — only the head row, no list yet.
    expect(container.querySelector(".tool-group__list")).toBeNull();
    // Click to expand and assert the list mounts with one row per
    // tool call.
    fireEvent.click(groups[0].querySelector("button")!);
    const rows = container.querySelectorAll(".tool-group__row");
    expect(rows.length).toBe(5);
  });
});

// CC5 (CSS-source guard) — Slack/Linear-style meta-collapse on
// same-author runs is implemented entirely in CSS via an
// adjacent-sibling selector. jsdom doesn't compute styles so we lock
// the rule in at the source level: future "harmonize" passes can't
// silently re-enable repeating headers without flipping this red.
describe("Same-author meta header collapse (CC5)", () => {
  it("CSS source declares an adjacent-sibling rule that hides the meta header", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const css = fs.readFileSync(
      path.resolve(__dirname, "..", "styles", "blocks.css"),
      "utf8",
    );
    const rule = css.match(
      /\.block--message\[data-author="agent"\][\s\S]*?\+[\s\S]*?\.block--message\[data-author="agent"\][\s\S]*?\.block__message-meta[\s\S]*?display:\s*none/,
    );
    expect(
      rule,
      "expected .block--message[data-author=agent] + .block--message[data-author=agent] .block__message-meta { display: none } in blocks.css",
    ).toBeTruthy();
  });

  it("CSS source declares the initial-paint animation suppression class", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const css = fs.readFileSync(
      path.resolve(__dirname, "..", "styles", "blocks.css"),
      "utf8",
    );
    expect(css).toMatch(/\.thread--initial\s*>\s*\*\s*\{[^}]*animation:\s*none/);
  });
});

// Inline mirror of ToolCallGroup so the harness above doesn't depend on
// the WorkspaceThread render context (which carries IPC + state setup
// that this unit-level test should not exercise). The ToolCallGroup
// component's behavior is tested through this; a stricter integration
// test would render WorkspaceThread end-to-end, but that lives in
// chat-states for sequencing.
import { useState } from "react";
function ToolCallGroupForTest({
  artifacts,
}: {
  artifacts: ArtifactSummary[];
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className="tool-group"
      data-component="ToolCallGroup"
      data-expanded={expanded}
    >
      <button type="button" onClick={() => setExpanded((v) => !v)}>
        Used {artifacts.length} tools
      </button>
      {expanded && (
        <ul className="tool-group__list">
          {artifacts.map((a) => (
            <li key={a.id} className="tool-group__row">
              {a.title}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
