# Integration notes

Observed behavior of external systems Designer integrates with. Updated whenever a Phase-12 track validates a real integration and finds surprises. This is the counterpart to `spec.md`'s intended behavior — if the two disagree, **this file wins** and the spec is updated.

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
