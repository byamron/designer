# Fresh start: lean local chat app (v0 plan)

Status: research done, nothing built. Ideas only from T3 Code (MIT), Paseo (Apache-2.0), Orca (MIT); no code copied, no fork.

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

## Open choices
1. Node vs Bun for the server.
2. React vs Preact.
3. New repo location/name; old Designer repo archived, not mined (except maybe `integration-notes.md` stream-json quirks and `critique.md`).
