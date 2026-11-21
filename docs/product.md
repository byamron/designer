# Product: what this is and how it differs

Status: draft from the owner's initial vision. Gaps marked **Open**.
The long-term direction (feedback cycles, voice and critique modes) is in [vision.md](vision.md); this doc is the nearer-term shape.

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

## Decisions
- **Shell:** web first (local server + browser UI), desktop wrapper later. The wrapper is needed for commenting on arbitrary external pages (see below), not for localhost or HTML files.
- **Canvas:** one surface for web pages, HTML files, and localhost pages, seamlessly. We do not build or compete on a canvas;
  other canvases (Paper, Subframe, Twombly, Onlook, ...) are loaded as web pages and complemented by the feedback layer.
  Paper: v1 at most loads it as a web page in the window; a closer integration is later and not in v1. See [vision.md](vision.md).
- **Variants:** side-by-side exploration and comparison when there are design decisions to make. Goal, phased after the comment loop.
- **Dictation:** system dictation (the owner uses an app shortcut) for now. In-app capture becomes needed once voice
  must be timestamp-aligned with pointer position (voice comments, critique mode); see [vision.md](vision.md).
- **Auth:** no sign-in flow in the app. The local server launches the user's own logged-in Claude Code / Codex; the browser UI only talks to localhost.

## Browser limits that shape this
- Local HTML files and localhost dev servers: we can serve or proxy them and inject a comment overlay, so this works in a plain browser tab.
- External sites (including Paper on the web): most send headers that block embedding in an iframe, and we cannot inject scripts across origins. Showing and commenting on those needs a desktop webview.

## Open questions
- From the old app: nothing carried over by default. Revisit `docs/archive/` only for specific ideas.
