# Phase 24 §11.0 P2 — SIGINT-on-piped-stdio verification

**Question.** Designer spawns `claude` with piped stdio, not a PTY
(`crates/designer-claude/src/claude_code.rs:250`). The terminal `claude`
binary's documented "press ESC to interrupt" path runs under the user's
shell PTY. Does POSIX SIGINT, sent via `kill(2)`, actually interrupt a
streaming turn cleanly under our piped-stdio spawn — or do we have to
fall back to in-band protocol or a kill-and-respawn?

**Answer.** Yes. SIGINT is the right mechanism for D7. It cleanly
interrupts a mid-turn stream, emits an interpretable transcript marker
and a final `result` envelope, then exits with code 0. No PTY required.

**Date.** 2026-05-04 — `claude` v2.1.126, on macOS, against the user's
local install.

## Method

Spike binary at `src/bin/sigint_spike.rs` (feature-gated to
`claude_live` so a workspace build never compiles it). It mirrors the
production spawn config exactly — `tokio::process::Command` with
`-p`, `--input-format stream-json`, `--output-format stream-json`,
`--permission-prompt-tool stdio`, piped stdin/stdout/stderr — sends a
prompt that reliably triggers a long streaming response (a 3000-word
essay on the printing press), waits ~10s for the assistant to start
streaming, then applies one of four interrupt mechanisms:

1. `sigint`  — `libc::kill(pid, SIGINT)`
2. `control` — `{"type":"control_request","subtype":"interrupt"}` over stdin
3. `sigterm` — `libc::kill(pid, SIGTERM)`
4. `eof`     — close stdin

For each, the spike reads stdout for another 8s, then waits up to 6s
for the child to exit. Two sample runs land at `/tmp/sigint-spike-run-1.log`
and `/tmp/sigint-spike-run-2.log`; the relevant findings are
reproduced below.

## Findings

### SIGINT — recommended ✓

```
[spike] sent signal 2 to pid 34737
[spike][post][0001] {"type":"assistant","message":{...
  "text":"# The Printing Press: A History from Gutenberg to the Digital Age\n\n## Intro…
[spike][post][0002] {"type":"user","message":{"role":"user","content":[
  {"type":"text","text":"[Request interrupted by user]"}]},...
[spike][post][0003] {"type":"result","subtype":"error_during_execution",
  "duration_ms":6778,"is_error":true,"num_turns":2,"stop_reason":null,
  "total_cost_usd":0,...
[spike][post] stdout EOF after 3 lines
[spike] subprocess exited: success=true code=Some(0) signal=None
```

- The partial `assistant` envelope that was in flight is flushed, so
  the user sees whatever text streamed up to the interrupt.
- A `user` envelope with `[Request interrupted by user]` lands as the
  next line — Designer can pattern-match this to render the spec's
  "Interrupted" inline marker (§5.4.2) without inventing a new event.
- A final `result` envelope with `subtype: "error_during_execution"`
  closes the turn. The `stop_reason` field on this envelope is
  `null`; the discriminator the implementer pattern-matches is
  `subtype`. (Note: today the translator's `translate_result` early-
  returns on any non-`success` subtype — see `stream.rs:416-425` —
  so this envelope is currently dropped on the floor. D7 will need
  to add the arm. See "Implementation sketch" below.)
- Exit code 0, no signal in `ExitStatus`. Cleanest possible exit.
- Total time from signal to exit: ~7s, dominated by API-side ack of
  the interrupt — not a stdio buffering problem.

### control_request interrupt — works, slightly worse exit semantics

```
[spike] sent control_request interrupt over stdin
[spike][post][0001] {"type":"control_response","response":{
  "subtype":"success","request_id":"d9190843-…"}}
[spike][post][0002] {"type":"assistant","message":{...partial essay...
[spike][post][0003] {"type":"user","message":{...
  "text":"[Request interrupted by user]"...
[spike][post][0004] {"type":"result","subtype":"error_during_execution",...
[spike] subprocess exited: success=false code=Some(1) signal=None
```

- Same transcript shape as SIGINT plus a `control_response` ack
  envelope.
- Exits with code 1, not 0 — Designer's reader-task already treats any
  exit (clean or not) as session end, so this isn't a blocker, but it
  does mean a non-zero status will appear in logs every interrupt.
- One real downside: requires `stdin` to be writable. If the writer
  task has already died (the chat-hang scenario in
  `claude_code.rs:334` warning), in-band interrupt is unreachable.
  SIGINT works regardless.

### SIGTERM — destructive, do not use

```
[spike] sent signal 15 to pid 35817
[spike][post] stdout EOF after 0 lines
[spike] subprocess exited: success=false code=Some(143) signal=None
```

- Hard-kills before claude has a chance to drain anything.
- No partial assistant envelope, no `[Request interrupted by user]`
  marker, no `result` envelope. The transcript just stops.
- Exit code 143 = 128 + SIGTERM. From Designer's perspective this is
  indistinguishable from a crash and would surface as a chat-hang.

### Close stdin (EOF) — does not interrupt

```
[spike] closed stdin (EOF)
[spike] phase 3 (post-interrupt): 0 lines, 0 message envelopes,
  last=None, saw_result=false, result_stop_reason=None
[spike] subprocess STILL ALIVE after 6s — force-killing
```

- Confirmed: in `--print --input-format stream-json`, claude does not
  treat stdin EOF as a turn-cancellation signal. The active API
  request keeps streaming on the server side; the subprocess survives
  EOF for at least 14 seconds (8s post-window + 6s exit-wait) before
  the spike force-kills it.
- Useful negative result: `kill_on_drop(true)` in
  `claude_code.rs:253` is what saves us from zombie subprocesses
  during workspace teardown. Closing stdin is not a substitute.

## Recommendation for D7

Use **SIGINT via `libc::kill(child_pid, SIGINT)`** for §5.4.2's
"ESC interrupts mid-turn" path. Implementation sketch in
`crates/designer-claude/src/claude_code.rs`:

1. Stash `child.id()` alongside the existing writer/reader task
   handles in the per-tab subprocess record (the orchestrator already
   tracks workspace-scoped state for `interrupt`).
2. Replace the `interrupt` impl that currently writes
   `interrupt_request_line()` over stdin with a `libc::kill(pid,
   SIGINT)` call. Keep the in-band path as a fallback in case the
   writer task is alive but the OS denies the signal (extremely rare).
3. Translator work is required — *not* free. Two gaps:
   - `translate_result` at `crates/designer-claude/src/stream.rs:416-425`
     currently early-returns on any non-`success` subtype. The
     `error_during_execution` envelope the spike captured is silently
     dropped today. Add an arm that emits the Phase 24
     `AgentTurnEnded { stop_reason: Interrupted }` event for that
     subtype.
   - `AgentTurnEnded` and `stop_reason: Interrupted` themselves are
     part of the Phase 24 event vocabulary (`core-docs/adr/0008-phase-24-event-vocabulary.md`)
     and do not exist in `designer-core/src/event.rs` yet. They land
     when the Phase 24 implementation track does, so D7 either
     follows that track or co-introduces the variants.
4. Designer's per-spawn random session id (Cut 1, 2026-05-03) means
   the next user message after an interrupt naturally respawns. No
   `--resume` plumbing needed; spec D7 doesn't require session
   continuity across the interrupt.

The spec's D7 mechanism description ("send SIGINT to the subprocess")
is correct as-written. No spec revision needed.

## Unexpected behavior worth flagging

- **EOF doesn't shut claude down.** Future cleanup paths that assumed
  "drop stdin → child exits" will leak subprocesses. Designer relies
  on `kill_on_drop(true)`; anything that takes ownership of the child
  outside the orchestrator must keep that invariant.
- **`result.stop_reason` is null on interrupt.** The discriminator is
  `subtype: "error_during_execution"`, not `stop_reason`. Anyone
  pattern-matching on `stop_reason` for the interrupt path will miss
  it.
- **`total_cost_usd: 0` on the interrupt result envelope.** Cost-chip
  accounting (Decision 34 telemetry) won't bill the interrupted turn,
  even though there was real API spend up to the cancellation point.
  Probably fine — interrupted turns shouldn't pad the chip — but
  flagging in case the chip should reflect partial cost.
- **No zombies observed across all four mechanisms.** `kill_on_drop`
  + tokio's reaping behavior is doing its job; even the EOF case
  cleaned up after force-kill.

## Reproducing

```sh
cargo run -p designer-claude --features claude_live \
  --bin sigint_spike -- all
```

Or one mechanism at a time: `sigint`, `control`, `sigterm`, `eof`.
Each run spends a few cents in API tokens.
