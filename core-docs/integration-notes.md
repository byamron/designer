# Integration notes

Observed behavior of external systems Designer integrates with. Updated whenever a Phase-12 track validates a real integration and finds surprises. This is the counterpart to `spec.md`'s intended behavior — if the two disagree, **this file wins** and the spec is updated.

---

## §12.A — Claude Code subprocess

**Status:** completed 2026-04-22. Real Claude Code 2.1.117 subprocess validated end-to-end; `ClaudeCodeOrchestrator` rewritten and passing a live integration test. Refresh by re-running `scripts/probe-claude.sh --live` after each Claude Code upgrade; diff against this section and update.

### Pinning

| Field | Value |
|---|---|
| Claude Code version | 2.1.117 |
| Probe date | 2026-04-22 |
| Host OS | macOS (Darwin 25.0.0) |
| Auth | keychain OAuth (`apiKeySource: "none"`) |

### CLI surface

`claude --help` top-level does **not** list a `team` subcommand, with or without `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. The env var gates behavior, not top-level command visibility.

**Team creation is not a CLI subcommand.** The interaction model is: spawn one `claude -p` process (the lead) and tell it, in natural language, to create a team. The lead does the rest.

Flags that matter for Designer:

| Flag | Purpose |
|---|---|
| `-p`, `--print` | Non-interactive mode. Required for subprocess use. |
| `--output-format stream-json` | Structured JSON event stream over stdout. |
| `--input-format stream-json` | Structured JSON input over stdin (Conductor uses this). |
| `--include-partial-messages` | Emit per-token deltas as `stream_event` events. |
| `--verbose` | Full event detail in stream (required for stream-json). |
| `--teammate-mode {auto,in-process,tmux}` | Display mode for teammates. `in-process` works in non-tty subprocesses (**spike-confirmed 2026-04-22**). |
| `--session-id <uuid>` | Deterministic session id. |
| `--resume <uuid>` | Resume a prior session. |
| `--permission-mode {default,acceptEdits,bypassPermissions,plan,auto,dontAsk}` | Permission behavior. |
| `--permission-prompt-tool stdio` | Answer permission prompts programmatically via stdio. **Conductor uses this**; cleaner than `--dangerously-skip-permissions`. |
| `--disallowedTools <tools>` | Deny specific tools (Conductor uses this to deny `AskUserQuestion`). |
| `--setting-sources user,project,local` | Control settings inheritance. |
| `--max-turns <n>` | Turn cap per session (Conductor uses `1000`). |
| `--model <alias-or-name>` | Pin model (e.g., `opus[1m]`). |
| `--append-system-prompt <str>` | Add to default system prompt. Complies with spec §5 "we do not rewrite Claude's identity." |

Observed Conductor invocation (from `ps`):
```
claude --output-format stream-json --verbose \
       --input-format stream-json --max-turns 1000 \
       --model opus[1m] --permission-prompt-tool stdio \
       --resume <session-id> --disallowedTools AskUserQuestion \
       --setting-sources=user,project,local --permission-mode default
```

Notable: Conductor **ships its own Claude Code binary** at `~/Library/Application Support/com.conductor.app/bin/claude` rather than relying on the system install. Designer should use the system install (per spec §5) but pin a minimum version.

### Home directory layout

```
~/.claude/
├── teams/{team-name}/
│   ├── config.json        # members, session ids, agent types, model selection
│   └── inboxes/
│       ├── {role}.json    # array of messages to this role
│       └── ...
├── tasks/
│   ├── {session-uuid}/    # Claude's TodoList tool state (per-session)
│   │   └── {n}.json
│   └── {team-name}/       # agent-team task list (created on team spawn)
├── sessions/              # per-session state
├── projects/{slug}/       # project-scoped session index
├── plugins/               # user plugins
├── skills/                # user skills
└── agents/                # user-level subagent definitions
```

Team and team-task directories are created by Claude Code when a team spawns. Designer observes them via file watching + hook invocations + stream-json.

### Team config schema (`~/.claude/teams/{team}/config.json`)

Captured live:

```json
{
  "name": "dir-recon",
  "description": "Brief directory reconnaissance by a researcher teammate",
  "createdAt": 1776871009160,
  "leadAgentId": "team-lead@dir-recon",
  "leadSessionId": "fc51fcf4-125c-4b37-a372-d46ea70a1577",
  "members": [
    {
      "agentId": "team-lead@dir-recon",
      "name": "team-lead",
      "agentType": "coordinator",
      "model": "claude-opus-4-7[1m]",
      "joinedAt": 1776871009160,
      "tmuxPaneId": "",
      "cwd": "<workspace-root>",
      "subscriptions": []
    },
    {
      "agentId": "researcher@dir-recon",
      "name": "researcher",
      "color": "blue",
      "joinedAt": 1776871014695,
      "tmuxPaneId": "in-process",
      "subscriptions": [],
      "agentType": "Explore",
      "model": "haiku",
      "prompt": "<the spawn prompt the lead gave this teammate>",
      "planModeRequired": false,
      "cwd": "<workspace-root>",
      "backendType": "in-process"
    }
  ]
}
```

Notes:
- `agentId` is `{role-name}@{team-name}`. Role-based per FB-0001.
- `leadSessionId` is the lead's durable session — this is what Designer should `--resume` against for `assign_task` / `post_message`.
- Per-teammate `model` is heterogeneous: Claude picked `opus` for the coordinator and `haiku` for the worker without being asked. Designer can request specific models in the spawn prompt.
- `tmuxPaneId: "in-process"` is the in-process sentinel; `""` for the lead (ambient); a real pane ID for tmux-backed teammates.
- `backendType` for teammates: `"in-process"` (confirmed working non-tty) vs `"tmux"` vs iTerm2.
- `agentType` references a subagent definition by name. `"Explore"` is Claude's built-in; custom ones live in `.claude/agents/*.md`.
- Do **not** edit config.json by hand. Claude overwrites on state updates.
- Timestamps are unix-ms.

### Inbox schema (`~/.claude/teams/{team}/inboxes/{role}.json`)

Array of message objects. Messages come in two forms:

**Human-readable text:**
```json
{
  "from": "researcher",
  "text": "**Designer** is a local-first macOS application...",
  "summary": "Project overview: Designer macOS app",
  "timestamp": "2026-04-22T15:17:04.858Z",
  "color": "blue",
  "read": false
}
```

**Control messages (JSON-in-text):**
```json
{
  "from": "researcher",
  "text": "{\"type\":\"idle_notification\",\"from\":\"researcher\",\"timestamp\":\"...\",\"idleReason\":\"available\"}",
  "timestamp": "2026-04-22T15:17:07.459Z",
  "color": "blue",
  "read": false
}
```

Control types observed: `idle_notification`, `shutdown_request`, `shutdown_approved`.

**Translator rule:** try `serde_json::from_str(&msg.text)` first; if it parses and has a `"type"` discriminant, treat as control; otherwise treat as human-readable text.

### Stream-json event vocabulary

From a 2-member team running a simple task for ~17 seconds, event-type histogram:

| Count | type | subtype | Purpose |
|---|---|---|---|
| 947 | `stream_event` | — | Per-token partial deltas (most frequent). |
| 55 | `assistant` | — | Complete assistant turns (full message object). |
| 37 | `system` | `status` | Status updates. |
| 34 | `user` | — | User message echoes. |
| 7 | `system` | `task_started` | Task lifecycle — new task created. |
| 6 | `system` | `task_notification` | Task progress signals. |
| 3 | `system` | `init` | Session init (one per session: lead + teammate + any subagents). |
| 2 | `system` | `hook_started` | Hook invocation begins. |
| 2 | `system` | `hook_response` | Hook invocation ends (carries exit code). |
| 2 | `result` | `success` | Session terminal marker. Carries cost + usage. |
| 2 | `system` | `task_updated` | Task state patch. |
| 1 | `rate_limit_event` | — | Subscription capacity signal. |

#### Representative event shapes

**`system/init`** — emitted once per session start:
```json
{
  "type": "system", "subtype": "init",
  "cwd": "...", "session_id": "...",
  "model": "claude-opus-4-7[1m]",
  "permissionMode": "bypassPermissions",
  "apiKeySource": "none",
  "claude_code_version": "2.1.117",
  "tools": [...],                  // large list
  "mcp_servers": [...],            // large list
  "agents": ["Explore", ...],
  "skills": [...],
  "plugins": [...],
  "memory_paths": {"auto": "..."},
  "fast_mode_state": "off",
  "uuid": "..."
}
```

**`system/task_started`** — teammate spawn as seen from the lead:
```json
{
  "type": "system", "subtype": "task_started",
  "task_id": "t9zu6heo5",
  "tool_use_id": "toolu_...",
  "task_type": "in_process_teammate",
  "description": "researcher: You are the \"researcher\" teammate...",
  "prompt": "<spawn prompt>",
  "session_id": "<lead-session-id>",
  "uuid": "..."
}
```

**`system/task_updated`** — task state patch:
```json
{
  "type": "system", "subtype": "task_updated",
  "task_id": "bacnr21el",
  "patch": {"status": "completed", "end_time": 1776871130382},
  "session_id": "...", "uuid": "..."
}
```

**`system/task_notification`** — teammate reports status (mirrors inbox):
```json
{
  "type": "system", "subtype": "task_notification",
  "task_id": "t9zu6heo5",
  "tool_use_id": "toolu_...",
  "status": "completed",
  "output_file": "",
  "summary": "researcher@dir-recon",
  "session_id": "...", "uuid": "..."
}
```

**`rate_limit_event`** — capacity signal (Decision 34):
```json
{
  "type": "rate_limit_event",
  "rate_limit_info": {
    "status": "allowed",
    "resetsAt": 1776884400,
    "rateLimitType": "five_hour",
    "overageStatus": "rejected",
    "overageDisabledReason": "org_level_disabled_until",
    "isUsingOverage": false
  },
  "session_id": "...", "uuid": "..."
}
```

`status` values: `"allowed"`, `"approaching"` (speculative — not observed; may appear pre-hit), `"exceeded"`. `rateLimitType`: `"five_hour"`, weekly variants likely. Designer parses these and surfaces via the usage chip (Phase 13.G).

**`system/hook_started`** / **`system/hook_response`** — hook invocation visibility:
```json
{"type": "system", "subtype": "hook_started", "hook_id": "...", "hook_name": "...", "hook_event": "...", "uuid": "...", "session_id": "..."}
{"type": "system", "subtype": "hook_response", "hook_id": "...", "hook_name": "...", "hook_event": "...", "output": "...", "stdout": "...", "stderr": "...", "exit_code": 0, "outcome": "..."}
```

**Key finding:** hook invocations are visible in the lead's stream-json *in addition to* the hook subprocess itself running. Designer can use stream-json as the primary event feed and skip a separate hook-file tailer in many cases.

**`result/success`** — terminal marker with cost:
```json
{
  "type": "result", "subtype": "success",
  "duration_ms": 17222, "duration_api_ms": 17203,
  "num_turns": 4,
  "total_cost_usd": 0.36,
  "modelUsage": {
    "claude-opus-4-7[1m]": {
      "inputTokens": 14, "outputTokens": 720,
      "cacheReadInputTokens": 84855, "cacheCreationInputTokens": 47950,
      "costUSD": 0.36, "contextWindow": 1000000, "maxOutputTokens": 64000
    }
  },
  "permission_denials": [],
  "terminal_reason": "completed",
  "stop_reason": "end_turn"
}
```

### Session scope of stream-json

**Critical for the translator design:** the lead's stream-json carries events from the lead's session only. Teammate chat lines do not appear directly in the lead's stream; they surface as:
- Tool-use results (when the lead reads teammate messages from the inbox)
- `task_notification` events (when teammates change status)

To observe a teammate's own stream in detail, Designer would need to `--resume <teammate-session-id>` separately. For v1 this is **not needed** — the lead's stream plus the inbox files give us everything the UI needs for track-level status.

### Task-list files (`~/.claude/tasks/{team-name}/`)

Not populated for our spike because the team completed without the TodoList tool being used. Expected to follow the same schema as per-session task files:
```json
{
  "id": "1",
  "subject": "…",
  "description": "…",
  "activeForm": "…",
  "status": "pending | in_progress | completed",
  "blocks": [],
  "blockedBy": []
}
```

To capture the shape under the team primitive, re-run the probe with a prompt that forces TodoList usage: *"create a team with one teammate and give them three pending tasks on a shared task list."*

### Session-resume semantics

- Lead session ID in `config.json -> leadSessionId`. Durable; Designer stores it and uses `claude -p --resume <id>` for `assign_task` and `post_message`.
- Teammate sessions also have IDs, but not surfaced in `config.json` in the shape observed. Likely in `~/.claude/sessions/` or a future `memberSessionId` field. Re-probe when needed.
- Known limitation (per docs): in-process teammates do not survive `/resume`. If Designer resumes a lead whose teammates are gone, the lead will reference stale agent IDs. Handling: emit a `TeamStale` event on resume; ask the lead to respawn teammates before accepting new work.

### Load-bearing spike — resolved

**Question:** does `--teammate-mode in-process` work in a non-tty subprocess spawned from Rust / bash?

**Result:** **Option (a) — works cleanly.** 2026-04-22 probe (`scripts/probe-claude.sh --live`):
- No tty allocation; no pty wrapper; no tmux dependency.
- Lead spawned a researcher teammate in ~14 seconds.
- Teammate executed, messaged the lead, went idle.
- Shutdown flow did show lag (matches docs-known "shutdown can be slow" limitation): the lead sent a shutdown request and had to resend before the teammate acknowledged.

**Implication:** the 12A.3 rewrite can spawn the lead with a plain `tokio::process::Command`. No extra dependencies. No Phase 16 packaging impact.

### Translator design implications (feeds 12A.3)

1. **Hook firing is visible in two places:** the subprocess hook itself, and the `system/hook_started`/`system/hook_response` events in the lead's stream-json. Designer's primary lifecycle feed can be the stream; the `designer-hook` binary becomes a backup for when the stream misses (e.g., when the translator is down). Simplifies initial scope.
2. **Task events (`task_started` / `task_updated` / `task_notification`) are the right hook for `OrchestratorEvent::TaskCreated` / `TaskCompleted`** — richer than the on-disk task-list files. Patch shape for updates makes incremental state cheap.
3. **`rate_limit_event` is the Decision 34 signal source.** Parse and surface via the usage chip.
4. **`result/success` carries cost.** Feeds `CostTracker` directly without a parallel tally.
5. **Stream-event partials at 947 events / 17s (~55 per second)** confirm the 120ms backend coalesce decision (D3): without coalescing, we'd flood the Tauri channel.
6. **`permission-prompt-tool stdio`** is the path we want for 13.G approval gates, not `--dangerously-skip-permissions`. Conductor does this; we should too. The stdio protocol needs its own probe pass in 12A.3.

### Shutdown behavior — documented gotcha

The probe ran longer than the ~17s the lead reported as `duration_ms` because the shutdown handshake is async. The lead's `result/success` fired when its turn ended, but the subprocess didn't exit until the teammate acknowledged shutdown. On the probe machine, the first shutdown request was ignored; a second one (1 minute later) was also still pending when the probe was killed.

**Implication for `Orchestrator::shutdown`:**
- Send natural-language shutdown prompt to the lead via `--resume`.
- Wait for the lead's `result/success` + inbox shutdown_approved messages.
- If both haven't arrived within a configurable timeout (default 60s), `start_kill()` the process.
- Track dangling teams in `~/.claude/teams/` on startup and offer to clean up.

### Conductor comparison (observational)

From live `ps` on the dev machine while Conductor was running alongside the probe:
- Conductor spawns `claude` subprocesses with `--permission-prompt-tool stdio`, `--max-turns 1000`, `--model opus[1m]`, `--resume <session-id>`, `--disallowedTools AskUserQuestion`.
- Not using `--dangerously-skip-permissions` — responds to permission prompts programmatically.
- Not (visibly) using `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` — Conductor predates the teams primitive and rolls its own session-per-workspace model, confirming our differentiation thesis.
- Ships its own Claude Code binary bundled with the Mac app. Designer will use the system install (spec §5 / FB-0016).

### Known limitations observed + from docs

- In-process teammates don't survive `/resume`; orchestrator must respawn.
- Shutdown can lag (teammate must acknowledge).
- `agent-teams` is experimental — may change shape in a minor Claude release. Scheduled probe workflow catches this (Phase 12A.5 Tier 3 CI).
- One team per lead session (no nested teams); Designer's workspace/track model respects this by keeping teams at the track level (spec Decision 8).

### Open re-probes

Worth a re-run of the probe when:
- Claude Code upgrades past 2.1.117.
- A team is given TodoList-heavy work (to capture `~/.claude/tasks/{team-name}/` shape).
- A teammate is given write tools under a restricted path (to capture `PreToolUse` hook stall behavior, 12A.3 sub-task).
- The `approaching` rate-limit status (if it exists) needs capturing — probably requires a heavier workload.

---

## §12.B — Swift Foundation Models helper

**Status:** infrastructure landed (supervisor + config + probed boot + stub-testable boot path). Real-binary validation pending the next run on an Apple-Intelligence-capable Mac.

### Build path

- Package: `helpers/foundation/Package.swift`, `swift-tools-version:5.9`, `.macOS(.v15)`.
- Build: `./scripts/build-helper.sh` → `swift build -c release --package-path helpers/foundation`.
- Artifact: `helpers/foundation/.build/release/designer-foundation-helper`.
- Runtime resolution: `AppConfig::default_in_home()` auto-resolves in priority order: `DESIGNER_HELPER_BINARY` absolute path → sibling of `current_exe()` when running inside a `.app` bundle (Phase-16 production path) → `<workspace>/helpers/foundation/.build/release/designer-foundation-helper` under Cargo.
- No user-space install — the binary stays in the Swift build tree for dev and moves into `Contents/MacOS/` when Phase 16 signs the bundle.

### Protocol (unchanged from Phase 5)

- Frame: 4-byte big-endian length prefix, then a JSON body.
- Requests: `{"kind":"ping"}`, `{"kind":"generate","job":"...","prompt":"..."}`.
- Responses: `{"kind":"pong","version":"...","model":"..."}`, `{"kind":"text","text":"..."}`, `{"kind":"error","message":"..."}`.
- Helper CLI now additionally accepts `--version` for a single-line semver print, used by `scripts/build-helper.sh` as a post-build smoke check.
- Unknown-kind frames get a structured `{"kind":"error","message":"unknown-request"}` response instead of the previous hang.

### Observed SDK call shape

*To be filled in by the first run on an Apple Intelligence machine.* Expected call is `LanguageModelSession().respond(to: prompt)` per Apple's public Foundation Models SDK. Wrap errors through `localizedDescription` rather than the full error object to avoid leaking prompt echoes or file paths in returned strings.

### Supervisor behavior (verified via stub binary)

- In-flight requests fail fast when the child dies or stalls. The supervisor never sleeps a backoff under the request lock; the cooling-off window is checked at the *start* of the next request.
- Default tuning: exponential backoff `[250, 500, 1000, 2000, 5000]` ms, max 5 consecutive failures before permanent demotion to `NullHelper`, 5s per-request deadline.
- Tuning is overridable via `SwiftFoundationHelper::with_tuning()` — tests use `[10, 10, 10, 10, 10]` ms so restart paths run in under a second.
- Stderr is drained into a 2 KB ring buffer and included in every restart log line. The ring is shared across restarts so multi-crash patterns show the full picture.
- `kill_on_drop(true)` on the child plus an aborting stderr-drain task mean dropping `SwiftFoundationHelper` cleanly reaps the subprocess.

### Known quirks

- Dev loop: if the user rebuilds the Swift helper while the app is running, the supervisor will keep using the old child until its next failure. This is acceptable — a dev who just ran `./scripts/build-helper.sh` can restart Designer or send a helper-kill signal; production users are unaffected.
- The rate limiter (10 tokens, 5/s refill) lives Rust-side and is checked *before* the cache. Cache hits bypass the rate limiter entirely — that's intentional, since a cache hit doesn't actually burn a Foundation Models call.

### Fallback diagnostics

On boot the helper either runs live or falls back to `NullHelper`. Every fallback comes with a structured reason surfaced via the `helper_status` IPC:

| `fallback_reason` | Meaning | `recovery` |
|---|---|---|
| `user_disabled` | `DESIGNER_DISABLE_HELPER=1` forced fallback. | `user` |
| `not_configured` | `AppConfig::helper_binary_path` is `None` — no install detected and no env override set. | `reinstall` |
| `binary_missing` | Configured path exists on disk as a string but is not a file. `fallback_detail` contains the path. | `reinstall` |
| `ping_timeout` | Binary ran but the ping exceeded `HELPER_BOOT_DEADLINE` (750ms). | `reinstall` |
| `unsupported_os` | Binary ran but reported `macos-too-old` — this Mac is on a macOS version that doesn't expose Foundation Models. | `none` |
| `models_unavailable` | Binary ran but reported `foundation-models-unavailable` — Apple Intelligence not enabled on this Mac or framework not linkable. | `none` |
| `ping_failed` | Binary ran and responded with some other error. `fallback_detail` contains the helper's verbatim message. | `reinstall` |

Discrimination is structural, not substring-based: `HelperError::Timeout(Duration)` is a distinct variant from `HelperError::Unavailable(..)`; `Reported("macos-too-old")` and `Reported("foundation-models-unavailable")` are the two documented machine tags the Swift side emits. The `PingFailed` bucket is reserved for genuinely unknown errors; the pre-classified buckets are preferred so the UI can route recovery affordances correctly.

### `NullHelper::generate` output is a marker, not a summary

`NullHelper::generate` returns `"[unavailable <job>] <prompt prefix>"`. This is a deliberate diagnostic placeholder — **not** user-facing copy. Phase 13.F surfaces that consume `LocalOps::*` results must branch on `HelperStatusResponse.kind == "fallback"` and render a skeleton / empty state instead of the returned string. The word "unavailable" is chosen to match the IPC vocabulary; avoid "offline" because Designer is still online, just without on-device model capacity.

`NullHelper::ping()` similarly returns the plain string `"unavailable"` — intended as a machine-readable signal, not a user-visible status line.

### `fallback_detail` is diagnostic-only

The `fallback_detail` field on `HelperStatusResponse` may contain machine tags like `foundation-models-error: NSCocoaError 42`. These strings are useful in bug reports and logs but **must not** be concatenated into user-visible copy. Renderers should pick from `provenance_label` + `provenance_id` for user text, and reserve `fallback_detail` for a developer-only "Show details" affordance if one is ever surfaced.

### Supervisor fails fast; backoff never blocks under the request lock

`SwiftFoundationHelper`'s `exchange()` holds the child's stdin/stdout mutex across a single round-trip, but never sleeps under the lock. On failure the failing call returns `HelperError::Unavailable` with the stderr snapshot immediately; the cooling-off window is checked at the *start* of the next request; respawn happens lazily. UI call time stays bounded at the per-request deadline (5s default) even during a crash storm. Demotion is a boolean flag on supervisor state — `AppCore.helper` is never swapped, so there's no architectural surface to change if 13.F wants to add a "re-enable helper" affordance; that would just clear the flag.

### Helper events (for 13.F)

The supervisor publishes state transitions on a `tokio::sync::broadcast` channel exposed at `SwiftFoundationHelper::subscribe_events()` and forwarded through `AppCore::subscribe_helper_events()`. Events:

- `HelperEvent::Ready { version, model }` — emitted after the first successful `ping` captures pong fields. Subscribers label provenance ("Summarized on-device") without querying.
- `HelperEvent::Degraded { consecutive_failures }` — emitted on every failed round-trip while the helper is still alive (pre-demotion).
- `HelperEvent::Demoted` — emitted exactly once when the supervisor crosses `max_consecutive_failures`. 13.F should swap to NullHelper-aware rendering.
- `HelperEvent::Recovered` — emitted when a failure streak clears. Distinct from `Ready` so the UI can differentiate "first boot" from "recovered from N failures."

Slow subscribers see `RecvError::Lagged` and should resync by calling `AppCore::helper_health()`.
