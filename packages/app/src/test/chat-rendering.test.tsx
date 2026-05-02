import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ArtifactReferenceBlock,
  MessageBlock,
  ReportBlock,
  ToolUseLine,
} from "../blocks/blocks";
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

function reportArtifact(
  title: string,
  opts: { author_role?: string; summary?: string } = {},
): ArtifactSummary {
  return {
    id: `art_${Math.random().toString(36).slice(2, 8)}`,
    workspace_id: "ws_test",
    kind: "report" as ArtifactKind,
    title,
    summary: opts.summary ?? title,
    author_role: opts.author_role ?? "agent",
    version: 1,
    created_at: "2026-04-30T00:00:00Z",
    updated_at: "2026-04-30T00:00:00Z",
    pinned: false,
  };
}

function richArtifact(
  kind: ArtifactKind,
  title: string,
  summary = title,
): ArtifactSummary {
  return {
    id: `art_${Math.random().toString(36).slice(2, 8)}`,
    workspace_id: "ws_test",
    kind,
    title,
    summary,
    author_role: "agent",
    version: 1,
    created_at: "2026-04-30T00:00:00Z",
    updated_at: "2026-04-30T00:00:00Z",
    pinned: false,
  };
}

const noProps = {
  payload: null,
  isPinned: false,
  onTogglePin: () => {},
  expanded: false,
  onToggleExpanded: () => {},
};

// T4 — User and agent messages must render with distinct authorship
// attributes so the canonical bubble/flat asymmetry can attach. B4
// regression: the renderer used to omit `data-author` entirely, so the
// CSS selector for the user bubble never matched.
describe("MessageBlock authorship (B4)", () => {
  it("emits data-author='you' for user role", () => {
    const { container } = render(
      <MessageBlock artifact={artifact("user", "hello")} {...noProps} />,
    );
    const article = container.querySelector("article.block--message");
    expect(article).not.toBeNull();
    expect(article!.getAttribute("data-author")).toBe("you");
  });

  it("emits data-author='you' when role is null (default-treats-as-user)", () => {
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
    const r = render(
      <MessageBlock artifact={artifact("agent", "ok")} {...noProps} />,
    );
    const time = r.container.querySelector("time");
    expect(time).not.toBeNull();
    expect(time!.getAttribute("datetime")).toBe("2026-04-30T00:00:00Z");
    expect(time!.textContent ?? "").not.toBe("");
  });

  it("does not mount the meta header on user messages", () => {
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

// DP-B — tool-use reports render as one terse line each (· Read foo.rs),
// not as N coalesced cards. The prior B5 coalescing pass-through was
// removed in service of "pass-through Claude Code by default".
describe("Tool-use line rendering (DP-B)", () => {
  it("renders one ToolUseLine per tool-use report — no coalescing", () => {
    const reports = [
      reportArtifact("Read plan.md"),
      reportArtifact("Edited blocks.tsx"),
      reportArtifact("Used Bash", { summary: "cargo test" }),
    ];
    const { container } = render(
      <div>
        {reports.map((a) => (
          <ToolUseLine key={a.id} artifact={a} {...noProps} />
        ))}
      </div>,
    );
    const lines = container.querySelectorAll(
      '[data-component="ToolUseLine"]',
    );
    expect(lines.length).toBe(3);
    // No coalesced wrapper
    expect(container.querySelector('[data-component="ToolCallGroup"]')).toBeNull();
  });

  it("expands to show the detail line on click when summary differs from title", () => {
    const a = reportArtifact("Used Bash", { summary: "cargo test --workspace" });
    const { container } = render(<ToolUseLine artifact={a} {...noProps} />);
    const line = container.querySelector('[data-component="ToolUseLine"]')!;
    expect(line.getAttribute("data-expanded")).toBe("false");
    fireEvent.click(line.querySelector("button")!);
    expect(line.getAttribute("data-expanded")).toBe("true");
    expect(container.querySelector(".tool-line__detail--expanded")).not.toBeNull();
  });

  it("hides the head-button click target when summary matches title (no detail)", () => {
    const a = reportArtifact("Used Read", { summary: "Used Read" });
    const { container } = render(<ToolUseLine artifact={a} {...noProps} />);
    const button = container.querySelector(".tool-line__head") as HTMLButtonElement;
    // No aria-expanded means no expander is wired
    expect(button.getAttribute("aria-expanded")).toBeNull();
  });
});

// DP-B — ReportBlock dispatches: tool-use reports → ToolUseLine,
// recap/auditor/freeform reports → ArtifactReferenceBlock.
describe("ReportBlock dispatcher (DP-B)", () => {
  it("renders tool-use reports (Used/Read/Wrote/...) as ToolUseLine", () => {
    const a = reportArtifact("Read plan.md");
    const { container } = render(<ReportBlock artifact={a} {...noProps} />);
    expect(container.querySelector('[data-component="ToolUseLine"]')).not.toBeNull();
    expect(
      container.querySelector('[data-component="ArtifactReferenceBlock"]'),
    ).toBeNull();
  });

  it("renders recap reports as ArtifactReferenceBlock", () => {
    const a = reportArtifact("Wednesday recap", { author_role: "recap" });
    const { container } = render(<ReportBlock artifact={a} {...noProps} />);
    expect(
      container.querySelector('[data-component="ArtifactReferenceBlock"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-component="ToolUseLine"]')).toBeNull();
  });

  it("renders auditor comments via the recap path (sidebar reference)", () => {
    const a = reportArtifact("Audit: race risk", { author_role: "auditor" });
    const { container } = render(<ReportBlock artifact={a} {...noProps} />);
    expect(
      container.querySelector('[data-component="ArtifactReferenceBlock"]'),
    ).not.toBeNull();
  });
});

// DP-B — ArtifactReferenceBlock dispatches a focus-artifact event so
// the ActivitySpine can scroll the matching row into view + flash it.
describe("ArtifactReferenceBlock focus dispatch (DP-B)", () => {
  it("dispatches designer:focus-artifact on click with the artifact id", () => {
    const a = richArtifact("spec", "auth-rewrite.md");
    const onFocus = vi.fn();
    window.addEventListener("designer:focus-artifact", onFocus);
    try {
      const { container } = render(
        <ArtifactReferenceBlock artifact={a} {...noProps} />,
      );
      fireEvent.click(container.querySelector("button")!);
      expect(onFocus).toHaveBeenCalledTimes(1);
      const ev = onFocus.mock.calls[0][0] as CustomEvent<{ id: string }>;
      expect(ev.detail.id).toBe(a.id);
    } finally {
      window.removeEventListener("designer:focus-artifact", onFocus);
    }
  });

  it("renders the humanized kind label and the title", () => {
    const a = richArtifact("spec", "auth-rewrite.md");
    const { container } = render(
      <ArtifactReferenceBlock artifact={a} {...noProps} />,
    );
    // humanizeKind has no canonical label for `spec`, so it falls
    // through to the title-case helper which capitalizes the first
    // letter and leaves the rest. The interesting assertion is that
    // both the kind chip and the title render.
    const kindLabel = container.querySelector(".artifact-ref__kind");
    const titleLabel = container.querySelector(".artifact-ref__title");
    expect(kindLabel?.textContent ?? "").toMatch(/spec/i);
    expect(titleLabel?.textContent).toBe("auth-rewrite.md");
  });
});

// CC5 (CSS-source guard) — Slack/Linear-style meta-collapse on
// same-author runs is implemented entirely in CSS via an
// adjacent-sibling selector. jsdom doesn't compute styles so we lock
// the rule in at the source level.
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
