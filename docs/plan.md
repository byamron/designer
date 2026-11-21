# Fresh start: lean local chat app (v0 plan)

Status: research done, nothing built. Ideas only from T3 Code, Paseo, Orca; no code copied, no fork. Rules and trace ledger: [inspirations.md](inspirations.md).

## Landed 2026-11-19 (PRs #151, #153-#158)
CI on GitHub Actions (typecheck, unit, build, browser suites, audit; `.github/workflows/ci.yml`); one-click previews (local links,
chips, "Ask Claude to start it"); question cards for `AskUserQuestion`; images in chat; the inspector (Inspect toggle, properties
panel, Copy changes); a fix for a scroll follow/detach race that made the motion suite flaky; the PR protocol now covers stacked
PRs and a Safety section. Mac-only checks from these are listed in [needs-local-testing.md](needs-local-testing.md). Known open:
the `ui` browser suite occasionally fails "pinned to bottom while streaming" (a scroll-follow timing flake; rerun clears it).

## P0 status (built)
Server (Node 22, `ws`, JSONL store), Claude Agent SDK adapter, React UI. Verified against real Claude:
multi-turn streaming, tool calls, approvals (deny blocks the write), interrupt, resume after server restart.
Browser tests (fake provider) cover follow/detach scroll, jump-to-latest, tool groups, approvals, Esc, replay.

P1 (built): workspaces and session tabs. A workspace is a folder or a git worktree the app creates
(`<data>/worktrees/<repo>/<name>`, branch `designer/<name>`); each workspace has several session tabs.
Worktrees with uncommitted changes are never removed. Checklist of what still needs the owner's Mac:
[needs-local-testing.md](needs-local-testing.md).

P2 (built): preview pane. Resizable split (chat capped at half the width, drag or arrow keys, swap sides,
persisted), showing an HTML file from the workspace or any http(s)/localhost URL. Files are served from a
second port (default app port + 1) so previewed code is on another origin and cannot open the app's
WebSocket (tested). Pages that forbid framing, or are unreachable, show a message instead of a blank pane.
The preview refreshes when the agent finishes a turn. Selecting text in a reply offers "Quote", which puts it
in the composer as a blockquote.

Polish pass 1 (after owner testing of P0-P2, everything worked; feedback: clunky, streaming slow, focus rings
cut off, no motion): measured with real Claude first. Our pipeline adds ~50-70 ms between updates (raw SDK
deltas arrive every ~33 ms, we coalesce to ~33-67 ms); time to first text was ~1.9 s on a first turn and
~0.8 s after (that is Claude Code itself), so "slow" is mostly latency we cannot remove, plus lumpy arrival we can smooth.
Done: working indicator with phase label (Thinking / Running X / Writing / Waiting for approval), animated dots
and a running timer, "Worked for Ns" after each turn; animated Jump to latest (re-reads the bottom each frame,
cancelled by scrolling up, instant under reduced motion); sending returns you to the bottom; streamed text is
eased in per frame instead of arriving in lumps, with a caret; entrance, expand and hover transitions; preview
loading bar; focus rings are inset so scrolling containers cannot clip them (automated check tabs through every
control). Bug found and fixed along the way: `content-visibility: auto` on finished replies made the view jump
to the top when a long reply you had scrolled up in finished streaming; removed (re-add only with a measured need).
Browser suites: `e2e/run.sh` (ui, focus, motion), each on a fresh server.

Permissions: modes are Ask / Auto / Auto-accept edits / Full access. Auto uses Claude Code's own classifier
(`permissionMode: 'auto'`); calls it cannot decide still reach our Allow/Deny cards. Verified in the cloud container
(bash and a file write ran with no prompts; the SDK lists which models support it). The app shows a notice if the SDK
runs in a different mode than requested. Not yet verified on the owner's account/plan; default stays "Ask".
Chat logs are written owner-only (0700 dirs, 0600 files).

Security gaps we know about (not yet done): the local server has no per-launch token, so another local process or
user on the same machine can talk to 127.0.0.1:4317 (Host/Origin checks only stop web pages); agents are not
sandboxed beyond Claude Code's own permissions; inspector reports can carry text from untrusted pages into a message.

Vision (owner, 2026-11-18): the product is the feedback loop between a designer and the model; see [vision.md](vision.md)
(pinned comments, then voice, then live critique mode and meeting mode).

Roadmap additions (owner, 2026-11):
- Inspector / visual properties panel (built, Mac check pending): select elements the same way comments will, edit visually,
  Copy changes -> paste to the agent. Page agent injected into served HTML; opt-in proxy for localhost and website URLs.
- Paste/attach images in chat (built, Mac check pending).
- Handoff to Devin: build interactively with Claude, then hand the work to Devin to build on its own. Shape:
  a "Hand off" action runs a handoff-brief turn in the session (spec, decisions, acceptance criteria, files,
  inspector edits), pushes the worktree branch, creates a Devin session via Devin's API with that brief and the
  repo/branch, then shows its status and PR link in the workspace. Auth: Devin service-user API key supplied through an
  environment variable (the app never stores credentials). Unverified until built: request schema of the current API
  version, plan/API access, whether Devin's GitHub integration can see the pushed branch. Cannot be tested here
  without a Devin account; build against a fake server, verify live on the owner's machine.
- Later: Codex via ChatGPT login (same adapter interface); agent-to-agent messaging; review button.

Known gaps / next:
- Not yet verified on a real subscription login: this cloud container authenticates differently, so
  `apiKeySource` showed `none` here. The adapter strips `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` and warns
  if the SDK reports a key source other than a login. Confirm on the owner's Mac.
- After Stop, Claude can still emit one short reply before the turn ends (SDK behavior); review.
- Code blocks are plain `<pre>` (no syntax highlighting yet). `AskUserQuestion` is declined with a
  message asking the model to ask in plain text. No attachments, no multi-provider yet.
- Auth to the local server is Host/Origin checking on a localhost-only bind.

## Decisions so far
- Built in this repo. **Since 2026-11-18 `main` is the new app** (fast-forwarded from the old Tauri app's last commit; nothing rewritten).
  The old Tauri app is preserved at branch `archive/tauri-designer` and tag `tauri-final` (both `2195a3d`); the owner's old local `main`
  work is on a local backup branch and bundle on their Mac. Old release tags `v0.1.1`-`v0.1.3` belong to the Tauri app; new releases
  must not reuse them.
- Server: Node 22 (T3 Code and Paseo both run on Node; per web summaries, not yet verified in source).
- UI: React + TypeScript.
- Shell: decide Tauri vs Electron with a spike at the start of P2; server and UI stay separate until then.
- No code or files from T3 Code, Paseo or Orca were read for P0; nothing to log in the ledger yet.

## Goal
A local, single-user chat app that drives the user's own **Claude Code (Agent SDK)** and **Codex (`codex app-server`)** using their existing subscription logins. No API keys. Small, fast, boring. The coding harness is built on top later.

## Non-goals (v0)
Worktrees, git/PR features, subagent UIs, MCP UIs, checkpoints/rollback/fork, provider switching mid-thread, remote/mobile, multi-user, accounts, a native shell, virtualization, event-sourced projections.

## Shape
One Node (or Bun) process: HTTP + one WebSocket. Static web UI (React or Preact + TS). Open in a browser; wrap natively later if wanted.

```
browser UI  <--ws-->  server  --->  ProviderAdapter (claude | codex)
                         |
                   JSONL log per thread
```

## Adapter interface (the only real abstraction)
```ts
interface ProviderAdapter {
  start(opts: {threadId; cwd; resumeId?; model?; permission}): Promise<Session>
}
interface Session {
  events: AsyncIterable<Event>          // single outbound stream
  send(text: string, attachments?): Promise<void>   // start a turn
  steer?(text: string): Promise<void>   // inject into running turn (optional)
  interrupt(): Promise<void>
  respond(requestId: string, answer: Decision | Answers): void  // approvals / questions
  nativeId(): string | undefined        // for resume
  close(): void
}
```

## Normalized events (about 8)
`user_message`, `assistant_delta` / `assistant_message`, `reasoning`, `tool_call` (id, kind: command|file_change|other, label, status, partial output), `approval_request`, `user_input_request`, `error`, `turn_done`. Every event carries `threadId` and a server-assigned `seq`.

## Claude adapter (Agent SDK, TS)
- `query()` in streaming-input mode: a queue exposed as an async iterable `prompt`; `includePartialMessages: true`.
- Text: `stream_event` -> `content_block_delta` -> `text_delta`. Tool input: `input_json_delta`.
- Approvals: `canUseTool` returns a promise parked in a `requestId -> resolver` map; `respond()` resolves it. `AskUserQuestion` also arrives here.
- Sessions: first turn passes `sessionId`, later turns/restarts pass `resume`. Capture id from `system/init`. Transcripts live in `~/.claude/projects/...`.
- Interrupt: `query.interrupt()` (streaming mode only).
- **Auth gotcha:** `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` outrank the subscription login. Build the `env` option from `process.env` with those removed; check `init.apiKeySource` shows subscription.
- Verify early: that the bundled binary uses the stored `/login` credential with no env vars (docs imply it; not stated outright).

## Codex adapter (`codex app-server`)
- Spawn `codex app-server` (stdio, newline-delimited JSON-RPC, `jsonrpc` field omitted). `initialize` then `initialized`.
- Methods: `thread/start|resume`, `turn/start`, `turn/interrupt`, `turn/steer`.
- Notifications -> events: `item/started|completed`, `item/agentMessage/delta`, command output deltas, `turn/completed`.
- Approvals arrive as server->client requests (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, user-input); reply with the decision; same parked-promise map.
- Auth: `account/read` for status; if signed out, show "run `codex login`". Never read `auth.json` ourselves.
- Types: run `codex app-server generate-ts` against the installed binary and pin the version, or hand-type ~15 messages. Unverified: exact `item/agentMessage/delta` payload and approval response envelope; read the generated schema.

## Persistence
Append-only JSONL per thread (`seq` cursor) + small `meta.json` (`provider`, `nativeSessionId`, `cwd`, title). No DB in v0. Rely on each vendor's own session store for model-side history; our log is for UI replay.

## Transport
One WebSocket. On connect/reconnect the client sends `lastSeq`; server replays from the log, then streams live. Server coalesces deltas (~50-60 ms).

## UI (where the previous attempt failed; spend the effort here)
- **State:** normalized `id -> item` + ordered id list; a delta touches one item; finished rows are `memo`'d, keyed by stable id. Buffer deltas, flush once per animation frame.
- **Scroll:** follow/detach state machine driven by *user input* (upward wheel, touch drag, scrollbar press, nav keys), not scroll position. Re-attach within a few px when moving toward the end. Follow growth via ResizeObserver on the content wrapper and pin before paint. `overflow-anchor: none`. "Jump to latest" pill only when detached. `use-stick-to-bottom` is the fallback to ~100 lines of our own. Nested scrollers get `overscroll-behavior: contain`; expanding a tool row at the bottom must not lose position.
- **Markdown:** split at blank lines (not inside fences/lists); memoize finished blocks, re-parse only the tail. Plain `<pre>` while a fence is open, Shiki (lazy, fine-grained) after it closes. Optional paced text reveal (~150 ms) to smooth lumpy deltas.
- **Tool traces:** one line per call (verb, target, status); group consecutive calls into a run with a summary ("Read 3 files, ran 2 commands"); collapsed once done, open while live; partial output only in the expanded body, fixed max-height.
- **Long threads:** `content-visibility: auto` + `contain-intrinsic-size` on finished rows; no virtualization until proven needed.
- **Stop button, message queue, Esc to interrupt** are v0 table stakes.
- **Dependencies:** React/Preact, one tiny store, `marked` (lexer), a markdown renderer, `shiki`. Nothing else.

## Milestones
- **M0 UI + fake adapter.** Scripted event stream (long markdown, code, tool runs, approvals, interrupts, bursty deltas). Get scroll, streaming and traces smooth *before* real providers exist. Browser tests for: growth while scrolled up, expanding a tool row, selection during streaming, resize, hidden tab.
- **M1 Claude adapter** end to end: send, stream, tools, approvals, interrupt, resume after restart.
- **M2 Codex adapter** behind the same interface; proves the abstraction.
- **M3 harden:** reconnect/replay, error states, auth-status screens, perf pass (idle memory, per-token cost).

## Policy notes (re-check before sharing the tool)
- Claude: Anthropic says third-party products may not offer claude.ai login or route requests through subscription credentials; it also says it doesn't prevent an end user signing in to the unmodified Claude Code with their own subscription. Local, single-user, never touching tokens fits the permitted pattern (our reading, not official text). The June 2026 SDK credit change was paused per Anthropic's help article.
- Codex: no official sentence found permitting or forbidding third-party clients using the app-server with a ChatGPT login; treat as unverified.
- Never collect, store, or proxy credentials. Status check + "run login in your terminal" only.

## Still open
1. Package layout: single package vs `server/` + `web/` workspaces (lean default: two folders, one npm workspace).
2. App name (keeping "Designer" for now).
