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

## Proposed milestone order (draft)
- M0 chat UI + fake adapter (unchanged).
- M1 Claude adapter.
- M2 shell: workspaces (worktrees), session tabs, resizable chat/preview split.
- M3 preview + pinned comments + send-to-agent loop (the differentiator; consider pulling earlier).
- M4 Codex adapter; review button; agent-to-agent tool.
- M5 harden.

## Open questions
- Desktop wrapper (Electron/Tauri) vs browser tab + proxy?
- What exactly is "canvas": the agent's HTML output only, or also Paper files / Figma via integration?
- Dictation: rely on OS dictation, or build in?
- Variants: side-by-side compare of multiple versions? (likely wanted; not yet specified)
- From the old app: nothing carried over by default. Revisit `docs/archive/` only for specific ideas.
