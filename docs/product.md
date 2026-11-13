# Product: what this is and how it differs

Status: draft from the owner's initial vision. Gaps marked **Open**.

## One line
A chat-first workspace for designers to explore and iterate with AI agents, where
the thing being designed (a canvas, an HTML file, a web page) is the main surface
and the chat is secondary.

## Who and what for
- Designers exploring and iterating with AI: fast back-and-forth, many variants.
- Not for shipping production code. It should be capable of it, but that is not
  the goal; engineers' tools (Conductor, IDEs) cover that.
- Current workflow being replaced: Claude Code in Conductor, designing in Paper.

## Keep from Conductor-style tools
- Parallel agents via git worktrees, listed in a left sidebar.
- Multiple sessions per worktree, as tabs.
- Different models and agents per session (Claude, Codex, ...).
- Chat-first: the user does not read code or files.
- Very clean UI: workspace and session navigation stay out of the way.
- Agents can spawn and message agents in other sessions.
- Review button: starts a new session with a chosen model and a configurable review prompt.
- Terminal available but not prominent.

## Where we differ (the point of this product)
1. **The preview is first class.** Canvas / HTML file / web page gets most of the width. Chat is secondary: under half the width, easily resizable. Panes are swappable and configurable, but simple (no layout-builder complexity).
2. **Comment in context.** Type or dictate comments directly on the preview, anchored to elements or regions, and send them to the agent as targeted feedback. Start with pinned comments (a few tools have "design mode"); go further over time.
3. **A tight review loop.** See it, interact with it, give feedback, get a new version, review again. Fast cycles are the product.
4. **Quote and reply in chat.** Select text in a response and quote it into the next message (as Claude desktop does).

## Implications for the plan
- Non-goals in `plan.md` change: worktrees, multi-session tabs, multi-agent messaging, and a review button are now in scope (phased). Still out: remote/mobile, accounts, checkpoints/forks (revisit later).
- Shell: embedding a live page and injecting a comment overlay is awkward in a plain browser tab (iframe framing limits, no injection into arbitrary origins). Likely needs either a proxy that serves the agent's local dev server with an injected script, or a desktop wrapper with a real webview. **Open.**
- Agent-to-agent messaging: since we spawn each agent session ourselves, we can expose a small local tool (MCP) to each session for `spawn_session` / `message_session`. Same shape for both Claude and Codex. Needs a design pass for loops and cost.
- Feedback payload: comments should reach the agent as structured context (element selector, rect, text, optional cropped screenshot) rendered into one normal user message, so chat stays pass-through.
- The M0 chat quality work (scroll, streaming, tool traces) still stands; chat is secondary in space, not in quality.

## Phasing principle: build the tool with the tool
Get to a usable core first, then add features incrementally using the tool itself.
Every phase ends usable and shippable to ourselves; no phase leaves visible stubs.
Real Claude comes before polish: a fake adapter is only a short-lived test aid, not a milestone.

## Milestone order (draft)
- **P0 Usable core (dogfood threshold).** Local server + web UI, started with one command, working out of the box. Pick a folder, chat with Claude Code through the Agent SDK on the user's subscription, streaming, tool traces, approvals, stop, resume after restart, sessions listed and persisted. Chat scroll/streaming must be solid from day one, since it is what you live in. Exit test: we can do real work on this repo with it. Until then we keep using Conductor to build.
- **P1 Workspaces.** Git worktrees in a left sidebar, multiple session tabs per worktree. Opened from the same server; no shell decision needed yet.
- **P2 Preview pane.** Resizable split with a live preview (local dev server or HTML file) beside the chat; swappable panes. Quote-and-reply in chat.
- **P3 Comment loop.** Pinned comments on the preview, sent to the agent as structured context in a normal message. This is the differentiator; iterate on it heavily.
- **P4 More agents and orchestration.** Codex adapter, per-session model choice, review button with configurable prompt, agent-to-agent tool.
- **P5 Harden and extend.** Variants/compare, dictation, terminal, Paper/Figma integration, desktop wrapper if wanted.

The server + web UI split keeps the shell decision (browser tab vs desktop wrapper) open; a wrapper can host the same UI later. P3 is where that decision actually bites.

## Open questions
- Desktop wrapper (Electron/Tauri) vs browser tab + proxy?
- What exactly is "canvas": the agent's HTML output only, or also Paper files / Figma via integration?
- Dictation: rely on OS dictation, or build in?
- Variants: side-by-side compare of multiple versions? (likely wanted; not yet specified)
- From the old app: nothing carried over by default. Revisit `docs/archive/` only for specific ideas.
