# History

Detailed record of shipped work. Reverse chronological (newest first). This is not a changelog — it captures the **why**, **tradeoffs**, and **decisions** behind each change so future sessions have full context on how the project evolved.

---

## How to Write an Entry

```
### [Short title of what was shipped]
**Date:** YYYY-MM-DD
**Branch:** branch-name
**Commit:** [SHA or range]

**What was done:**
[Concrete deliverables — what changed in user-facing terms.]

**Why:**
[The problem this solved or the goal it served.]

**Design decisions:**
- [UX or product choice + reasoning]

**Technical decisions:**
- [Implementation choice + reasoning]

**Tradeoffs discussed:**
- [Option A vs Option B — why this one won]

**Lessons learned:**
- [What didn't work, what did, what to do differently]
```

Use the `SAFETY` marker on any entry that modifies error handling, persistence, data loss prevention, or fallback behavior.

---

## Entries

### Phase 23.C — Tool-use rows expand to full payload (three-PR trail)
**Date:** 2026-05-03 (trail spans 2026-05-02 → 2026-05-03)
**Branch:** chat-tool-expand → tool-line-polish → tool-line-discoverability
**PRs:** #92 (initial), #94 (region wrapper polish), #97 (chevron + retry)

**What was done:**

`ToolUseLine` (`packages/app/src/blocks/blocks.tsx`) used to show a compact one-line tool-use row that expanded to one extra summary line. It now expands to the full artifact payload as monospace `<pre>` under the head, addressing friction `019dea67` ("tool-use rows feel decorative — no way to drill into evidence"). The trail across three PRs:

- **PR #92** — Core feature. On expand, fetches the artifact via `ipcClient().getArtifact(id)`; per-mount cache + in-flight `useRef` flag dedupes a fast double-click into a single IPC call. Output >40 lines truncates with a "Show full (N more lines)" disclosure that drops the cap. Initial review caught three blockers fixed in a follow-up commit on the same branch: `mountedRef` guard so `setState` doesn't fire after unmount, "Loading output…" affordance during the in-flight window, and `aria-live="polite"` on the new region.
- **PR #94** — Region-wrapper refactor. `.tool-line__region` was introduced as a flex-column wrapper that owns the box chrome (`--color-surface-sunken` fill, soft border, paddings) + `min-height` + `role="region"` + `aria-label` + `aria-live="polite"` + `aria-busy`. Loading / loaded / error states share one footprint so payload arrival is layout-stable. The inner `<pre>` dropped its chrome and aria-live (some screen readers re-read the whole pre content verbatim on insertion, which the wrapper sidesteps). `getArtifact` rejection surfaces "Nothing to show." instead of an empty box (the round-3 review fixed an earlier draft "No output captured." that read as engineer-y / accusatory). Round-3 review also caught an invalid `min-height` calc that mixed unitless `--type-caption-leading` with lengths — fixed by multiplying `--type-caption-size × --type-caption-leading`.
- **PR #97** — Discoverability + retry. The `· ` dot on the head was replaced by a lucide-react `ChevronRight` (size 12, strokeWidth 1.5 per axiom #13) that rotates 90° via CSS transform on `aria-expanded="true"`. Same monochrome weight as the dot at rest but signals click-to-expand without ambiguity. Reduced-motion collapses the rotation to instant. Error state now renders a "Try again" text-link beside "Nothing to show."; click clears the dedupe flags and refires `fetchPayload()` — transient failures recover with one click without us having to type-classify the rejection reason on the Rust side.

**Why:**

Pass-through chat (PR #63 / DP-B) had compact tool-use rows but no way to inspect what `Read core-docs/spec.md` actually returned, so a manager couldn't audit what the agent saw. The friction was filed within hours of dogfooding the post-DP-B chat surface. Phase 23.C as scoped in `roadmap.md` was a small frontend half-day; the trail grew because three rounds of staff-perspective review surfaced issues progressively (each round fixed earlier-round blockers, then found new ones at the next layer of polish).

**Design decisions:**

- Truncate at 40 lines, not pagination. Mirrors a typical terminal viewport at common laptop sizes; revisit if dogfood shows it's wrong. "Show full" reveals everything in one click rather than a paged disclosure — matches the cabin's terse register and avoids a state machine for page index.
- `<pre>` content uses `white-space: pre-wrap` so long lines wrap inside the parent's max-width (`min(48rem, 100%)`); `overflow-x: auto` handles single-word lines without breakpoints. The row never stretches the whole thread.
- Error copy: "Nothing to show." over "No output captured." Round-3 UX review flagged "captured" as implying a recording the system *should have* made — too engineer-y for the manager-not-engineer audience.
- Chevron over dot. The original Phase 23.C spec quoted "compact one-line `· Read foo.rs`", but the dot was a placeholder visual marker, not a documented design-language axiom. The chevron carries the same monochrome weight at rest while signaling click-to-expand without ambiguity. Rotation direction (90° clockwise to point down on expand) matches Radix / macOS / standard disclosure conventions.
- Frontend-only retry over Rust-side error classification. The originally-spec'd shape was 404 = permanent (no retry button); 5xx / IPC error = transient (retry button). Letting the user choose to retry sidesteps the classification entirely — cost is one extra IPC on a permanent-404 retry click. Parked the proper classification as roadmap item 23.C.f4 if dogfood shows the extra IPC matters.

**Technical decisions:**

- `aria-live="polite"` lives on the `.tool-line__region` wrapper, not the inner `<pre>`. Some screen readers (JAWS in particular) read the entire content of a `<pre>` verbatim when it's inserted into a live region; moving the live-update semantics up to the wrapper (which holds `role="region"` + `aria-label`) means SRs announce a single region update instead of streaming 40 lines of code aloud.
- `min-height` on the wrapper computed as `calc(--type-caption-size * --type-caption-leading + 2*--space-2 + 2*--border-thin)`. The unitless `--type-caption-leading` (1.4) has to be multiplied by the size token, not added directly to lengths, or CSS calc() rejects the whole rule and the layout-stability promise breaks silently. PR #94 round 3 caught this as a real blocker.
- `mountedRef` guard collapses the IPC `.then()` / `.finally()` callbacks into no-ops when the row unmounts mid-fetch (tab close, archive). React 18+ silenced the legacy "state update on unmounted component" warning, so the unmount-safety test asserts both `getArtifact` was called (proving the promise resolved) AND no console error landed (proving setState didn't fire) — neither half alone proves the guard works.
- The new `phase` state machine (`idle | loading | loaded | error`) replaced an earlier boolean `loading` flag. Phase carries the result, not the in-flight state — `inflightRef` carries the in-flight state. Separating them means `aria-busy` flips with the loading phase alone, and re-expand reads the cached `loaded` or `error` phase without retriggering the fetch.

**Tradeoffs discussed:**

- BlockProps `expanded` / `onToggleExpanded` adoption (parked as 23.C.f2). The `BlockProps` contract has the parent thread own block expand state, but ToolUseLine tracks it locally. Originally a v1 simplification ("disclosed state persists per-mount only") per the roadmap deliverable. Adopting the parent contract would let `WorkspaceThread` collapse all rows on tab switch / focus-mode but also requires extending the parent's payload state to track loading/error/loaded phases (today the parent only stores resolved `PayloadRef`s). Speculative without a parent-collapse consumer; left in roadmap with a refreshed estimate (~1 day not ½ day).
- Coalescing consecutive same-tool rows ("Read 4 files" with one disclosure expanding to four citations) — explicit Phase 23 v2 polish per the "Out of scope (v1)" list. Needs a coalescing primitive in `WorkspaceThread`, not a block-side change. Parked as 23.C.f3.
- Discoverability chevron register. The reviewer's first-round take flagged that adding a chevron changes the "compact one-line" register the original spec asked for. The third-round take revisited and concluded the dot was a placeholder visual marker, not a documented axiom — the chevron carries the same weight at rest while signaling interactivity. Decision: ship the chevron, document the change in `generation-log.md`.

**Lessons learned:**

- Three rounds of staff-perspective review on a "small half-day frontend phase" caught real issues at each layer — basic correctness (round 1: unmount safety, loading state, aria-live), shape refinement (round 2: layout stability, error state, italic axiom-violation), polish (round 3: invalid calc, error copy, discoverability, retry). Skipping any round would have shipped a real bug. The pattern argues for running review aggressively on phases that touch user-facing chrome, even when the LOC is small.
- Visual-regression baselines diverge whenever a head element changes (dot → chevron). The `regenerate-visual-baselines.yml` workflow handles this on a Linux runner so the developer doesn't try to commit Mac-rendered baselines. Triggered via `gh workflow run regenerate-visual-baselines.yml -f branch=<branch>` after pushing the change.
- Frontend-only fixes for "needs Rust-side classification" can sidestep the architectural decision by giving the user the choice. The retry button costs one extra IPC on permanent failures vs. zero IPC with classification, but the cost is paid on a click the user opted into — not silent overhead. If/when dogfood shows the extra IPC matters, the original Rust-side classification is still the right path.

---

### Phase 23.C polish — layout-stable region wrapper + error state
**Date:** 2026-05-03
**Branch:** tool-line-polish
**Commit:** PR #94 (2c0615bc)

> _Backfilled 2026-05-03 from PR body (PR #96). Rationale framing is agent-authored except where tied to a named staff-review finding, named commit, or quoted user direction. Spot-check 2026-05-03: `calc()` silent-fail attribution to round-3 design-engineer review is **grounded**; the "copy beats visual differentiation" framing and the deferred min-height fix are **agent inference**, not user-stated._

**What was done:**

Follow-up to PR #92 (Phase 23.C tool-use expand). The merged PR shipped with deferred review items in its body — closing the PR risked losing them, so the cheap fixes landed here and the rest were parked in roadmap.

- `.tool-line__region` carries box chrome + `min-height` so loading / loaded / error states share one footprint. Min-height computed as `(--type-caption-size × --type-caption-leading) + 2× space-2 + 2× border-thin` — the multiplication is load-bearing because `--type-caption-leading` is a unitless multiplier and `calc()` drops the rule entirely on unit mismatch (caught by the round-3 design-engineer review; the prior calc silently failed and the layout-stability promise was defeated).
- `role="region"` + `aria-label` + `aria-live="polite"` move from the inner `<pre>` up to the wrapper; `aria-busy` flips with the loading phase. Screen readers announce one region change instead of re-reading the long `<pre>` verbatim.
- Failed-fetch state surfaces "Nothing to show." inside the region (cached so a re-expand doesn't refetch a known 404). Copy is manager-tone, matching project empty-state vocabulary.
- ReportBlock manifest entry refreshed (tokens, behavior, `last_updated`).
- Roadmap gains a "Phase 23.C follow-ups" section with f1–f4: discoverability chevron (visual-register decision), honoring `BlockProps.expanded` for parent-driven collapse, coalescing consecutive same-tool rows, and distinguishing transient vs permanent fetch failures (needs Rust-side error typing).

**Why:**

PR #92 closed in friction-fix mode but left layout shift on payload arrival, an aria-live region that re-read the full `<pre>` on update, and silent empty `<pre>`s on fetch failure. None block dogfood; all degrade trust if they accumulate.

**Design decisions:**

- **Copy beats visual differentiation for the error state.** "Nothing to show." in muted text — no warning chrome — keeps the monochrome aesthetic and lets the message itself carry the signal. Rejected the design reviewer's lighter-error-tint suggestion.
- **Cache 404s in-memory per mount.** A user expanding the same row again shouldn't re-IPC a known-missing payload. Acceptable that transient errors are sticky for the mount lifetime; the right transient/permanent split needs Rust-side error classification (parked as 23.C.f4).

**Technical decisions:**

- **`min-height` calc as a single CSS expression**, not a JS measurement. Keeps the rule declarative and the bound predictable on theme switch.
- **`tabIndex` deliberately omitted from the region** — added a JSX comment so a future reviewer doesn't assume it's a missing prop. The expand-collapse interaction is keyboard-driven from the head; the region is announce-only.

**Tradeoffs discussed:**

- **Pure-frontend transient-vs-permanent error distinction (rejected) vs. roadmap-park as 23.C.f4 (chosen).** The right fix needs a typed error from `getArtifact` — pure FE pattern-matching on string messages would lock us to the current Rust error format. Defer until the Rust-side classification lands.

**Lessons learned:**

- CSS `calc()` with a unitless variable is a silent-fail trap. The malformed `min-height: calc(0.5rem × 1.4 + ...)` rejected the whole rule and the layout-stability test passed visually only because typical viewports masked the missing min-height. Worth a tools/invariants check for unitless variables inside calc() with length operands.
- Splitting `aria-live` from the live-region content is a portability concern, not a current-VoiceOver bug. Land the split when the cost is small (it was, here); don't wait for a complaint.

---

### Phase 23.D follow-up — resync per-tab thread state on tab switch
**Date:** 2026-05-03
**Branch:** chat-tab-state-resync
**Commit:** PR #93 (59c5d653)

> _Backfilled 2026-05-03 from PR body (PR #96); **not spot-checked against the session transcript**. The two BLOCKERs (`hasStarted` staleness, `initialPaint` re-arm) and PR #90's review-pass conclusion are visible in the PR bodies; the "ship + follow-up" characterization and per-tab persistence priorities below are likely implementation-agent framing, not transcript-recorded user direction._

**What was done:**

Phase 23.D (PR #90) kept `WorkspaceThread` mounted across tab switches to preserve the artifact-stream listener. That fix was load-bearing for live updates but left three pieces of per-tab state seeded only on first mount, so switching `tabId` left them stale. The two BLOCKERs flagged on the PR #90 second review pass land here as small, surgical effects:

- **`hasStarted` resyncs from `tabStartedById[stateKey]`** via a `useEffect` keyed on `stateKey`. A fresh sibling tab inherited the previous tab's `true` and skipped the suggestion-strip empty state — now resolves correctly.
- **`ComposeDock` is now keyed by `stateKey`** so it remounts per tab. The textarea no longer carries the previous tab's draft into the next tab's mount; round-trip A→B→A still restores A's draft because the per-tab store survives the remount.
- **`initialPaint` animation gate re-arms on every `tabId` change** via a two-RAF `useEffect`. The slide-in keyframe (`thread-message-in`, 250ms) no longer re-fires on artifacts the user has already seen.
- Stale comment at `WorkspaceThread.tsx:394` ("Tab switches remount the whole component") updated.
- T-23D-3 scroll-preservation test relaxed to start both tabs before scroll-shimming (the `hasStarted` resync correctly unmounts `.thread` when switching to a never-started sibling, so scroll preservation only holds when both tabs are in thread mode).
- Three new tests pin the new behaviors: suggestion strip on fresh sibling tab, draft round-trip across switches, `.thread--initial` re-arms on switch.

**Why:**

PR #90's task brief explicitly placed `WorkspaceThread.tsx` and `ComposeDock.tsx` out of scope. The two BLOCKERs (UX: blank thread on fresh sibling tab; design-engineer: animation stampede on every tab switch) couldn't be fixed without touching them, so the original PR shipped with them as "decision pending." This follow-up takes the ~6-line scope expansion the PR body recommended.

**Design decisions:**

- **`stateKey` (workspace_id + tab_id) as the React key on ComposeDock.** Forces an intentional remount per tab — clean, no manual store reads, and matches the per-tab attribution model already in place. Model + effort reset on remount is intentional (and called out in follow-ups for later persistence).
- **Two-RAF `initialPaint` window.** The `thread-message-in` keyframe runs 250ms; two frames at 60fps is ~33ms — enough headroom to suppress the re-fire without delaying the next genuine arrival.

**Technical decisions:**

- **`tabId` (not `stateKey`) keys the `initialPaint` effect.** The animation gate cares about tab transitions, not workspace transitions. Workspace switch tears down the whole MainView, so the `initialPaint` gate auto-resets there anyway.
- **Effect-based resync, not a memoization rebuild.** `useEffect` is the right primitive when the trigger is a prop/key change and the action is "re-read external state once." Memo would re-derive on every render; the effect re-derives only on `stateKey` change.

**Tradeoffs discussed:**

- **Persist model + effort + attachments per tab now (scope creep) vs. ship the BLOCKER fix and follow up (chosen).** The remount-resets-controls behavior is a paper-cut, not a regression — none of those features ever shipped per-tab persistence. Land the architectural fix; persist controls when there's a clean vehicle for it.

**Lessons learned:**

- `useState(() => ...)` lazy initializers fire **once** on mount. Whenever the component is intentionally kept mounted across what used to be a remount boundary, lazy initializers and one-shot effects need an audit.
- Two-RAF gates are imperceptible and well under the standard motion duration. Reach for them when a CSS keyframe needs to be suppressed for one paint.

---

### Phase 23.A — stamp coalesced agent artifact ids with first-token timestamp
**Date:** 2026-05-03
**Branch:** chat-coalescer-ts
**Commit:** PR #91 (67d05eed)

> _Backfilled 2026-05-03 from PR body (PR #96). Rationale framing is agent-authored except where tied to a named staff-review finding, named commit, or quoted user direction. Spot-check 2026-05-03: reviewer-caught `uuid` API bug and ±2ms→±10ms tolerance widening are **grounded** in commit d7e26e51; the "pre-existing artifact ids stay broken" tradeoff is **agent reasoning** code-documented but not user-weighed._

**What was done:**

The message coalescer accumulates streamed agent tokens and flushes one `ArtifactCreated` per (workspace, author_role) once a 120ms idle window passes. Pre-fix, the flushed artifact id was `ArtifactId::new()` — a UUIDv7 stamped at *flush time*. Tool-use artifacts and any user reply between the last agent token and the flush carried earlier UUIDv7s, so the chat read bottom-up-and-jumbled.

The coalescer now captures `uuid::Timestamp` on the first chunk of each pending burst (same `or_default()` site that captures `tab_id`), clears it on flush, and builds the artifact id via `first_seen_artifact_id` (a thin wrapper over `Uuid::new_v7`). The chat view sorts by artifact id (backed by the projector's `BTreeMap<ArtifactId, _>` iteration), so this is the single source of truth fix.

Pre-existing artifacts retain their (incorrect) timestamps. **Only new flushes are correct** — old conversations open with their pre-fix ordering until replaced.

Acceptance tests T-23A-1..4 land plus a helper round-trip; tolerance widened from ±2ms to ±10ms after a round-1 reviewer flag (CI scheduler contention).

**Why:**

PR #87 stripped the experimental agent-teams framing; same-day dogfood on the resulting plain-pass-through chat surfaced a more fundamental ordering bug: tool-use rows showed up *after* the agent message that triggered them and *after* the user's next reply. Roadmap Phase 23.A is the targeted fix.

**Design decisions:**

- **Capture `SystemTime::now()` alongside `Instant::now()` on first chunk.** Wall-clock and monotonic-clock samples aren't derivable from each other; reviewer caught a spec bug that would have stamped wall-clock from elapsed-time math.
- **Pre-existing artifact ids stay broken.** A one-time projector re-stamp sweep is a separate workstream; the cost of half-correcting (some flushes new, some old) wasn't worth gating the live fix on.

**Technical decisions:**

- **`uuid::Timestamp` as the captured type**, not a raw `SystemTime`. The `Uuid::new_v7(uuid::Timestamp)` API is the actual `uuid` 1.x surface (a reviewer flagged the original spec called a non-existent `new_v7_with_timestamp`).
- **Capture outside the lock** so the timestamp reflects when the broadcast event was *read* by the recv-task, not when the lock was acquired. Latency variance under contention disappears from the ordering.
- **`first_seen_artifact_id_preserves_millis`** test pins the helper round-trip explicitly. ms-level precision is what the ordering uses; sub-ms lives in random lower bits and is irrelevant.

**Tradeoffs discussed:**

- **Backfill old ids (rejected) vs. only-new-flushes-correct (chosen).** A projector pass at boot to re-stamp old artifacts would un-jumble historical scrollback but adds replay cost on every launch and risks drift if the projection logic ever changes. Defer; revisit if dogfood reports it.
- **Tight ±2ms vs ±10ms test tolerance.** ±2ms reads cleaner but flakes under CI contention. The structural assertion (≥100ms gap from flush time) carries the test's load; widening the wall-clock tolerance trades nothing meaningful.

**Lessons learned:**

- `Instant` and `SystemTime` are different physical clocks. When a feature needs both monotonic ordering and wall-clock stamping, capture both — don't try to derive one from the other.
- UUIDv7's monotonicity is its load-bearing property; any code that mints them at a moment that isn't "first-seen" silently breaks downstream sorts. Worth a comment at every `Uuid::new_v7` call site naming the moment.

---

### Phase 23.C — tool-use rows expand to full payload
**Date:** 2026-05-03
**Branch:** chat-tool-expand
**Commit:** PR #92 (94da44d4)

> _Backfilled 2026-05-03 from PR body (PR #96); **not spot-checked against the session transcript**. Round-1 / round-2 reviewer findings are visible in the PR body; the 40-line cap rationale, per-mount cache shape, and "Tradeoffs discussed" framing below are likely implementation-agent decisions, not transcript-recorded user direction._

**What was done:**

`ToolUseLine` (`packages/app/src/blocks/blocks.tsx`) used to expand to a single extra summary line — barely more than the collapsed view. It now fetches the full payload via `getArtifact(id)` on first expand, caches per-mount (deduped via in-flight ref so a fast double-click is a single IPC call), and renders `payload.body` as a monospace `<pre>` under the head. >40 lines truncates with a "Show full (N more line[s])" disclosure that drops the cap.

Closes friction `frc_019dea67` (tool-use rows feel decorative without a way to drill into evidence).

Round-1 review caught unmount-after-fetch + cache lifetime + missing in-flight affordance; round-2 dropped the speculative `font-style: italic` (axiom-disputed) and stopped using a console warning React 18+ has silenced as the unmount-safety test signal — replaced with a `toHaveBeenCalledTimes(1)` assertion.

**Why:**

Phase 23.C from the roadmap. The terse `· read foo.rs` line is correct as the default, but expand-on-click was promised by the layout and broken in practice — clicking only revealed a one-line summary that didn't add evidence.

**Design decisions:**

- **40-line truncation cap with a single explicit "Show full" disclosure.** "Typical terminal viewport" is the heuristic, with a dogfood revisit hook captured in the spec. Pluralization fixed in the disclosure label ("1 more line" / "N more lines").
- **Loading copy is a muted "Loading output…" affordance**, not a spinner or skeleton. The IPC round-trip is fast in the typical case; a heavier state would over-claim.

**Technical decisions:**

- **Per-mount cache + in-flight ref** so concurrent expands of the same row collapse to one IPC call. Cache is intentionally not persisted across remounts — the artifact id is monotonic so re-fetching on remount is fine.
- **`mountedRef` guard**, but reordered: the ref initializes to `true` at the definition site and the cleanup useEffect now only does cleanup. Avoids a redundant `mountedRef.current = true` set that the round-2 reviewer caught.

**Tradeoffs discussed:**

- **Inline expand vs. open-in-overlay (chosen inline).** Overlay would handle very long payloads better but breaks the chat-flow reading model. Truncation + disclosure is the right shape for a chat surface; long payloads are rare for tool-use bodies.
- **Visual chevron / hover-fill on the head (rejected here).** Adding a discoverability affordance changes the visual register the roadmap explicitly asked for ("compact one-line"). Park as 23.C.f1; revisit if dogfood surfaces "I didn't know I could click."

**Lessons learned:**

- `aria-live` on the inner `<pre>` re-reads the full content as it grows. Hoist `role="region"` + `aria-live="polite"` to the wrapper and let `aria-busy` carry the transient signal — done in the immediate follow-up (PR #94) but worth pre-empting in any future expand-on-fetch component.
- Test signals shouldn't depend on framework warnings the framework can suppress between versions. Pin the structural assertion ("the promise resolved with the right call count") instead.

---

### Phase 23.D — keep WorkspaceThread mounted across tab switches
**Date:** 2026-05-03
**Branch:** chat-tab-remount
**Commit:** PR #90 (3a77c725)

> _Backfilled 2026-05-03 from PR body (PR #96); **not spot-checked against the session transcript**. The two BLOCKERs (`hasStarted` staleness, `initialPaint` re-arm) are visible in the second review pass on the PR; the "ship-with-follow-up" decision is recorded in the PR body as the implementing agent's recommendation. Whether the user actively chose ship+followup vs scope-expand in-session is unverified — what's grounded is that PR #93 followed the next morning._

**What was done:**

`MainView.tsx`: dropped `activeTab` from the React `key` on `<WorkspaceThread>` so the component instance survives tab switches. The previous key forced React to unmount + remount the entire thread on every switch, tearing down the artifact-stream listener, in-flight payload fetches, scroll position, and per-tab expanded-block state. Live agent updates that landed while a user was on a sibling tab were lost — surfaced to the user as "I send a message and leave the tab, the agent stops" (it didn't; the listener did).

The `refresh` callback already depended on `[workspace.id, tabId]`, so re-fetch on tab change was wired and didn't need to change. Per-tab state is keyed internally by `stateKey`.

T-23D-1..4 acceptance tests added in `tabs.test.tsx`. Relaxed one assertion in the existing `frc_019de703` draft-preserved test that was over-specified to the old remount semantics.

The PR shipped with two BLOCKERs flagged on the second review pass and explicitly deferred to a follow-up: `hasStarted` lazy-initializer staleness on fresh sibling tabs, and `initialPaint` animation gate not re-arming on switch. Both fixed in PR #93 (Phase 23.D follow-up).

**Why:**

The task brief explicitly scoped this PR as "one prop change in MainView plus tests." The architectural correction (kept-mounted) was the right primitive; the per-tab-state cleanups are the consequences and were appropriately a separate change.

**Design decisions:**

- **Ship the architectural primitive even with follow-up regressions captured.** The alternative was to delay until ~6 more lines passed three more reviews, blocking dogfood from getting the live-update fix. The user accepts subtraction passes that yield simpler code; here it's an addition pass that intentionally paused at the brief boundary.

**Technical decisions:**

- **Drop `activeTab` from the key only.** `workspace.id` stays in the key — switching workspaces still tears down because the underlying data identity has changed.
- **T-23D-2 dispatches a synthetic `artifact_created` event via a patched `stream`.** A real test where the Rust core emits a live artifact mid-tab-switch would be a stronger guarantee; lands naturally with Phase 23.E (per-tab Claude subprocess).

**Tradeoffs discussed:**

- **Expand scope here (~6 lines for the BLOCKERs) vs. ship + follow-up (chosen).** Documented the recommendation in the PR body; user direction landed via PR #93 immediately after.

**Lessons learned:**

- React key changes are surgical primitives but leak per-mount state assumptions all over the component tree. After every key tightening, audit `useState(() => ...)`, `useEffect(() => ..., [])`, and any ref initializer that reads external state.
- The `frc_019de703` test was a good signal — it had been written against the old remount semantics and started failing on the new key. Relaxing it (rather than fixing it to match) was the right call because round-trip preservation is what the test is supposed to prove, not the specific remount mechanism.

---

### Phase 23 plan — Chat UX hardening
**Date:** 2026-05-03
**Branch:** chat-ux-phase
**Commit:** PR #89 (7263af51)

> _Backfilled 2026-05-03 from PR body (PR #96); **not spot-checked against the session transcript**. Two real spec bugs (uuid API call, `SystemTime`/`Instant` capture) caught by the staff-engineer pre-merge review are visible in the PR body; the per-tab subprocess "Phase 19/20/22.A precursor" framing and the wave-sequencing rationale are likely planning-agent inference, not transcript-recorded user direction._

**What was done:**

Docs-only. Added **Phase 23 — Chat UX hardening** to `core-docs/roadmap.md` with five sub-phases (23.A–E), acceptance tests, and a Wave 1 / Wave 2 / Wave 3 sequencing model. `core-docs/plan.md` Current Focus flags Phase 23 as the active dogfood-blocking body of work. Milestones table entry added.

Sub-phases:
- **23.A** — coalescer first-token timestamp (`core_agents.rs` only).
- **23.B** — activity indicator in compose dock + tab strip.
- **23.C** — tool-use rows expand to full payload (`blocks.tsx` + CSS).
- **23.D** — tab-switch keeps thread mounted (`MainView.tsx` single-line key change).
- **23.E** — per-tab Claude subprocess (touches `core_agents.rs` + `claude_code.rs`).

**Why:**

PR #87 stripped the experimental agent-teams framing and closed four friction reports. Same-day dogfood on the now-plain chat surface surfaced the next regression layer: tool-use rows render after the agent text + user reply (coalescer flush-time stamping), tab switching tears down the artifact-stream listener (key change), and one Claude subprocess per workspace means tabs share a session — confusing both the model and the user.

The per-tab subprocess shape is the architectural correction Phase 19 (multi-track), 20 (parallel-work coordination), and 22.A (roadmap canvas) were always going to need; treating tabs as the dispatch boundary today saves re-litigating it later.

**Design decisions:**

- **Wave-based sequencing.** Wave 1 (23.A + 23.C + 23.D) is file-disjoint and dispatches in parallel. Wave 2 is solo (23.E touches `core_agents.rs` and conflicts with 23.A). Wave 3 (23.B) follows 23.E because its activity event carries `tab_id`. Conservative serialization on the Wave 2 boundary — engineer reviewer pushed back claiming 23.A and 23.E are disjoint within `core_agents.rs`, but rebase churn is more expensive than two-day delay.
- **Read-only activity indicator in v1.** Designer can't yet interrupt claude mid-turn over the stream-json protocol, so 23.B ships without a Stop button. The "honest read-only" framing is captured as an explicit known tradeoff; revisit if dogfood surfaces "I see it working but can't act."
- **Tab-strip badge (added during review).** The per-tab compose-dock indicator alone left the user invisible to background-tab activity, re-creating the "stops responding" friction. Background activity must be surfaced at-a-glance.
- **User-facing copy translation.** Backend states (`Idle / Working / AwaitingApproval`) leaked into UI copy in the spec; rewritten as "Working… {elapsed}", "Approve to continue", etc.

**Technical decisions:**

- **`OrchestratorEvent::ActivityChanged` is broadcast-only-additive** and not subject to ADR 0002's `EventPayload` freeze. Pattern-log precedent entry to land alongside 23.B.
- **`SystemTime::now()` captured alongside `Instant::now()` on first-chunk** in 23.A — they're not derivable from each other.
- **Subprocess death emits Idle** in the 23.B translator spec so a crash doesn't leave a phantom "Working" indicator.
- **Tab-idle subprocess GC deferred.** Per-tab claude subprocesses run ~50–200 MB; idle tabs would burn memory indefinitely without a kill policy. Spec acknowledges; revisit when dogfood surfaces it.

**Tradeoffs discussed:**

- **Treat tabs as dispatch boundary now vs. later (chosen now).** Phase 19 / 20 / 22.A all depend on per-tab dispatch eventually. Migrating after dogfood-trained habits form is more painful than getting the model right while the chat surface is the only consumer.
- **Run a staff-perspective review on a docs-only PR (chosen yes).** The skill normally skips docs-only diffs; for a planning doc that three parallel agents will dispatch off, getting an architectural sanity check first is worth the overhead. Two real spec bugs and several clarity gaps landed.

**Lessons learned:**

- A docs-only PR can be the highest-leverage review surface in a phase because it locks the contract for all the implementation PRs that follow. The two spec bugs caught here (uuid API call, `SystemTime`/`Instant` capture) would have cost real implementation time.
- Background-tab activity is a UX requirement, not a "nice to have" — the per-tab indicator alone reproduces the original symptom. Worth a default-on-tab-strip-badge invariant for any future per-tab signal.

---

### /release skill — codified release workflow
**Date:** 2026-05-02
**Branch:** release-skill
**Commit:** PR #88 (2ed58778)

> _Backfilled 2026-05-03 from PR body (PR #96); **not spot-checked against the session transcript**. Staff-engineer review findings (race condition in `gh run watch`, semver heuristics) and UX-designer review findings (confirmation gate, PR-body preview) are visible in the PR body; the "skill that stops short" shape characterization and "user owns the moment of release" framing are likely implementation-agent voice, not transcript-recorded user direction._

**What was done:**

Project-local skill at `.claude/skills/release/SKILL.md` codifying the v0.1.x release workflow. Pre-flight readiness sweep (working tree, CI, version drift, last tag, commits since, open PRs, friction, crashes); GO/HOLD with explicit user confirmation before bumping anything. Bumps the three version sources (`Cargo.toml`, `apps/desktop/src-tauri/tauri.conf.json`, `packages/app/package.json`) + refreshes `Cargo.lock`, drafts the PR title + body, **previews before push**.

Hands back a paste-ready terminal snippet for `git tag` + `git push` + `gh run watch`, plus links to the workflow runs page, releases page, and live release URL. **Stops short of tagging** — the user owns the moment of release.

**Why:**

Each Designer release touches three version files and follows a bespoke sequence (PR-first, then tag, then watch the release workflow that signs/notarizes/publishes the DMG + `latest.json`). Without a skill, every cut re-derives the same sequence from `core-docs/history.md` archaeology and re-discovers the same gotchas (race condition in `gh run watch` immediately after tag-push; need to wait for the bump-PR's own CI before merging).

**Design decisions:**

- **User owns the moment of release.** Skill stops at "here's the snippet; paste when ready." Tagging is an irreversible-shared-state action (PRs get cut against the tag, the auto-updater starts serving the DMG, etc.), so the human stays in the loop. Matches the project's "Suggest, do not act (by default)" principle.
- **Pre-flight summary as a table, not a wall of text.** Ordered by gating priority; friction/crashes only shown when notable. Folds the UX-designer review's "wall-of-text risk" finding.
- **Confirmation gate is explicit.** "Pause. Do not proceed without confirmation" between pre-flight and version bump — folded from the UX-designer review of step 1 → 2 ambiguity.
- **PR body preview before push.** Folded from the UX-designer review — the user wants to see the title + body before the PR exists.

**Technical decisions:**

- **`sleep 10` before `gh run watch`** so the release workflow's run record exists by the time the watcher starts. Without it the watcher attaches to the previous release run and exits "successful" while the real run is still queueing.
- **0.x semver heuristics for minor vs patch** are listed in step 2 (signals: new features = minor, bug fixes only = patch). Avoids re-deriving the call each release.
- **Verification hint** uses friendlier copy: "quit and relaunch to force a fresh updater check" before the log-file fallback. Folded from UX review.

**Tradeoffs discussed:**

- **Auto-tag (rejected) vs. user-tags (chosen).** Auto-tagging was the alluring shortcut. The user's principle that the release is "their moment" — and that the auto-updater begins serving immediately on tag — argues for keeping the human-in-the-loop hand-off explicit.

**Lessons learned:**

- A "skill that stops short" is a real shape. The `/release` skill does ~80% of the work and hands back a paste-ready snippet — the user reads, pastes, and owns the irreversible step. Worth using this shape elsewhere when the action is irreversible-shared-state.
- One staff-engineer reviewer claim about PR #85 having 7 files was incorrect — three (`vite.config.ts`, `vite-env.d.ts`, `AppDialog.tsx`) are now permanent infrastructure, not part of every release. Called out explicitly in step 3 so future runs of the skill don't expand the bumped-files list.

---

### Bulletproof basic chat + workspace archiving
**Date:** 2026-05-02
**Branch:** friction-triage-19
**Commit:** PR #87 (13911a7a)

> _Backfilled 2026-05-03 from PR body (PR #96). Rationale framing is agent-authored except where tied to a named staff-review finding, named commit, or quoted user direction. Spot-check 2026-05-03: archiving paired in one ask is **grounded** (user: "Archiving workspaces should also be in this PR because that's core functionality"); confirm-copy fix was a real UX-review catch; the "chat-philosophy memory FB-0001" attribution and the "subtraction beats flag-hiding" framing are **agent inference** (the user said "shouldn't do crazy things on top of CC" — the philosophy anchor is retroactive)._

**What was done:**

Two coupled subtraction passes:

1. **Stripped the experimental agent-teams framing from default chat.** `build_command` no longer sets `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, `--teammate-mode in-process`, `--include-partial-messages`, or `--disallowedTools AskUserQuestion`. `spawn_team` skips the team-creation bootstrap prompt entirely. `build_message_prompt` returns the body verbatim — no `Message from user:` wrapper. `build_spawn_prompt` and its tests deleted; new `message_prompt_passes_body_through_verbatim` test added. New chat sessions use `lead_role: "assistant"`; existing persisted `team-lead` artifacts still humanize correctly.

2. **Workspace archiving.** Soft-archive (recoverable, reuses `WorkspaceStateChanged`), restore, and hard-delete (new `WorkspaceDeleted` event — additive). `AppCore::archive_workspace`, `restore_workspace`, `delete_workspace` (idempotent; archive shuts down the orchestrator session). `WorkspaceSidebar` gets a per-row archive button (hover-revealed) and a collapsible Archived section pinned to the bottom with Restore + Delete actions; Delete prompts for confirmation.

Closes friction `frc_019dea66` (new chat doesn't continue answering), `frc_019dea67` (tool-use lines + agent goes silent), `frc_019dea69` (consistently stops responding), `frc_019dea6a-0f1d` (no way to close/archive workspaces).

**Why:**

Designer was opting into Claude Code's experimental agent-teams feature and re-framing every user turn as a meta-message *to a team lead*. Symptom: the lead replies once, dispatches a tool-search subagent, then goes silent — exactly what the friction reports describe. Designer's stated chat philosophy (memory FB-0001, project memory FB chat-philosophy) is pass-through CC by default; this PR makes the implementation match. Multi-agent dispatch goes back on the roadmap behind a future opt-in.

Workspace archiving was core sidebar functionality the user asked for in the same pass — workspaces couldn't be removed at all before, so the sidebar grew indefinitely.

**Design decisions:**

- **Soft-archive + hard-delete, not single-action delete.** Archive is the safe default (recoverable; events stay on disk; only access goes away). Delete is explicit + confirmed. Confirm copy rewritten to "Its chat will no longer be accessible." per UX review (the original "Chat history will be lost" was wrong because events stay on disk).
- **Empty-state surfaces archived list when present.** Original "No workspaces yet" hid archived items behind a misleading message; UX review flagged it.
- **`window.confirm` on Delete (deferred refactor to a designed primitive).** A generalized `ConfirmDialog` doesn't yet exist (`AppDialog` is hard-wired to the help dialog). Tracked as a follow-up workstream rather than blocking the friction fix on a primitive extraction.
- **Hover-only reveal of row actions.** Has a keyboard path via `:focus-within` but no persistent visual cue for AT users — flagged as a follow-up UX pass.

**Technical decisions:**

- **`WorkspaceDeleted` orphans tracks/artifacts tied to the workspace id.** Acceptable in v1 (UI never walks the orphans; event log retains them for audit). Would matter if a "recently deleted" recovery surface lands later.
- **`archive_workspace` shuts down the orchestrator session** so claude doesn't keep ticking on an archived workspace.
- **`@media (prefers-reduced-motion: reduce)` rules disable** `.workspace-row__actions` and `.sidebar-group__head--toggle` transitions — caught by the design-engineer review.
- **Token hygiene: `1px` hairline → `var(--border-thin)`.** Caught by `tools/invariants/check.mjs`.

**Tradeoffs discussed:**

- **Hide-behind-flag the agent-teams strip (rejected) vs. rip it out (chosen).** The teams framing was actively breaking dogfood; flag-hiding would have left dead code paths and ambiguity about the canonical chat shape. Subtraction is simpler and more honest. Multi-agent dispatch as an explicit opt-in is the future shape, not the buried-default shape.

**Lessons learned:**

- The chat-philosophy memory ("pass-through CC by default; only intercept where Designer's core value prop demands it") is load-bearing — every subsequent chat-surface decision falls out of it. Worth re-reading before any chat PR.
- A subtraction pass is the right tool when an experimental capability is masking the canonical shape. The friction reports were unanimous: the symptoms all stemmed from one experimental knob being on by default.
- Mini-procedure deliverables (generation-log, pattern-log, component-manifest) for behavioural changes — design-engineer review caught they were missing here. Worth a default-on procedure check in any UI-touching PR template.

---

### CI: bump GitHub Actions to Node 24 runtime
**Date:** 2026-05-02
**Branch:** node24-actions-bump
**Commit:** PR #86 (7dcd8003)

> _Backfilled 2026-05-03 from PR body (PR #96); **not spot-checked against the session transcript**. The June 2 / September 16 GitHub deprecation deadlines and the action-version table are factual; the rejection of `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` cites linked GitHub-Actions issue references in the PR body. The "no version drift in `release.yml`" framing is likely implementation-agent voice._

**What was done:**

GitHub deprecated Node 20 on Actions runners. Hard deadlines: June 2 2026 runners default to Node 24 for JS actions; September 16 2026 Node 20 removed entirely. This PR bumped every deprecated action to its first major version with `runs.using: node24`. No job-structure, runner-label, secret, concurrency, or matrix changes — version bumps only.

| Action | Before | After |
|---|---|---|
| `actions/checkout` | `@v4` | `@v5` |
| `actions/setup-node` | `@v4` | `@v5` |
| `actions/cache` | `@v4` | `@v5` |
| `actions/upload-artifact` | `@v4` | `@v6` |
| `actions/github-script` | `@v7` | `@v8` |

Untouched: `Swatinem/rust-cache@v2` and `tauri-apps/tauri-action@v0` (already Node 24 since v2.9.0 / v0.6.0; floating tags); composite/Rust-binary actions with no Node runtime.

Six workflow files: `ci.yml`, `supply-chain.yml`, `release.yml`, `claude-live.yml`, `claude-probe.yml`, `regenerate-visual-baselines.yml`.

**Why:**

Every CI run was emitting "Node.js 20 actions are deprecated…" warnings. The June 2 hard deadline forces a default Node 24 runtime; the September 16 deadline removes Node 20 entirely. Bumping action versions is the supported fix; the `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` opt-in is a test-the-waters knob with known drift between what the action expects and what it gets.

**Design decisions:**

- **No version drift in `release.yml`.** Critical-path workflow (Apple cert import, notarytool, Tauri minisign, `latest.json` publishing); only `actions/checkout` + `actions/setup-node` lines moved. `tauri-action@v0` floats to Node 24 already, so deliberately not touched.
- **`actions/upload-artifact@v6` chosen over `@v7`.** v7 only adds an `archive: false` flag we don't use; v6 is the first Node-24 major and is enough.

**Technical decisions:**

- **`setup-node@v5` breaking-change check.** `always-auth` input removed (not used); auto-npm-caching when `package.json` has a `packageManager` field (verified via grep that no `package.json` in the tree has this field). Behavior identical.
- **`node-version: '20'` left alone.** This is the target Node version for `npm ci` / build, not the action's runtime. Per the task brief.

**Tradeoffs discussed:**

- **Set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` (rejected) vs. bump action versions (chosen).** The env var is a test-the-waters opt-in that doesn't fix the underlying deprecation and has known drift. Bumping the action versions is the supported fix.

**Lessons learned:**

- Floating major tags (`@v0`, `@v2`) on third-party actions silently track upstream — verified that `Swatinem/rust-cache@v2` and `tauri-apps/tauri-action@v0` are already Node 24 without any pin. Worth knowing for any "are we on the deprecated runtime" sweep.
- Self-hosted runners need to be on actions runner ≥ `v2.327.1` for Node 24; verified by the `claude-live` job passing with the new action versions.

---

### Version bump 0.1.1 → 0.1.2
**Date:** 2026-05-02
**Branch:** version-bump-0.1.2
**Commit:** PR #85 (657fabad)

> _Backfilled 2026-05-03 from PR body (PR #96); **not spot-checked against the session transcript**. The drift between the three version sources is factual (the `packages/app/package.json` 0.1.0 → 0.1.2 jump is in the diff); the "three sources are two too many" follow-up framing is implementation-agent inference, not transcript-recorded user direction._

**What was done:**

Bumped workspace + Tauri bundle version `0.1.1` → `0.1.2` for the next release. Synced `packages/app/package.json` from a stale `0.1.0` to `0.1.2`.

**Why:**

15 commits / ~9k LOC had landed on `main` since `v0.1.1` (per-tab thread isolation, settings split, friction loop polish, test floor, model selector, performance budgets). Nothing breaking — natural patch bump.

**Technical decisions:**

- **Three version files in lockstep:** `Cargo.toml`, `apps/desktop/src-tauri/tauri.conf.json`, `packages/app/package.json`. The `/release` skill (PR #88) was authored in part to codify this trio so future cuts don't drift again. `packages/app/package.json` had silently drifted to `0.1.0` while the workspace was at `0.1.1` — caught by the audit and brought current.

**Lessons learned:**

- Three version sources are two too many. The `/release` skill is the workaround; a longer-term fix would be a single source of truth. Captured as an implicit follow-up — not yet a roadmap item because it's a paper-cut, not friction.

---

### Roadmap promotion — Phase 22.N (Merge queue) + 22.N.1 (UI craft)
**Date:** 2026-05-02
**Branch:** merge-queue-plan
**Commit:** PR #84 (e2209b54)

> _Backfilled 2026-05-03 from PR body (PR #96); **not spot-checked against the session transcript**. Two staff-perspective review passes on the spec are referenced in the PR body; the v1/v2 escape-hatch decisions, the differentiator-vs-existing-tooling framing, and the "Decision N" / ADR cross-references are spec-author judgment recorded in the gitignored spec — not transcript-recorded user direction._

**What was done:**

Docs-only. Added **Phase 22.N — Merge queue** and **Phase 22.N.1 — UI craft + Tier-2 → 22.E migration** to `core-docs/roadmap.md`. Roadmap promotion of a planning spec that went through two staff-perspective review passes; spec lives gitignored at `.context/specs/phase-22n-merge-queue.md`.

The merge queue is a project-scoped sequential merge train that resolves textual + semantic conflicts between parallel-completed PRs, surfaced through a project-level tab.

**Why:**

Phase 20 prevents most conflicts via partition-before-fan-out; the merge queue resolves the residual conflicts that occur anyway, or that occur when Phase 20 wasn't applied (the dogfood case). Complementary, not redundant. Differentiator vs. existing tooling (GitHub merge queue, Mergify, Graphite, Composio agent-orchestrator, Overstory): **cross-PR context briefing for the resolution agent + manager surface + PR-identity preservation** (resolution lands as one attributed commit on the original branch; no meta-PRs).

**Design decisions:**

- **Phase split: 22.N is backend + queue logic + minimal tab; 22.N.1 is full in-app drill-in + craft.** Sequential FIFO in v1 with three v2 escape hatches frozen in the v1 data model so v2 reads with zero migration: `base_ref`, `BranchTarget`, `TestRunRecord` keys. Inline Tier-2 approval `<Frame>` in v1; no in-app drill-in (manager uses "Open PR" → GitHub).
- **Conflict-marker scope only.** Pre-write gate restricts agent edits to `<<<<<<<` / `=======` / `>>>>>>>` regions; out-of-marker edits fail the gate. Bounds the resolution agent's blast radius.
- **No force-push.** Resolution lands via `git push`; force-push rejected by invariant check. Preserves PR identity and review trail.
- **Single-Designer-instance v1 assumption.** Multi-instance lease coordination deferred to v1.x.
- **Cost rolls into existing CostTracker per-workspace lanes.** Queue tab cost chip is an aggregate filter view; no multi-lane extension; no double-counting.
- **State-pip palette reuses existing semantic + neutral scales.** Zero new scales introduced.

**Technical decisions:**

- **Briefing payload forward-extensibility** follows the same rule as `EventPayload` per ADR 0002 — additive-only, `Option<…>` for new fields, no removals without ADR.
- **14 new `QueueItem*` event variants** + additive `Anchor::QueueItem` extension (per the Lane 0 ADR addendum).
- **Hard gates: 13.E + 13.G + 20 + 22.A. Soft gate: 22.E.** 22.N.1 gates: 22.N + 22.E.
- **ADR 0007 — Merge queue architecture** referenced as a follow-up doc to be drafted at implementation time.

**Tradeoffs discussed:**

- **Build a merge queue (chosen) vs. defer to GitHub's** (rejected). GitHub's queue handles sequencing, not semantic resolution; the differentiator is the cross-PR briefing payload + manager surface.
- **One bundled phase (rejected) vs. 22.N + 22.N.1 split (chosen).** First reviewer pass landed at "agree with caveats"; v3 split closes the caveats by pulling the craft + drill-in + 22.E migration into a follow-up that gates on 22.E, leaving 22.N independently shippable.

**Lessons learned:**

- Two staff-perspective review passes before promoting a spec to roadmap caught real load-bearing decisions that would have been costly to reverse mid-implementation (PR-identity preservation, no force-push, conflict-marker scope). Worth running on any phase that adds new event variants or changes a hot-path UI.
- Locking forward-extensibility hooks in v1 data model (the three escape-hatch keys) is cheap when the v2 shape is at all foreseeable. No-migration v1 → v2 reads are the payoff.

---

### Per-message model selection — frontend selector wired through to Claude CLI
**Date:** 2026-05-02
**Branch:** release-review
**Commits:** local; not yet PR'd

**What was done:**

The composer's Model dropdown (Opus 4.7 / Sonnet 4.6 / Haiku 4.5) is now real — picking a model and sending respawns the workspace's Claude subprocess with the matching `--model` argument. Conversation history survives the swap because session ids are workspace-derived (UUIDv5), so Claude resumes the same session under the new model.

Concretely:

- `TeamSpec.model: Option<String>` — additive, per-team Claude CLI model override.
- `PostMessageRequest.model: Option<String>` — additive, per-message identifier from the frontend.
- `ClaudeCodeOrchestrator::build_command` accepts a model override that beats the orchestrator default when present.
- `AppCore::team_model_by_workspace` tracks which Claude CLI model the current team was spawned with; `team_model()` / `set_team_model()` are the read/write helpers.
- `core_agents::post_message` takes a `model: Option<String>` parameter. When the requested model differs from what the workspace's team is running, it calls a new `spawn_workspace_team(workspace_id, model)` helper to respawn before dispatching the message.
- `frontend_model_to_claude_cli` maps `opus-4.7 → claude-opus-4-7`, `sonnet-4.6 → claude-sonnet-4-6`, `haiku-4.5 → claude-haiku-4-5`. Unknown identifiers fall through to the orchestrator default (no-op).
- Frontend: `WorkspaceThread.onSend` passes `payload.meta.model` through to `ipcClient().postMessage`. ComposeDock un-gated — Model + Effort selectors render unconditionally; the `show_models_section` flag now only gates the placeholder Settings → Models pane.
- Five new tests pin the contract: Rust `frontend_model_mapping_is_locked` (frontend ↔ CLI mapping), `post_message_with_model_records_team_model` (lazy-spawn pins model, same-model post is no-op, switch respawns), `post_message_without_model_leaves_team_model_unset` (legacy-path unchanged); frontend `forwards the user's selected model on postMessage` (Haiku reaches the IPC), `omits a model when the default selection is in effect` (default opus-4.7 still rides along — the no-op path).

**Why:**

Closes friction `frc_019de705` ("got this error when I switched to Haiku") with a real fix instead of the hide-behind-flag stopgap proposed during the release review. The user explicitly wanted the cheap-model option for testing — burning Opus tokens during round-trip / regression iteration is wasteful when the user isn't evaluating model quality, just that the path works. Model selection is also the simplest demonstration that Designer's chat surface respects per-message preferences without intercepting Claude Code's own model-routing semantics.

**Design decisions:**

- **Per-team `TeamSpec.model`, not per-message.** Claude Code accepts `--model` once at process start; there is no in-session mid-stream swap. Plumbing a per-message field into `TeamSpec` would be a contract lie. The user-visible behavior is per-message because the UI exposes it that way, but the runtime mechanism is per-team-with-respawn-on-change.
- **Switching models = respawn the subprocess.** `kill_on_drop(true)` on the prior `Child` makes the kill synchronous; `spawn_team`'s `insert` overwrite drops the stale handle. Empirically the round-trip is fast enough that a model-switch doesn't feel laggy — comparable to one fresh chat message.
- **Sessions resume on respawn.** The session id is `Uuid::new_v5(SESSION_NAMESPACE, workspace_id)` — deterministic per workspace, not per process. Claude Code persists session state to `~/.claude/sessions/`, so a respawn under a new model picks up the same conversation. The user's mental model is "switch model and keep talking," and the implementation honours it.
- **Always pass `meta.model` through, even when it matches the running team.** The backend detects the no-op case (`team_model() == Some(requested)`) and skips respawn. Frontend stays simple; backend owns the comparator.
- **Keep `show_models_section` as the gate for the Settings → Models pane.** The pane is still placeholder — model defaults / per-project preferences haven't been designed yet. The composer selector is the per-message override that most users want today; the pane is the future "set the workspace default" surface.

**Technical decisions:**

- **`spawn_workspace_team` extracted as a helper** that both the lazy-spawn path (`TeamNotFound` / `ChannelClosed` recovery) and the model-mismatch path call. Keeps `cwd` resolution and `set_team_model` side-effects in one place; the recovery and switch paths can't drift apart.
- **`frontend_model_to_claude_cli` is a pure function** so the mapping is testable in isolation. Locks the frontend-to-CLI translation as a single-line edit rather than scattered string manipulation.
- **Additive serde on both the IPC DTO and the orchestrator spec** — `#[serde(default, skip_serializing_if = "Option::is_none")]` everywhere — so legacy frontends and persisted specs decode unchanged. No ADR needed (per ADR 0002 addendum: additive event-vocabulary changes are free).
- **`team_model_by_workspace` lives on `AppCore`** alongside `last_user_tab_by_workspace`. Same lifecycle (cleared lazily; stale entries are harmless because the comparator falls back to "spawn" on `TeamNotFound`).

**Tradeoffs discussed:**

- **Hide selector behind flag (release-review's first instinct) vs. wire it for real.** The user explicitly chose the real fix: "this shouldn't be a difficult implementation." It wasn't (~150 LOC across the Rust crate boundary plus the frontend wire). The hide-via-flag move is the right release-prep instinct when implementation is non-trivial; when it's cheap, do the work. Captured as FB-0038.
- **Send `/model <name>` as a slash command vs. respawn the subprocess.** Claude CLI's native `--model` is a process arg, not a runtime command. The slash-command path would couple Designer to an undocumented Claude internal; the respawn path uses public CLI surface and resumes via the existing session mechanism. Respawn wins on portability and observability.
- **Per-message model in `TeamSpec` vs. global `ClaudeCodeOptions::model`.** Per-team scope is correct for the multi-workspace case — different workspaces can run different models concurrently. The global option still works as the orchestrator-wide default when a workspace has no team yet.

**Lessons learned:**

- The "hide it behind a flag" stopgap was the safe-by-default release move, but the user pushed back the moment the implementation was understood to be cheap. The discipline is: when proposing to hide a half-baked feature, also estimate the wire-it-for-real cost. If it's < 1 day, default to wiring.
- Existing test mocks that used `{...originalClient, ...overrides}` silently lost prototype methods on the `MockIpcClient` class instance. ComposeDock's new `getFeatureFlags()` call exposed the bug. Fixed in 4 spots inline, but the pattern should be replaced with a plain-object base or a builder helper. Captured as FB-0039.
- Locking the model mapping in a unit test is small (~10 lines) but high-leverage — it makes "add a new model variant" a single-test failure instead of a silent dispatch-as-default bug.

---

### Release v0.1.1 → HEAD multi-perspective review pass (release-prep)
**Date:** 2026-05-02
**Branch:** release-review
**Commits:** local; not yet PR'd

**What was done:**

A range-mode staff-perspective review of the cumulative diff from `v0.1.1` to `HEAD` — 13 PRs / ~8,018 LOC across 111 files / staging set for the next release. Three parallel reviews (staff engineer / staff UX designer / staff design engineer) ran against the saved diff. Findings triaged into BLOCKER / NIT / FOLLOW-UP.

Two original blockers fixed inline on `release-review`:

- **`RepoUnlinkModal.tsx:125` referenced undefined token `--color-text`.** The `<strong>` wrapping the repo path silently fell back to UA default — a dark-mode contrast regression that wouldn't show up in light-mode visual baselines. Replaced with the canonical `--color-foreground`. New in PR #78; introduced when the modal was authored.
- **AppDialog Help dialog had no path to Friction.** The "Ask the help agent" input was correctly removed in the dogfood push (no backing handler), but the dialog was left with only keyboard shortcuts + version — a user looking for help had nowhere to go. Added a "Report issues" section pointing at ⌘⇧F via a tokenized inline link (`.app-dialog__inline-link` — focus-visible, hover, tokenized colors), plus the missing ⌘⇧F entry in the keyboard shortcut list. Closes friction `frc_019de6ff`.

The third UX blocker (`frc_019de705` Haiku selector error) was first hidden behind `show_models_section`, then properly wired in the per-message-model entry above. The "hide first" move was the wrong choice once the user clarified the testing use case — entry above for the rationale.

A pre-existing test bug surfaced as collateral: `workspace-thread.test.tsx` used `{...originalClient, ...overrides}` to build IPC mocks, which silently drops prototype methods on the underlying `MockIpcClient` class instance. ComposeDock's new `getFeatureFlags()` call (added during the flag-gating pass, then kept after the model wiring) made the missing method explode. Fixed in 4 mock setups; deeper refactor to a plain-object base or builder helper deferred (FB-0039).

Friction status going into the review: 14 of 18 reports closed. End of session: all 18 effectively addressed (12 by direct PR fix during v0.1.1 → HEAD, 2 by the in-session release-prep, 2 already addressed but not previously cross-referenced).

Five files changed by the review pass: `RepoUnlinkModal.tsx`, `AppDialog.tsx`, `dialogs.css` (new `.app-dialog__hint` + `.app-dialog__inline-link`), `ComposeDock.tsx` (flag dance — added then removed), `workspace-thread.test.tsx` (mock fixes).

**Why:**

Designer is approaching its second release after v0.1.1 (which itself was the dogfood push). The user asked for a comprehensive pre-release review with explicit priority on chat reliability, tab function correctness, and friction-loop completeness. Range-mode review (against the tag, not a single PR) is the right shape for release-staging — there is no single PR to review; the staging set is the cumulative diff.

The three dead-token / half-baked-feature / broken-selector findings are exactly the class of issues that erode dogfood trust per FB-0036 ("no half-baked features in prod"). Catching them in a multi-perspective sweep before tagging is cheaper than catching them in friction reports after.

**Design decisions:**

- **Range mode is the right shape for release reviews.** A PR-mode review wouldn't fit — there's no single PR. A per-PR review of all 13 would dilute the lens. Reviewing the cumulative diff against the previous tag is the correct altitude: the reviewer sees the staging set as one unit, can spot cross-PR drift (e.g., the two dead tokens in different modals, only one introduced this window), and produces a single set of findings the user can act on before cutting.
- **Help dialog: link to Friction, don't add an in-progress ask agent.** The "Ask" input was removed correctly in the dogfood pass per FB-0036. Adding it back in any half-state would re-violate that rule. The right fix is a clear Report-issues path, since most users hit "help" because something feels off — and Friction is the channel for that.
- **Cancel default focus + tokenized danger remain the destructive-modal pattern.** RepoUnlinkModal's pattern (PR #78) holds; the `--color-text` fix is a token-correctness cleanup, not a pattern change.

**Technical decisions:**

- **`.app-dialog__inline-link` is a new tokenized class** rather than inline styles. The Help dialog's "Friction" trigger is a button (because clicking it should close the dialog and call `toggleFrictionComposer`), but it must read as a textual link inside flowing copy. The class enforces tokens: `--color-foreground` for resting, `--color-accent` for hover, `--border-thin` + `--color-accent` + `--focus-outline-offset` + `--radius-badge` for focus-visible. No raw px / hex / ms.
- **Did not fix the pre-existing `--color-danger` references** across `RepoLinkModal.tsx:168`, `CreateProjectModal.tsx:261`, `RepoUnlinkModal.tsx:136`, or `friction.css:94`'s raw `rgba(255,255,255,0.12)` hover. All pre-date v0.1.1; cleanup pass is its own PR (history entry on PR #78 already flagged this for follow-up).
- **Did not regenerate visual-regression baselines.** PR #79 ships infra; baseline PNGs need to be generated on the Linux CI runner (macOS local renders differ in Skia + fontconfig). Captured as a release-blocker question for the user, not a fix.

**Tradeoffs discussed:**

- **Hide model selector vs. wire it.** Initially hidden behind `show_models_section` as the safe release move. User pushed back: "this shouldn't be a difficult implementation." Reverted the hide and shipped the real wiring (entry above). The lesson: when a half-baked feature has a cheap real fix, hide-via-flag is the wrong stopgap. Captured as FB-0038.
- **Single review pass vs. per-PR sweep across 13 PRs.** Single pass wins on coherence and effort. The cost is that reviewer attention is amortized across the whole staging set; a single PR with subtle issues might get less attention than it would in PR mode. Trade is acceptable for release prep where the goal is "what's missing for the release" rather than "did each PR meet its bar."

**Lessons learned:**

- A test mock that spreads a class instance (`{...originalClient}`) drops prototype methods. The pattern survived multiple PRs because no test-setup code path needed prototype methods until ComposeDock added `getFeatureFlags()`. Worth capturing as FB-0039 + a future test-helper refactor.
- The dead-token sweep that PR #78's lessons-learned section flagged is still outstanding. Each new modal that copy-pastes the danger-styling pattern adds another `--color-danger` reference. The cleanup pass should also lock the tokens via an invariant in `tools/invariants/check.mjs`.
- The release-review model (range mode against the previous tag) was new this session and worked well. Codified into the staff-perspective-review skill — entry below.

---

### `staff-perspective-review` skill: branch + range modes
**Date:** 2026-05-02
**Branch:** release-review
**File:** `.claude/skills/staff-perspective-review/SKILL.md`

**What was done:**

The staff-perspective-review skill previously assumed an open PR and refused to run otherwise. Updated to support three modes based on git state:

- **PR mode** *(unchanged)* — PR open against the current branch. Review the PR's diff; on success, update the PR body with "Reviewer notes" and leave it open for the human reviewer.
- **Branch mode** *(new)* — no PR open but the branch is ahead of main. Review against `origin/main`; if reviews conclude the branch is ready (gates green, no unfixable blockers), `git push -u` and `gh pr create` with a full PR body (Summary, Test plan, Reviewer notes, Follow-ups).
- **Range mode** *(new)* — caller passes `--base <ref>` (e.g. `--base v0.1.1`). Review the range; summarise findings inline; do **not** open a PR. Used for release-staging reviews where the staging set spans many already-merged PRs and there is no PR to update.

The mode-detection step at the top of the workflow runs `gh pr list --head` + `git rev-list --count origin/main..HEAD` in parallel and picks the matching mode. Caller can override via `--base`. Diff base resolution: `<base>...HEAD` for PR/branch, `<tag>..HEAD` for range.

Three new gotchas codify hard-won lessons:

- **Don't open a PR with red gates.** If the human reviewer's first action would be "fix the failing build," the skill failed.
- **Confirm before auto-PRing on sensitive branches.** Branch names like `release-*`, `hotfix-*`, `v[0-9]*`, or diffs that touch release infra (`tauri.conf.json`, `Cargo.toml` version, GitHub Actions release workflows) need an explicit user OK before opening a PR.
- **Range mode: don't push fixes without explicit instruction.** Range mode is often run on a local `release-review` branch the user created for the survey. Pushing or auto-PRing there is rarely what they want.

The "Don't merge" guard restated for all three modes. Branch mode includes a new PR template (Summary / Test plan / Reviewer notes / Follow-ups) drawn from the style of recent merged PRs.

**Why:**

The original skill conflated "review the work" with "update the PR." The release-prep flow exposed the gap: there's no single PR for a release-staging review, and asking the user to fabricate one to satisfy the skill is process theater. Worse, branch-mode (work complete but no PR yet) was unsupported even though it's a common shape — the user finishes a workstream and the skill should be able to pick up from there.

**Design decisions:**

- **Mode detection over mode selection.** The user shouldn't have to remember to pass a flag — the skill infers PR vs. branch from `gh pr list`. Range mode requires the explicit `--base` arg because release-staging is the only intent for it (`gh pr list` would match a feature-branch PR otherwise).
- **Range mode never opens a PR.** Release prep is a survey, not a workstream. The findings are inputs to the user's release-cut decision, not a deliverable to be merged.
- **Branch mode gates PR-opening on review readiness.** Reviews can find blockers the agent fixes inline; they can also find FOLLOW-UPs that don't block opening but should be noted in the body. The skill draws the line at "would a human reviewer immediately bounce this back?" — if yes, stop and report; if no, ship the PR.
- **The "Don't merge" invariant holds across all modes.** PR mode leaves the PR open; branch mode opens but doesn't merge; range mode produces a written summary. The skill's value is the polish step before human review, not autonomous shipping.

**Technical decisions:**

- **Branch-name guards on `release-*` / `hotfix-*` / `v[0-9]*`.** These branches are sensitive enough that auto-PRing without confirmation would be surprising. The guard isn't paternalistic — it preserves user agency over the most consequential PRs.
- **`<base>...HEAD` (three dots) for PR/branch, `<tag>..HEAD` (two dots) for range.** The semantic difference matters: `...` is the symmetric difference (what's in the branch but not in main); `..` is the inclusive set of commits since the tag. Release reviewers want every commit since the previous tag, including those added via merges from main.

**Tradeoffs discussed:**

- **Auto-open PR in branch mode vs. always wait for user.** Auto-open wins because the review-then-PR sequence is the dominant workstream-completion shape; making the user manually open after a successful review adds friction. The sensitive-branch guard handles the genuinely-different cases.
- **Single skill with three modes vs. separate skills.** Single skill wins because the review machinery is identical across modes — only the input surface (diff base) and output surface (PR vs. summary) change. Three skills would duplicate the agent-spawn / triage / fix machinery.

**Lessons learned:**

- The first version of the skill encoded a workflow assumption ("PR exists") that was true 90% of the time. The remaining 10% — release prep, branch-completion — was where the skill silently failed. Encoding mode-detection at the top is cheap and saves the user from working around the skill.
- The PR-opening template needs to mirror recent merged PRs in style (short title, Summary as bullets, Test plan as checklist, Reviewer notes as the new section). Drift from that style means the human reviewer reads two different PR shapes and the skill's PRs feel foreign.

---

### Settings scope split + project unlink (RepoUnlinkModal + `cmd_unlink_repo`) SAFETY
**Date:** 2026-05-02
**Branch:** settings-scope-unlink
**PR:** #78

**What was done:**

A project-scoped **Disconnect repository** affordance lives in **Project Home → Repository** with a confirmation modal ("Designer will no longer track changes in `<path>`. Your repo files are not touched."). Fans out across every workspace in the project that has a linked worktree. Settings is now global-only — the previous Repository row in Settings → Account moved out. New `cmd_unlink_repo` IPC and an additive `WorkspaceWorktreeDetached` event (the inverse of `WorkspaceWorktreeAttached`); idempotent on re-call.

**Why:**

Two friction reports (`frc_019de6f7`, `frc_019de6fa`) — Settings was mixing global and per-project concerns, and there was no way to disconnect a repo without editing state by hand. Closes the friction loop and clears the way for further global-vs-per-project Settings work.

**Design decisions:**

- **Per-project surface lives on Project Home, not Settings.** Settings is global-altitude only (Decision 63 in `spec.md`). Anything tied to a single project lives on the project surface so the rule "Settings = chrome that applies everywhere" is enforceable by inspection.
- **Modal copy is reassuring, not technical.** "Your repo files are not touched" addresses the actual user fear (data loss); the path is shown for trust, not as a path-edit affordance.
- **Cancel is the default focus.** Destructive primary, safe default — matches the convention across the existing modals.

**Technical decisions:**

- **`WorkspaceWorktreeDetached` is additive, mirrors the Attached event.** The frozen contract (ADR 0002) takes additions, not changes. The detached event reuses the worktree-id payload shape so projection is symmetric.
- **Fan-out at the IPC layer, not the projection.** A project-level unlink iterates every workspace's worktree under the project and emits one detach per worktree. Idempotent on re-call so a partial failure is safely re-runnable.
- **Three Rust tests pin the contract:** emit-then-clear, idempotency on re-call, unknown-workspace error. Four vitests cover the modal flow (single-workspace happy path, Cancel skips IPC, fan-out across N workspaces preserves order).

**Tradeoffs discussed:**

- **Per-workspace unlink rows vs. one project-level button.** A row-per-workspace would surface fan-out cardinality but multiplies the destructive surface and clutters the Repository pane. The single project-level affordance keeps the surface clean; surfacing the count in the modal copy ("Disconnect from N workspaces") is a follow-up, not a blocker.
- **Rename `WorkspaceWorktreeAttached` to `…Linked` for symmetry vs. preserve the locked event name.** Frozen contracts win — additive only. The English asymmetry (Attached/Detached vs Linked/Unlinked) is a documentation concern, not a correctness one.

**Lessons learned:**

- Three modals reference `--color-danger`, which is not a canonical token (the canonical scale is `--danger-3..12`). Pre-existing across the codebase; flagged as a one-pass cleanup separate from this PR rather than fixed inline. Drift like this accumulates when modal patterns get copy-pasted.
- The destructive-default-Cancel pattern was inconsistent across the existing destructive modals; codifying it here means the next destructive surface inherits the right default focus.

---

### Polish bundle: Enter-to-send, pulse gating, friction file drop + submit
**Date:** 2026-05-02
**Branch:** polish-bundle
**PR:** #76

**What was done:**

Four file-disjoint polish fixes from open friction reports, bundled because the surfaces don't overlap and each is under an hour.

- **Return-to-send.** ComposeDock sends on plain Enter; Shift+Enter inserts a newline. ⌘↵ kept as a muscle-memory alias.
- **Activity-dot pulse gating.** State dots used to pulse forever once a workspace flipped to `state="active"`. They now pulse only while the stream has had a recent event in an 8s window — new `recentActivityTs` map in `dataStore` + `useRecentActivity` hook applied to `WorkspaceSidebar`, `ActivitySpine`, and `HomeTabA`.
- **Friction file drop.** Drop zone lifted to the whole widget root (was a tiny screenshot row). `ingestFile` validates MIME (image/\*) and size (10MB) and surfaces an inline failed toast. Switched preview from `URL.createObjectURL(blob)` to a base64 `data:` URL — Tauri window CSP (`img-src 'self' data:`) was silently dropping `blob:` URLs, the visible "preview doesn't load" symptom.
- **Submit smoothness.** Replaced the 2200ms dead-air close timer with a 400ms cross-fade to a "Filed." slab over the composer interior, then unmount at ~650ms.

**Why:**

Four open friction reports — each a small visible defect that eroded trust in the chat surface and the friction loop itself. Cheap to fix, expensive to leave, and the pulse-forever issue in particular was visible on every workspace home.

**Design decisions:**

- **Enter sends, Shift+Enter inserts a newline.** Matches the dominant convention in chat surfaces; ⌘↵ kept so anyone with the existing keystroke wired into muscle memory doesn't lose it.
- **Pulse is an activity signal, not a state badge.** Once it pulses forever, the user reads it as "this is the active workspace" rather than "something just happened" — semantically wrong. The 8s recency window restores the original "look here, now" intent.
- **"Filed." slab is `aria-hidden="true"`.** The existing toast owns the SR announcement; declaring `aria-live="polite"` on the slab too would double-announce. Cross-fade is visual chrome only.

**Technical decisions:**

- **Base64 `data:` URL for the friction preview.** Tauri's CSP (`img-src 'self' data:`) drops `blob:` URLs without a console error — the symptom was an empty preview. Switched to `String.fromCharCode + btoa` (the standard latin-1 binary-string encoding for image bytes 0–255).
- **`HomeWorkspaceRow` extracted.** First pass missed threading `useRecentActivity` through HomeTabA's workspace dot. Extracting the row shares the gating logic across surfaces.
- **IME-composition test added** so the keymap doesn't mis-fire mid-composition for IME users.

**Tradeoffs discussed:**

- **"Filed." vs. "Submitted" tone.** Pending product review of `feedback.md`; deferred. Both work; this isn't the surface that decides voice.
- **Tune `ACTIVE_RECENCY_MS` once we have real-world heartbeat data** vs. **ship a chosen constant.** Picked 8s by inspection; calibration follow-up captured.

**Lessons learned:**

- CSP failures on `blob:` URLs are silent. Worth a project-wide note when a future surface tries `URL.createObjectURL` for any preview.
- Multi-perspective review caught the double-announcement on the slab + toast combination — easy to ship as an a11y regression in a polish PR if no one is looking.

---

### Tab UI bugs: close, ⌘W, no-flash on switch, per-tab drafts
**Date:** 2026-05-02
**Branch:** tab-ui-bugs
**PR:** #75

**What was done:**

Three friction reports that made the multi-tab workflow feel broken:

- **`frc_019de6fc`** — close-tab X button + ⌘W did nothing. Frontend IPC called `close_tab` but no Rust handler existed; added `AppCore::close_tab` → `cmd_close_tab` → registered in `tauri::generate_handler!`. Global ⌘W keymap inside the workspace branch of MainView so the keystroke fires regardless of focus.
- **`frc_019de6fd`** — tab switch flashed the empty-state suggestion strip before destination content rendered. Persisted a per-tab `tabStartedById` flag; WorkspaceThread reads it synchronously via lazy `useState` so the destination paints with the thread on frame 0.
- **`frc_019de703`** — composer drafts vanished on tab switch. Persisted per-tab drafts in `composerDraftByTab`; ComposeDock accepts `initialDraft` + `onDraftChange` so the textarea round-trips through the store on every keystroke. Closed tabs are reaped via `clearTabState`.

**Why:**

Three of the highest-attention friction reports in the open queue — every multi-tab session hit at least one of them. The tab system shipped functional but rough; this is the polish pass that makes it feel intentional.

**Design decisions:**

- **⌘W matches browser convention.** Modal-aware guard (skip if `appStore.dialog` or `quickSwitcherOpen` is open) so the keystroke doesn't close a tab while a dialog is dismissable.
- **Lazy `useState` initializer** for the started-flag read so the destination tab paints right on frame 0. The flicker was small but read as "broken" — destination should never look empty before the data lands.
- **Per-tab drafts are session-scoped, not persistent across launches.** Original symptom was tab-switch loss; cross-session loss is a different P3 polish. Don't conflate.

**Technical decisions:**

- **Per-tab state on the app store, not the component tree.** The store is the right scope — closing a tab needs to reap the entry, and the component unmount is where reaping fires.
- **`clearTabState` reaper called from `closeTab`.** Without it the per-tab maps grow unboundedly. Cheap fix, surfaced by the engineering review.

**Tradeoffs discussed:**

- **Cross-tab thread isolation now vs. follow-up.** A `TODO(tabs-thread-isolation):` marker flags the cross-tab artifact read in WorkspaceThread; the architectural fix (per-tab thread isolation) is a parallel PR. Keep this PR scoped to the three filed friction reports.

**Lessons learned:**

- Frontend was calling an IPC command that had no Rust handler — typecheck couldn't catch it because the IPC client surface is string-keyed at the boundary. The new contract test (handler registered, signature matches) belongs in the IPC smoke suite from PR #74.

---

### Testing Phase A floor — updater, safety, IPC smoke, update-prompt SAFETY
**Date:** 2026-05-02
**Branch:** testing-strategy
**PR:** #74

**What was done:**

First slice of the testing strategy in `core-docs/testing-strategy.md`. Risk-driven, not coverage-driven — every test exists because a regression in that surface would silently brick or compromise the app.

- **Updater config invariants** (4 tests): `tauri.conf.json` has `createUpdaterArtifacts: true`, a real GitHub Releases endpoint, a non-placeholder minisign pubkey, and a version that matches the Cargo workspace. **Caught real drift on first run** — Cargo was `0.1.0` while `tauri.conf.json` was `0.1.1` from commit `85ad2e4`. Bumped Cargo to reconcile.
- **Approval-gate expansion** (+6 → 12 total): denied-path replay survival, double-resolve last-write-wins, cost-tracker per-workspace isolation, scope deny-over-allow precedence, empty-allow fallback, full CSP baseline lock.
- **IPC integration smoke** (4 tests): project + workspace + tab round-trip; validate-project-path boundaries; multi-workspace projection; restart persistence. Drives `ipc::cmd_*` directly via the shim seam — no Tauri runtime needed.
- **UpdatePrompt component** (7 tests): state machine + the timeout-after-install race contract.

416 Rust workspace tests (was ~408); 125 frontend (was 118). Strategy doc + a `justfile` for local-dev ergonomics also land here.

**Why:**

Designer is approaching dogfood-readiness, and several safety-critical paths (updater config, approval gates, persistence round-trip) had no automated regression coverage. A silent updater config regression bricks every installed user; a silent approval-gate regression bypasses the safety story. Lock those down first.

**Design decisions:**

- **Risk-driven, not coverage-driven.** Test surfaces ranked by what fails silently if it regresses, not by line count. The four chosen surfaces all have that property.
- **No new test runner.** Stays inside `cargo test` + `vitest` so CI doesn't grow a new gate to maintain.

**Technical decisions:**

- **IPC tests drive `cmd_*` via the shim seam.** Avoids spinning a Tauri runtime per test (cold expensive, flaky); the shim is the testable seam Designer was already using internally.
- **`updater_config` reads `tauri.conf.json` at test time.** Production code reads it at build time, but the assertion shape is the same. Drift between the two is impossible — both go through the same JSON.
- **CSP baseline test asserts the exact policy string.** Sorting both sides would lose the lock-on-exact-output property; the comment explains the enum-order coupling is intentional.

**Tradeoffs discussed:**

- **Phase A scope creep — six items vs. three.** The strategy doc originally claimed visual-regression and performance-budget tests in Phase A; both ship in parallel workspaces (#73 for perf). Branch-protection on `main` is user-side. Doc rewritten to match reality (3 lanes), no scope hidden in a footnote.
- **Add an error-pill-absence assertion to the UpdatePrompt race-contract test** vs. **leave a comment.** The error pill *is* briefly visible before relaunch closes the window — the assertion would fail. Captured the real behavior in a comment as an intentional non-contract; the cleanup belongs on the polish list, not in the test.

**Lessons learned:**

- Version-sync drift between Cargo and `tauri.conf.json` is the kind of bug that ships silently — the auto-updater no-ops without raising a CI signal. The new invariant test catches it on every PR.
- The strategy doc claimed more than the PR shipped on the first commit; the staff-engineer review caught it before merge. Worth tightening the rule: doc updates land with the PR that ships them, not as scope cover.

---

### Performance budget tests for cold start and IPC roundtrip
**Date:** 2026-05-01
**Branch:** perf-budget
**PR:** #73

**What was done:**

Two integration tests in `apps/desktop/src-tauri/tests/perf_budget.rs`:

- `cold_start_under_budget` — times `AppCore::boot()` (SQLite open + first projector replay) against a 250 ms budget.
- `ipc_list_projects_p99_under_budget` — 100 sequential `cmd_list_projects` calls on a populated AppCore (10 projects × 3 workspaces); asserts p99 under 2 ms.

Stdlib-only timing (`std::time::Instant`); no `criterion` or other benchmark crate. Runs on the existing `cargo test --workspace` path; no CI changes.

**Why:**

Designer's "<100ms interaction latency, <200MB idle memory" Quality Bar item had no automated guardrail. A 10% per-commit creep over 10 commits is 2.7× total — undetected. These two budgets catch order-of-magnitude regressions before they ship.

**Design decisions:**

- **Two surfaces only — boot and IPC roundtrip.** They cover the two hot paths the user experiences as "the app starts" and "the app responds." Adding more surfaces would dilute the signal until thresholds get tuned away.
- **Methodology comment lives at the top of the test file.** Future budget changes need to know how the numbers were chosen — the comment is the audit trail.

**Technical decisions:**

- **Stdlib `Instant`, not `criterion`.** Criterion adds a dep, a separate runner, and harness overhead that masks the regressions we want to see. The threshold is order-of-magnitude, not microbenchmark-precision.
- **Final budgets at 2× max-of-5-runs hit by noise; bumped twice as parallel-test contention surfaced more spike modes.** Final 250 ms / 2 ms catches order-of-magnitude regressions while tolerating runner jitter and parallel cargo-test scheduling. Observed maxes across ~40 darwin/aarch64 debug runs: cold_start 103.5 ms under contention (~30 ms typical), IPC p99 626 µs under contention (~22 µs typical).

**Tradeoffs discussed:**

- **Stricter budgets that catch a 50% regression** vs. **looser budgets that survive CI noise.** Stricter would have flaked on every parallel-cargo-test run. Looser-but-still-meaningful (10× headroom over typical, 2.5× over observed max) is the right register for an integration test that runs on every PR.
- **Process-global `INBOX_HANDLER` `OnceCell` — race risk?** Verified inert: both tests use `use_mock_orchestrator: true` and the handler is only wired into the real orchestrator. Comment added to head off future review confusion.

**Lessons learned:**

- This test measures `AppCore::boot()` — not window paint, first-draw latency, or anything the user actually sees as "launch time." A user-perceived startup-time check belongs in the dogfood gate (manual signal) until a real end-to-end test exists. Captured as a follow-up.

---

### Bundled chat: file logging + auto-recover stale claude handle SAFETY
**Date:** 2026-05-01
**Branch:** bundled-chat-hang
**PR:** #72

**What was done:**

Bundled `Designer.app` was reporting chat hanging on first message, then `orchestrator post_message failed: spawn failed: stdin channel closed` on retry (friction `frc_019de701`, `frc_019de705`). Two failure modes, one root cause: when the `claude` subprocess dies, the writer task exits, the team handle in the orchestrator's map goes stale, and the next `post_message` fails with no recovery. The bundled `.app`'s launchd-stripped environment + hardened runtime makes claude die in ways that don't reproduce under `cargo tauri dev`, and stdout/stderr were routed to /dev/null — **zero on-disk traces**.

This PR ships the diagnostic + recovery layer:

- **Daily-rotating file appender** at `~/.designer/logs/designer.log.<date>` (`tracing-appender`).
- **Auto-recover stale handle** in `core_agents::post_message`: on `OrchestratorError::ChannelClosed`, re-spawn so the user's retry just works. Skips the orchestrator's graceful `shutdown` (60s wait); `spawn_team`'s `insert` overwrites the stale `TeamHandle` and `kill_on_drop(true)` on the old `Child` kills synchronously.
- **Softer user-visible errors**: "couldn't deliver your message to Claude — …" instead of "orchestrator post_message failed: …".
- **New typed `OrchestratorError::ChannelClosed { workspace_id }`** so recovery matches on a typed error, not string-matching `Spawn("stdin channel closed")`.
- **Boundary trace at `cmd_post_message`** + writer/reader exit lines promoted from `debug` → `info`, tagged with `workspace=…` and `pid=…`.

**Why:**

Chat is the primary surface; a bundled-only chat hang with no logs is unobservable and bricks every dogfood loop. Without on-disk traces, every bundled-only regression is invisible. The recovery layer fixes the user-visible second-attempt error in the meantime.

**Design decisions:**

- **Recovery skips graceful shutdown.** Recovery happens on the user's retry — a 60s `shutdown` wait is unacceptable UX. `kill_on_drop(true)` bounds cleanup to the drop, so the message round-trip stays snappy.
- **User copy is human-language, not jargon.** Three error sites all use the same softer copy; the legacy "orchestrator post_message failed: …" prefix is asserted-against in the new test so it can't regress.
- **Pattern-log entry written.** The spawn-on-insert recovery shape (vs. graceful-shutdown-then-respawn) has implications for Phase 13.E+ tool-call status work — per-task events don't survive a respawn. Logged for the next author.

**Technical decisions:**

- **Typed error variant beats string-matching.** `OrchestratorError::ChannelClosed { workspace_id }` is the right shape for a recovery branch; string-matching the previous `Spawn("stdin channel closed")` would silently drift the moment that string changed.
- **Panic hook installs before tracing guard.** Intentional ordering — `init_tracing` panics get captured by the crash file. Explicit comment in `main.rs`.
- **Daily rotation.** Log files don't grow unboundedly; old logs are easy to share without a "find the latest" step.

**Tradeoffs discussed:**

- **Diagnose root cause first vs. ship visibility + recovery now.** Without logs, diagnosis is impossible — claude is reachable from the bundle (`claude --version` works in the bundled context, returns 2.1.126), but what happens between spawn and the first stdout byte is invisible. The cheapest path to that visibility is the file appender; the recovery layer makes the second-attempt-failure mode disappear in the meantime. Not a root-cause fix, and the PR body says so plainly.
- **Concurrent recovery race.** Real but mitigated by `kill_on_drop(true)` on the old `Child`. Demoted to FOLLOW-UP rather than blocking; stress test for concurrent recovery is on the post-merge list.

**Lessons learned:**

- Bundled-only failure modes need on-disk traces from day one. Every future Tauri release should ship with the file appender armed, not added after the first invisible regression.
- The `staff-perspective-review` skill was also added to this repo as a project skill — three reviews ran before opening for human review and caught both the 60s graceful-shutdown UX failure and the missing respawn-also-fails test.

---

### Release pipeline ready: signing, updater, icon, routine-release docs SAFETY
**Date:** 2026-05-01
**Branch:** dogfood-build-status / enable-updater-bundle / sand-icon-and-release-docs / update-app-icon
**Spans:** PR #65, #66, #69, #71

**What was done:**

Four bundled PRs that took the v0.1.0 release pipeline from "fires the workflow" to "ships a signed, notarized, auto-updating DMG with the right icon and a documented routine-release path."

- **#65 — Notarization + Release publish.** `tauri-action` expects the App Store Connect API key as a file on disk (`APPLE_API_KEY_PATH`) plus the 10-char Key ID in `APPLE_API_KEY`. The original workflow passed the `.p8` contents in `APPLE_API_KEY` and never set a path → `notarytool` was never invoked → builds were signed but **un-notarized**. Fixed by materializing the `.p8` to `~/private_keys/AuthKey_<id>.p8` and exporting `APPLE_API_KEY_PATH`. Added `permissions: contents: write` and `GITHUB_TOKEN` env so the Release publish step actually works.
- **#66 — `createUpdaterArtifacts: true`.** v0.1.0 published, but the auto-updater needed `latest.json` and the `.tar.gz.sig` minisign signature — neither was emitted. Tauri 2 only produces the updater bundle when `bundle.createUpdaterArtifacts: true` AND `TAURI_SIGNING_PRIVATE_KEY` is set. The env var was wired; the conf flag wasn't. One-line edit. (First-pass attempt added `"updater"` to `bundle.targets` — Tauri's enum doesn't accept that value; second commit corrects to the real spelling.)
- **#69 — `PACKAGING.md` routine release + sand-tile app icon.** Three-line release doc replaced with a routine-release walk-through, version-sync invariant (tag MUST equal `"v" +` `tauri.conf.json` `"version"` or the auto-updater silently no-ops), monotonic-versions rule, broken-release recovery (prefer bumping forward, not delete-and-retag), weekly cadence guidance, and an App-icon section. Sand-tile icon composited the transparent "d" mark on `rgb(243,243,242)` (the actual computed `--color-background` in light mode) so the dock icon reads as a continuation of the app surface.
- **#71 — `d` mark icon update.** Replaced the sand-tile icon with the new Designer "d" mark; regenerated all icon variants.

**Why:**

The v0.1.0 tag-push exposed three pipeline gaps and one icon issue, all of which would have blocked the dogfood loop. None were caught in pre-tag testing because the release workflow only fires on tag push. The routine-release docs codify the recovery path so the next time something breaks, the playbook is on disk, not in someone's head.

**Design decisions:**

- **Document the version-sync rule prominently.** A tag/conf mismatch fails silently — the build succeeds, the user installs cleanly, and the auto-updater quietly no-ops forever. The doc calls it out as a critical invariant.
- **Bump forward, don't delete-and-retag.** Delete-and-retag is only safe when no user has installed the broken version yet; once anyone has, the new build under the same tag corrupts the auto-update path. Bump-forward is the default.
- **Weekly release cadence.** Recommended for dogfood — fast enough to keep the loop tight, slow enough that each release feels deliberate.

**Technical decisions:**

- **`APPLE_API_KEY_PATH` is materialized in a step, not a secret.** GitHub Actions secrets are env strings, not files; writing to disk in a step is the canonical pattern. Path goes under `~/private_keys/` per `notarytool`'s expectation.
- **`createUpdaterArtifacts: true` instead of adding `"updater"` to `bundle.targets`.** Tauri 2's `BundleTargetInner` enum doesn't accept `"updater"` — first attempt rejected with `data did not match any variant of untagged enum BundleTargetInner`. The conf flag is the documented mechanism.
- **Sand-tile background = `color-mix(in oklab, sand-3 80%, sand-1)`.** That's the actual computed `--color-background` value in light mode — the dock icon should read as a continuation of the app surface, not a chip floating on it. Superseded by the "d" mark in #71 once a clean source asset existed.

**Tradeoffs discussed:**

- **Delete-and-retag vs. bump-forward for the broken v0.1.0.** Bump-forward (`v0.1.0 → v0.1.1`) shipped because the v0.1.0 release had been tagged and surfaced briefly; bump-forward is the safe choice once any user could have hit the broken artifact. Codified in the routine-release doc.
- **Sand-tile icon vs. transparent-source on the system background.** Sand tile reads as part of the app surface; transparent on system background reads as a chip on whatever wallpaper the user has. Picked the sand tile, then revised again in #71 once the "d" mark felt right against the dock.

**Lessons learned:**

- The release workflow's failure modes are invisible until the first tag push fires it. Worth treating release-path tests (PR #74's updater_config invariants) as first-class — silent broken auto-update is the worst kind of regression because it bricks every installed user.
- Tauri 2's bundler is quiet about config errors that mean "signature not found" — `tauri-action` falls back to re-tarring `.app` without re-signing rather than failing loudly. The PR body's link to the failing run log is the kind of evidence trail every release-path PR should ship with.

---

### Friction: batch-copy + first wave of fixes (3 of 18) + dispatch packs
**Date:** 2026-05-01
**Branch:** friction-batch-and-fixes
**PR:** #70

**What was done:**

Three bundled deliverables:

1. **Batch-copy** — Settings → Activity → Friction now has a "Copy {N} as one prompt" button that bundles every record matching the active filter into one clipboard payload. New `buildBatchAgentPrompt(entries, filter)` mirrors the per-record shape; uses path-only payload (the agent reads each record itself) so the prompt stays small for 50+ entries.
2. **Wave 1 fixes (3 of 18 friction reports addressed in-PR):**
   - `frc_019de6f6` — Friction not available in settings tab. New `--layer-floating: 150` token (between modal=100 and titlebar=200). All five friction surfaces moved to it so the trigger + composer remain reachable while SettingsPage is mounted.
   - `frc_019de6fb` — Dark mode main tab lighter than surface. Inverted dark-mode `--color-content-surface` mix from sand-5+sand-9 → sand-1+sand-3.
   - `frc_019de6ff` — Help dialog "Ask" input does nothing. Removed. Per the dogfood rule "no half-baked features in prod."
3. **Parallel-agent dispatch packs** — six self-contained markdown prompts under `.context/friction-batches/` (gitignored). Each is paste-ready for a fresh agent session. File-disjoint by design so groups land in any order without rebase contention.

**Why:**

18 open friction reports after the first dogfood-pass week. Single-agent serial fix-up would take days; the dispatch-pack pattern lets parallel agents fix file-disjoint groups concurrently. Batch-copy is the explicit ask: triage one prompt, not 18.

**Design decisions:**

- **Single source of truth for the close-the-loop CLI** — `ADDRESS_CLI` constant. A future change to `designer friction address` only edits one spot.
- **Three explicit registers for the batch button: loading / loaded-empty / ready.** Loading shows no count (was briefly "Copy 0 as one prompt" mid-fetch); loaded-empty disables; ready shows the count.
- **Header phrasing adapts to the active filter** — "3 open Designer friction reports" rather than "3 Designer friction reports (filter: open)". Reads naturally in the agent's first message.
- **Removed > half-baked.** The Help dialog "Ask" input was a placeholder waiting on an answering agent; in prod, it dishonestly suggested capability. Removed per the dogfood rule.

**Technical decisions:**

- **Path-only payload for the batch prompt.** Lets the agent read each record itself and keeps the prompt small for 50+ entries. Bundling full record bodies would have made the clipboard payload unwieldy and noisy.
- **`--layer-floating: 150` is a new token between modal=100 and titlebar=200.** All five friction surfaces moved to it. Without this token, friction was unreachable while Settings was mounted (Settings is at the same layer as the friction trigger).
- **Test-isolation bug fixed:** the new vitest mutated `window.navigator.clipboard` globally with no restoration, leaking into later tests. Snapshot descriptor in `try`, restore in `finally`.

**Tradeoffs discussed:**

- **One PR per friction fix vs. wave-of-3 + dispatch packs for the rest.** Single-PR-per-fix has clean rollback granularity but slow throughput. Bundling 3 in-PR + dispatching 15 by group is the throughput choice; the dispatch packs are file-disjoint so they don't fight on rebase.
- **Bundle full records in the batch prompt vs. paths only.** Path-only assumes the agent has filesystem access to the friction records (true under Designer's data-dir convention). Bundling records would work for any agent but bloats the clipboard. Picked path-only; the prompt template itself names the read step.
- **Fix the `--layer-floating` issue with a new token vs. raise friction trigger one layer.** New token is the structural answer — friction needs a defined layer between modal and titlebar; ad-hoc raising would have caused a different overlap somewhere else.

**Lessons learned:**

- Test-isolation bugs from globally-mutated browser APIs are easy to write and hard to catch — the new vitest test passed but left the next test broken. `try/finally` snapshot is the standard fix; worth a CONTRIBUTING note if a third test trips it.
- "Copy 3 as prompt" parsed ambiguously — did "as prompt" mean the format or the destination? "Copy 3 as one prompt" disambiguates without a tooltip. Multi-perspective UX review catches copy ambiguity that the engineer-author misses.

---

### Friction → agent loop: CLI subcommands + copy-path + fs-watch
**Date:** 2026-05-01
**Branch:** friction-explainer
**PR:** #67

**What was done:**

Closes the dogfood loop: file friction in the desktop app, fix it from any agent (Claude Code, Codex CLI, terminal) without a tab bounce.

- **Shared projection** — `project_friction()` moves to `designer-ipc::friction` so the desktop IPC handler and the new CLI surface reduce the same events the same way. Single source of truth for the Open / Addressed / Resolved state machine.
- **`designer friction` CLI** — `list`, `address`, `resolve`, `reopen`, with `--state` filter, `--json` for agents, and `--data-dir` / `$DESIGNER_DATA_DIR` for per-environment isolation. Tracing default dropped to `warn` so `--json | jq` is clean on stderr.
- **Row affordances** — `Copy path` and `Copy prompt` buttons on every Friction triage row. The prompt template embeds the path and the close-the-loop CLI command so an agent can act on a single paste.
- **fs-watcher** — `store_watcher.rs` debounces fs events on `<data_dir>/events.db` and emits `designer://store-changed`; `FrictionTriageSection` re-fetches on receipt without disturbing the active filter chip. External CLI writes appear in the open inbox in ~500ms.
- **Distribution + docs** — `scripts/install-cli.sh` and a Friction → agent loop section in `core-docs/workflow.md`.

**Why:**

The friction-file step worked, but the close-the-loop step required tab-bouncing back to Designer to mark records addressed/resolved. That broke the dogfood flow ("file friction → switch to agent → fix → switch back to mark resolved"). Putting the state-machine on the CLI lets any agent close the loop natively.

**Design decisions:**

- **CLI uses the same projection as the desktop UI.** Shared `project_friction()` lives in `designer-ipc::friction`. Two surfaces, one state machine — no drift possible.
- **fs-watcher debounce on `events.db`, not per-record files.** SQLite's WAL means many writes per logical change; debounce at the file level keeps the watcher cheap and the UI re-fetch single-shot.
- **`Copy prompt` template embeds the close-the-loop CLI.** A single paste gives the agent the path and the resolve command. Fewer steps to remember.

**Technical decisions:**

- **Tracing default `warn` on the CLI** so `--json | jq` is clean on stderr. The desktop binary stays at `info` because its log destination is on disk, not stderr.
- **`--data-dir` / `$DESIGNER_DATA_DIR` for per-environment isolation.** Agents running in different worktrees should target different data dirs without cross-contamination.
- **`notify-debouncer-mini` already in the workspace.** No new dependency added — the debouncer was a transitive dep already pulled in by another crate.

**Tradeoffs discussed:**

- **CLI bundled inside `Designer.app` vs. `cargo install` install path.** `cargo install` works for devs with Rust; non-dev release needs Tauri `externalBin` or a Homebrew formula. Belongs in the public-release prep PR; out of scope here.
- **Desktop write also fires the fs-watcher → one redundant `list_friction`.** Cheap; future fix is to track the last sequence the bridge emitted internally and skip when `events.db`'s max matches. Not worth a clever optimization in the v1.
- **Five buttons on open Friction rows.** Will wrap at narrow widths. Consolidate into a "more" menu in a polish pass.

**Lessons learned:**

- The shared-projection pattern (one function, two surfaces) generalizes — anywhere desktop and CLI surface the same data, putting the projection in `designer-ipc` is the right home. Worth a CONTRIBUTING note when the second surface lands.
- fs-watch latency on macOS sat at ~500ms — well within the "feels live" threshold without any UI optimism. Captured for future "should we use optimism here?" decisions on related surfaces.

---

### Dogfood push (v0.1.0): updater + chat pass-through + reliability audit SAFETY
**Date:** 2026-05-01
**Branch:** dogfood-readiness
**PR:** #63

**What was done:**

Three bundled tracks that took Designer from terminal-build-only to a downloadable, auto-updating macOS app you can dogfood seriously.

- **DP-A — Updater + signed/notarized release workflow.** `tauri-plugin-updater` on `v*` tags. New `UpdatePrompt` floats bottom-left when an update is available; one click downloads + applies + relaunches.
- **DP-B — Pass-through chat.** Eight artifact card renderers collapse into one-line `→ kind: title` references that focus the matching row in `ActivitySpine` on click; the spine auto-shows itself if collapsed when a focus event fires. `ToolCallGroup` disclosure becomes terse `· Read src/foo.rs` lines. `ApprovalBlock` is the must-intercept that keeps its chrome.
- **DP-C — Reliability audit.** Honest *Feature readiness* table in `plan.md` (19 prod / 1 flag / 12 hide). New `FeatureFlags { show_models_section }` gates the placeholder Models pane.

**Why:**

Designer had been terminal-build-only — every dogfood session required `cargo tauri dev`, no auto-update path, and a chat surface that buried the Claude Code experience under custom artifact-card chrome. Three principles drove the bundle: dogfood means downloadable + auto-updating; chat is pass-through by default and only intercepts where the core value prop demands (approvals); features that aren't dogfoodable get flagged or hidden, not shipped half-baked.

**Design decisions:**

- **Pass-through chat by default; intercept only at approvals.** The chat philosophy memo (`feedback.md`) — Designer's value is above the model, not in re-rendering it. Eight artifact card renderers collapsed to one-line references; tool-call disclosure goes terse. `ApprovalBlock` stays full-chrome because gating is the must-intercept.
- **`UpdatePrompt` floats bottom-left.** Persistent but ignorable; doesn't interrupt flow. One-click downloads + applies + relaunches.
- **Models pane is flag-gated, not removed.** It's a real planned feature with no shipping behavior yet — flag-gate keeps the development path clear without lying about prod capability.

**Technical decisions:**

- **`projector_apply_is_idempotent_per_sequence`.** The CI-failing `core::tests::open_tab_appends_and_projects` was a pre-existing dual-apply race — projector applied every event twice (synchronously at the write site + via the broadcast subscriber). Fixed by adding `last_applied: HashMap<StreamId, u64>` to `ProjectorState` so `apply` is sequence-idempotent. Regression test broadened to cover three variants: manual dual-apply, the production replay→live transition, and 16-way concurrent applies.
- **`ActivitySpine` auto-shows on focus events.** A click on an artifact reference in the chat needs the spine visible — the auto-show keeps the click feeling like a destination, not a no-op.
- **`UpdatePrompt` race-fix:** unmount guard + reduced-motion + timeout/success race tightened in Round 2 review.

**Tradeoffs discussed:**

- **Custom artifact cards vs. pass-through one-line refs.** Custom cards were bigger and prettier but masked Claude Code's actual streaming feel and made the chat feel like a different product. Pass-through is the chat-philosophy choice; the references still let the user drill into the spine when they want detail.
- **Hide unfinished features vs. ship them with placeholder UI.** Hiding behind a feature flag preserves the development path; placeholder UI in prod would have lied about capability. The 19/1/12 audit codified the rule.
- **Streaming polish — partial-chunk emission to match Claude Code's true streaming feel** vs. the existing 120ms idle-flush coalescer. Out of DP-B's frontend scope; tracked as a backend follow-up.

**Lessons learned:**

- The dual-apply projector race had been latent for several phases; a CI test that ran in parallel finally surfaced it under the new test load. Dual-apply at the projector level is a class of bug that needs an explicit test surface — the three-variant regression test is the right shape.
- Three rounds of review (pre-commit, post-CI, post-race-fix) caught issues in each pass. The cadence — implement, review, fix, re-review — is the right one for a multi-track bundle PR; each round caught different categories (UX copy, IPC race, test-coverage gaps).

---

### Phase 22 — Project Home redesign (roadmap + spec + plan)
**Date:** 2026-04-30
**Branch:** home-spec-roadmap
**PR:** #62

**What was done:**

Folded the home-page spec into the roadmap as **Phase 22** — a three-surface project Home tab (Recent Reports / Roadmap / Designer Noticed). Pure roadmap/spec/plan, no code. Decomposed into 8 independently shippable sub-phases (22.G color, 22.B reports, 22.A roadmap canvas, 22.I track completion, 22.D edit & proposal, 22.E adjacent attention, 22.H click-into-agent, 22.C origination). 23 new entries (40–62) in `core-docs/spec.md`. 37 acceptance tests gated per-sub-phase.

**Why:**

Project Home was a placeholder pane — no clear axis between "what shipped," "what's planned," and "what Designer noticed." A coherent surface story was needed before any of the eight component features could land without stepping on each other. The phase exists to lock the architecture before parallel implementation work starts.

**Design decisions:**

- **Three-surface composition.** Recent Reports (single high-level voice), Roadmap canvas, Designer Noticed. One tab, three altitudes. Other compositions were tried in spec — separate tabs, mixed sidebars — none cleaved as cleanly.
- **Single voice for Reports.** Multi-voice deferred behind a future settings affordance; single high-level "manager" voice ships v1.
- **Done = shipped.** Enforced at *two* paths (IPC writes + projection auto-derivation), both gating on `NodeShipment` evidence. Authored-Done-without-shipment demotes to InReview at the projector with an inline tooltip.
- **No project-altitude Reports tab.** Expand-in-place inside Project Home preserves Decision 36 (no project-altitude tab kind).
- **Snappy motion, no spring** for adjacent-attention column fill — preserves axiom #5.

**Technical decisions:**

- **Multi-claim status precedence.** Previously undefined. Now: max claiming-track state under an all-must-ship Done gate.
- **`summary_high` migration safety.** Additive field; falls back to existing `summary` for pre-22.B reports. No crash, no backfill.
- **Read-state projection scoped to `(ProjectId,)` for v1.** No premature `(UserId, ProjectId)` shape; extends additively when team-tier lands.
- **`AttentionItem` fields bounded** (`title ≤ 80`, `body_summary ≤ 240`). Per-kind derivation table covers all 5 kinds.
- **`TrackStarted` gains additive `anchor_node_id`** per Lane 0 ADR.

**Tradeoffs discussed:**

- **Linear integration vs. cut.** Linear users live in Linear; the canvas's value is markdown-first plans living in the repo (Decision 17). Two-source-of-truth confusion the original spec couldn't fully resolve. Cut from v1 — interop, not moat.
- **Three-voice Reports vs. single voice.** Multi-voice would have diluted the "summarize by default, drill on demand" principle on the home tab. Single voice ships; the multi-voice hatch can come back behind a settings affordance once dogfood signal motivates it.
- **Projector vs. IPC enforcement boundary on Done = shipped.** Both. Belt-and-braces — projector catches authored-event drift, IPC catches client misbehavior.
- **First-slice recommendation: 22.G + 22.B + 22.A + 22.I behind a feature flag.** Lands team identity, "what shipped" highlights, and a live plan view with shipping badges in three landed PRs without committing to edit/attention infra until dogfood signal motivates it.

**Lessons learned:**

- Pure roadmap/spec/plan PRs benefit from staff-perspective review even with no code surface. The three review lenses surfaced eight bugs that would have leaked into implementation: undefined multi-claim precedence, anchor-split determinism, AttentionItem field bounds, etc. Writing the spec carefully before sub-phases land is cheap; writing it sloppily and patching during sub-phase implementation is expensive.
- Cuts at architecture time are cheaper than cuts at implementation time. Linear, three-voice Reports, the project-level Reports tab, and the five-category re-skin are all easier to leave out of v1 than to retract once shipped.

---

### Chat UX overhaul — 14 bug fixes + conversational polish
**Date:** 2026-04-30
**Branch:** chat-ux-audit
**PR:** #61

**What was done:**

User reported 8 issues running Designer for the first time. Branch ships a focused fix per issue plus a conversational-polish pass. 107 tests pass (was 60); production build clean; Mini design invariants clean on every touched file. Audit, root causes, fix plan, and updated test taxonomy live in `core-docs/chat-ui-audit.md`.

**Bug fixes (14):** re-entry guard on tab open; visible active/inactive tab font-weight + opaque-fill delta; project-home contract test (no `role=tab` when on home); `data-author` wired on message blocks (user bubble + agent flat distinct); `ToolCallGroup` coalesces consecutive `report` artifacts into one disclosure; sticky-scroll thread + jump-to-latest pill; activity indicator with idle/submitting/stuck states + 15s stuck timeout; global ⌘T shortcut wired; tab titles use `max + 1` so closes don't produce duplicate "Tab 3"; closing a tab moves focus to the next tab or new-tab button; send button disables + `aria-busy` while in flight; compose form (not textarea) carries `aria-busy`; `aria-relevant="additions"` on the live region.

**Conversational polish (6):** `humanizeRole()` strips `_agent` qualifiers; new artifacts fade + slide in (with tab-switch suppression); inline relative timestamps with 30s tick; spec/PR/code-change blocks demoted to inline-attachment chrome; same-author runs tighten + first message in a run owns the meta header; inline markdown for bold/italic/code/URLs (XSS-hardened, hand-rolled tokenizer, no `react-markdown` dep).

**Why:**

First-run user testing surfaced 8 issues that broke the "this feels like real-time communication" register. Pre-cursor to the chat pass-through work in PR #63 — the pass-through philosophy means the chat surface has to feel live and well-mannered first.

**Design decisions:**

- **`aria-busy` on the form, not the textarea.** Textarea-busy locks the user out of typing follow-up drafts during in-flight sends; form-busy lets them keep typing.
- **Conversation rhythm scoped to user-after-user / agent-after-agent only.** First-pass tightened the agent → user turn boundary too; that read as the agent "catching up to" the user. Scoping to same-author runs preserves the turn cadence.
- **No `react-markdown` dep.** Hand-rolled tokenizer for the four supported inlines; XSS-hardened by construction. Adding a markdown lib for four inlines is a heavy hammer.

**Technical decisions:**

- **`.thread--initial` gates per-child arrival animation on first paint.** Without this, a tab switch stampedes 50 simultaneous animations. The class clears on first commit so subsequent arrivals animate individually.
- **Artifact count moved to a ref.** Keeps `onSend` callback identity stable so React doesn't re-bind it on every render.
- **`animation` shorthand fix** — `--motion-enter` is a transition shorthand, not a duration; the original code parsed inconsistently across engines.

**Tradeoffs discussed:**

- **Custom artifact-card chrome (preserved here) vs. pass-through one-line refs (the eventual choice in PR #63).** Polish-first is the right move when the chat philosophy hasn't been written down yet — fix the in-tree register, then decide whether to keep or collapse it. The collapse landed in DP-B; this PR's polish is what makes the ref-only register feel acceptable.
- **Activity dots 4 → 8 px.** 4 px reads as punctuation, not status. 8 px is the smallest size that reads as "an indicator."

**Lessons learned:**

- Three-perspective review (staff engineer, staff UX designer, staff design engineer) before opening for human review caught six issues the implementation missed. The cadence works; documented in PR body so future audit-style PRs follow it.
- "Run this in dev for 5 minutes and write down what feels off" generated 8 issues + 6 polish items that no test would have surfaced. First-run friction is a different category from regression risk — both belong in the test taxonomy.

---

### Phase 16.S — Supply-chain CI gates (audits + SBOM)
**Date:** 2026-04-30
**Branch:** supply-chain-ci
**PR:** #60

**What was done:**

Audits-only scope of Phase 16.S — adds blocking supply-chain CI gates without taking on signing, SLSA L3 provenance, updater dual-key, or `cargo-vet` calibration (those are 16.R / follow-up 16.S work).

`.github/workflows/supply-chain.yml` runs five jobs on PRs to `main`, pushes to `main`, daily 07:17 UTC drift schedule, and `workflow_dispatch`: `cargo audit` (HIGH/CRITICAL block, MEDIUM/LOW + unmaintained warn), `cargo deny check`, CycloneDX SBOM (one BOM per workspace member, uploaded as artifact), `npm audit --omit=dev --audit-level=high`, and `lockfile-lint`. A `drift-issue` job opens or updates a stable-titled tracking Issue when the daily cron run fails. `deny.toml` at workspace root pins the policy: macOS-only targets, license allowlist matching the resolved tree, GPL/AGPL/LGPL excluded. `core-docs/security.md` §16.S new "Supply-chain CI policy" subsection documents the severity gate and exemption discipline.

**Why:**

Designer is heading toward dogfood-distributable. Without supply-chain CI, a transitive dep with a HIGH advisory could ship into a signed DMG and infect every install. Audits-only first to lock the gate, then layer signing/provenance on top later.

**Design decisions:**

- **HIGH/CRITICAL block, MEDIUM/LOW warn.** Severity gate, not all-or-nothing. Blocking on every advisory would yield ignored alerts; HIGH/CRITICAL is the right signal-to-noise threshold for a small team.
- **`unmaintained = "workspace"`.** Transitive unmaintained advisories (`unic-*`, `fxhash` via tauri) surface as warnings rather than blocking — fixing them requires upstream tauri to update, and we shouldn't gate Designer's merges on that. RUSTSEC IDs documented inline.
- **License allowlist matches today's resolved tree exactly.** Explicitly excludes GPL-* / AGPL-* / LGPL — workspace-level posture for shipping a closed-source binary. Future deps that pull in new licenses fail the check until a deliberate allowlist update.
- **Daily drift schedule + stable-titled tracking issue.** Catches the case where a previously-passing dep develops a new advisory between PRs. Single issue, comments append — easier to triage than one issue per drift.

**Technical decisions:**

- **`deny.toml` targets restricted to `aarch64-apple-darwin` + `x86_64-apple-darwin`.** Designer is macOS-only for v1; trims Linux-only `gtk-rs` / Windows-only `windows-*` transitives from the check graph. Smaller surface, fewer false positives.
- **`publish = false` at the workspace level + `publish.workspace = true` per crate.** Lets `cargo deny`'s `[licenses.private].ignore = true` correctly identify the workspace's `license = "UNLICENSED"` crates as private rather than failing the license check.
- **Severity gate is a Python post-processor on `cargo audit --json`.** `cargo audit`'s built-in CLI gate is all-or-nothing; the post-processor implements the HIGH-blocks/MEDIUM-warns split.

**Tradeoffs discussed:**

- **Block all advisories vs. severity gate.** All-advisories blocks every PR until each is triaged — dev-killing, fosters ignore-list bloat. Severity gate keeps the "real" advisories blocking while giving lower-severity ones a daily-cron safety net.
- **Audits-only vs. signing+SBOM+provenance in one PR.** Audits land cheaply and protect the merge surface; signing/SLSA/dual-key need more design work and shouldn't gate the audit gate. Documented split in `security.md`.

**Lessons learned:**

- Today's posture (0 blocking vulnerabilities, 19 informational warnings, all upstream-tauri-controlled) means the gate's signal-to-noise is what the daily-cron will reveal over time, not the day-1 numbers. Worth re-reading the drift issue weekly to calibrate.
- Empty `[advisories].ignore` and `[bans].deny` lists today is a feature — every future exemption goes there with a citation comment, no silent passes.

---


### Phase 21.A2 — `domain_specific_in_claude_md` detector (Forge-overlap)
**Date:** 2026-04-30
**Branch:** domain-specific-claude-md
**PR:** #57

**What was done:**

Eighth detector in the Phase 21.A2 squad. Reads `<project_root>/CLAUDE.md` from disk once and emits one `Severity::Notice` finding per line that substring-matches a keyword in the new `DOMAIN_SPECIFIC_CLAUDE_MD_KEYWORDS` corpus in `defaults.rs`. Confidence fixed at 0.6 — the signal is heuristic, not structural. Output kind is `rule-extraction` per `roadmap.md` L1468; Phase B's synthesizer will turn each finding into a scoped `.claude/rules/<name>.md` proposal with `paths:` frontmatter narrowing the rule to the file family it concerns.

- **Three keyword families.** File-extension hints (`.tsx`, `.rs`, `.py`, `.go`), framework names (`tailwind`, `radix`, `tokio`, `pytest`, `vite`), directory anchors (`packages/app/`, `apps/desktop/`, `src-tauri/`, `crates/`). Lowercased, anchor-free, no regex metacharacters per CONTRIBUTING §4. Iteration order is stable so the same line always reports the same keyword — keeps `window_digest` deterministic across runs.
- **Listed in `FORGE_OVERLAP_DETECTORS`.** Forge ships an analog (`domain_specific` in `analyze-transcripts.py`); AppCore's `core_learn::probe_for_forge` wiring defaults the config to `DetectorConfig::DISABLED` when `~/.claude/plugins/forge/` is present. The detector logic stays correct so the user can opt back in explicitly. The list itself was already populated in 21.A1; this PR did not modify `FORGE_OVERLAP_DETECTORS`.
- **No internal cap enforcement.** Per the task spec for this row, the detector emits one finding per matching line and lets `core_learn::report_finding` enforce `max_findings_per_session` at the chokepoint. CLAUDE.md is bounded by the project's own `claude_md_demotion` budget (≤200 lines), so producing the full list is cheap.
- **Anchors.** `Anchor::FilePath { path: "CLAUDE.md", line_range: Some((line, line)) }` per finding — single-line range, relative path. The path is intentionally a bare filename rather than a project-relative path because Designer's evidence drawer renders the anchor inline next to the file's own header; a leading `./` would read awkwardly.
- **Summary copy.** `"CLAUDE.md L<n> references <keyword>"`. Length bounded by construction at ≤46 chars; the prior `trim_summary` helper was dropped on the simplify pass (dead code by construction). Passive voice, no second-person, no directive — matches the 21.A1.2 evidence-text rule.
- **Fixtures.** Two on-disk project trees under `tests/fixtures/domain_specific_in_claude_md/`: positive (CLAUDE.md with six lines that each substring-match a corpus keyword across all three families) and negative_generic (principles / axioms only, no extension or framework token). Plus eight in-module unit tests covering case-insensitive matching, one-finding-per-line semantics, line-number indexing, disabled config, missing CLAUDE.md, no project root, and `window_digest` stability.

**Why:**

Per `roadmap.md` row L1468 (`CLAUDE.md lines tied to a specific file extension / framework / directory. Heuristic keyword match. Output kind: rule-extraction (move to scoped .claude/rules/<name>.md)`). The signal is "this line in CLAUDE.md only applies to a narrow file family — stop loading it for every prompt and demote it to a scoped rule." Forge has the same intent (different scoring); the Designer version cites the spec and ships the keyword list as a flat `&[&str]` so a future MLX backend has the same vocabulary.

**Design decisions:**

- **Severity `Notice`, not `Warning`.** Per CONTRIBUTING §6 the A2 default is `Notice` unless the detector's measured FPR is <5% on the fixture suite. Keyword-substring matching has obvious failure modes (a sentence about "Backend code" that happens to mention `crates/` in passing); `Notice` is the conservative pick. The synthesizer is expected to filter further when it composes the proposal.
- **Confidence 0.6 — heuristic.** Lower than `config_gap`'s 0.7 (which is structural — either the hook entry is in the JSON or it isn't) and higher than `cost_hot_streak`'s clamped band (which is a noisy probability). 0.6 says "candidate signal, not certainty."
- **Trim corpus to the spec'd list.** First pass added `react`, `next.js`, `tauri`, `.ts`, `.jsx`, `.swift` for symmetry. Multi-perspective review caught two FP risks: `react` substrings into `interact` and `reaction`, so any sentence about reacting to feedback fires; `tauri` shadows the more-specific `src-tauri/` directory anchor due to corpus iteration order. Trimmed to exactly the keywords listed in the task spec — 4 + 5 + 4 = 13 entries.
- **No code-fence guard.** Lines inside fenced shell blocks (e.g. `pytest -q` inside a triple-backtick block) still fire. That's wanted behavior — a CLAUDE.md shell block is exactly the kind of domain-specific instruction that belongs in a scoped rule.

**Technical decisions:**

- **`first_keyword_hit` returns `Option<&'static str>`.** The corpus is a `&'static [&'static str]`, so the matched keyword can borrow from the binary instead of allocating. Keeps `build_finding` zero-allocation past the format string and the digest hash.
- **Per-line `to_ascii_lowercase()` allocation.** Allocates a `String` per line scanned (200 lines × ~80 chars ≈ 16 KB total). Considered a byte-iterator case-insensitive matcher and Aho-Corasick; rejected both — at 200 lines × 13 keywords the linear scan finishes in microseconds, and a custom matcher would add complexity without proportional gain. The CLAUDE.md size is bounded by the project's own demotion threshold, so the cost is small and capped.
- **No timeout wrapper.** Unlike `repeated_correction.rs` and `repeated_prompt_opening.rs`, this detector doesn't wrap `analyze` in `tokio::time::timeout`. The two listed detectors walk the full event stream (potentially 10k+ events); this one reads a single ≤200-line file. The orchestrator's outer timeout is sufficient — adding an inner timeout for a millisecond-scale detector is theater. Sibling `config_gap.rs` follows the same convention.

**Tradeoffs discussed:**

- **Spec-listed corpus vs symmetric extension set.** Adding `.ts`, `.jsx`, `.swift` for symmetry seemed natural during the first pass — Designer ships a Swift helper, so `.swift` lines in CLAUDE.md are real. Cut on review because the user spec explicitly listed four extensions, and unauthorized scope creep on a corpus-defining PR causes calibration drift across detectors. Re-add via a separate PR if the empty-fixture FPR data later supports it; bump `VERSION` per CONTRIBUTING §3.
- **Detector-internal cap vs chokepoint cap.** `config_gap.rs` short-circuits its own loop when `findings.len() >= cap`. This detector emits unconditionally and lets the chokepoint refuse the overflow, per the task spec. Trade-off: a CLAUDE.md with 50 matching lines wastes a few microseconds building findings the chokepoint immediately drops, but the code path is uniform with the rest of the squad and the chokepoint's per-session ledger is the single source of truth. The waste is bounded by the file's own line cap.

**Lessons learned:**

- **Keyword corpora are calibration surfaces.** Adding a keyword silently changes detector behavior across every project; doing it under the cover of a "symmetric extension set" rationale is the kind of small drift that compounds. Future detector authors should treat the corpus as a separate review surface even when bundled with the detector PR.
- **Multi-perspective review caught two FPs the inline tests missed.** `react` and `tauri` both passed every test in the first-pass fixture suite because the fixture's wording happened not to contain `interact`/`reaction` and the fixture used `apps/desktop/src-tauri/` (where `apps/desktop/` won iteration order). The negative-fixture catches "no domain references at all" but doesn't catch "a domain reference that *also* substrings into common English." Review caught it; consider a dedicated "high-FP edge fixture" pattern in CONTRIBUTING when corpora carry English-overlap risk.
- **Dead code from defensive copy.** `trim_summary` + `SUMMARY_BUDGET` were copied from `config_gap.rs` without re-checking whether the new summary template could overflow. Since this detector's summary is `"CLAUDE.md L<u32> references <≤13-char>"` ≤ 46 chars, the truncation branch is unreachable — confirmed by counting the format components. Removed on simplify; saved a function and a const.

**Quality gates:**

- `cargo fmt --all -- --check` ✅
- `cargo clippy --workspace --all-targets -- -D warnings` ✅
- `cargo test -p designer-learn` ✅ (106 lib tests + 2 fixture-driven harness tests)

---

### Bugfix — `tokio::spawn` from Tauri `setup` panics bundled .app on launch
**Date:** 2026-04-29
**Branch:** build-issue
**PR:** #56

**What was done:**

Swapped `tokio::spawn` → `tauri::async_runtime::spawn` in `apps/desktop/src-tauri/src/core_proposals.rs` (the new Phase 21.A1.2 module added in #49). Two call sites: `spawn_track_completed_subscriber` (the boot-time subscriber wired from `main.rs::setup`) and `schedule_track_synthesis` (the debounced synthesis spawn). Added a docstring on the boot-time function calling out the constraint, and pointed back to the original 13.D fix.

Same PR adds a regression test (`apps/desktop/src-tauri/src/core_proposals.rs::tests::spawn_subscribers_do_not_require_caller_runtime`) that exercises both call sites from a plain `#[test]` (no Tokio context entered), proving the spawn does not require `Handle::current()`. This test would have caught both this occurrence and the prior 13.D one.

A workspace-scoped `clippy.toml` `disallowed-methods` ban on `tokio::spawn` in `apps/desktop/src-tauri/` is a strong follow-up — the lint is per-crate and trips every existing `tokio::spawn` call site in `core.rs` / `core_learn.rs` / `core_local.rs`, which would each need an audit + `#[allow(clippy::disallowed_methods)]` with justification (each is reached from inside an entered runtime context). Out of scope for the bugfix PR; tracked separately.

**Why:**

A locally-built `Designer.app` from `cargo tauri build` crashed on launch with `SIGABRT` ~400 ms after spawn. The macOS crash report (`~/Library/Logs/DiagnosticReports/designer-desktop-*.ips`) showed the faulting thread top-frames inside `__CFNOTIFICATIONCENTER_IS_CALLING_OUT_TO_AN_OBSERVER__` → `-[NSApplication _postDidFinishNotification]`, abort'd from a Rust panic. The user's panic hook captured the actual message: `panicked at apps/desktop/src-tauri/src/core_proposals.rs:61:5: there is no reactor running, must be called from the context of a Tokio 1.x runtime`.

This is the **third occurrence** of this bug pattern in the project (see entry below for #2 in 13.D's `spawn_message_coalescer`, and the 13.0 fix for `spawn_event_bridge`). Tauri's `setup` callback runs on the main thread *before* a Tokio runtime context is bound — `tokio::spawn` panics there. `tauri::async_runtime::spawn` is the supported API and works regardless of caller context, because Designer registers its tokio runtime with Tauri at boot via `tauri::async_runtime::set` (`main.rs:131`).

**Why this slipped through CI:**

Phase 21.A1.2 unit and integration tests (`crates/designer-learn/tests/...` + `apps/desktop/src-tauri/src/core_proposals.rs::tests`) all use `#[tokio::test]`, which sets up a runtime before the test body runs. The boot-from-`setup` path is not exercised by the test suite — the panic only surfaces against a real bundled launch. The new `#[test]` (not `#[tokio::test]`) regression test plugs that gap.

**Quality gates:**

- `cargo fmt --check` ✅
- `cargo clippy --workspace --all-targets -- -D warnings` ✅
- `cargo test --workspace` ✅
- Local `cargo tauri build` produces a `.app` that opens to the main window without abort ✅

---

### Phase 21.A2 — `multi_step_tool_sequence` detector (Forge-overlap)
**Date:** 2026-04-29
**Branch:** multi-step-tool-seq
**PR:** #55

**What was done:**

Phase 21.A2's first Forge-overlap detector. Surfaces the "same N-tool sequence repeated across multiple sessions" pattern that Phase B's synthesizer turns into a `skill-candidate` (or `agent-candidate`) proposal. Walks the workspace event stream, treats user `MessagePosted` events as session boundaries, and emits length-3 sliding windows over runs of agent tool-use `ArtifactCreated` artifacts. A finding fires once per tuple identity that hits both `min_sessions` distinct sessions and `min_occurrences` total occurrences.

- **Tool-name extraction is a string parse, not a typed read.** Designer doesn't yet have a typed `ToolCalled` event variant; the closest signal is the verb-first `ArtifactCreated` title produced by `tool_use_card` in `crates/designer-claude/src/stream.rs` (Phase 13.H F5). The detector parses the leading verb back to a canonical tool identifier (`Read`/`Write`/`Edit`/`Search`/`Bash`/`Used <X>`). Lossy on the way in by design — `MultiEdit`/`NotebookEdit` collapse to `Edit`, `Glob`/`Grep` collapse to `Search` — so two sessions invoking the same logical workflow fold to one tuple identity. `MultiStepToolSequenceDetector::VERSION` bumps to 2 when the typed event lands.
- **Pre-message tool runs are discarded.** Tools that arrive before the first user `MessagePosted` have no session anchor — there is no `Anchor::MessageSpan` target. The detector's session counter stays `None` until the first user message, so pre-message events neither inflate the distinct-session count nor leak phantom evidence. Caught during the staff-engineer review pass.
- **Anchor cap.** Both `MessageSpan` and `ToolCall` anchor lists cap at `MAX_ANCHORS_PER_KIND = 5` per finding. The summary keeps the uncapped session + occurrence counts. Matches the `approval_always_granted` cap convention so a busy workspace doesn't ship a finding with hundreds of evidence anchors.
- **Defaults from Forge.** Reuses `defaults::SKILL_DEFAULTS` (4 occurrences / 3 sessions) — the docstring already named this detector as a consumer when the constant was migrated from Forge's `THRESHOLDS["skill"]`. Already in `FORGE_OVERLAP_DETECTORS`; AppCore disables it when Forge is co-installed.
- **Fixtures.** Three: positive (3 sessions × `(Read, Edit, Bash)` → one finding), distinct (3 sessions, all different tuples → no finding), under-threshold (same tuple in only 2 of 3 sessions → no finding). Disk-driven harness mirrors the `cost_hot_streak` `--ignored regenerate_fixtures` pattern; fixture config pins `min_occurrences: 3 / min_sessions: 3` to land exactly on the roadmap floor while production keeps the SKILL_DEFAULTS 4/3.

**Why:**

`multi_step_tool_sequence` is the canonical "did this turn into a workflow?" signal — the user can promote a recurring sequence into a skill or sub-agent so the lead doesn't re-derive it every session. Forge already ships an analog, hence the Forge-overlap registration; Designer runs it on the workspace event log instead of the plugin transcript.

**Design decisions:**

- **Sliding-window granularity, not whole-run identity.** A run `[A, B, C, D]` produces two windows (`A→B→C`, `B→C→D`) rather than one whole-run tuple. Captures recurring 3-grams even when the surrounding workflow length differs across sessions.
- **`Severity: Notice`** — per CONTRIBUTING.md §6, the A2 default. A `Warn` would crowd out three `Notice` findings on the workspace home, and a "you're repeating this workflow" observation is suggestive rather than action-worthy on its own.
- **Confidence clamped to `[0.5, 0.9]`** — three identical sequences across three sessions is rare by chance, so the floor sits high; but the user could plausibly be drilling on the same task in three back-to-back sessions for unrelated reasons, so the ceiling sits below 1.0.
- **Tool-name canonicalization is opinionated.** Folding `Edit`/`MultiEdit`/`NotebookEdit` to `Edit` and `Glob`/`Grep` to `Search` means `(Read, Edit, Bash)` and `(Read, MultiEdit, Bash)` register as the same workflow. Two alternatives considered: (a) preserve the precise tool variant, splitting near-identical workflows; (b) collapse all "read-shaped" tools into one bucket, over-merging. Picked the middle path.

**Technical decisions:**

- **`extract_tool_name` returns `Option<&str>`.** Borrows from the input title rather than allocating; the callsite decides when to allocate. Keeps the per-artifact path allocation-free for known verbs.
- **Drop the synthetic session-0 bucket.** First draft created a default `SessionInfo` for events before any user message. The post-review refactor tracks `current_session: Option<usize>` instead, so pre-message events don't need a phantom anchor and don't count toward `min_sessions`. The summary's session count and the evidence's `MessageSpan` count now agree by construction.
- **`Vec<Cow<'static, str>>` rejected for HashMap keys.** Tuple keys store owned `Vec<String>` since the hash + compare by value matches HashMap's standard contract. The borrow-vs-own optimization for static tool names would only save allocations on tuples that never make it into the HashMap (i.e., runs shorter than 3) — academic. The `extract_tool_name` borrow change is the hot-path win.

**Tradeoffs discussed:**

- **Cap evidence anchors at 5 per kind** vs. **emit one anchor per occurrence.** Reviewers (efficiency + UX) flagged uncapped emission as both a memory pressure and a UI-noise concern — a workspace with 50 sessions running the same tuple would attach 50 anchors per kind. The summary's count keeps the full picture; anchors are spot-check pointers.
- **Lift `truncate_with_ellipsis` into shared crate utility** vs. **keep private.** Sibling `scope_false_positive::trim_summary` does the same thing under a different name, so a future PR could DRY them up alongside any third caller. CLAUDE.md's "three similar lines is better than a premature abstraction" pushes the cross-detector refactor outside this PR's scope.
- **Use the spec floor (3/3)** vs. **use Forge's calibration (4/3).** Roadmap text says "3+ identical sequences across 3+ sessions"; Forge ships 4/3. Picked Forge's calibration for the production default (the `defaults.rs` docstring already named this detector as a consumer) and pinned the fixture config at 3/3 so a regression that *raises* the production floor surfaces in the unit tests instead of the fixtures.

**Lessons learned:**

- Title-prefix parsing is a stand-in for a typed `ToolCalled` event. The `(Read|Wrote|Edited|Searched|Ran|Used)` set is small and audit-friendly today, but every new tool-use card variant in `tool_use_card` needs a parser-side update or it becomes invisible to this detector. The `VERSION` bump-on-typed-event-landing is the long-term fix; until then, the parser table is the coordination point.
- The pre-message bucket bug was only catchable by reading the data model end-to-end (summary count vs. evidence count). Test cases that look at "did the detector fire" wouldn't surface it; the new `pre_message_tool_runs_are_discarded` regression test pins the fix.

---

### Phase 21.A2 — `compaction_pressure` detector (Designer-unique)
**Date:** 2026-04-29
**Branch:** compaction-pressure-detector
**PR:** #54

**What was done:**

Fourth Designer-unique Phase A detector. Catches the pattern *the user types `/compact` (Claude Code's built-in slash command) regularly across multiple Designer sessions in a short window*. Lives at `crates/designer-learn/src/detectors/compaction_pressure.rs`. Single pass over `input.events`: group `MessagePosted` by payload `workspace_id`, segment per-workspace into sessions via a 60-minute idle gap on adjacent message timestamps, mark a session **qualifying** when it contains a `/compact` body inside the trailing-7-day window anchored on the most-recent input event, and emit one `Severity::Notice` `Finding` per workspace whose qualifying-session count meets `config.min_sessions` (default 3). Evidence: `Anchor::MessageSpan` per `/compact`, capped at `MAX_EVIDENCE_ANCHORS = 5`. Two on-disk fixtures (trigger + under-threshold) plus 11 in-module tests.

**Why:**

Per `roadmap.md` L1476: *`/compact` invoked ≥1×/session consistently. Threshold: 3+ sessions in a week. Output kind: `context-restructuring` (Phase B).* Forge's analyzer never sees the slash commands the user types into Claude Code; Designer captures them natively as `MessagePosted` events. The detector's signal feeds a future `context-restructuring` proposal — usually "demote a long CLAUDE.md block to a reference doc," "lift conversation-only context into a memory note," or "trim a runaway agent transcript so the user no longer needs to manually compact mid-session."

**Design decisions:**

- **Idle-gap session segmentation, not a typed boundary.** Designer doesn't yet emit a `SessionStarted` payload, so the detector can't read process-boundary events directly. The 60-minute idle gap on `MessagePosted` events is the cheapest correct proxy. When a typed boundary lands, bump `CompactionPressureDetector::VERSION` per CONTRIBUTING.md §3 and switch — old findings stay attached to v1.
- **Trailing window anchored on input, not wall-clock.** `latest_ts` is `input.events.iter().map(|e| e.timestamp).max()` rather than `OffsetDateTime::now_utc()`, so the detector is reproducible from a frozen event log and replay is deterministic.
- **Per-workspace finding emission.** The detector loops a `BTreeMap<WorkspaceId, ...>` and emits one `Finding` per qualifying workspace, with `workspace_id: Some(ws)` from the loop key — not `input.workspace_id`. This is the first detector to behave correctly on project-wide bundles (`input.workspace_id == None`), which Phase 21.A3 will rely on.
- **Severity `Notice`** per CONTRIBUTING.md §6 — A2 default. Raising to `Warning` would need <5% measured FP rate on the fixture suite, which would require Phase B's synthesis pass to be live first.
- **Anchor cap at 5** (matches `approval_always_granted`'s convention). The exact `/compact` count is in the summary; anchors are spot-check pointers for the proposal evidence drawer, so the drawer stays scannable. The `window_digest` keys on **every** qualifying compact's event id (not the capped anchor list) so dedupe stays stable as more sessions pile on inside the same trailing-7-day window.
- **`config.min_occurrences` advisory in v1.** The roadmap pins the threshold on session breadth, not raw `/compact` count, so the detector counts sessions and ignores `min_occurrences`. The default is set to 3 to mirror `min_sessions` so a user override of either knob alone behaves intuitively.

**Technical decisions:**

- **`Finding.timestamp` pins the last qualifying compact**, not the latest input event — semantically tighter and avoids a trailing non-compact message bumping the finding's timestamp into unrelated activity.
- **`is_compact_command` matches `/compact` only at body head, terminated by EOF or whitespace** — `/compactify` and `/compact-foo` don't trigger.
- **`build_anchor` is gated by `is_compact_command`** at the call site. The fallback arm (non-`MessagePosted` envelope) is unreachable in practice but degrades to a usable anchor instead of panicking — defenses go cheap when the runtime cost is one match arm.

**Tradeoffs discussed:**

- **Lift `trim_summary` into a shared helper** vs. **keep per-detector copies.** `scope_false_positive` made the same call (CLAUDE.md's "three similar lines is better than a premature abstraction"); deferred until a third caller appears with the same budget.
- **One pass for `latest_ts` + grouping** vs. **two clean O(n) passes.** Two passes is clearer, the cost is bounded (analysis windows are small), and the early-return-on-empty-input guard wants `latest_ts` in hand before the grouping loop. Code clarity wins.

**Lessons learned:**

- First detector to loop per-workspace inside `detect()` to support project-wide bundles. The `Some(workspace_id)` from the loop key (vs. `input.workspace_id`) is the right pattern; reviewers should watch for this in future detectors that aggregate across workspaces.

---

### Phase 21.A2 — `repeated_prompt_opening` detector
**Date:** 2026-04-29
**Branch:** repeated-prompt-opening
**PR:** #53

**What was done:**

First Forge-overlap detector in the Phase 21.A2 squad. Walks the event stream, picks the first user `MessagePosted` per `WorkspaceId` (the "session opener"), tokenizes each opener (lowercased, punctuation-stripped), and clusters by Jaccard similarity over the token sets. A cluster of `min_occurrences` (default 4 per `SKILL_DEFAULTS`) openers emits one `Severity::Notice` finding intended for a `skill-candidate` proposal under Phase B's synthesis pass.

- **Workspace-as-session heuristic.** `SessionAnalysisInput` doesn't yet expose explicit session boundaries. Sibling Phase 21.A2 detectors converge on workspace-as-session (`repeated_correction.rs` counts distinct `WorkspaceId`s for its `min_sessions` gate), so this detector follows suit. Each opener is the first user message of a unique workspace, which means cluster size *is* the distinct-session count — `min_occurrences` and `min_sessions` collapse to one threshold check.
- **Greedy connected-components clustering.** A new opener joins the *first* cluster whose any existing member shares Jaccard ≥ `REPEATED_PROMPT_OPENING_JACCARD_MIN` (0.5); otherwise it seeds a new cluster. Deterministic given the event stream's sequence ordering. O(N·K·M) where N is openers, K clusters, M average cluster size — bounded by the analysis-window size (~50 events).
- **Listed in `FORGE_OVERLAP_DETECTORS`.** Forge ships `find_repeated_prompts` in `analyze-transcripts.py` L1199–L1252. AppCore's `core_learn::probe_for_forge` defaults the config to `DetectorConfig::DISABLED` when `~/.claude/plugins/forge/` is present; the detector logic stays correct so the user can re-enable it explicitly.
- **Defaults reuse `SKILL_DEFAULTS` plus a Designer-unique Jaccard floor.** `min_occurrences: 4, min_sessions: 3` come from Forge's `THRESHOLDS["skill"]` via the existing `SKILL_DEFAULTS` constant. The new `REPEATED_PROMPT_OPENING_JACCARD_MIN: f32 = 0.5` constant in `defaults.rs` cites Forge `analyze-transcripts.py` L1231 (Forge ships 0.30) and explains the tightening: the cockpit surface is more attention-scarce than Forge's CI log, so a higher-precision/lower-recall floor keeps the proposal feed clean.
- **`tokio::time::timeout` belt-and-braces.** Wraps the analysis pass in a 250 ms inner timeout per CONTRIBUTING §"partial-failure containment", matching `repeated_correction.rs`. The orchestrator wraps detectors at the outer level too; the inner timeout protects the pipeline if the outer harness regresses.
- **Fixtures.** Three: positive (4 paraphrased openers across 4 workspaces — clusters above 0.5 Jaccard); negative-similarity (4 distinct openers — no pair clusters); negative-count (3 matching openers — under `min_occurrences=4`). Disk-driven harness at `tests/repeated_prompt_opening.rs` plus seven in-module unit tests covering tokenizer, Jaccard edges, confidence band, summary copy, opener-per-workspace semantics, disabled config, and non-user-author skip.

**Why:**

Per `roadmap.md` row L1465 (`Session-opening user messages with >0.5 Jaccard similarity. Threshold: 4+ sessions. Output kind: skill-candidate`). The signal is "the user keeps starting sessions the same way" — a strong candidate for promoting that opener into a reusable skill. Forge has a less-strict version (0.30 floor); the Designer version cites and tightens.

**Design decisions:**

- **No stopword filtering.** Forge's `analyze-transcripts.py` runs a stopword pass (`STOPWORDS` at L70) before tokenizing. Designer skips it — the higher Jaccard floor compensates for the noise stopwords would add. Simpler tokenizer earns its keep against the stricter threshold.
- **Severity `Notice`, not `Warn`.** Per CONTRIBUTING §6: A2 default is `Notice` unless the detector's measured FPR is <5% on the fixture suite. The clustering can over-merge near the threshold (e.g. "review the diff" matches "review the docs" if both share enough scaffolding tokens), so `Notice` is the conservative pick.
- **Cluster size is the only count gate.** Because each opener is the first user message of a unique workspace, `cluster.len() == distinct_workspaces`. The `min_sessions` check collapses to redundant defense; kept the gate for forward-compatibility if the bundle gains finer session boundaries later (bump `VERSION` per CONTRIBUTING §3 then).
- **Quote budget 160 chars + ellipsis.** Long openers (paragraph-sized initial prompts) truncate for evidence-drawer skim-readability. The `char_range` still anchors to the full source-body byte length so the renderer can highlight back into the original message.

**Technical decisions:**

- **Byte-indexed `char_range`.** Matches `repeated_correction.rs`'s convention (its `char_range` is computed from `str::find` byte offsets). Consistent across detectors so the renderer can treat the field uniformly.
- **`Opener` struct dropped its `workspace_id` field.** First draft tracked workspace_id per opener for a `BTreeSet` distinct-count. After review noticed the redundancy (one opener per workspace, count == distinct_workspaces by construction), the field and the BTreeSet went away.
- **Greedy clustering returns `Vec<Vec<Opener>>` with clones.** For N=50, max ~100 KB of cloned data. An indices-based `Vec<Vec<usize>>` would save the clones but require lifetime gymnastics; not worth the complexity at this scale.

**Tradeoffs discussed:**

- **Confidence-score helper extraction.** `repeated_correction.rs:377` and this detector ship the same `0.5 + above × 0.10` clamp. Reuse reviewer flagged it as a candidate. CONTRIBUTING §3 documents per-detector calibration as the convention (sibling detectors `cost_hot_streak` and `scope_false_positive` ship different formulas), so kept private. If a third detector lands the same shape, lift it to `lib.rs`.
- **Test-helper extraction.** Sibling integration tests (`tests/repeated_correction.rs`, `tests/scope_false_positive.rs`, `tests/cost_hot_streak.rs`) ship near-identical `fixture_dir` / `load_input` / `load_expected` / `user_msg` / `write_fixture` helpers. Per `tests/example_fixture.rs` design notes, this is intentional duplication so each detector's fixture harness stays self-contained when copy-renamed.

**Lessons learned:**

- Reviewer caught that the original summary copy (`"... in N sessions across M workspaces"`) was tautological since N == M for this detector. Multi-perspective review (staff engineer + UX + UI + design engineer) keeps catching copy-vs-implementation drift; cheaper to run before merge than to amend.
- The `tokio::time::timeout` wrap was missed in the first draft — only `repeated_correction.rs` shipped it among the existing four detectors. Worth adding to the CONTRIBUTING checklist as a per-detector requirement, not a "as needed" pattern.

---

### Phase 21.A2 — `scope_false_positive` detector (Designer-unique)
**Date:** 2026-04-29
**Branch:** detector-scope-false-pos
**PR:** #46

**What was done:**

Third detector in the Phase 21.A2 squad and the second Designer-unique one. Reads `ScopeDenied` events (Designer's gate log; invisible to plugin tooling) and pairs each canonical denial path with a subsequent `ApprovalRequested` + `ApprovalGranted` whose request summary names the same path. Three or more same-path denials with at least one matching override → one `Severity::Notice` finding with confidence clamped to `[0.5, 0.85]`, intended for a `scope-rule-relaxation` proposal under Phase B's synthesis pass.

- **New module tree.** `crates/designer-learn/src/detectors/{mod.rs,scope_false_positive.rs}` — the canonical place every Phase 21.A2 detector now drops itself into. Prior to this PR there was no `detectors/` directory; the example detector lives at the crate root and the registry is intentionally a flat `pub mod` list rather than a global, per `CONTRIBUTING.md` §2.
- **Lexical path canonicalization.** `canonicalize_in_spirit()` strips empty / `.` components, resolves `..` against the running stack, drops trailing slashes — *without* touching the filesystem. Events may reference paths that don't exist on the analysis host (especially after a worktree is cleaned up), so Phase 13.I's filesystem `canonicalize()` is the wrong tool here. The function is private to the detector; if a second detector needs it, lift it next to `window_digest` in `lib.rs`.
- **Glob handling on summary match.** When the denial path is a glob (`src/foo/*` or `src/foo/**`), the trailing wildcard is stripped and the prefix substring-matched against the approval summary so a concrete-path approval (`Allow write to src/foo/bar.rs`) still credits the rule.
- **Anchor variant choice.** `ToolCall { event_id, tool_name }` is the closest fit for a domain (non-tool) event reference under the locked Anchor enum (no new variants per CONTRIBUTING.md §1). The `tool_name` values `"ScopeDenied"` and `"ApprovalGranted"` are exposed as `pub const` on the detector type so tests and downstream consumers can reference the symbol instead of magic strings.
- **Fixtures.** Positive trigger (3 denials → 3 grants, with one `./src/foo/bar.rs` form to exercise the canonicalizer in fixture-land, not just unit tests) and negative (3 denials, no overrides → no findings). Disk-driven harness at `tests/scope_false_positive.rs` plus four in-module unit tests covering canonicalization, glob-prefix matching, the threshold edge, and quiet-without-override.

**Why:**

Per `roadmap.md` §"Phase 21.A2 — Detector squad", `scope_false_positive` is the third in the recommended order — it leverages Designer's event-store advantage over Forge's plugin position (Forge can't see `ScopeDenied`). The detector's signal is "the user keeps overriding this rule" — the input to a future `scope-rule-relaxation` proposal, which is safety-gated (re-type-to-confirm + risk-note required) downstream.

**Design decisions:**

- **Confidence clamp `[0.5, 0.85]`** — repeated overrides strengthen the signal (suggests the rule is too tight), but the user could equally be widening scope by mistake. Capping below 0.9 keeps the Phase B synthesizer from promoting this finding into auto-applied recommendations.
- **`min_sessions` not consumed in Phase A** — `SessionAnalysisInput` doesn't yet expose per-session boundaries. Default ships at `min_sessions: 1` so observed behavior matches the configured policy. When the bundle gains a session-split view, bump `VERSION` per the threshold-defaults convention in `CONTRIBUTING.md` §3 and start filtering on it.
- **Severity `Notice`, not `Warn`** — per CONTRIBUTING.md §6: "Designer's noise tolerance is much lower than Forge's." A `Warn` would crowd out three `Notice` findings on the workspace home, and the override pattern is suggestive rather than action-worthy on its own.

**Technical decisions:**

- **Typed `ApprovalId` / `EventId` keys.** First draft used `String` keys for the pending-approval map and string event IDs in `PathEvidence`. The post-review refactor switched to the typed `Copy` IDs and deferred stringification to `build_finding`, where the strings are computed once and reused for both `Anchor` event_ids and the `window_digest` key list.
- **Drain-and-sort emission.** `by_path.into_iter().collect::<Vec<_>>()` + `sort_by` + `filter().take().map().collect()` rather than re-locking the map with `keys().cloned() / by_path.get()`. Lets `build_finding` consume `PathEvidence` by value, no clones.
- **`by_path.is_empty()` short-circuit on `ApprovalRequested`.** Skips `summary.clone()` and the iter scan for any approval whose request precedes any denial in the session. Common case in early-session windows.

**Tradeoffs discussed:**

- **Lift `trim_summary` into a shared `truncate_with_ellipsis`** vs. **keep it private.** `crates/designer-claude/src/stream.rs::truncate` is a near-duplicate but lives in a different crate and doesn't append an ellipsis. CLAUDE.md's "three similar lines is better than a premature abstraction" wins — leave private until a third caller appears.
- **Unify the two `anchors.extend(...)` calls behind a closure** vs. **leave the duplication.** Reviewer flagged it as marginal; the explicit form reads cleaner.

**Lessons learned:**

- The locked `Anchor` enum's `ToolCall { event_id, tool_name }` variant is doing double duty as the only event-reference variant. Every Phase 21.A2 detector that wants to point at a non-tool event (`ApprovalGranted`, `ScopeDenied`, `CostRecorded`, …) will exercise this same stretch. Worth flagging if a third detector wants the same thing — the variant docstring should be widened to "an event in the workspace stream" rather than "a tool-call event."

---

### Phase 21.A2 — `approval_always_granted` detector (Designer-unique)
**Date:** 2026-04-29
**Branch:** detector-approval-granted
**Commit:** range starting `2e6f3dd` on `detector-approval-granted`

**What was done:**

First Designer-unique Phase A detector (`crates/designer-learn/src/detectors/approval_always_granted.rs`). Walks an event slice once, groups `ApprovalRequested/Granted/Denied` triples by approval class, and emits a `Severity::Notice` finding when a class has ≥5 grants and 0 denials. Three fixtures (positive trigger, under-threshold, mixed-denial) plus 16 unit tests pin the behavior. Designer-unique → not in `FORGE_OVERLAP_DETECTORS`; always runs.

**Why:**

Designer's owning the approval gate is a structural advantage over Forge: the gate stream is invisible to plugins. Detecting "this approval class is always granted" is the single highest-signal Phase A pattern that Forge cannot replicate, so it's the right detector to land first after `repeated_correction` (a Forge-overlap detector with mature thresholds).

**Design decisions:**
- **Approval class = `(workspace_id, tool, canonical_input)`.** Workspace is part of the key so a project-wide bundle doesn't merge unrelated workspaces' grants into one false-positive class. The tool comes from the gate's `tool:<Name>` prefix; canonical input is per-tool: parent directory for Write/Edit/MultiEdit/NotebookEdit, `verb *` for Bash, lowercased ≤80-char fallback otherwise. Phase B re-implements the rule on its side; the docstring is the contract.
- **Clinical summary copy.** `"ApprovalRequested for Bash(prettier *) granted 6×, 0 denials"` — passive voice, pattern-described, ≤100 chars, no second-person address. Per the 21.A1.2 surface contract, summaries are evidence text rendered under proposals, not user-facing prose. Phase B's synthesis composes the recommendation.
- **`suggested_action: None`.** Proposal kind (`auto-approve-hook` vs `scope-expansion`) is Phase B's call, not the detector's.
- **Confidence band `[0.6, 0.95]`.** Zero-denial in N≥5 attempts is empirically strong, so the floor is high. Linear in extra grants above the threshold; saturates at 0.95.

**Technical decisions:**
- **`window_digest` keyed on class identity, not evidence.** First draft hashed the (capped) `grant_event_ids` list, which broke the `core_learn::report_finding` chokepoint dedup in two ways: (1) sliding the analysis window changed the digest and re-emitted the same finding; (2) grants beyond the cap left the digest unchanged, so an updated `granted 7×` finding was suppressed as a duplicate of the earlier `granted 6×`. Switched to `sha256("approval_always_granted" + workspace_id + tool + canonical_input)` so the digest tracks class identity. Per-class dedup behaves correctly across runs.
- **Workspace_id in `ClassKey`.** First draft pulled `workspace_id` for the finding from `input.workspace_id` (which is `None` for project-wide bundles) and didn't include it in the class key, so cross-workspace grants merged. Now `ClassKey { workspace_id, tool, input }`; the finding's `workspace_id` is set from the key.
- **Orphan resolutions logged + dropped.** A `Granted`/`Denied` whose request scrolled out of the window can't be attributed to a class. Counting it would bias toward "always granted" (denials in a truncated head, grants in the visible tail). Logged at `tracing::debug!` so calibration data shows when callers pass too-narrow windows; production callers pass the full project log so this is an edge case.
- **Tool casing preserved separately from the class key.** `tool:MultiEdit` lowercases to `multiedit` for the hash key; the original cased form is captured per-request and cached on `ClassAggregate::display_tool` so summaries render `"MultiEdit"`, not `"Multiedit"`.
- **Path canonicalizer rejects flag args and URLs.** First draft's `tok.contains('/')` matched `--write=/tmp/old` and `https://example.com`. Now requires `!tok.starts_with('-')` and `!tok.contains("://")`.
- **Bash canonicalizer strips `Label:` prefixes.** Real summaries like `"Bash: prettier src/foo.js"` were collapsing to a `bash *` self-class, swallowing the actual command. Now strips one or more leading `Foo:` tokens before parsing.
- **`min_sessions` is advisory in v1.** This detector treats each workspace stream as one session. Tuners setting `min_sessions > 1` get a `tracing::debug!` line; multi-session aggregation is Phase 21.A3.

**Tradeoffs discussed:**
- **Path parsing on summaries vs `Path::parent()`.** Summaries are arbitrary text containing path *tokens* mixed with verbs and arguments, not real `Path` values. `rsplit_once('/')` handles the token-extraction job; using `Path::parent()` would require re-parsing each whitespace-separated token as a `Path` first. Stuck with `rsplit_once`.
- **Per-detector fixture harness vs shared driver.** CONTRIBUTING.md picks the per-detector copy-rename pattern explicitly: the fixture *behavior* is the canonical reference, so abstracting a shared driver would hide what the detector actually does. Followed.
- **Fixture format.** Custom assertion fields (`summary_contains`, `evidence_count`, `confidence_min/max`) instead of full `Finding` shape, because `id` and `timestamp` are volatile. Inspired by the example_fixture pattern; mirrors what the CONTRIBUTING.md "expected.json" guidance suggests.

**Lessons learned:**
- A Detector-trait + Finding contract isn't enough — `window_digest` semantics live one layer down (in the chokepoint dedup), and getting the digest right matters more than getting the finding shape right. Documented the digest-as-class-identity rule in the module docstring so the second Designer-unique detector author doesn't repeat the bug.
- Cross-workspace bleed is a foreseeable bug for any class-keyed detector when the input bundle is project-wide. Future detectors with class-style keys should default to including `workspace_id` in the key unless they're explicitly project-wide aggregations.
- The four-perspective review (staff engineer + UX + UI + design engineer) caught six bugs the first-pass implementation shipped: `window_digest` keying, cross-workspace bleed, orphan-resolution bias, flag-arg path mismatch, label-prefix swallow, silent `min_sessions` ignore. Worth running before merge on every detector PR.

---

### Track 13.M — Friction trivial-by-default UX
**Date:** 2026-04-28
**Branch:** friction-trivial-ux

**What was done:**

Rewires the Friction widget so the typed-sentence path is the default and selection mode demotes to opt-in. Folds in 13.K's deferred v2 items (auto-capture via ⌘⇧S, stream-subscribed toast).

- **Composer-default flow.** ⌘⇧F mounts the composer bottom-right with the body textarea autofocused. Body alone is enough to submit (⌘↵). When the user submits without anchoring, the new `pageAnchorForRoute()` helper in `lib/anchor.ts` synthesizes a page-level `dom-element` Anchor against the active route. ESC dismisses.
- **⌘⇧S viewport capture.** New `cmd_capture_viewport` IPC. Tauri 2.10 has no built-in webview-capture API, so we shell out to macOS `screencapture -R<x,y,w,h>` against the window's screen rect, scaled from physical pixels back to points via `WebviewWindow::scale_factor()`. Tempfile lifecycle uses `tempfile::NamedTempFile` (auto-deletes on drop) instead of a hand-rolled `/tmp/` path. The frontend hides the composer for one paint frame (two `requestAnimationFrame`s) before invoking the command so the composer doesn't appear in its own screenshot. Non-macOS hosts return a clear "macOS-only in this build" error.
- **Opt-in anchor mode.** ⌘. or 📍 button in the composer header enters selection mode; the composer hides while selection is active and restores with the anchor descriptor as a chip (× to clear). The selection-mode banner keeps a persistent legend ("Click element to anchor · Alt: anchor exact child · ESC to cancel") so Alt-overrides-snap is discoverable.
- **50ms suppression replaces 600ms grace.** 13.K's silent 600ms outside-click grace was the largest source of "where did my click go?" ambiguity. Replaced with a deterministic 50ms swallow after arming — long enough to absorb the click that triggered selection mode, short enough to feel instant.
- **Demoted FrictionButton.** Smaller footprint (`target-sm`), opacity-led hover, no accent fill while active. ⌘⇧F is the primary trigger; the button is the discoverable affordance for users who don't yet know the shortcut.
- **Persistent key-hint footer** in the composer: `⌘↵ submit · ⌘⇧S screenshot · ⌘. anchor · esc dismiss`. Data-driven (`KEYHINTS` array) for low-cost extension. `aria-keyshortcuts` declared on the dialog root so AT users get the shortcuts announced.
- **Stream-subscribed toast.** A useEffect keyed on `submittedId` subscribes to the workspace event stream and upgrades the toast from "Filed locally" → "Filed as #abc123" once `friction_reported` lands in the projection. The effect's cleanup tears down both the subscription and the auto-close timer on unmount or follow-up submit. Uses `EVENT_KIND.FRICTION_REPORTED` constant (added to `ipc/types.ts`) instead of a magic string.
- **Submit button label tracks state.** `Submit` → `Submitting…` → `Filed`. Previously got stuck on "Submitting…" until the auto-close fired, contradicting the toast.
- **Composer max-width.** `max-width: calc(100vw - var(--space-6))` so the popover never overflows on narrow viewports.

State machine: `frictionMode: "off" | "composing" | "selecting"` (was `"off" | "selecting" | "editing"`). Dropped the dead `frictionAutoCapture` field — the widget stays mounted across mode flips (returns null), so component state survives entering/exiting selection without store round-tripping.

**Why:**

The four-perspective review of 13.K found that selection mode added cognitive load before the user had typed a single character. For a solo dogfood user, the most common case is "the thing I'm looking at right now is bad" — they don't need to anchor, they need a fast capture. 13.M makes "type a sentence and submit" the default path so the friction loop completes in <2s with zero DOM-walking. Selection demotes to a discoverable opt-in for the cases that actually need it.

**Design decisions:**

- **Page-level anchor as fallback, not a new variant.** Reuses the locked `dom-element` Anchor variant per the frozen contracts; no new event variant needed. `pageAnchorForRoute()` lives next to the other anchor helpers in `lib/anchor.ts` for reuse.
- **Hide-for-one-frame via two rAFs.** The first rAF fires after the `visibility: hidden` style is committed; the second fires after a paint actually lands. With one rAF the capture occasionally raced and included the composer's pixels.
- **`tempfile::NamedTempFile` over hand-rolled `/tmp/` paths.** Auto-cleanup on drop replaces an explicit unlink + `uuid_lite()` shim. Workspace already depended on `tempfile`; the simpler version is also more correct (cleans up even on panic).
- **Visual demotion before removal.** The button stays as a discoverable affordance. Removing it entirely would be cleaner if every user knew ⌘⇧F, but they don't — and the demoted button costs us nothing while teaching the shortcut via tooltip + `aria-keyshortcuts`.
- **Effect-managed stream subscription.** The submitted-id useEffect owns the subscription + the auto-close timer; React tears both down on unmount. The earlier draft registered the subscription inside the async submit callback, which leaked listeners on unmount (the `setTimeout` was the only cleanup hook).

**Technical decisions:**

- **`cmd_capture_viewport(window: tauri::WebviewWindow)`.** The Tauri command takes the calling webview window directly so we don't need to look it up by label. Geometry comes from `outer_position()` + `inner_size()` (physical pixels) divided by `scale_factor()` (the standard points<>pixels conversion `screencapture -R` expects).
- **No `frictionAutoCapture` store field.** The widget stays mounted across `mode` transitions (returns null when not "composing"), so React preserves component state — body draft, screenshot — through the round-trip into selection mode. Store round-tripping was redundant.
- **`HIDDEN_STYLE` module-level constant.** Avoids re-allocating `{ visibility: "hidden" }` on every render and bypasses an empty `{}` object literal's referential-equality churn against the `<div style>` prop.
- **`EVENT_KIND.FRICTION_REPORTED` added to the constants table.** Joins `FINDING_RECORDED` / `FINDING_SIGNALED`. Stringly-typed `event.kind === "friction_reported"` would have drifted silently if the Rust serde rename ever changed.

**Tradeoffs discussed:**

- **Webview-capture vs `screencapture` shell-out.** The spec mentioned `webview.capture()` but Tauri 2.10 doesn't ship one. Options: (a) wait for upstream, (b) pull a `xcap`/`core-graphics` Rust crate, (c) shell to `screencapture`. (c) won — it's a single tokio-blocking call, the macOS user already has the binary, and it gracefully prompts for Screen Recording permission on first use. We can swap to a Rust-native capture later without changing the IPC shape.
- **Page-level anchor synthesis vs making the IPC anchor optional.** Making the anchor optional would have broken the locked `ReportFrictionRequest` contract and forced a backend version bump. The fallback satisfies the contract and projects sensibly in the triage view (descriptor falls back to the route).
- **Subscribe-after-submit vs subscribe-at-mount for the stream toast.** The current implementation subscribes after the IPC call resolves, which leaves a tiny race window where the `friction_reported` event could fire between IPC return and effect attach. Mirrors the existing `bootData` pattern (subscribe-after-fetch). Worst case is a missed toast upgrade — the friction record itself is durable on disk + in the projection. Subscribe-at-mount with a seen-set would be more robust but adds machinery; deferred unless dogfood signal shows the missed-upgrade case.

**Lessons learned:**

- **jsdom doesn't ship `elementFromPoint`.** The 50ms-suppression Vitest needed a property stub to avoid blowing up the click-outside path. Worth noting in any future overlay tests.
- **Returning null vs unmounting matters for state preservation.** Conditionally returning null from a top-level component keeps state alive across the "hidden" period; conditionally rendering the component in the parent unmounts and loses state. The widget needs the former so the body draft survives the trip into selection mode.

---

### Phase 21.A1.1 — Designer noticed on workspace home + cap/dedup polish
**Date:** 2026-04-27
**Branch:** noticed-home-placement
**PR:** [#37](https://github.com/byamron/designer/pull/37)

**What was done:**

Lane 1.5 Wave 1 polish to close the four gaps the four-perspective review of PR #33 surfaced. Lands before Phase 21.A2 ships ten detectors on top.

- **Workspace-home placement.** New `DesignerNoticedHome` section at the bottom of the project home tab — top-N (8) severity-sorted live feed (`Warn` > `Notice` > `Info`, then most-recent-first within bucket). Auto-refetches on `finding_recorded` / `finding_signaled` stream events.
- **Settings → Activity → Designer noticed becomes the *archive*.** Same `SegmentedToggle` layout from 21.A1 — second sibling (Designer noticed) is now framed as the historian for the full list across the project; the live feed lives on home.
- **Sidebar Home button unread badge.** Derived from `finding_recorded` events with sequence > `noticedLastViewedSeq` cursor; cursor advances on workspace-home mount or archive open. Badge is a quiet pill on the Home button using `--accent-9` / `--accent-contrast` (Mini's monochrome accent — no chromatic fill).
- **Calibrated badge.** `FindingRow` now renders `👍 calibrated` / `👎 calibrated` pills whenever the finding has a `FindingSignaled` event in projection. New `core_learn::list_signals` projects the System stream into `HashMap<FindingId, (ThumbSignal, Timestamp)>`; `cmd_list_findings` joins it into a new optional `calibration: Option<FindingCalibration>` field on `FindingDto`. Local optimistic state still wins until the next refresh, so the badge appears the instant the user thumbs.
- **Detector budget + write-time dedup.** `DetectorConfig` gains `max_findings_per_session: u32` (default 5 via the new `DEFAULT_MAX_FINDINGS_PER_SESSION` const). `core_learn::report_finding` now takes `&DetectorConfig` and enforces the cap atomically (reserve-and-refund pattern under one lock acquisition; verified race-free by `report_finding_cap_holds_under_concurrency`). Before writing, scans the project's open findings projection for the same `window_digest` — duplicates silently no-op and refund the cap.
- **CONTRIBUTING.md severity calibration section.** A2 detectors default to `Notice`; `Warning` requires <5% FP-rate justification on the captured fixture suite.
- **Code cleanup.** Extracted `useFindings` hook so the workspace-home and Settings archive share the fetch + optimistic-signal logic verbatim. Centralized event-kind magic strings into `EVENT_KIND` const in `ipc/types.ts`. Parallelized `list_findings` + `list_signals` in `cmd_list_findings` via `tokio::try_join`. Added `From<LearnError> for IpcError` to match the per-crate error-wrapping convention.

**Why:**

Three concrete UX gaps the post-21.A1 review surfaced:

1. **Visibility.** Findings buried under `Settings → Activity → sub-tab` meant the user had to remember to look. The workspace home is where the user's attention naturally lands; that's where the live signal belongs.
2. **Trust loop.** Thumbing a finding gave no persistent confirmation — the optimistic button state was lost on reload. The calibrated badge closes the user-facing loop ("my thumb did something") without needing Phase B's threshold-tuning logic.
3. **Noise discipline.** Without a per-detector cap, a buggy or over-eager detector in Phase 21.A2 could flood the workspace home in one session before the user notices. The `max_findings_per_session` cap + `window_digest` dedup are cheap floors against that failure mode; both reset on process restart.

**Design decisions:**

- **Top-8 on home, full archive in Settings.** Spec says 5–10; 8 is the largest count that still fits cleanly under the existing home-tab panels at common window widths without scrolling. Backend cap is 5/detector — multiple detectors can fill the home feed, but no single one can dominate.
- **Severity sort within home, insertion order in archive.** Home is "what should I look at," archive is "what's the history" — different mental models, different sorts.
- **Badge is monochrome.** Mini's design language axiom #3 forbids chromatic accent; the unread badge uses `--accent-9` (gray-9) and `--accent-contrast` (white). The Mini convention is followed; the badge stays restrained.
- **Calibrated badge style is a neutral pill.** Color is reserved for severity (the row's left border). The badge uses `--color-border` / `--color-surface` so it reads as "additional info" rather than "another severity dimension."
- **Cursor stored as event sequence, not timestamp.** Sequences are monotonic per-stream; timestamps are subject to clock skew. The badge's "since you last looked" semantics match the event log's natural ordering.

**Technical decisions:**

- **In-memory session counter on `AppCore`.** Cheaper than an event-sourced counter; resets on restart. Matches the "session = process lifetime" framing in the spec. The race-free reservation pattern (check + bump under one lock acquisition; refund on dedup-no-op or store error) is verified by a concurrent test that spawns N+1 callers against a cap of N and asserts exactly N writes succeed.
- **`list_signals` is a one-shot projection over the System stream.** Walked top-to-bottom; events arrive in sequence order which is monotonic, so plain `HashMap::insert` already gives last-write-wins without an explicit timestamp comparison. Phase B will move to a dedicated projection when 21.A3's cross-project aggregator lands.
- **`useFindings` hook over duplicated logic.** The workspace-home and Settings archive share the same fetch, optimistic-signal, and refetch-on-stream-event behavior. One source of truth.
- **`tokio::try_join!` in `cmd_list_findings`.** The two reads (`list_findings`, `list_signals`) are independent; concurrent fetch saves the second read's latency on every page open.
- **`EVENT_KIND` const.** Replaces magic-string event-kind comparisons in TS. The Rust side serializes `EventKind` as snake_case via serde; the const mirrors that encoding so a future kind rename surfaces as a TS compile-time gap.

**Tradeoffs discussed:**

- **Reserve-and-refund vs hold-the-lock-across-await.** A sync `parking_lot::Mutex` cannot be held across `.await`; switching to `tokio::Mutex` would add per-call overhead for a counter that's hit at most once per detector per session. Reserve-and-refund keeps the sync mutex and refunds on the no-op / error paths.
- **Top-N vs the cap as the single source of truth.** Considered fixing home-feed length to the per-detector cap. Rejected — multiple detectors should be able to crowd the feed; the cap is a per-detector floor, the feed length is a per-surface choice.

**Lessons learned:**

- **Multi-perspective review found a race the spec didn't.** The cap enforcement in the first cut had a check-then-bump race that none of the spec text or my own design pass surfaced — the quality-review agent flagged it, and the resulting reservation pattern is now covered by a concurrent test that would have caught the regression at PR time.
- **CSS layout breakage from a 3rd grid child.** The home button is `display: grid` with two tracks; my first cut placed the badge as a 3rd child, which auto-flowed to a new row. Wrapping label+badge in a flex span fixed it. Worth a `data-component` audit pattern: when adding a child to an existing grid container, check the grid template before assuming `margin-left: auto` will do what you want.

**Verification:**

`cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace` (10 learn tests pass — adds `report_finding_cap_holds_under_concurrency`, `report_finding_dedupes_on_duplicate_window_digest`, `list_signals_last_write_wins_on_repeat_thumbs`), `npm run typecheck`, `npm run test` (46 tests).

---

### Phase 21.A1 — Learning layer foundation (rebased post-13.K)
**Date:** 2026-04-27
**Branch:** learn-foundation
**PR:** [#33](https://github.com/byamron/designer/pull/33)

**What was done:**

Foundation for Phase 21's learning layer so the ten detectors of Phase 21.A2 can land in parallel. Initially shipped against a vendored `Anchor` stub (because Track 13.K hadn't merged); rebased onto `main` after 13.K (#34) landed so this PR uses 13.K's `Anchor` enum verbatim.

- New crate `crates/designer-learn` with the locked `Detector` async trait (dyn-safe via `async_trait`), `DetectorConfig`, `DetectorError`, `SessionAnalysisInput` builder + `GateHistory` aggregation, Forge-migrated threshold constants + keyword corpora in `defaults.rs` (each with a `forge/scripts/...` citation comment), a `NoopDetector` worked example detector authors copy-rename, fixture-test harness (`tests/example_fixture.rs` + `tests/fixtures/example/`), and a load-bearing `CONTRIBUTING.md`.
- `Finding` struct + `Severity` + `ThumbSignal` in `designer-core::finding`. `FindingId` lives alongside the other id types in `crate::ids` via the `id_type!` macro. `Anchor` is `designer-core::anchor::Anchor` — owned by 13.K, re-used here without modification.
- Additive `EventPayload::FindingRecorded { finding }` and `EventPayload::FindingSignaled { finding_id, signal }` per the Lane 0 ADR addendum (PR #27).
- `apps/desktop/src-tauri/src/core_learn.rs` wires `report_finding` / `list_findings` / `signal_finding` onto `AppCore`, plus `forge_present` (probes `~/.claude/plugins/forge/`; Phase 21.A2 detectors with names in `FORGE_OVERLAP_DETECTORS` default to disabled when Forge is co-installed). Probe split into `forge_plugin_dir_under(home)` so the integration test never mutates process-wide `HOME`.
- New `cmd_list_findings` / `cmd_signal_finding` IPC in `commands_learn.rs` (matches the per-track `commands_<track>.rs` convention from 13.D/E/F/G + 13.K's `commands_friction.rs`). New `FindingDto` + `SignalFindingRequest` DTOs in `designer-ipc`.
- Settings → **Activity** now hosts two sub-pages via `SegmentedToggle`: 13.K's **Friction** (already shipped) and **"Designer noticed"** (this PR — read-only finding list, thumbs-up/down per row that emits `FindingSignaled`). Severity drives a left-border accent only.

**Why:**

Locking the `Detector` trait + `Finding` shape + threshold constants + a CONTRIBUTING.md *before* the ten Phase 21.A2 detector authors land in parallel. Without the foundation crate + the contract doc, ten detector authors converging from a fresh context would each pick a different threshold-constant style, a different fixture format, a different scoring approach. Three days of foundation work cuts each subsequent detector to half a day.

The surface is also genuinely useful before any detector arrives: a hand-crafted `FindingRecorded` event flows through the IPC into the Settings page, so the dogfood loop works end-to-end on first install.

**Design decisions:**

- **Settings IA — Activity holds both Friction + Designer noticed.** Locked in `roadmap.md` §"Settings IA (locked)". The sub-page selector is a `SegmentedToggle` rather than nested-rail navigation; both children share the surface conventions. 13.K shipped first as a flat "Activity · Friction" section; this PR's rebase converted it to the `SegmentedToggle` shape now that the second sibling exists.
- **Read-only + thumbs only in Phase 21.A1.** The "what to do about this finding" UI (proposal accept / edit / dismiss) is Phase B's responsibility once `LocalOps::analyze_session` lands. Calibration events (`FindingSignaled`) are recorded now so Phase B has a corpus to tune against from day one.

**Technical decisions:**

- **`Anchor` lives in `designer-core::anchor` (owned by 13.K).** Initially this PR vendored a snake-case stub. The rebase dropped that stub entirely; finding evidence now uses 13.K's locked enum (kebab-case tags, camelCase fields, `FilePath { path: String, ... }`). No shape divergence.
- **`FindingId` uses the `id_type!` macro.** The first cut hand-rolled `Display`/`FromStr`/`Default`. Three-perspective review caught the duplication; FindingId now lives alongside `ProjectId`/`WorkspaceId`/`ArtifactId`/`FrictionId` in `crate::ids` via the same macro.
- **`commands_learn.rs` matches the per-track convention.** Initially the command shims went into the omnibus `commands.rs` with a `cmd_` prefix. Reuse review caught that the codebase has two conventions — bare names in the omnibus file, `cmd_` prefix in `commands_<track>.rs`. Since `core_learn.rs` matches the parallel-track convention, the shim file matches too.
- **`derive_tool_inventory` is intentionally absent in Phase 21.A1.** Tool-call events don't yet have a typed `EventPayload` variant. Detectors that need the inventory populate it via `build_with_overrides` in 21.A2 until typed events arrive.

**Tradeoffs discussed:**

- **Vendor `Anchor` ahead of 13.K vs wait for 13.K.** Initial PR vendored. Once 13.K landed, the rebase dropped the vendor and adopted 13.K's enum verbatim — additive, zero migration. The "vendor first, swap on rebase" path saved ~3 days of serialization while keeping a single source of truth at merge time.

**Lessons learned:**

- **Comment-reality gap is a real risk in foundation PRs.** A `forge_present` docstring claimed snapshot-once at boot caching; the implementation re-checked the filesystem on every call. Three-perspective review caught the lie. Doc-strings written ahead of implementation can outlive the actual implementation — audit them before merge.
- **`std::env::set_var` mid-test races other tests in the same binary.** Refactoring the production helper to take a path argument so the test never mutates global env was cheaper than serializing tests with a mutex.

**Verification:**

`cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace` (Rust tests including #34's camelCase wire-format pinning all green), `npm run typecheck`, `npm test` (46 frontend tests). The fixture-driven proof-of-life (`tests/example_fixture.rs`) and the Forge stub-dir test (`forge_plugin_dir_under_flips_when_stub_dir_exists`) verify the deliverables.

---

### Track 13.K — Friction (internal feedback capture) — PR #34
**Date:** 2026-04-27
**Branch:** friction-capture
**Commits:** f9d7590 (initial), 3a352cb (review pass), <rebase squash>
**PR:** [#34](https://github.com/byamron/designer/pull/34)

**What was done:**

Shipped the in-app friction-capture surface so dogfood signal goes from "this affordance feels wrong" to a markdown record + GitHub issue in <5s. Surfaces:

- Bottom-right floating `FrictionButton` (⌘⇧F shortcut, armed-state visual). Bottom-right is now permanently reserved for capture; the dev-only `SurfaceDevPanel` was relocated to bottom-left as part of this work.
- `SelectionOverlay` with smart-snap (walks ancestors to nearest `data-component` / `role="row"|"button"` / `<dialog>`); Alt overrides snap; ESC + click-outside (600ms grace from arming) + button-toggle exits; armed-state banner pinned to viewport top.
- Anchored `FrictionWidget` with three working screenshot inputs (paste / drop / file picker) + auto-context chips + file-to-GitHub checkbox.
- Backend pipeline: synchronous markdown record (`~/.designer/friction/<unix-ms>-<slug>.md`) + content-addressed PNG (`<sha256>.png`) → `FrictionReported` event → background `gh gist create --secret` (PNG-header probe avoids decoding screenshots that don't need downscaling) → `gh issue create --label friction` → `FrictionLinked` (or `FrictionFileFailed`).
- Settings → Activity → Friction triage page: lists entries with state, per-entry actions (open issue, file-on-github, mark resolved). Mark-resolved is local-only — does NOT close the GitHub issue.

Locked contracts: shared `Anchor` enum (`crates/designer-core/src/anchor.rs` + `packages/app/src/lib/anchor.ts`) frozen for reuse by 15.H inline comments and 21.A1 finding evidence; `EventPayload` gained `FrictionReported` / `FrictionLinked` / `FrictionFileFailed` / `FrictionResolved` per the ADR 0002 addendum (commit c03f650). Built on top of PR #29's `data-component` annotations on top-level React components, which give the smart-snap a stable anchor identity instead of structural CSS paths.

**Why:**

Designer just landed in `/Applications` for daily-driver use (PR #24). The user's friction with the app is the single most valuable input signal for everything that follows — every Phase 15.J polish item, the Phase 15.K onboarding pass, even the Phase 21 learning layer's training data. **Without an in-app capture, friction goes unrecorded.** Forge-style end-of-session retros are too coarse for the kind of "this button is in the wrong place" / "this affordance isn't discoverable" signal we need.

**Design decisions:**

- **Bottom-right reserved for Friction, dev panel goes bottom-left.** Capture affordances live where the user's muscle memory expects them (Forge / Linear / Vercel all put screenshot-to-issue bottom-right). One-line CSS change to `.surface-dev-panel`. Pattern-log records the rule.
- **Three-exit policy for selection mode** (ESC, click button again, click outside with 600ms grace). The grace gives the user a beat to drift over a target without losing armed state on a stray click.
- **Smart-snap with Alt override.** Hovering shows a thin atom outline + a thicker snap outline; the snap target is the closest component-rooted ancestor. Alt holds anchor at the exact pointer node so the user can capture sub-component bits.
- **Settings IA: Activity → Friction.** Reserved a top-level "Activity" section so 21.A1's "Designer noticed" finding list is a sibling. Pattern-log locks the IA so 21.A1's agent doesn't invent a different home.
- **Dropped the broken "Capture this view" button.** Tauri 2's `webview.capture()` isn't wired in v1; the button only showed a failure toast — a dead affordance. Three working inputs (paste / drop / file picker) cover v1; auto-capture is a follow-up when SelectionOverlay grows the wiring.
- **Local-only path stays useful offline.** If `gh` is missing/not-authed/offline, the user still gets a markdown record + content-addressed screenshot on disk, plus a triage-page row with a Retry button.

**Technical decisions:**

- **`Anchor` wire format: kebab-case tag + camelCase fields.** Frozen by `#[serde(rename_all = "kebab-case", rename_all_fields = "camelCase")]` on the Rust enum and a wire-format pinning test (`dom_element_serializes_with_camel_case_fields`). The TS mirror sends `{kind: "dom-element", selectorPath: "...", ...}`; without the field rename the frontend's first submit would have silently rejected on the Rust deserialize. Caught in the three-perspective review pass before merge.
- **`large_enum_variant` allow on `EventPayload`.** `FrictionReported` carries an Anchor + screenshot ref + provenance fields and is by far the heaviest variant. Boxing it would shrink steady-state event memory ~5×, but friction events are user-driven (≪1/min) — the per-`EventEnvelope` size cost is amortized across the steady-state cheap variants.
- **`spawn_filer` shared by submit + retry.** The async pipeline (downscale → gist → issue → emit Linked or FileFailed → rewrite markdown) is identical for both paths; one helper, one place to fix bugs in the future.
- **`locate_friction` single-pass scan.** Replaces three independent `read_all` calls in the resolve / retry path. With multi-MB `events.db`, the previous code was reading the entire log three times per click.
- **`spawn_blocking` for SHA + screenshot write.** Hashing a 5MB PNG + hitting the FS would pause the tokio worker for 50–200ms. Now off the runtime.
- **PNG header-only dimension probe.** Full decode (~50–200ms) only runs when the screenshot actually needs a resize.
- **`FrictionFileError` Display impl.** Earlier draft used `format!("{error_kind:?}")` for the triage row's error message; that surfaced struct-syntax noise (`GistRejected { detail: "..." }`) to the user. Display impl maps each kind to an actionable hint.

**Tradeoffs discussed:**

- **`Array.from(Uint8Array)` for the IPC bridge.** Tauri 2's default JSON IPC can't deserialize a `Uint8Array` directly into `Vec<u8>` — it serializes as `{0: 13, 1: 22, ...}` (an object), not `[13, 22, ...]` (an array). The materialization cost is real but bounded by the 25MB `SCREENSHOT_BYTE_CAP`. Switching to base64 or a binary IPC channel is a follow-up if friction screenshots get bigger.
- **Auto-capture deferred.** Tauri 2 has webview-capture in beta but the path is unstable across platforms; rather than ship a half-working button we deferred to v2 and made the three available inputs prominent in the empty-state copy.
- **Inline toast vs subscribed-to-event toast.** Spec wanted "Filed as #N" once `FrictionLinked` lands. The widget closes 1.4s after submit; the user has to check Settings → Activity to confirm filing. A v2 toast manager that subscribes to the stream would close the loop. Acceptable v1 trade.

**Lessons learned:**

- **Always cross-check serde rename behavior between Rust and TS sides.** `#[serde(rename_all = "kebab-case")]` on a tagged enum only renames variant names, not field names inside struct variants. The TypeScript spec used `messageId` / `selectorPath` (camelCase); Rust defaulted to `message_id` / `selector_path` (snake_case). The wire format would have broken on the first real submit. The fix (`rename_all_fields = "camelCase"`) is one line, but adding a test that pins the exact JSON shape with field names is the durable defense.
- **Match-based projection: use `if guard` not nested `if`.** Clippy caught a nested `if` inside a match arm during the review pass — collapsed into a guard expression on the arm itself. Cleaner and matches the rest of the codebase's pattern.
- **Hidden affordances (capture button) hurt more than no affordance.** Showing a Capture button that produces a failure toast every time taught the user the button doesn't work. Better to omit and surface the three working inputs explicitly.

---

### Track 13.J — `test_support` module for shared mocks (PR #32)
**Date:** 2026-04-26
**Branch:** test-support-module
**Commit:** 5764377
**PR:** [#32](https://github.com/byamron/designer/pull/32)

**What was done:**

PR #22's six-perspective review flagged that `core_git::tests::check_track_status_routes_through_summary_hook` (the F4 test) inlined ~80 LOC of `AppCore` construction that already exists in `core_local::tests::boot_with_helper_status`, plus a one-off inline `CountingOps` mock with obvious reuse value. This consolidates both:

- `core_local::tests` is now `pub(crate)` and exposes `boot_with_helper`, `boot_with_helper_status`, and a new `boot_with_local_ops(helper, local_ops, kind)` variant for tests that need a custom `LocalOps` without the helper-derived plumbing.
- `apps/desktop/src-tauri/src/test_support.rs` (new, cfg-test) hosts the `CountingOps` mock — a `LocalOps` implementation whose only non-trivial method is `summarize_row`, which increments an `AtomicUsize` so callers can lock in "exactly N helper round-trips for this code path."
- The F4 test was rewritten to use both. `core_git.rs` shrunk by ~83 LOC.

**Why:**

The F4 test was the only counted-LocalOps caller in the desktop crate, but the inline mock + AppCore boot meant that any future cross-module test asserting "the hook routed through `summarize_row`" would re-roll both. Extracting them now (while there is exactly one caller) keeps the cleanup small and avoids a bigger refactor when the second caller arrives.

**Design decisions:**

- **`test_support` lives in the desktop crate, not in a workspace-shared crate.** The mocks here are tied to the crate's `AppCore` shape; cross-crate sharing would require a public test-doubles crate, which is overkill for a single counter mock.

**Technical decisions:**

- **Three boot helpers, not one.** `boot_with_helper` (Live, helper-derived ops) is the default for the existing `core_local::tests` callers; `boot_with_helper_status` parameterizes status; `boot_with_local_ops` lets the F4 test inject a custom `LocalOps` without rebuilding the helper plumbing. Each is a thin wrapper — collapsing them would break ~20 existing call sites for no readability gain.
- **`mod tests` is `pub(crate)`, not the helpers in a sibling `pub(crate) mod test_helpers`.** Items inside still need their own `pub(crate)` to be reachable, so the surface increase is exactly the three boot fns plus `tests`'s name. Both shapes work; this one is one line of code change.
- **`CountingHandler` was *not* moved.** It lives in `crates/designer-claude/src/claude_code.rs` (a different crate) and is referenced only from that file. The roadmap mentioned it as a candidate, but the audit found no actual duplication.

**Tradeoffs discussed:**

- **Collapsing `boot_with_helper_status` and `boot_with_local_ops` into a single function.** Rejected — would force every existing `boot_with_helper_status` caller to construct `FoundationLocalOps::new(helper.clone())` themselves. The two-function shape keeps existing callers terse and the new caller explicit.

**Lessons learned:**

- The simplify pass after the initial implementation surfaced three real wins (drop a speculative future-mocks doc-comment, simplify `CountingOps::new()` from `(Arc<Self>, Arc<AtomicUsize>)` to `Arc<CountingOps::default()>`, drop the now-redundant "Live status so..." comment) and one false positive (a claim that `std::mem::forget(dir)` had been removed — it had not). Worth running the three-agent review on test-only refactors, not just production code.

---

### Track 13.J 1.C — `CostTracker::replay_from_store` bulk-update
**Date:** 2026-04-26
**Branch:** cost-tracker-bulk-replay
**Commit:** 50168bd
**PR:** [#30](https://github.com/byamron/designer/pull/30)

**What was done:**

`CostTracker::replay_from_store` now folds every `CostRecorded` event into a local `HashMap<WorkspaceId, CostUsage>` accumulator and bulk-publishes to the shared `DashMap` in one pass. Previously the loop called `self.usage.entry(...)` per event, locking a DashMap shard each time — N shard-acquisitions when 1 sufficed. Behavior is identical: the map is still cleared before publish, the saturating-add arithmetic is unchanged, and the function remains idempotent on repeat calls.

Added `cost::tests::replay_matches_old_path`: a 100-event fixture across 5 interleaved workspaces (plus a non-cost `AuditEntry` mixed in to exercise the filter) is replayed by both the new bulk path and a reference implementation of the prior per-event path; per-workspace `usage(ws)` must match exactly.

**Why:**

Surfaced by the PR #22 six-perspective review of Phase 13.H (`roadmap.md` § Track 13.J). Boot-only path, so not urgent, but trivial to fix and the optimization tightens the concurrency window during replay (clear+publish is a small interval; the old per-event path mutated shared state for the entire scan).

**Design decisions:**

- None — pure backend optimization with zero UI / IPC / event-shape surface.

**Technical decisions:**

- Clear-then-bulk-insert (vs. swap-the-whole-DashMap): the `Arc<DashMap>` is shared with cloned trackers, so we can't replace the inner allocation. Mutating in place is the only correct option.
- Skipped `HashMap::with_capacity(...)` pre-allocation: the efficiency reviewer suggested `events.len() / 5` as a heuristic, but introducing a magic ratio on a boot-only path costs more clarity than it saves cycles. At most ~log₂(N) rehashes on boot.
- Test reference impl deliberately re-states the old per-event `DashMap.entry()` logic verbatim — it's the equivalence anchor, not copy-paste. Comment in the test mod calls this out.

**Tradeoffs discussed:**

- Pre-allocation guess vs. unhinted growth — went with unhinted; see above.
- Comment in `replay_from_store` body referencing the equivalence test name (`tests::replay_matches_old_path`): borderline narration but kept because it documents *why* the rewrite is safe to read at a glance.

**Lessons learned:**

- Three-agent /simplify pass (reuse / quality / efficiency) on a 100-LOC change took ~30 seconds and confirmed the patch was already clean. Cheap insurance.

---

### `data-component` annotation prereq for Track 13.K Friction — PR #29
**Date:** 2026-04-26
**Branch:** friction-anchors
**Commit:** 5a78fee

**What was done:**
Added `data-component="<ComponentName>"` to the topmost rendered DOM element of every top-level React component in `packages/app/src/{layout,components,blocks,lab}/` — ~25 sites covering `AppShell`, `ProjectStrip`, `WorkspaceSidebar` + the inline `WorkspaceRow`, `MainView` (all three return paths), `ActivitySpine`, `TabLayout`, `QuickSwitcher`, `SettingsPage`, `ComposeDock`, `RepoLinkModal`, `CreateProjectModal`, `AppDialog`, `Onboarding`, `IconButton`, `Tooltip` (on `TooltipSurface`), `PrototypePreview` (both render branches), and all ten block renderers (`BlockHeader`, `MessageBlock`, `SpecBlock`, `CodeChangeBlock`, `PrBlock`, `ApprovalBlock`, `ReportBlock`, `PrototypeBlock`, `DiagramBlock`, `CommentBlock`). Documented the convention in `pattern-log.md`; left an inline pointer comment in `AppShell.tsx`.

**Why:**
Track 13.K's Friction smart-snap selection mode walks up from a click target to the nearest `data-component` ancestor and uses that name as the anchor identifier. Without these attributes, anchors fall back to brittle structural CSS paths that rot the moment the markup shifts. This is a Lane 1 prereq listed in `plan.md` § Lane 1.

**Design decisions:**
- Anchor name = component name (PascalCase). Human-readable in friction reports and debugging surfaces; survives className refactors because we own the names.
- Annotated the topmost rendered DOM element per component, not the click target. Friction's resolver walks UP from the click, so any ancestor placement works — but topmost is the convention so a future reader doesn't have to guess where the attribute lives.
- `BlockHeader` carries its own `data-component` separate from the parent block. Click on a header element resolves to `BlockHeader` (more specific); click elsewhere in the block resolves to the block name. Gives Friction a stable header sub-anchor without ambiguity.
- `Tooltip` is annotated on the floating popup (`TooltipSurface`), not the cloned trigger. The Tooltip component owns no DOM around the trigger — it uses `cloneElement` — so the popup is the only DOM Tooltip can claim. Trigger clicks resolve to whatever child carries `data-component` (typically `IconButton`), which is the right anchor.

**Technical decisions:**
- Pure attribute additions; zero rendering, styling, or behavior changes.
- No CSS selectors target `[data-component]` anywhere in the repo (verified via grep across `packages/`), so the additions can't accidentally hit a style rule.
- No registry/HOC abstraction. ~25 inline string literals matching the component name is the lightest possible pattern; introducing a `withDataComponent(Component, name)` HOC would add indirection for no payoff.
- Annotation grouped *first* among `data-*` attributes on every site that has multiple — anchor identity ranks above semantic state attrs by convention.

**Tradeoffs discussed:**
- `MainView` ends up with three separate `<main className="app-main" data-component="MainView" ...>` openings (one per branch in the function). Reviewer flagged the duplication; weighed an early-return pattern or a `<MainShell>` wrapper. Deferred — the three branches render genuinely different children, the chrome is one short line, and a wrapper is a future refactor when a 4th branch lands.
- `WorkspaceRow` annotated on its `<li>` rather than the inner `<button>` (which carries the `workspace-row` className and click handler). Both placements resolve correctly because the walk goes button → li. Kept on `<li>` per the "topmost rendered DOM element" convention.

**Lessons learned:**
- A multi-perspective review (staff engineer / UX / design engineer) plus three concurrent simplify reviewers produced no required changes — the task spec was tight enough that the implementation was unambiguous. Worth replicating for future small-but-load-bearing prep PRs.

---

### First-run polish — PR #24 + review pass (PR #25-equivalent commits)
**Date:** 2026-04-26
**Branch:** fix-first-run
**Commits:** a074463 (initial PR #24) → 907c278 (review-pass fixes)
**PR:** [#24](https://github.com/byamron/designer/pull/24)

**What was done:**

The user built and ran Designer from `/Applications` for the first time (post-PR #23 dogfood-readiness merge) and immediately hit four day-1 blockers. PR #24 fixed all four; a follow-on three-perspective review (staff engineer, staff design engineer, staff UX designer) surfaced a dozen smaller-scope fixes that were applied in the same branch before merge.

Initial four blockers (PR #24 first commit):

1. **Claude binary not found.** macOS .app launches inherit a minimal PATH from launchd that excludes the shell's PATH (where `~/.npm-global/bin/claude` lives). New `resolve_claude_binary_path()` in `apps/desktop/src-tauri/src/core.rs` probes common install locations and falls back to `bash -lc 'command -v claude'`. Resolved absolute path goes onto `ClaudeCodeOptions::binary_path` at boot.
2. **Whole app scrolled like a web page.** `html, body, #app` had `height: 100%` with no overflow restriction; root would scroll on wheel events. Changed to `position: fixed; inset: 0; overflow: hidden`.
3. **Traffic-lights overlapped UI / window couldn't be dragged.** `titleBarStyle: Overlay` paints content from y=0; the original 32px drag spacer was inside `ProjectStrip` only, so main + sidebar + spine had nothing reserving the inset. Added a full-width `.app-titlebar` zone with `data-tauri-drag-region` above the shell grid; `.app-shell` `padding-top` reserves the height; strip's local spacer removed.
4. **"Add project" silently failed.** The flow used `window.prompt()` which Tauri's bundled webview doesn't implement. Replaced with a real `CreateProjectModal` (scrim, focus trap, ESC dismiss, Enter submit, error display) modeled on `RepoLinkModal`.

Three-perspective review surfaced: a portability hole in the claude resolver, a fragile z-index, a missing path-validation surface, modal-state fragmentation, ~30 LOC of verbatim duplication between two modals, an `useEffect` that reset the form on busy-flip, several copy issues, and a missing test file. All but the largest items applied in 907c278:

- **Backend correctness.** `bash -lc` → `$SHELL -lc` (macOS default is zsh; bash login shells skip `~/.zshrc`). Added `~/.bun/bin`, `~/.yarn/bin`, `~/.asdf/shims`, `~/.cargo/bin` to the candidate list. Invalid `DESIGNER_CLAUDE_BINARY` overrides now `warn!` instead of falling through silently. `home == Path::new(".")` guard added. New `cmd_validate_project_path` IPC + tilde expansion in `cmd_create_project`: typing `~/code/foo` now expands to `$HOME/code/foo`, validates the directory exists, and canonicalizes symlinks before storing the project.
- **UX.** CreateProjectModal field order flipped: Project folder FIRST, Name SECOND. Name autofills from `basename(path)` when the user hasn't typed in the Name field. Title changed from "New project" to "Create a project" (consistent verb-noun with "Link a repository"). Removed "seed" jargon from copy.
- **Design system.** `--app-titlebar-height: var(--space-6)` defined in `app.css` :root; `--layer-titlebar: 5` defined in `tokens.css`. Both replace inline literals. `.app-titlebar` switched from `position: absolute` (fragile, depends on body being positioned) to `position: fixed`, and from hardcoded `z-index: 100` (collided with `--layer-modal: 100`) to `var(--layer-titlebar)`. Migrated `createProjectOpen` boolean to extending `AppDialog` discriminant: `"settings" | "help" | "create-project" | null`. Modal state is now centralized; impossible-state of two modals open at once is unreachable.
- **Dedup.** Extracted `collectFocusable` + `messageFromError` helpers to `packages/app/src/lib/modal.ts`. Both `RepoLinkModal` and `CreateProjectModal` now share. ~30 LOC of verbatim copy-paste removed.
- **Modal hygiene.** CreateProjectModal `useEffect` split into two: one keyed `[open]` for reset+focus, one keyed `[open]` (with `busyRef` for in-handler check) for the keyboard listener. Previously a single effect with `[open, busy]` deps reset the form on every busy flip, clobbering form state mid-error. Added an optional `onCreated?` callback prop so onboarding flows can chain into a follow-up step instead of always routing through `selectProject`.
- **Tests.** New `create-project.test.tsx` (5 cases): renders nothing when not open, autofills name from path basename, lets the user override auto-name without clobber, disables submit on empty fields, uses the dialog discriminant correctly. All 38 vitest cases + full `cargo test --workspace` green.
- **Cleanup.** Deleted orphaned `.app-strip-drag` CSS rule (the JSX node was removed but the rule was left behind).

**Why:**

The post-13.H dogfood-readiness PR (#23) flipped the default to real Claude but the user's first cold-boot from `/Applications` revealed four blockers that no amount of `cargo test --workspace` could surface — all of them were "first time the app ran outside `cargo tauri dev` and outside the test harness" issues. The review pass on top caught the polish items that distinguish "the app technically works" from "I can use this daily."

**Design decisions:**

- **`$SHELL -lc` over `bash -lc`.** macOS's default shell is zsh; users add PATH lines to `.zshrc`. `bash -l` reads `.profile`/`.bash_profile`/`.bashrc`, never `.zshrc`. Honoring the user's actual login shell is the safe call. Falls back to `/bin/sh` if `SHELL` is unset.
- **Path validation in the backend, not just frontend.** Frontend can be bypassed by a malicious or buggy IPC caller. The backend is the authority. Added a separate `cmd_validate_project_path` IPC for inline UI feedback, but `cmd_create_project` validates again — defense in depth.
- **Discriminant over boolean for modal state.** The PR's first commit added `AppState.createProjectOpen: boolean`. The review correctly pointed out this fragments dialog state — settings, help, create-project should all be in one discriminant. Migrated mid-PR.
- **`<Modal>` primitive deferred.** Three modals now share enough that a primitive is warranted, but extracting it under a "first-run polish" PR adds risk. Filed as a Phase 15.J carry-over with an explicit ADR question: does the primitive own the scrim, or accept one?
- **Browse… button deferred.** Real value but real scope (`@tauri-apps/plugin-dialog` install, capability registration, web-build fallback). With backend `~` expansion the user can paste paths cleanly enough; the Browse button is a quality-of-life follow-up, not a blocker.

**Technical decisions:**

- **`run_reader_loop` ctx struct rejected (for now).** Staff engineer flagged the 9-arg signature with `#[allow(clippy::too_many_arguments)]` as a smell. Filed as Track 13.J follow-up — bundling args into `ReaderLoopCtx` is right but it's a refactor at the wrong scope for this PR.
- **`onCreated` callback as optional prop.** Defaults to `selectProject(id)` so existing callers (the strip `+` button, the menu item) keep their behavior. Onboarding flows in 15.K can override without touching the modal.
- **Test seam vs production code.** `CreateProjectModal` reads from `useAppState((s) => s.dialog === "create-project")` directly rather than accepting `open` as a prop. Slightly less reusable than `RepoLinkModal`'s prop-driven API, but the create-project surface is global (one modal at a time, app-wide); a prop interface would just be ceremony.

**Tradeoffs:**

- **`promptCreateProject` deletion.** No callers remained after the modal swap. Deleting was easy. The function was already broken (Tauri webview doesn't implement `window.prompt`); preserving it for "compatibility" would have just been dead code.
- **`Actor::user()` → `Actor::system()` in the F4 hook seam (carryover from 13.H).** Already documented in the 13.H entry; the actor shift is locked by the F4 test.
- **Stale events.db UX.** The user's existing `~/.designer/events.db` carries workspaces from the earlier mock-orchestrator era. Telling the user to `rm` is a workaround. Filed as Phase 15.K (Settings → "Reset Designer" with confirmation). Not in this PR; would have required a confirmation dialog component, settings panel surface, and IPC. Single-PR scope discipline.

**Lessons learned:**

- **The first cold launch from /Applications is the test the test harness can't run.** Body scroll, traffic-light overlap, drag region, and prompt-fallback were all invisible to `cargo tauri dev` (which has the Vite dev server in front and inherits the launching shell's PATH). Whenever a phase claims "ready to ship," the smoke test should include `cargo tauri build && open /Applications/Designer.app`.
- **Reviews of PRs that touch user-visible surfaces should run on those surfaces.** The 13.H review caught the F1-F5 wire-up correctness issues; it wouldn't have caught the body-scroll bug because none of the 13.H reviewers booted the app. PR #24's review caught everything because the user reported the visible bugs first.
- **Migrating boolean state to a tagged-union discriminant is cheap and high-value.** `createProjectOpen: boolean` was the easy diff in the first commit. The review-pass migration to extending `AppDialog` was 6 lines and removed the impossible-state class entirely. Worth doing eagerly when the union already exists.

**Quality gates:**

- `cargo fmt --all -- --check` ✅
- `cargo clippy --workspace --all-targets -- -D warnings` ✅
- `cargo test --workspace` ✅
- `npx tsc --noEmit` ✅
- `npx vitest run` ✅ (38/38 across 9 files)

**Filed for follow-up:**

- Track 13.J (now also called "13.H + 13.K follow-ups") — see `roadmap.md`.
- Phase 15.J — Real-Claude UX polish, now extended with the Browse… button, inline path validation, and `<Modal>` primitive items.
- Phase 15.K (new) — Onboarding & first-run flow. See `roadmap.md`.

### Real-Claude default + dogfood readiness — PR #23
**Date:** 2026-04-26
**Branch:** dogfood-real-claude
**Commit:** aa15f37
**PR:** [#23](https://github.com/byamron/designer/pull/23)

**What was done:**

Flipped Designer from "mock orchestrator by default" to "real Claude by default" and landed the wiring needed to actually use the app daily, on top of PR #22's 13.H runtime work.

- **A. Real-Claude default + override.** `AppConfig::default_in_home()` sets `use_mock_orchestrator: false`. New `Settings.use_mock_orchestrator: Option<bool>` overrides via `settings.json`. `DESIGNER_USE_MOCK=1` env var overrides both. Boot resolves env > settings > config and logs the source.
- **B. Workspace cwd in spawn.** `TeamSpec` gains `cwd: Option<PathBuf>`. `core_agents::post_message` resolves the workspace's project `root_path` and threads it through the lazy-spawn. Without this, the agent's `Read`/`Edit` tools resolve against the desktop process's cwd, not the user's repo.
- **C. Isolated `claude_home`.** `ClaudeCodeOptions.claude_home` defaults to `~/.designer/claude-home` so Designer's session/team/inbox files don't collide with the user's interactive `claude` CLI or Conductor running in parallel.
- **D. Boot preflight.** `claude --version` runs at boot in real-Claude mode. Logs the version on success; warns loudly on failure. Doesn't crash boot.
- **E. Boot logging.** One info line at startup carries `orchestrator`, `orchestrator_source`, `claude_version`. No ambiguity about which mode is running.
- **F. Cost chip on by default.** `Settings.cost_chip_enabled` defaults to `true`. Real-Claude mode means every turn costs money — usage visibility is the right default.

**Why:**

PR #22 wired the runtime; #23 made it the daily-driver default. Without these, the user would either need to know to flip a flag or wonder why mock data kept appearing.

**Bug caught by first run:**

`spawn_message_coalescer` called `tokio::spawn` directly, which panics with *"there is no reactor running"* when invoked from Tauri's `setup` callback (it runs on the main thread, outside the runtime context). Swapped to `tauri::async_runtime::spawn` to match the existing `spawn_event_bridge` pattern. Coalescer tests still green. This was a latent bug from 13.D — only triggered now because PR #22 added enough logging to expose it on actual GUI launch.

**Quality gates:**

- `cargo fmt --check` ✅
- `cargo clippy --workspace --all-targets -- -D warnings` ✅
- `cargo test --workspace` ✅
- `npx tsc --noEmit` ✅
- `npx vitest run` ✅

### Phase 13.H — Wire real Claude (F1–F5)
**Date:** 2026-04-26
**Branch:** phase-13h-wire-claude
**Commits:** [pending — see PR]

**What was done:**

Five items in one sequential PR (the planned ONE-workspace approach), closing the four production wiring gaps surfaced by PR 20's six-agent post-merge review plus the F5 tool-use UX gap (formerly PR 17's `TODO(13.D-followup)`). Real-Claude usability gates closed: a complete tool-use round-trip — from agent narration to inbox approval to cost-chip increment to on-device summary — now works end-to-end.

- **F1 — Wire `permission_handler.decide()` into the stdio reader.** Added `TranslatorOutput::PermissionPrompt { request_id, tool, input, summary, tool_use_id }` and a `control_request` parse arm in `crates/designer-claude/src/stream.rs`. Captured the actual wire format by probing real `claude` 2.1.119 — request shape is `{"type":"control_request","request_id":"<uuid>","request":{"subtype":"can_use_tool","tool_name":"Write","input":{...},"tool_use_id":"toolu_..."}}`; response shape is `{"type":"control_response","response":{"subtype":"success","request_id":"<uuid>","response":{"behavior":"allow","updatedInput":{...}}}}` (or `{"behavior":"deny","message":"..."}`). Three fixtures live under `crates/designer-claude/tests/fixtures/permission_prompt/{write,edit,bash}.json`. The reader-loop body factored into a free `run_reader_loop` function so the unit test can drive it with a synthetic `std::io::Cursor` instead of spinning up a real subprocess. On the new variant the reader **spawns** (not awaits) a decision task that calls `permission_handler.decide(req)`, encodes the response via `encode_permission_response`, and writes through the existing `stdin_tx` channel. The spawn-not-await invariant is locked by `reader_continues_while_permission_decision_pending`: it parks the handler indefinitely, then sends a subsequent `result/success` cost line, asserts the cost signal arrives **before** releasing the parked decision, and only then asserts the decision reply lands.
- **F2 — Populate `PermissionRequest::workspace_id`.** Set at the F1 construction site (`Some(workspace_id)`), captured by the spawned decide-task closure. Without this, `InboxPermissionHandler::decide` would fail-closed on every prompt with `MISSING_WORKSPACE_REASON`. Lock-test `permission_prompt_carries_workspace_id` round-trips a parsed prompt and asserts `decide()`'s argument has the field set.
- **F5 — Tool-use translator + `ArtifactProduced` emission.** `translate_assistant` now walks the message's `content` array. Each `tool_use` block emits one `OrchestratorEvent::ArtifactProduced { kind: ArtifactKind::Report, title: format!("Used {tool}"), summary, body, author_role: Some(author_roles::AGENT) }`; text blocks concatenate into the existing `MessagePosted`. New `tool_use_summary(tool, input)` picks the most informative one-line summary per tool kind: `file_path` for Write/Edit/MultiEdit/NotebookEdit, `command` for Bash, `pattern` for Grep, `file_path||path||pattern` for Read/Glob. The block registry's existing `Report` renderer displays them — no new artifact kind needed. Stretch (correlate `tool_use_id` → eventual `tool_result` and emit `ArtifactUpdated`) deferred — filed as `TODO(13.H+1)` inline in the comment.
- **F3 — Subscribe `ClaudeSignal::Cost` to `CostTracker::record`.** Added `Orchestrator::subscribe_signals()` to the trait with a default implementation that returns a never-firing receiver (additive, no breaking change). `MockOrchestrator` overrides with a real `signal_tx` field and exposes a `signals()` method so tests inject signals without spinning up a real subprocess. `ClaudeCodeOrchestrator`'s pre-existing inherent `subscribe_signals()` moved onto the trait impl. Added a new `CostTracker::record(workspace, delta, actor)` method on `crates/designer-safety/src/cost.rs` that appends `EventPayload::CostRecorded` and updates the in-memory usage map without a cap check (already-incurred spend cannot be refused; refusing would only desynchronize the cap from reality). Refactored `AppCore::boot` into `boot()` + `boot_with_orchestrator(config, override)` so tests can inject a `MockOrchestrator` whose `signals()` they retain a handle to. The new `spawn_cost_subscriber(weak: Weak<AppCore>, rx)` helper holds a `Weak<AppCore>` and gracefully terminates when the core drops. Conversion: `total_cost_usd: f64` → `dollars_cents: u64` via `(usd * 100.0).round() as u64`, clamping non-finite or negative values to zero.
- **F4 — Route `core_git::check_track_status` through `append_artifact_with_summary_hook`.** Replaced the direct `self.store.append(EventPayload::ArtifactCreated { ... kind: CodeChange ... })` in `apps/desktop/src-tauri/src/core_git.rs::check_track_status` with `self.append_artifact_with_summary_hook(ArtifactDraft { ... })`. The receiver changed from `&self` to `self: &Arc<Self>` to match the hook seam's signature. The hook (Phase 13.F) handles the 500ms deadline + late-return `ArtifactUpdated` + per-track debounce automatically; the call site was the last unrouted code-change emitter. Test `check_track_status_routes_through_summary_hook` injects a counting `LocalOps` mock and asserts `summarize_row` is called once per emit AND the resulting artifact's summary equals the LLM line, not the raw diff stat.

**Why:**

PR 20's post-merge review surfaced four production wiring gaps inherent to the underlying parallel PRs (not regressions from the integration). Together they made real-Claude usage stall on the first tool prompt: F1 was the hard blocker (without it the agent hangs until Claude's internal ~10-min timeout), F2 caused fail-closed prompts that didn't surface to the inbox, F3 left the cost chip reading $0.00 and the cap silently allowing over-spend, F4 left rail summaries reading as raw diff stats. F5 is a UX completeness gap from PR 17's `TODO(13.D-followup)` — without it the user sees Claude narrate but never sees which tool was invoked, breaking the "summarize by default, drill on demand" principle. Fixing all five together unblocks dogfooding.

**Design decisions:**

- **Spawn-not-await on `decide()`.** The reader is single-threaded; awaiting inline on a 5-minute approval blocks every other event from Claude during that window. The test `reader_continues_while_permission_decision_pending` is the load-bearing artifact — it would catch any future regression to inline-await behavior.
- **Wire format probed live, not assumed.** The roadmap's spec said "Claude's stdio request shape" without fully documenting it. We probed real `claude` 2.1.119 to capture the actual `control_request` / `control_response` shape (including the `request_id` correlation surface and `permission_suggestions` field we currently ignore). Fixtures came from the probe; tests round-trip them. This is the same discipline §12.A used for the stream-json vocabulary.
- **`TranslatorOutput::PermissionPrompt` is internal, additive.** Internal types within `designer-claude` aren't frozen by ADR 0002 (only `OrchestratorEvent`, `EventPayload`, IPC DTOs, and the `PermissionHandler` trait are). Extending the translator output enum is a non-breaking change.
- **Default trait impl for `subscribe_signals()`.** A never-firing receiver via `broadcast::channel(1).1` (drop the sender first, so the receiver immediately closes) means orchestrators that don't surface platform telemetry don't have to plumb a real signal channel. Additive, no breaking change.
- **`CostTracker::record` does not cap-check.** Observed spend has already happened on Anthropic's side; refusing to log it would desynchronize the cap from reality. Use `check_and_record` for forecasted spend that should be gated; `record` for telemetry. Documented in the new method's doc comment.
- **`boot_with_orchestrator` test seam.** Adding an optional override parameter to `AppCore::boot` was simpler than the alternatives (downcasting an `Arc<dyn Orchestrator>`, exposing the signal sender on AppCore directly, or duplicating the boot wiring inside the test). Production callers pass `None` and inherit the existing config-driven Mock-vs-Claude branch.
- **F5 used `ArtifactKind::Report` rather than a new `Tool` kind.** `Report` already has a registered renderer; adding a new kind would require an event-vocabulary extension and a new renderer. ADR 0003 explicitly leaves this trade-off open: "promote to a typed `Tool` kind in a future ADR if churn warrants it." For now, "Used Read" + summary + JSON body is enough drill-down on demand.
- **`tool_use_summary` per-tool dispatch.** A generic `serde_json::to_string(input)` summary would be unreadable for a wide Bash command or a long file_path. Per-tool selection (Bash → `command`, Write → `file_path`, etc.) gives a 120-char one-liner that reads naturally in the rail.

**Technical decisions:**

- **`run_reader_loop` extracted as a free function.** The reader-loop body was inline inside `spawn_team`, accessing the live `child.stdout` pipe — untestable without a real subprocess. Extracting it as `async fn run_reader_loop<R, S>(reader, ws, ..., handler, stdin_tx)` over an `AsyncRead + Unpin` source lets the F1+F2 tests drive it with `std::io::Cursor<Vec<u8>>`. Added `#[allow(clippy::too_many_arguments)]` since this is a private internal helper, not a public API.
- **`encode_permission_response` exported.** `pub use stream::encode_permission_response` from the crate so the orchestrator and any future test consumer can build the wire response. Symmetric with the existing `ClaudeStreamTranslator` re-export.
- **Test seams added, not test mocks bolted on.** The factor of `boot_with_orchestrator` and the addition of `MockOrchestrator::signals()` are minimal API surfaces — both can stay in production code without hurting clarity. Avoids the alternative of test-only `cfg(test)` shims that drift from production behavior.

**Tradeoffs:**

- **F4 test asserts one emit, not two.** The 2-second per-track debounce window collapses a quick second `check_track_status` into a `Cached` claim — the helper isn't called twice. A test that asserts two calls would either need a 2.1s sleep (brittle) or two distinct `TrackKey` values (different workspaces or author_roles, which would test less of the routing). Asserting one call + one summary mutation proves routing without timing brittleness; the debounce-cache behavior is covered by `core_local`'s own tests.
- **Tool-use → tool-result correlation deferred.** The stretch goal of correlating `tool_use_id` to the next user-turn's `tool_result` and emitting `ArtifactUpdated` on the original `Used Read` artifact (so it gains a result-summary post-hoc) is ~50 LOC of stateful translator work. Filed as `TODO(13.H+1)`. Without it, the user sees "Used Read" but never the result inline; they can still drill into the JSON body if curious.
- **`run_reader_loop`'s 9 arguments.** The free-function refactor pushed argument count past clippy's threshold. Wrapping in a builder struct would clean up the call site at the cost of more indirection in code that's already in a hot loop. Allowed clippy lint locally; if more callers appear, revisit.
- **No live `permission_prompt_round_trip` test added.** The roadmap mentions a `tests/claude_live.rs::permission_prompt_round_trip` gated by `--features claude_live`, run on the self-hosted runner. The dogfood acceptance walk covers the same surface manually; adding the gated test is a small follow-up that doesn't gate the PR. Filed for next iteration.

**Lessons learned:**

- **Probe live before coding to a wire format.** The roadmap had the response shape (`{"behavior":"allow"}`) but only a cursory hint at the request shape. A 5-minute probe pass against real `claude` 2.1.119 surfaced `permission_suggestions`, `display_name`, and `tool_use_id` fields that the spec didn't mention; capturing them in fixtures means future translator extensions don't have to re-probe.
- **Test the spawn-not-await invariant before writing the spawn.** The `reader_continues_while_permission_decision_pending` test was written first (using a `ParkingHandler` whose `decide()` parks on a `Notify`); only after it passed did we trust the spawn. If the test had been written after, an inline-await refactor would have slipped through CI without anything failing.
- **The "factor an internal seam for test access" pattern is cheap.** `boot_with_orchestrator` is 6 LOC of API; it lets the F3 test inject a known mock without duplicating ~100 LOC of boot wiring. The same pattern for `run_reader_loop` made F1's synthetic-stdout test feasible.
- **Sequential single-PR was the right parallelization call.** The five items shared `claude_code.rs` + `stream.rs` (three of five) and orchestrator-trait surface (one more). Splitting into parallel branches would have created merge cost on those shared files for no time savings. The 13.D/E/F/G fan-out worked because each had 1500+ LOC of orthogonal domain work; 13.H's ~500 LOC of cohesive runtime hardening didn't.

**Quality gates:**

- `cargo fmt --all -- --check` ✅
- `cargo clippy --workspace --all-targets -- -D warnings` ✅
- `cargo test --workspace` ✅ (54 designer-claude tests + 67 designer-desktop tests + cost subscriber and translator integration tests)
- `cd packages/app && npx tsc --noEmit` ✅
- `cd packages/app && npx vitest run` ✅ (33/33 across 8 files)

### Phase 13 integration meta-PR [#20] — D/E/F/G unified onto `phase-13-integration`
**Date:** 2026-04-26
**Branch:** phase-13-integration → main
**Commits:** 4dd11c7 (D) → bc40343 (E) → 58b4861 (G) → 5a32418 (F) → 8c712d4 (post-review cleanup)
**PR:** [#20](https://github.com/byamron/designer/pull/20) — MERGEABLE / CLEAN, all five CI checks green (rust test / clippy / fmt / frontend / claude-live integration)

**What was done:**

The four parallel Phase 13 tracks (D agent-wire, E track+git, G safety+keychain, F local-model surfaces) were merged in the documented integration order onto a single `phase-13-integration` branch. Conflicts resolved cleanly across the predicted hot-spots — `apps/desktop/src-tauri/src/main.rs::generate_handler!` (alphabetized handler list with all four tracks' commands interleaved), `apps/desktop/src-tauri/src/{core,ipc}.rs` (PR 19's `cmd_request_approval`/`cmd_resolve_approval` real implementations co-exist with PR 16's track commands), `crates/designer-{core,ipc}/` (re-exports merged: `author_roles + Track + TrackState + USER_AUTHOR_ROLE`), `packages/app/src/ipc/{client,types,mock}.ts` (one unified `IpcClient` interface with all 22 methods), `packages/app/src/blocks/blocks.tsx` (PrototypePreview import alongside ipc/StreamEvent imports), `core-docs/{plan,history,generation-log,roadmap,integration-notes}.md` (chronological merge of 13.D + 13.E + 13.G + 13.F entries side-by-side). PR 18's `FB-0027/0028` were renumbered to `FB-0030/0031` to avoid collision with PR 16's review-pass feedback entries. PR 18's tuple-form `IpcError` sites were migrated to PR 17's struct-form constructors (`invalid_request`, `not_found`, `unknown`).

**Six-agent post-merge review:**

After the integration commits landed, a parallel review pass ran six agents: staff engineer, staff UX designer, staff design engineer (the three perspectives the user asks for on every milestone), plus the simplify pass's reuse / quality / efficiency reviewers. Findings:

- **Staff engineer** (`af5f93b352b883dd5`) — verdict "needs changes, blocking on C1 + C2." Identified four production wiring gaps inherent to the underlying PRs (not regressions from the merge): F1 `permission_handler.decide()` not routed in stdio reader, F2 `PermissionRequest::workspace_id` not populated, F3 `ClaudeSignal::Cost` broadcast into the void, F4 `core_git::check_track_status` bypasses the 13.F summary hook. Plus pre-existing `TabOpened` double-apply (synchronous + broadcast subscriber both fire). All four are tracked as Phase 13.H.
- **Staff UX designer** (`a1756e45cd898c0b4`) — verdict "needs changes before merge." Three blockers: mock "Acknowledged: …" reply visible without a dev/mock indicator, ComposeDock loses attachments on send failure (only text restores), late-grant after timeout produces contradictory UI. Nine high-priority UX gaps including missing 5-min timeout copy on ApprovalBlock, generic repo-link error messages, color-blind accessibility on the cost-chip band. Filed as 13.H polish + Phase 15 a11y work.
- **Staff design engineer** (`ac8d98fe32694a260`) — verdict "ready to merge with H1–H5 fixed." H1 (broken `--font-mono` token reference, fixed) was the only must-fix-before-merge. H2 RequestMergeButton needs stream subscription, H3 CostChip popover needs overflow guard, H4 AppDialog/RepoLinkModal scrim-dismiss disagreement, H5 two parallel modal implementations (RepoLinkModal duplicates AppDialog plumbing). Token discipline broadly clean.
- **Reuse review** (`a2fea0cba52cb8536`) — top win: blanket `impl From<CoreError> for IpcError` collapses everything to `Unknown`, masking 7 sites that should be `not_found` / `invalid_request`. Fixed in 8c712d4. Mock IPC stub duplicated across 3 test files (filed as Phase 13.H+ helper extraction). `first_line_truncate` (Rust) vs `firstLineTruncate` (TS) drift on multibyte input.
- **Quality review** (`ad20cd7b22b665498`) — top issues: stringly-typed author roles partially adopted (registry exists; only 13.F imports it). Fixed in 8c712d4 by expanding `author_roles` registry with `TEAM_LEAD / USER / SYSTEM` and migrating four production sites. `cmd_request_approval` is dead-but-shipped — kept deliberately as a security stub; documented in 13.G integration-notes.
- **Efficiency review** (`aa4b46578c70a4a44`) — boot path runs four sequential full event-log scans (projector replay + cost replay + gate replay + orphan sweep). Filed as 13.H+ optimization. Coalescer ticks 33×/sec when idle. ApprovalBlock mounts one stream listener per block (N approval blocks = N listeners). All filed as follow-ups; none are correctness issues.

**Post-review cleanup (commit 8c712d4):**

Four low-risk wins applied to the integration branch:
1. `impl From<CoreError> for IpcError` discriminates `Invariant → invalid_request`, `NotFound → not_found`, `InvalidId → invalid_request`. Removes 4 hand-rolled match blocks; fixes 7 silent error-downgrade sites.
2. `.block__file` references `--type-family-mono` (the canonical token) instead of the undefined `--font-mono` (which was masked by the `monospace` fallback).
3. `designer_core::author_roles` adds `TEAM_LEAD`, `USER`, `SYSTEM` constants. Production sites that hardcoded `"system".into()` (core_git PR + code-change emit, core_safety scope-deny comment, inbox_permission approval artifact) now route through the registry — `TRACK` for git-emitted, `SAFETY` for safety-emitted.
4. Deleted no-op `__reset_inbox_handler_for_tests` stub the engineer review flagged as misleading; the docstring claimed it cleared the OnceCell but the body did nothing.

**Frozen-contract compliance verified:**
- `crates/designer-core/src/event.rs` event vocabulary unchanged.
- `crates/designer-claude/src/permission.rs` `PermissionHandler` trait shape unchanged (PR 19's `workspace_id` field is additive on the request struct, not on the trait method signature).
- `crates/designer-ipc/src/lib.rs` artifact DTOs unchanged. New non-artifact DTOs added per ADR 0003's "frozen surface is the artifact DTOs; new IPC commands grow non-artifact request/response shapes."

**Quality gates (final, post-cleanup):**
- `cargo fmt --all -- --check` ✅
- `cargo clippy --workspace --all-targets -- -D warnings` ✅
- `cargo test --workspace` ✅ (30 test groups, ~150+ tests)
- `npx tsc --noEmit` ✅
- `npx vitest run` ✅ (33/33 across 8 files)

**Known follow-ups (filed as Phase 13.H — Phase 13 hardening pass):**

F1, F2, F3, F4 (see `roadmap.md` Track 13.H). Plus the medium-priority items from the six reviews: mock IPC stub helper extraction, `IpcClient` interface split into thematic sub-interfaces, boot-path replay consolidation, `cmd_list_artifacts` summary projection, coalescer idle-wakeup elimination, `ApprovalBlock` subscription multiplexing, `RequestMergeButton` stream subscription, AppDialog scrim-dismiss alignment, ComposeDock attachment restoration on send failure, mock-orchestrator dev-only string indicator, `TabOpened` double-apply.

**Lessons learned:**

- The integration commit (`5a32418`) where conflicts get resolved is the most error-prone surface; the post-merge review pass is a real defense. Six agents in parallel surfaced four production wiring gaps that none of the per-PR reviews caught, because each per-PR reviewer didn't have the cross-cut visibility.
- The "frozen contracts" convention (event.rs, PermissionHandler trait, artifact DTOs locked by 13.0) held across four parallel branches with zero shape conflicts. Worth keeping the convention for future parallel-fan-out phases.
- Stale `.git/index.lock` from a parallel git operation in another worktree blocked the final commit and could not be cleared from the sandbox; required user intervention. Future automation should detect this and fail loudly rather than silently looping.

### Phase 13.F — local-model surfaces (initial + post-review pass)
**Date:** 2026-04-25
**Branch:** 13f-local-model-surfaces
**Commit:** [pending — see PR]

**Review pass (2026-04-25 same-day):**

- **Debounce-burst race fix.** First-pass `SummaryDebounce` cached only resolved values; a second caller arriving while the first was in flight saw no entry and dispatched its own helper call (call_count == 2 for a burst that should be 1). Fixed by tracking inflight slots (`watch::Sender<Option<String>>`) alongside resolved entries; concurrent callers join the same in-flight watch. Test `concurrent_burst_shares_one_helper_call` asserts call_count == 1 after a 100ms-apart burst over an 800ms helper.
- **Eviction.** Added `SUMMARY_DEBOUNCE_MAX_ENTRIES = 1024` cap with opportunistic prune of expired `Resolved` entries on each `claim`. Inflight slots are never evicted (would error every awaiter). Test `debounce_cache_is_bounded_under_churn` exercises 1000 unique keys.
- **`Weak<AppCore>` on the late-return spawn.** Previous code held `Arc<AppCore>` in the detached task — a slow helper would extend AppCore's lifetime past shutdown by the helper-call duration. Now uses `Arc::downgrade(self)` and bails when `upgrade()` returns None.
- **Archived target rejection.** `Projector::artifact()` returns artifacts regardless of `archived_at`; the projector preserves history. The audit/recap policy ("don't audit something that's been archived") lives at the boundary now: `audit_artifact` returns `NotFound` when `target.archived_at.is_some()`, `recap_workspace` returns `Invariant` for archived/errored workspaces, and `emit_artifact_updated` short-circuits if the target was archived between append and helper return.
- **Cross-workspace audit boundary.** `AuditArtifactRequest` now requires `expected_workspace_id`; `AppCore::audit_artifact(id, expected, claim)` validates `target.workspace_id == expected` and returns `Invariant` (mapped to `IpcError::InvalidRequest`) on mismatch. Future-proofs the seam for per-workspace authorization in 13.G.
- **Author-role registry.** New module `designer_core::author_roles` exports `RECAP`, `AUDITOR`, `AGENT`, `TRACK`, `SAFETY`, `WORKSPACE_LEAD` constants. Replaces inline `"auditor"` / `"recap"` literals; downstream tracks should reuse to avoid drift.
- **Local timezone for "Wednesday recap".** Added `local-offset` to the workspace `time` feature set; `weekday_label()` now uses `OffsetDateTime::now_local()` with UTC fallback when the host can't resolve a local offset (sandboxed CI envs).
- **PrototypeBlock CSP regression fixed.** First-pass inline-HTML mode used `sandbox="allow-forms allow-pointer-lock"` — same as the lab demo, but without the lab's CSP `<meta>` wrapping. A `<form action="https://attacker">` could exfiltrate. Two defenses now: (1) `sandbox=""` (no permissions — blocks form submission entirely) and (2) `wrapInlineHtmlWithCsp()` injects a CSP `meta` tag with `form-action 'none'`, `script-src 'none'`, etc. New vitest `hardens against form-action XSS` asserts both defenses.
- **`summary_provenance` deferred** to a pre-launch ADR. Adding the field non-breakingly is a new variant on the artifact event vocabulary (`ArtifactSummaryProvenanceSet`), which warrants its own decision record. The 12.B system-level helper-status indicator covers the global case for now.
- **Wiring TODO.** Module docs for `core_local.rs` and ADR 0003 explicitly note that tracks D/E/G must route `code-change` through `append_artifact_with_summary_hook`; direct `store.append` bypasses the hook and breaks Decision 39's at-write-time guarantee. Search for `TODO(13.F-wiring)` during track-integration merges.

Test coverage: 15 Rust unit tests (5 new this pass — concurrent burst, archived target, cross-workspace boundary, helper-down + long summary, eviction under churn) + 4 vitest cases (1 new — XSS via form-action).


**What was done:**

- New `AppCore::append_artifact_with_summary_hook(draft: ArtifactDraft)` seam in `apps/desktop/src-tauri/src/core_local.rs`. For `ArtifactKind::CodeChange` it calls `LocalOps::summarize_row` with a 500ms timeout; success replaces the supplied summary before the event lands, timeout/error/fallback uses a deterministic 140-char ellipsis-truncated fallback, and a detached task emits `ArtifactUpdated` if the helper eventually returns. Other artifact kinds bypass the hook and append verbatim.
- Per-track debounce (`SummaryDebounce` field on `AppCore`) — `(workspace_id, author_role)` keys; within a 2-second window, a second `code-change` reuses the cached summary instead of round-tripping the helper.
- `AppCore::recap_workspace(workspace_id)` — gathers non-report artifacts, calls `LocalOps::recap`, emits `ArtifactCreated { kind: "report", title: "<Weekday> recap", summary: <headline>, author_role: Some("recap") }` with markdown payload.
- `AppCore::audit_artifact(artifact_id, claim)` — calls `LocalOps::audit_claim`, emits `ArtifactCreated { kind: "comment", title: "Audit: <claim>", summary: <verdict>, author_role: Some("auditor") }` in the target's workspace.
- `commands_local::cmd_recap_workspace` and `commands_local::cmd_audit_artifact` Tauri shims; both registered alphabetically in `main.rs`'s `tauri::generate_handler!`.
- `PrototypeBlock` now renders inline-HTML payloads via `PrototypePreview`. `PrototypePreview` was extended with a discriminated-union prop signature so `{ workspace }` (existing lab demo) and `{ inlineHtml, title? }` (new artifact path) coexist. The artifact path renders just the sandbox iframe (`sandbox="allow-forms allow-pointer-lock"`, no `allow-scripts`). `PrototypeBlock` change: 7 LOC.
- ADR 0003 amended with the hook-seam contract.
- 10 new Rust tests in `core_local::tests` (in-deadline path, late-return → ArtifactUpdated, helper-error fallback, debounce reuse, recap happy path + missing-workspace error, audit emission, fallback truncate, non-code-change bypass). 3 new vitest tests in `prototype-block.test.tsx` (inline HTML → sandboxed iframe, no payload → placeholder, hash payload → placeholder).
- Quality gates: `cargo test --workspace`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --check`, `tsc --noEmit`, `vitest run` — all green. 16 frontend tests, 100+ backend tests.

**Why:**

Phase 13.1 (PR #15) shipped the typed-artifact foundation but left the local-model emitters as TODOs. 13.F is the on-device-models track in the four-track Phase-13 fan-out: write-time summaries (spec Decision 39), morning recap, audit verdicts. Without it, every emitted artifact carries the producer's raw `summary` text, which means the rail/collapsed views see verbose-and-noisy strings that don't summarize the change.

**Design decisions:**

- **Option B for debounce** (each artifact gets the same batch summary; no event suppression). Justification: keeps the rail's edit count accurate, doesn't violate `ArtifactCreated` semantics (each batch IS its own artifact), and avoids a race window where a "merged" representation would have to be reconciled with downstream pin/unpin events. Only the helper round-trip is coalesced, not the events themselves.
- **Hook seam, not store interceptor.** The seam is an `AppCore` method that tracks call instead of `store.append`; this keeps `EventStore` agnostic to LocalOps and replays remain bit-for-bit deterministic (the stored summary is whatever was written, never regenerated). Late-arriving `ArtifactUpdated` events also persist their summary verbatim — replay safety preserved.
- **Helper-down short-circuits before the call.** Per integration-notes §12.B, `NullHelper::generate` returns a `[unavailable …]` marker that must not be rendered as user copy. The hook checks `helper_status.kind == Fallback` before dispatch and uses the deterministic truncation directly.
- **Per-artifact provenance not added to the schema.** ADR 0003 froze the artifact event vocabulary; adding `summary_provenance: Option<String>` would be a breaking change. The existing system-level helper status (12.B's IPC) drives a global "On-device models unavailable" indicator. Per-artifact "this is a fallback summary" badges are a 13.G/UI follow-up if and when needed.
- **`PrototypePreview` discriminated-union prop signature.** Extending PrototypePreview with an `inlineHtml` prop kept the integration to a single prop pass on the consumer side without expanding the lab-demo's responsibilities. The new path is strictly the sandbox primitive — no variant explorer, no annotation toggle.

**Technical decisions:**

- **`tokio::spawn` + `&mut handle` for the timeout race.** Lets us wait up to 500ms inside the append, then keep awaiting the same future from a detached task without re-running the helper call.
- **`ArtifactDraft` packed-arg struct** introduced to keep the public seam below clippy's `too_many_arguments` ceiling (was 8 args, ceiling is 7) without scattering `#[allow(clippy::…)]` markers. Bonus: gives downstream tracks a typed "build this artifact" object that's symmetric with `EventPayload::ArtifactCreated`.
- **`pub(crate)` on `helper_events`.** Tests in `core_local::tests` need to construct `AppCore` directly with a custom `FoundationHelper` (so they can control response timing). Promoting `helper_events` from private to `pub(crate)` was the minimum change; no public API impact.
- **Recap entries filter out `report` artifacts.** Avoids feeding yesterday's recap into today's recap as input; report-of-reports is a pathological recursion.

**Tradeoffs discussed:**

- **Option A vs B for debounce.** Option A (merge artifacts into one) was rejected: violates "each semantic edit batch is an artifact" (Decision 39's premise) and complicates pin/unpin/archive on a coalesced artifact. Option B is the simpler invariant.
- **CSP injection in `PrototypePreview`.** The lab demo wraps each variant's HTML in a CSP `meta` header. The 13.F path passes payload-as-srcdoc verbatim — the iframe's `sandbox` attribute (without `allow-scripts`) is the principal defense; CSP-meta would require either parsing-and-reinjecting the agent's HTML or wrapping it in a host document. Either option moves user code; the sandbox attribute alone meets the brief's "PrototypePreview already handles iframe sandboxing" framing.

**Lessons learned:**

- Tokio's `tokio::spawn` returning `JoinHandle<HelperResult<T>>` produces a triple-nested Result on `tokio::time::timeout(..., &mut handle)` — `Result<Result<HelperResult<T>, JoinError>, Elapsed>`. Clear branches on each layer keep the timeout path readable.
- `cargo clippy`'s `too_many_arguments` lint fires on `>7` args. The artifact-creation seam naturally has 7 fields; adding any one (e.g., `causation_id`) would push past it. Packing into `ArtifactDraft` future-proofs the boundary.


### Phase 13.D — agent wire
**Date:** 2026-04-25
**Branch:** 13d-agent-wire
**Commit:** pending

**What was done:**

End-to-end user-prompt → agent-reply loop, against the ADR 0003 artifact foundation. New IPC command `cmd_post_message(workspace_id, text, attachments)` lands the user's draft as both a `MessagePosted` event and an `ArtifactCreated { kind: "message" }` artifact synchronously, then dispatches the body to `Orchestrator::post_message`. A new `OrchestratorEvent::ArtifactProduced` variant carries agent-emitted typed artifacts (today only `diagram` and `report` per the 13.D scope cap) without rerouting them through the persisted `MessagePosted` channel — the AppCore stays the single writer of `EventPayload::ArtifactCreated`.

A boot-spawned message coalescer task subscribes to the orchestrator's broadcast channel, filters out user echoes, accumulates per-(workspace, author_role) bursts, and flushes one `ArtifactCreated { kind: "message" }` after 120 ms of idle (the partial-message coalescer deferred from 12.A; window overridable via `DESIGNER_MESSAGE_COALESCE_MS` for tests). `MockOrchestrator::post_message` no longer double-persists the user's text; instead it simulates a deterministic `Acknowledged: …` reply and emits `ArtifactProduced` when the prompt mentions "diagram" or "report", which is enough to exercise the full round-trip in the offline demo.

`WorkspaceThread.onSend` now `await`s `ipcClient().postMessage`. The placeholder "wiring lands in Phase 13.D" notice is gone. On error the draft is restored into the compose dock and an alert banner surfaces the message so the user can edit and resend without retyping. The mock IPC client mirrors the Rust path closely enough that `vitest` can render the thread, click send, and assert the request shape.

`PostMessageRequest`, `PostMessageAttachment`, and `PostMessageResponse` DTOs added to `designer-ipc`; matching TypeScript types in `packages/app/src/ipc/types.ts`. `ipc_agents.rs` holds the runtime-agnostic async handler; `commands_agents::post_message` is the thin Tauri shim, registered alphabetically in `main.rs`'s `generate_handler!`.

**Why:**

13.1 unified the workspace surface around `WorkspaceThread` but left the compose dock wired to a "draft cleared" notice. 12.A delivered the Claude Code subprocess primitive but the partial-message coalescer was deferred. 13.D closes both: the user can now type a message and watch an agent reply land inline. Without this, the unified thread is a read-only artifact viewer.

**Design decisions:**

- **User text persists synchronously.** `AppCore::post_message` appends both the `MessagePosted` event and the `ArtifactCreated` artifact before calling the orchestrator. If the subprocess is down, the user's text is durable — they see it in the thread, they can re-dispatch, they don't lose drafts to a flaky child.
- **Lazy team spawn on first message.** Demo / fresh workspaces start without a team. The first user message lazy-spawns one (lead_role `team-lead`, no teammates). Future tracks can override the spawn payload by spawning a team explicitly before the first message.
- **Coalescer drops user echoes.** `MockOrchestrator::post_message` re-broadcasts the user prompt as `OrchestratorEvent::MessagePosted` for parity with the real Claude flow (which re-emits assistant text via the stream translator). The coalescer matches `author_role == "user"` and drops the echo so the user doesn't see their text twice.
- **Failed sends restore the draft.** ComposeDock clears its draft after `onSend` returns regardless of outcome. WorkspaceThread catches the failure, calls `composeRef.current?.setDraft(payload.text)` and refocuses, so the user can edit and resend without retyping.

**Technical decisions:**

- **Coalescer is two tasks, not one.** Recv task accumulates bodies under a `parking_lot::Mutex<HashMap>`; tick task polls every 30 ms and drains entries that have been idle for ≥ window. Single-task `tokio::select!` with a dynamic timer was rejected — bookkeeping for the next deadline doubled the code with no measurable latency win.
- **`OrchestratorEvent::ArtifactProduced` is broadcast-only.** The real `ClaudeCodeOrchestrator`'s reader task persists `EventPayload::MessagePosted` via `event_to_payload`, but for `ArtifactProduced` we explicitly return `None` — AppCore's coalescer is the single writer for `EventPayload::ArtifactCreated`. Two writers would race the projector and produce duplicate artifacts.
- **`spawn_message_coalescer` is a free function, not a method.** Per `CLAUDE.md` §"Parallel track conventions", new methods on `AppCore` go in `core_agents.rs`'s sibling `impl AppCore { … }` block, but the boot wiring lives in `main.rs::setup`. Free function accepts `Arc<AppCore>` so it composes naturally with both the production boot path and the test setup.
- **Test override via env.** `DESIGNER_MESSAGE_COALESCE_MS` shrinks the 120 ms production window to 5 ms in tests. The round-trip test polls every 20 ms for the diagram artifact + the agent's coalesced reply with a 25-attempt cap (~500 ms ceiling).

**Tradeoffs discussed:**

- **Modify `MockOrchestrator::post_message` vs. introduce a new test surface.** Modified the mock — the existing semantics ("write the user's text as if the team echoed it") were a stand-in that doesn't match the real Claude flow. Switching the mock to broadcast-only (no persist) for the user message + simulate an agent reply is closer to the real path and lets the AppCore stay the single user-side persister. One existing test (`mock_assign_task_produces_create_and_complete`) still passes against the new behavior.
- **Add `OrchestratorEvent::ArtifactProduced` vs. keyword-detect inside the coalescer.** Added the variant. Keyword detection in `core_agents.rs` would tightly couple the AppCore to the mock's keyword convention and force the same logic to be re-derived when real Claude tool-use shapes are observed. The variant gives the translator (or any future orchestrator) a clean emission target.
- **Disable the send button while in-flight vs. let the empty-draft guard prevent double-dispatch.** Did the latter. ComposeDock clears its draft after `onSend` returns; the next send sees an empty draft and the dock's empty guard short-circuits. Disabling the button would require wiring a `disabled` prop through ComposeDock's controlled-component contract; not worth the surface change.

**Lessons learned:**

- **`#[serde(tag = "kind", …)]` collides with a field literally named `kind`.** Initially named the new `OrchestratorEvent::ArtifactProduced` field `kind`. The derive emitted "variant field name `kind` conflicts with internal tag" and refused to compile. Renamed to `artifact_kind` to mirror `EventPayload::ArtifactCreated`'s convention, which already worked around the same collision.
- **Same serde rule blew up `IpcError`.** Newtype-tuple variants (`Unknown(String)`, `NotFound(String)`, …) on an internally-tagged enum (`#[serde(tag = "kind")]`) compile but fail at runtime with "cannot serialize tagged newtype variant containing a string". Latent bug — the existing crate had it since 13.0 — surfaced as soon as 13.D actually returned typed errors over the wire. Converted every variant to a struct form (named field) and added a `tests::ipc_error_serialization_shape_has_kind_tag` round-trip lock; the TS translator in `packages/app/src/ipc/error.ts` matches against the locked shape.
- **DEFERRED transactions deadlock under concurrent writers in WAL mode, even with `busy_timeout`.** The 13.D coalescer is the first path with two concurrent SQLite writers (AppCore writes the user artifact while the coalescer's `emit_agent_artifact` writes a tool-call artifact). `conn.transaction()` defaults to DEFERRED, which acquires a read lock on the first SELECT and tries to upgrade to write at the first INSERT — and SQLite returns `SQLITE_LOCKED` (not `SQLITE_BUSY`) for that upgrade conflict, which `busy_timeout` does **not** retry. Switched the append path to `transaction_with_behavior(Immediate)` so the write lock is acquired at BEGIN and `busy_timeout=5000` handles the contention cleanly. Also added `PRAGMA busy_timeout=5000` to per-connection init so future write paths benefit.
- **`stream_id` wire format was checked incorrectly.** `StreamId::Workspace(uuid)` serializes as `"workspace:<uuid>"` (Rust `Display` impl), but the WorkspaceThread refresh listener checked `event.stream_id === workspace.id` — it would only have matched the bare-uuid mock format. Production events would have flowed through the channel without ever triggering a refresh. Tightened the listener to match the production prefix and updated the mock to emit production-shaped stream_ids; added a vitest that dispatches a `workspace:<uuid>` artifact event and asserts a refresh fires.
- **Frontend draft preservation is non-trivial.** ComposeDock clears its draft synchronously after `onSend` returns. To preserve on failure, the parent has to re-seed the draft via the imperative `setDraft` handle. Otherwise the user retypes a long prompt every time the orchestrator burps. Pair that with a synchronous `useRef` re-entry guard on `onSend` so two clicks within one microtask don't both dispatch (React state alone batches and would let both through).
- **Cargo workspace tests can flake when one test sets `std::env::set_var` from inside a `#[tokio::test]`.** The first run of `cargo test --workspace` produced one transient failure on the unrelated `core::tests::open_tab_appends_and_projects`. Eight follow-up runs were clean. The likely cause is the projector's broadcast subscriber double-applying the `TabOpened` event under load — a pre-existing race documented in `core.rs` (synchronous `apply` + broadcast subscriber both fire). Out of scope for 13.D.

**Followup fixes (in this same PR after the first review pass):**

- **Order flipped to dispatch-first, persist-second.** Original implementation persisted the user artifact before dispatching to the orchestrator on the principle "drafts survive subprocess failure". That created a duplicate-on-retry pattern: dispatch fails → user artifact persisted → user retries → second user artifact for the same text. Flipped the order so the artifact lands only on successful dispatch; the frontend's draft restoration covers the "didn't lose my text" UX.
- **`OrchestratorEvent::ArtifactProduced` is processed inline.** Originally `tokio::spawn`'d to keep the recv loop draining; that put a concurrent SQLite writer in flight against `AppCore::post_message`. Moved to inline `await` — tool-call burst rate is low enough that briefly blocking the recv loop is fine, and the broadcast channel buffers 256 events behind it.
- **Coalescer holds `Weak<AppCore>`.** Tasks no longer keep the core alive past the caller's last `Arc`; tests can call `boot_test_core` repeatedly without leaking spawned tasks across runs.
- **Length cap.** `cmd_post_message` rejects bodies > 64 KB with `IpcError::InvalidRequest` — caps a runaway paste before it hits the orchestrator or the projector.
- **Attachments warn-and-drop.** Attachments accepted by the IPC are logged at WARN level so we notice if a flow starts depending on attachment delivery before the storage path exists. Tracked as `TODO(13.D-followup)`.
- **`tool_use` / `tool_result` translator gap.** Marked `TODO(13.D-followup)` in `crates/designer-claude/src/stream.rs::translate_assistant`. Per "summarize by default, drill on demand," agent tool calls should at minimum emit `ArtifactProduced` summaries; the wiring lands per-tool as we observe Claude's tool-use shapes.

### Phase 13.E — Track primitive + git wire (review-pass hardening)
**Date:** 2026-04-25
**Branch:** track-primitive-git-wire
**Commit:** TBD

**Hardening pass over the initial 13.E build, applied in the same PR:**

- *Branch-name argument injection blocked.* `validate_branch` rejects names that start with `-` (would be parsed as a `git`/`gh` flag) or contain whitespace, control chars, or any of `~^:?*[\\\0`. Fail-closed at IPC, before the worktree directory is even created.
- *gh subprocess timeout.* `request_merge` runs `gh pr create` under a 30-second timeout (test-overridable). On timeout the track stays `Active` so the user can retry; no ghost in-flight state.
- *Idempotent `request_merge`.* In-memory inflight set keyed by `TrackId`. A double-click finds the second call, short-circuits, and returns a friendly invariant error instead of running `gh pr create` twice and getting "PR already exists" the second time.
- *Robust gh URL parsing.* `gh pr create` interleaves push progress with the PR URL; `extract_pr_url` (in `designer-git`) plucks the last `https://…/pull/N` line. The earlier "trim whole stdout, hand to `gh pr view`" path was fragile.
- *Per-repo serialization of `start_track`.* Per-repo async mutex means concurrent `start_track` calls on the same repo serialize cleanly — one succeeds with its worktree, the other gets a clean "branch already exists" error from git.
- *Partial-init rollback.* If `seed_core_docs` or `commit_seed_docs` fails after `init_worktree` succeeded, the worktree is removed before the error propagates. Same for an event-store write failure on `TrackStarted`. The user can retry without a leaked checkout.
- *Edit-batch signature now per-file.* The earlier coarse signature (file count + total +/-) collided when two distinct diffs touched the same paths with the same totals — the second batch was silently dropped. The new signature includes per-file `+a:-r` so redistributed edits across the same files survive.
- *Bounded `batch_signatures` map.* Cleared opportunistically inside `check_track_status` when the track is `Merged` or `Archived`; `forget_track` exposed for explicit cleanup hooks.
- *Symlink-resolved `repo_path`.* `link_repo` runs `fs::canonicalize` before validation and persistence, so two distinct user-facing paths that point at the same repo dedupe to one stored value.
- *Domain comment corrected.* `TrackState::RequestingMerge` is now documented as reserved (not produced by replay today). Idempotence is enforced in-process via the inflight set rather than a state-machine transition; this matches the frozen event vocabulary.
- *RepoLinkModal a11y.* Tab/Shift-Tab focus trap so keyboard users can't escape the modal into the AppShell behind the scrim. Scrim dismiss flipped from `onMouseDown` to `onClick` so a drag that starts inside the dialog and ends on the scrim no longer surprise-dismisses.

**Tests added in this pass:**
- `start_track_rejects_branches_with_leading_dash` — argument-injection guard.
- `start_track_rejects_branch_with_whitespace` — secondary metachar guard.
- `concurrent_start_track_same_branch_one_succeeds_one_fails_clean` — racing concurrent calls; exactly one track gets projected.
- `start_track_rolls_back_worktree_when_seed_commit_fails` — verifies cleanup path called once and no `TrackStarted` was projected.
- `request_merge_dedupes_concurrent_calls` — in-flight set rejects the second call.
- `request_merge_times_out_on_stalled_gh` — timeout fires; track stays Active.
- `request_merge_surfaces_gh_already_exists` and `_gh_auth_failure` — gh stderr makes it back to the IPC error.
- `edit_batch_signature_distinguishes_same_total_different_distribution` — regression test for the silent-drop bug; would fail under the old coarse signature.
- `link_repo_canonicalizes_symlinked_path` — symlink → canonical path stored.
- `extracts_url_from_progress_decorated_stdout` / `_bare_url_stdout` / `returns_none_when_no_url_present` — `designer-git::extract_pr_url`.
- `traps Tab focus inside the dialog` and `scrim dismiss uses click, not mousedown` — vitest, RepoLinkModal a11y.

**Initial 13.E build (kept below):**

**What was done:**

*Domain.* `crates/designer-core/src/domain.rs` gained the `Track` aggregate (`id`, `workspace_id`, `branch`, `worktree_path`, `state`, `pr_number?`, `pr_url?`, `created_at`, `completed_at?`, `archived_at?`) and the `TrackState` enum (`Active → RequestingMerge → PrOpen → Merged → Archived`). Projection extended with `tracks: BTreeMap<TrackId, Track>` + `tracks_by_workspace: BTreeMap<WorkspaceId, Vec<TrackId>>`, projecting `TrackStarted / PullRequestOpened / TrackCompleted / TrackArchived` (event vocabulary frozen by 13.0; this PR adds the emitters and projection only).

*GitOps.* `designer-git` got `validate_repo`, `init_worktree` (already present, used now), `commit_seed_docs` (skips no-op staged trees so re-seeds are clean), and `current_status` (committed + uncommitted diff vs base). `open_pr` switched to `gh pr create` followed by `gh pr view --json` so we get structured PR fields without parsing free-form output.

*AppCore.* `core_git.rs` filled in. Five new methods: `link_repo`, `start_track`, `request_merge`, `list_tracks`, `get_track`, plus `check_track_status` for the edit-batch coalescer. `RealGitOps` is a process-singleton via `OnceLock`; tests override with `set_git_ops_for_tests`. Tests are serialized via a tokio mutex so the global-override pattern stays sound under parallel execution.

*Edit-batch coalescing.* Explicit, on `check_track_status`. We diff the worktree against base, hash a stable signature (file count, +/- totals, sorted paths), compare against the per-track baseline, and emit one `ArtifactCreated { kind: "code-change", … }` only when the signature changes. Repeated checks with no diff produce no artifact. A 60-second timer was rejected because (a) wall-clock heuristics are flaky on suspended laptops and in tests, (b) timers create phantom artifacts when nothing changed, and (c) explicit-on-check matches the user mental model of "snapshot a moment of work."

*IPC.* New DTOs in `designer-ipc`: `LinkRepoRequest`, `StartTrackRequest`, `RequestMergeRequest`, `TrackSummary`. New IPC handlers in `apps/desktop/src-tauri/src/ipc.rs` and Tauri commands in `commands_git.rs`: `cmd_link_repo`, `cmd_start_track`, `cmd_request_merge`, `cmd_list_tracks`, `cmd_get_track`. All five registered in `main.rs`'s `tauri::generate_handler![…]` (kept alphabetical).

*Frontend.* New `RepoLinkModal` in `packages/app/src/components/`. Wired into `Onboarding` as the final-slide CTA (becomes "Link a repository" when a workspace exists) and into Settings → Account (replaces the static "GitHub: not connected" placeholder with a live, action-attached row). New `RequestMergeButton` in the workspace sidebar header — surfaces only when the active workspace has a mergeable track, runs `cmd_request_merge` on the most recent eligible track. IPC client/types/mock wired in `packages/app/src/ipc/{client,types,mock}.ts`. No new CSS tokens introduced; reuses `app-dialog*`, `btn`, `state-dot`, etc.

*Tests.* Five backend tests in `core_git.rs`: track lifecycle round-trip (Started → PRopened → Completed → Archived), PR-open emitting a `pr` artifact, edit-batch coalescer (two distinct diffs → two artifacts; repeat → none), `link_repo` rejecting non-repo paths, `start_track` requiring a linked repo. Two designer-core integration tests: full track replay through the projector. Three vitest tests covering `RepoLinkModal` (happy path, invalid-path error, empty-input disabled state).

**Why:**

13.E unblocks the workspace-as-feature model in spec Decisions 29–30. Until this lands, "request merge" is a UI-only fiction: there's no Rust state to drive the chrome and no `gh pr create` plumbing. With the Track aggregate + emitters in place, every other 13.X track can hang work off a real, replayable lifecycle (track started → code change → PR open → merged → archived) instead of inventing a parallel surface.

**Design decisions:**

- **Repo-link surfaces.** Two surfaces: onboarding's final slide for first-run, Settings → Account for re-link. Onboarding-only would force users to dismiss → re-open the modal to re-link; Settings-only would bury the first-run path. Two surfaces, one component (`RepoLinkModal`) — same code, different triggers.
- **Request Merge placement.** Lightest-touch option chosen: an icon button in the sidebar header next to the workspace name, surfacing only when a mergeable track exists. The track-rollup block-action surface was the alternative but would have required 13.E to dictate block UX, which ADR 0003 explicitly forbids. The header icon costs one `IconButton` and stays out of the thread.
- **Repo path stored on workspace.** We re-purposed the existing `WorkspaceWorktreeAttached { workspace_id, path }` event to mean "this workspace is linked to repo at `path`." Track-level worktrees live on `Track.worktree_path`. Adding a new event variant was off the table per ADR 0003; this re-use is semantically close (the workspace's worktree IS the source repo from the track's perspective) and preserves replay compatibility.
- **No new design tokens.** The repo-link modal reuses `app-dialog*`, `btn`, `quick-switcher__input`. The request-merge button reuses `IconButton`. All inline styles reference existing tokens (`var(--space-N)`, `var(--color-*)`, etc.) — no arbitrary px / hex / ms.

**Technical decisions:**

- **Track-id-derived worktree paths.** `<repo>/.designer/worktrees/<track-id>-<slug>`. Including the UUID guarantees no two concurrent `start_track` calls collide on a directory even when the slug matches. The slug is decorative — humans recognize it in `git worktree list` output, but uniqueness rides on the track id.
- **Process-singleton GitOps.** `RealGitOps` is stateless; one instance is fine. A `OnceLock` lazily initializes it. Tests override via a separate `OnceLock<Mutex<Option<Arc<dyn GitOps>>>>` and a tokio-Mutex serializes parallel test runs. We did not push `Arc<dyn GitOps>` into `AppCore` because that would have required modifying `core.rs`, which ADR 0002 + the parallel-track conventions explicitly disallow during 13.D/E/F/G.
- **`gh pr create` parsing.** The `--json` flag is rejected by `gh pr create`; we run `pr create` then `pr view --json` to get structured fields. One extra subprocess on the merge-request path — fine, the user is already waiting for GitHub.
- **Edit-batch coalescer signature.** File count + total +/- + sorted paths joined by commas. Distinguishes "edited foo.rs" from "added foo.rs" only via +/- totals, which is correct: both are legitimate semantic batches. The signature is deliberately not a content hash — diffs evolve continuously and we want the coalescer to fire on each meaningful step, not on every keystroke.

**Tradeoffs discussed:**

- *60-second timer vs. explicit check.* Timer is "set it and forget it" but produces phantom artifacts and depends on wall-clock fidelity. Explicit check ("agent finished tool call → call cmd_status_check") is what 13.D will wire and matches how a thinking user models a code-change moment. Picked explicit; 13.D can layer a debounced auto-check on top if the explicit pattern feels too manual.
- *Track owns repo path vs. project owns it.* Project already has `root_path` from `ProjectCreated`. Promoting "repo linked" to project level would mean every workspace in a project shares a repo, which is the common case but doesn't compose with the future spec Decision 32 ("Forking reserved") where forks may diverge. Workspace-level link keeps the option open without changing event shapes today.

**Lessons learned:**

- The serial-test pattern (tokio mutex around shared global state) keeps the test-only override layer simple. Worth keeping in mind the next time a track is tempted to thread an injectable through `AppCore` just to test it.

### Phase 13.G — Safety surfaces + Keychain (SAFETY)
**Date:** 2026-04-25
**Branch:** safety-inbox-keychain
**Commit:** [PR pending]

**What was done:**

Wired the four safety surfaces ADR 0003 reserved for 13.G — approval inbox, scope-denied path, cost chip, macOS Keychain status — and replaced the development `AutoAcceptSafeTools` permission handler with a real, production-default `InboxPermissionHandler`.

Backend (Rust):
- `crates/designer-claude/src/inbox_permission.rs` — `InboxPermissionHandler` parks each Claude permission prompt on a `tokio::sync::oneshot` per-request channel, emits `ApprovalRequested` and `ArtifactCreated{kind:"approval"}` so the request shows up inline in the workspace thread, and waits up to **5 minutes** for a user resolve. Timeouts emit `ApprovalDenied{reason:"timeout"}` and tell the agent to deny — agents never block forever. `PermissionRequest` gained an additive `workspace_id: Option<WorkspaceId>` field; the trait shape stayed frozen per ADR 0002.
- `apps/desktop/src-tauri/src/core_safety.rs` — `AppCore` methods for `list_pending_approvals`, `resolve_approval_inbox`, `cost_status`, `keychain_status`, plus `record_scope_denial` (emits both `ScopeDenied` AND a `comment` artifact anchored to the offending change) and `sweep_orphan_approvals` (replay-safety sweep on boot — orphaned `ApprovalRequested` events become `ApprovalDenied{reason:"process_restart"}` so phantom rows don't pop the inbox after every restart).
- `apps/desktop/src-tauri/src/commands_safety.rs` — five new `#[tauri::command]` handlers: `cmd_list_pending_approvals`, `cmd_get_cost_status`, `cmd_get_keychain_status`, `cmd_get_cost_chip_preference`, `cmd_set_cost_chip_preference`. Registered in `main.rs::generate_handler!` alphabetically.
- `apps/desktop/src-tauri/src/ipc.rs` — replaced the "approvals are a Phase 13.G surface" stubs with real implementations that route through `AppCore::resolve_approval_inbox`. `cmd_request_approval` emits `ApprovalRequested` directly for parity with mock-orchestrator UI flows.
- `apps/desktop/src-tauri/src/core.rs` — `AppCore::boot` now constructs the inbox handler, installs it as the production permission handler on `ClaudeCodeOrchestrator` via `with_permission_handler()`, and runs the orphan-approval sweep right after the projector replay.
- `apps/desktop/src-tauri/Cargo.toml` — added `security-framework = { version = "2", default-features = false }` under `[target.'cfg(target_os = "macos")'.dependencies]`. MIT/Apache-2.0 dual-licensed.

Frontend (React):
- `packages/app/src/blocks/blocks.tsx` — `ApprovalBlock` Grant/Deny buttons now call `cmd_resolve_approval` with the approval id parsed from the artifact payload. Optimistic flip on click, projector becomes truth via subscription to `approval_granted`/`approval_denied` stream events. Resolved-state focus management: focus jumps to the resolution status div via `tabIndex={-1}` so SR users hear the new state and keyboard users don't lose place.
- `packages/app/src/components/CostChip.tsx` — new topbar widget showing `$<spent> / $<cap>` with a colored band (50% green / 80% amber / >80% red, dimmed when no cap). Click expands a small popover with daily/weekly/per-track placeholder. Hidden by default; `COST_CHIP_PREFERENCE_EVENT` re-fetches when Settings flips the toggle.
- `packages/app/src/layout/MainView.tsx` — mounts the chip on the right of `tabs-bar` (margin-left:auto pushes it past the new-tab button).
- `packages/app/src/layout/SettingsPage.tsx` — new Preferences row "Show cost in topbar" backed by `cmd_set_cost_chip_preference`; new Account row "Keychain" rendering `cmd_get_keychain_status` with a stable copy + state dot. Both use `aria-live="polite"` so screen readers don't get re-announced on minor state churn.
- `packages/app/src/styles/app.css` — `.cost-chip*`, `.cost-chip__popover*`, `.settings-page__keychain*` rules. All values reference existing tokens (`--space-*`, `--radius-button`, `--border-thin`, etc.) — no new hex/px values.
- `apps/desktop/src-tauri/src/settings.rs` — `Settings.cost_chip_enabled: bool` (defaults to `false` per Decision 34).

**Why:**

Three decisions converged here. **Decision 22** says approval gates live in the Rust core, non-bypassable — a frontend XSS can't synthesize an approval. The inbox handler enforces this by parking the agent on a `oneshot` channel inside Rust; the only way to release it is an event-store-backed `cmd_resolve_approval`. **Decision 26** says we never touch Claude's OAuth tokens — the Keychain integration is read-only, never writes, never reads the secret contents (only confirms the credential is present so the user sees "connected"). **Decision 34** says the cost chip is opt-in; the toggle defaults to `false` so usage anxiety is a user choice, not a default.

The replay-safety sweep is the staff-engineer review's biggest catch. Without it, every cold boot would surface every previously-pending approval as if they were live — but the Claude subprocess that requested them is gone, the agent isn't waiting, and a "Grant" click would resolve nothing. Sweeping orphans into `ApprovalDenied{reason:"process_restart"}` keeps the projector honest and the inbox clean.

**Design decisions:**

- **5-minute approval timeout.** Long enough for a real human round-trip (interrupted lunch, context switch); short enough that an agent doesn't appear permanently stalled when the user closed the laptop.
- **Cost chip color bands at 50 / 80%.** Green at 0–50%, amber 50–80%, red >80% (matches ADR 0002 §D4 — 95% is the ambient-notice threshold, surfaced separately when wired). Dimmed dot when no cap is configured so the chip doesn't shout when there's nothing to alarm about.
- **Approval payload as JSON, not free-text.** The `ApprovalBlock` parses `{ approval_id, tool, gate, summary, input }` so the UI can wire optimistic resolve + event-stream confirmation without a follow-up `cmd_get_artifact` round-trip. Free-text wouldn't carry the id deterministically.
- **Keychain service name is overridable.** Env var `DESIGNER_CLAUDE_KEYCHAIN_SERVICE` overrides the `Claude Code-credentials` default — a future Claude release that changes the service name doesn't require a Designer patch.
- **`PermissionRequest.workspace_id` defaults to `None`.** Additive field with a `serde(default)` so existing call sites (and `AutoAcceptSafeTools` tests) keep working. Inbox handler fails closed when `None` arrives — denying is safer than dropping the prompt.

**Technical decisions:**

- **`InboxPermissionHandler` lives in `designer-claude`, not `designer-safety`.** It's a `PermissionHandler` impl — the natural home is alongside the trait. Keeps `designer-safety` focused on `ApprovalGate`/`CostTracker`/`ScopeGuard` primitives that the handler uses.
- **Process-global handler via `OnceCell`.** `AppCore` boots the handler before the orchestrator selects it; the IPC layer (`cmd_resolve_approval`) and the orchestrator (caller of `decide`) need to share the same instance. A circular `Arc<AppCore>` would be uglier than a once-set global keyed off the binary's lifetime.
- **`cost_status` returns a flat DTO, not a nested enum.** Frontend reads `spent_dollars_cents`, `cap_dollars_cents`, `ratio` directly; the chip color band is computed in TS so updates don't require a round-trip per band change.
- **`record_scope_denial` is on `AppCore`, not `ScopeGuard`.** The guard returns `Result<PathBuf, SafetyError>` with no event-store reference. A helper at the AppCore level can append both events transactionally and apply them to the projector synchronously.

**Tradeoffs discussed:**

- *Inbox handler global vs `AppCore` field.* Global wins because `ClaudeCodeOrchestrator` is built before `AppCore`'s `Arc` is constructed — wiring the handler into `AppCore`'s field would require a second pass to backfill the orchestrator. Global is hidden behind `install_inbox_handler` so the surface is small.
- *Cost-chip data source: `cost_status` poll vs. `cost_recorded` stream subscription.* Both. Initial render polls; the chip subscribes to `cost_recorded` events and re-polls so it reflects per-turn cost without explicit refresh. Pure subscription would race the projector; pure polling would feel laggy.
- *Approval artifact summary update on resolve.* Considered emitting `ArtifactUpdated` to flip the artifact's summary to "Granted"/"Denied" so the projector reflects status. Rejected — the block subscribes to `approval_granted`/`approval_denied` events directly and flips local state, which is faster and avoids the artifact's `version` churn.
- *Keychain "last verified" timestamp.* Stored in a process-local `OnceLock<Mutex<Option<String>>>` cache, not persisted. A persisted timestamp could imply that we've verified the token contents (we haven't); this signal is "Designer last saw the credential exists." Cache survives within a session, resets on restart.

**Lessons learned:**

- `ApprovalId`'s `Display` includes the `apv_` prefix but `serde::Serialize` is `#[serde(transparent)]` (bare UUID). Tests asserting against the wire shape need `serde_json::to_value(&id)`, not `id.to_string()`. Updated docs in the tests so the next person doesn't trip.
- `tokio::test` defaults to single-threaded. The racing-approvals test needed `flavor = "multi_thread"` plus sequencing the spawns around `wait_for_pending` so the first park's read happens before the second spawn races into the SQLite write lock.
- `cargo fmt --check` only works from the workspace root, not from inside a crate dir — `cargo fmt --all -- --check` is the portable form.

**Post-merge security review fixes (2026-04-25, same branch).**

The launch-grade review caught seven issues across the 13.G surface; all fixed in the same branch before merge:

- **Blocking — `cmd_request_approval` unauth injection.** The IPC was wired to call `store.append(ApprovalRequested)` from any frontend caller. Restored to an explicit error stub with a docstring explaining why: only the orchestrator's `InboxPermissionHandler` is a legitimate producer of approval requests; an XSS-escaped script could otherwise plant fake "Grant write access?" entries in the inbox.
- **Blocking — orphan-sweep race.** `sweep_orphan_approvals` now holds a process-global `tokio::Mutex` for the whole sweep and re-reads the event log per write to catch any terminal event that landed between iterations. Two concurrent callers no longer double-write `process_restart` denials.
- **High — cost replay.** `CostTracker::replay_from_store` walks every `CostRecorded` event into the in-memory map; `AppCore::boot` calls it after construction. Without this, the cap check silently allowed a workspace to double-spend across boots and the topbar chip read $0.00 until the next per-turn cost event. New regression test in `designer-safety::tests::cost_tracker_replay_reflects_historical_spend`.
- **High — `gate.status` lies in production.** Inbox-routed resolutions wrote events directly to the store, bypassing `InMemoryApprovalGate.pending`. Added `gate.record_status` (in-memory only) + `gate.replay_from_store` (boot-time). The handler now takes an optional `Arc<dyn GateStatusSink>`; `AppCore::boot` wires a `GateSinkAdapter` so every resolve mirrors into the gate's map. The trait sink lives in `designer-claude`; the adapter lives in the desktop crate so `designer-safety` does not depend on `designer-claude` (preserves the natural layering).
- **Medium — resolution events on the wrong stream.** `ApprovalGranted/Denied` were written to `StreamId::System` while `ApprovalRequested` went to `StreamId::Workspace(...)`. Workspace-scoped subscribers saw "still pending forever." `PendingEntry` now stores `workspace_id` alongside the `oneshot::Sender`; resolutions and timeouts write to the same workspace stream as the request. Test: `resolution_event_lands_on_workspace_stream`.
- **Medium — workspace-id-missing path didn't audit.** Now emits `ApprovalDenied{reason:"missing_workspace"}` to System so a misconfigured Phase-13.D wiring surfaces in the audit feed instead of silently denying. Test: `missing_workspace_id_emits_audit_row`.
- **Medium — `format_now` reimplemented `rfc3339`.** Replaced with `designer_core::rfc3339(OffsetDateTime::now_utc())` — the codebase's canonical helper. Drops 12 lines of duplicate logic.
- **Medium — CSS hex literals + arbitrary `8px`.** The cost-chip and Keychain-status dot rules carried `#2f9e44 / #d97706 / #c92a2a` fallbacks and `8px` dimensions. Switched to `var(--success-9 / --warning-9 / --danger-9)` (already in `tokens.css` via Radix scales) and `var(--space-3)`. No invariant violations remain.
- **Concurrency — pre-park resolve race.** `decide` now inserts into `pending` *before* emitting any event. If a resolve arrives before decide finishes parking, the entry is already there. Test asserts the observable invariant (entry visible in `pending_ids` before the request event lands in the store).
- **Concurrency — two-click race.** Resolve atomically removes from `pending` *before* persisting the terminal event. A second resolve for the same id finds nothing in the map, returns `Ok(false)`, and writes no event. The audit log carries exactly one terminal event per approval. Test: `two_click_race_writes_only_one_terminal_event`.

Six new tests cover the previously buggy paths (pre-park observation, two-click race, missing-ws audit, workspace-stream resolution, gate sink update, sweep + grant race), plus cost-replay-after-restart in both the bare tracker and through `AppCore::boot`. Frontend gained one test asserting Grant/Deny stay disabled when the artifact payload is missing the parsed `approval_id`. All quality gates clean.

---

### Phase 13.1 — unified workspace thread + artifact foundation
**Date:** 2026-04-24/25
**Branch:** consolidate-tab-server
**Commit:** dc356f1..HEAD (consolidates tab-model-rethink + find-agentation-server + 13.1 build-out)

**What was done:**

*Architectural cutover (the big rock).* Plan / Design / Build / Blank tab types are retired. Every tab in a workspace renders one component — `WorkspaceThread` — which displays a continuous scrollable thread of typed artifact blocks with a docked compose surface. The four legacy tab files (`PlanTab.tsx`, `DesignTab.tsx`, `BuildTab.tsx`, `BlankTab.tsx`) and `HomeTabB.tsx` were deleted. `TemplateMenu` and the template picker are gone — `+` opens a fresh thread.

*Backend artifact foundation.* `crates/designer-core` gained `Artifact`, `ArtifactKind` (12 kinds — message / spec / code-change / pr / approval / report / prototype / comment / task-list / diagram / variant / track-rollup), `PayloadRef` (Inline body / Hash + size schema-only until 13.1-storage), and five new events: `ArtifactCreated / Updated / Pinned / Unpinned / Archived`. `ProjectorState` gained `artifacts: BTreeMap<ArtifactId, Artifact>` and `pinned_artifacts: BTreeMap<WorkspaceId, Vec<ArtifactId>>` with incremental update on every artifact event. Round-trip test covers the full lifecycle; PayloadRef serialization round-trip locks the schema.

*IPC.* Four new commands: `cmd_list_artifacts`, `cmd_list_pinned_artifacts`, `cmd_get_artifact`, `cmd_toggle_pin_artifact`. Plus a macOS `reveal_in_finder` shim so the workspace-sidebar root-path button actually opens Finder. `OpenTabRequest.template` defaults to `Thread` (legacy variants still parse for replay).

*Frontend block registry.* `packages/app/src/blocks/registry.ts` exposes `registerBlockRenderer(kind, Component) / getBlockRenderer(kind)`. Twelve renderers in `blocks.tsx` — seven render real data today (Message, Spec, CodeChange, Pr, Approval, Comment, TaskList), five are registered stubs (Report, Prototype, Diagram, Variant, TrackRollup) so 13.D/E/F/G can wire emitters without touching UI code. `GenericBlock` is the unknown-kind fallback. All visual decisions route through tokens (no inline styles).

*Surface architecture.* Six dev-only sliders in `SurfaceDevPanel` (⌘.) plus a tab-radius variant toggle decompose the surface register into independent knobs:
- Compose fill (compose ↔ parent), Main tab fill (white ↔ sandy), Surface sand (parent brightness)
- Tab opacity, Border intensity, Shadow intensity (two-layer diffuse, modern, not bottom-heavy)
- Tab corner variants: Soft 12 / Concentric 18 / Folder 14-6 / Match 24 / Custom
- Main tab radius slider (0-40px), Compose radius slider (0-32px) — independent of each other and the tab radius

*UX polish (memphis-v2 17-item Agentation feedback pass).* SettingsPage replaces the modal (Help stays modal). Palette gets a leading search icon. PaneResizer haptic snap (`navigator.vibrate(8)`). Reveal-in-Finder on the workspace path. Icon size audit (12→16). Activity spine rewritten: workspace-scoped, sections for Pinned / Artifacts / Code files / Agents / Recent events; pinned/files items use the same edge-to-edge hover treatment as the left sidebar.

*Sidebar restructure.* Horizontal padding moved off `.app-sidebar` and `.app-spine` onto inner blocks (header, group head, rows, sections, lists) so workspace-row and spine-artifact hovers fill the full rail edge-to-edge. Status icons line up with the "Workspaces" section label and Home above. Same pattern in the activity spine.

*Concentric corners.* `--radius-surface` 16 → 24px. Compose corner derives to 8px. Tab corners default to 24 (Match) so the active tab and main surface read as the same material.

*Dark palette rebuild.* Previous dark mode collapsed all surfaces near `sand-dark-1` because `var(--sand-dark-N)` doesn't exist — Radix Colors v3 only ships `--sand-N` and rebinds it under `.dark-theme`. Dark override now references `--sand-N` correctly, with reanchored slider math so the same default values produce real luminance separation: parent `≈sand-3.4` (warm dark page), main tab `≈sand-5.2` (~1.8 steps lifted figure). Foreground `--sand-12` (near-white), border-soft promoted to `--sand-a7`.

*Documentation.* Spec Decisions 36–39 (workspace thread, three-tier artifact presence, block-renderer registry as track contract, write-time semantic summaries). Decision 11 amended to "tabs as views, not modes"; Decision 12 superseded. FB-0024 (tabs as views), FB-0025 (three-tier artifact presence). Phase 13.1 inserted between 13.0 and 13.D-G in the roadmap.

**Why:**

The previous tab model forced users to pick a mode (Plan / Design / Build) before they could work — a cognitive tax with no payoff. The original spec already imagined "templates, not types" (Decision 12) but the implementation kept the mode distinction in the rendering layer. Two parallel branches (tab-model-rethink, find-agentation-server) had each started addressing the gap from different angles. Consolidating them avoided duplicated effort and merge conflict pain, and forced the design to converge before 13.D/E/F/G fan out.

The artifact foundation is the contract that lets those four tracks ship in parallel: each emits typed `ArtifactCreated` events into a registry that already knows how to render them. No track touches UI code. No track touches another track's events. Same scope, no contention.

**Design decisions:**

- **Tabs are views, not modes (Decision 36).** A tab is a lens onto the workspace's shared artifact pool. Multiple tabs = multiple lenses (side thread, agent lens, split). New tabs default to the suggestion view sourced from current activity; first send flips to thread.
- **Three-tier artifact presence (Decision 37).** Inline (where produced) → Pinned (rail) → On-demand (search/timeline). Maps directly to the four-tier attention model. The rail surfaces pinned items above agent activity so pins are the working-context shelf.
- **Block-renderer registry is the contract tracks emit against (Decision 38).** Tracks never paint UI; they emit `ArtifactCreated { kind, payload }`. Adding a new kind is one PR with the renderer + the emitter side-by-side.
- **Semantic summaries written once at write time (Decision 39).** No re-summarization on read. Per-track debounce coalesces edit bursts. Ships empty until 13.F wires the local-model helper.

**Technical decisions:**

- **Promote sketch ideas, delete the sketch.** `tab-model-rethink` shipped a 1,931-line URL-hash-gated demo (`packages/app/src/sketch/WorkspaceThreadSketch.tsx`). Block renderers and the unified thread surface were lifted into production modules and rewritten to use Mini tokens. The sketch file was not committed.
- **Preserve replay compatibility.** `TabTemplate` enum keeps `Plan / Design / Build / Blank` variants alongside `Thread` so old `TabOpened` events replay. Frontend renders all of them as `WorkspaceThread`; legacy titles normalize to "Tab N" on display.
- **Dev panel slider math is mode-aware.** Same slider semantics in light and dark, but the dark anchors span `sand-dark-1↔4` (parent) and `sand-dark-5↔9` (main tab) so the same default percentages produce hierarchy in both modes.
- **PayloadRef::Hash schema-only.** The `Hash` variant exists in the enum and serializes correctly, but the content-addressed store under `~/.designer/artifacts/<hash>` is not implemented. Producers should only emit `Inline` until 13.1-storage lands. Consumers tolerate `Hash` (the renderer fetches via `cmd_get_artifact` regardless).
- **Coalesce stream-event refresh.** `WorkspaceThread` and `ActivitySpine` both subscribe to `artifact_*` events but coalesce bursts onto a single `requestAnimationFrame` so a flurry from one track produces one refresh, not N.

**Tradeoffs discussed:**

- **Single PR vs. four-PR split.** Single PR was the right call — D/E/F/G can't run in parallel until 13.1 is in place, and splitting 13.1 into "events" + "registry" + "tab unification" + "spine" wouldn't have helped because each piece is unusable without the others.
- **Drop legacy tab files vs. keep as adapters.** Dropped. Pre-launch dev, no production replay liability. Each retired entry is preserved in the component manifest with `status: "retired"`.
- **Sketch as code vs. sketch as docs.** Considered shipping the sketch behind `#sketch` for review. Rejected — once the production thread is in, the sketch is just a worse copy. Reference the git blob in the plan if anyone wants to look back.

**Lessons learned:**

- **Radix Colors v3 only exports the base scale name; `.dark` rebinds those names.** There is no `--sand-dark-N`. The first dark-mode pass referenced `--sand-dark-1` etc. and silently failed (text fell through to browser defaults). The fix was a one-line search-and-replace, but the audit for invalid token references should be a project-level invariant.
- **Per-component re-render hotspots emerge fast under live event streams.** `WorkspaceThread.fetchPayload` originally depended on the `payloads` map; every payload load re-created the callback identity, cascaded through `onToggleExpanded`, and re-rendered every block. Functional `setState` reads make these effects safe; treat any `useCallback([state, ...])` over fast-changing state as a smell.
- **Component manifests are load-bearing.** The manifest had been invalid JSON for at least one prior commit (duplicate fields collided in a copy-paste). Nothing flagged it because nothing read the file. Adding `node -e "JSON.parse(...)"` to the invariants would have caught it instantly.

---

### UI overhaul — floating-surface register, dark mode, Lucide icons
**Date:** 2026-04-23
**Branch:** review-frontend-mini
**Commit:** pending

**What was done:**
Multi-session UI overhaul replacing the flat three-pane layout with a two-tier page + floating-surface register, landing a proper dark mode, adopting `lucide-react`, and rebuilding BuildTab around a chat/terminal interaction. User-facing deliverables:

- **Floating main surface.** Workspace sidebar + activity spine now sit directly on the sand page (no fill, no borders). The main content panel is a raised rounded rectangle — pure white in light, sand-dark-1 (off-black) in dark — with a soft hairline border and a subtle shadow. Tabs sit above the surface with a 6 px gap; the active tab is a bordered pill in `--color-content-surface` so it reads as "the same material" as the surface below without merging.
- **Dark mode actually works.** Previous theme bootstrap applied `[data-theme]` only; Radix Colors v3 activates its scales via `.dark-theme` class. A user in system-dark saw the light-mode scales regardless. Rewrote `theme/index.ts` to apply both signals (plus `colorScheme` on documentElement), added a `prefers-color-scheme` listener when in System mode, and wired a System / Light / Dark `SegmentedToggle` into Settings → Appearance. The index.html zero-flash boot script applies the same three assignments synchronously so the first paint is resolved.
- **Lucide adoption.** All ~30 inline `<svg>` tags across 7 files (workspace status glyphs, tab template icons, compose controls, home suggestions, project-strip chrome) replaced with `lucide-react` imports. `components/icons.tsx` becomes thin wrappers around the canonical 7-icon set (stroke 1.25 at sm/md, 1.5 at lg per axiom #13). One-offs import from `lucide-react` directly.
- **BuildTab as chat/terminal.** Dropped the task-list + merge-approval-card layout. Build renders a mono-typed chat stream; user sends instructions or slash commands (`/plan · /diff · /test · /merge`) via the same compose dock PlanTab uses. The merge approval gate is still enforced in the Rust core (spec §5) — `/merge` just asks.
- **HomeTabA restructure.** Kicker removed. Section order re-prioritizes: Needs-your-attention jumps to top and hides entirely when empty; workspace rows compress to status icon + name + one-line summary (first open tab's title); Autonomy becomes a real interactive SegmentedToggle with optimistic local override via `setAutonomyOverride` so it doesn't ship as a false affordance before the Phase 13 IPC lands.
- **Palette bare input.** Default density flipped to `open`; input is bare text + blinking caret on the surface, no container. Notion / Linear feel.
- **Token additions.** New `--radius-surface` (24 px) in `tokens.css`; new `--color-content-surface`, `--color-border-soft`, and `--surface-{gutter, tab-gap, text-pad, inner-pad, shadow}` in app.css. Compose corner radius is derived from the surface radius minus the compose-dock pad (`calc(var(--radius-surface) - var(--surface-inner-pad))` = 8 px) so the compose sits concentric with the floating surface.
- **Retired.** `TypeDevPanel` (type tuning) and `SurfaceDevPanel` (layout tuning) both removed after the values they were tuning landed in tokens.css / app.css. The `packages/app/src/dev/` directory no longer exists. Home variant A/B toggle pruned — Panels committed.

**Why:**
The flat three-pane register (sidebars, main, spine all on the same background separated by hairlines) made every region visually equal; nothing carried "this is the work." The floating-surface register (Linear / Dia / Inflight) delegates the hierarchy to the surface itself — sidebars stop competing with the content, the selected tab reads as part of the floating object, and dark mode's symmetry flip (darker-than-page surface instead of brighter) keeps the figure-vs-ground read intact across modes. Dark mode was simply broken; fixing the Radix class activation was a prerequisite for shipping a theme picker.

**Design decisions:**
- **Two-tier register, committed in both modes.** Amended axiom #8 to codify the page + floating-surface split as load-bearing for the workspace view. Project strip stays on its own Tier-1 surface (it's navigation, not content).
- **Content surface inverts by mode, chrome stays monotonic.** Surface is brighter than page in light, darker than page in dark. Other surface tokens (`--color-surface-flat/raised/overlay`) stay "one step above background" in both modes because they're secondary containers.
- **Style A committed.** Of three tab styles prototyped behind `[data-tab-style]` (selected-only, flat inactive + floating selected, all floating), A won on coherence at the sand + white register. Kept the data-attribute selectors in CSS so the branch can return.
- **Autonomy is interactive, not display-only.** Stub onChange violated the false-affordance axiom; a project-scoped local override makes the control feel responsive now and lets the Phase 13 IPC mutation replace the setter without UI changes.
- **Dev panels are a legitimate design tool, but they retire.** The 24-hour window during which gutter / tab-gap / compose-pad / shadow / tab-style were live-tunable ended the moment the values felt right. Shipping the panel in prod is scope creep; keeping it after the decision is dead weight.

**Technical decisions:**
- **Class-based theme activation, not media-query only.** Radix Colors v3 doesn't honor `prefers-color-scheme` on its own. Our CSS overrides, the index.html inline script, and `theme/index.ts` all apply `.dark-theme` / `.light-theme` + `[data-theme]` + `colorScheme`. System mode installs a `MediaQueryList` listener so OS-appearance changes propagate live.
- **`--color-content-surface` as a first-class role, not a one-off.** The main surface, the active tab pill, and future floating-content surfaces all bind to it; they invert together.
- **Pane-resizer cursor-only.** The ::before hairline and drag-fill were visual noise; a col-resize cursor + focus-visible ring is enough. Handle moved to `calc(var(--surface-gutter) * -1)` so the grabbable zone sits at the floating-surface edge.
- **Concentric compose math via calc().** No magic numbers — inner radius is derived from outer radius minus the separating pad.
- **Shared `WorkspaceStatusIcon`.** Extracted from WorkspaceSidebar so the 7-glyph status vocabulary reads identically on the sidebar and on HomeTabA.
- **`persisted.ts` try/catch around `localStorage`.** Strict sandbox origins (file://, Safari private mode) now fall back silently instead of throwing.

**Tradeoffs discussed:**
- **Surface darker than page in dark vs. brighter.** Brighter would match Slack / Linear convention; darker matches the explicit user ask ("off-black main surface"). The inversion preserves "figure vs ground" in both modes rather than trying to keep surface polarity constant.
- **Lucide vs Phosphor.** Phosphor has more decorative weights (duotone, fill); Lucide's stroke-only register matches our axioms more cleanly. Went with Lucide.
- **Bake dev-panel values into CSS vs. keep the panel in dev forever.** Keeping the panel mounted means every dev build prompts a decision. Baking the values commits; we can re-mount the panel behind a `?dev=1` query in a future pass if another axis needs tuning.
- **Optimistic autonomy update vs. disabled until Phase 13.** Disabled is the safer "false affordances are a bug" response; optimistic gives real feedback now and converges trivially when IPC lands. Chose optimistic because the UX is materially better and the rollback path is a one-line store change.

**Lessons learned:**
- **Radix's activation model is not `prefers-color-scheme`.** This cost real time — dark mode appeared to work in light-system but silently broke on dark-system. Lesson codified as FB-0018: theme-dependent CSS must use the same activation signal as the color library driving the scales.
- **Live tuning beats staff guesswork when contentious values are on the table.** The gutter / tab-gap / compose-pad / shadow / tab-style decisions would have been five rounds of "I think 12 feels right" without the dev panel; ~24 hours of real use closed the decision.
- **Section order on a dashboard is load-bearing UX.** Moving Needs-your-attention to the top only when non-empty is a materially different surface from a static Needs-attention card that sometimes shows "All clear."

---

### Phase 12.A landed — real Claude Code integration validated + workspace/track primitive committed
**Date:** 2026-04-22
**Branch:** phase-12a-plan
**Commit:** pending

**What was done:**

1. **Real Claude Code subprocess integration, validated end-to-end.**
   - `crates/designer-claude/src/stream.rs` — stream-json event translator (Claude stream-json → `OrchestratorEvent`s + side-channel `ClaudeSignal::RateLimit` / `Cost`).
   - `crates/designer-claude/src/claude_code.rs` — full rewrite of `ClaudeCodeOrchestrator`. Native agent-teams primitive, `--teammate-mode in-process`, `--input-format`/`--output-format stream-json` on both sides (Conductor-style persistent pipe), `--permission-prompt-tool stdio`, deterministic `--session-id` per workspace, graceful shutdown with 60s timeout fallback.
   - `crates/designer-claude/src/watcher.rs` — `classify()` rewritten for real file shapes: `teams/{team}/config.json`, `teams/{team}/inboxes/{role}.json`, `tasks/{team}/{n}.json`. Returns `None` (not `Some(Unknown)`) for out-of-scope paths to avoid channel spam.

2. **Fixtures + tests.**
   - Live probe (`scripts/probe-claude.sh`): safe Phase A inventory + live Phase B team spawn. Captured real `config.json`, inbox shapes, stream-json event vocabulary including `rate_limit_event` and `system/task_*` subtypes.
   - Unit tests: 26 in `designer-claude` (stream translator, prompt builders, session-id determinism, watcher classify including UUID-dir exclusion).
   - Live integration test (`tests/claude_live.rs`, gated by `--features claude_live`) spawns a real team via the orchestrator, observes `TeamSpawned`, and shuts down cleanly. Runs in ~28s against a real Claude install.
   - Full workspace: 44 tests pass; `cargo clippy --workspace --all-targets -- -D warnings` clean.

3. **Docs.**
   - `core-docs/integration-notes.md` — source-of-truth for Claude Code 2.1.117's real surface: CLI flags, `~/.claude/` layout, config/inbox/task schemas, stream-json event types with representative shapes, rate-limit event structure, Conductor comparison, known-limitations catalog.
   - `core-docs/adr/0001-claude-runtime-primitive.md` — first ADR. Native teams primitive adopted; spike resolved (option (a) — non-tty in-process works cleanly); alternatives rejected; reversal triggers documented.
   - `.claude/agents/track-lead.md` + `.claude/agents/teammate-default.md` — committed minimum subagent definitions.
   - `.claude/prompts/workspace-lead.md` — reserved stub (per D4; wired in Phase 13.D).

4. **CI scaffolding (self-hosted runner).**
   - `.github/workflows/ci.yml` — Tier 1 hermetic tests on GitHub-hosted macOS.
   - `.github/workflows/claude-live.yml` — Tier 2 live integration on a self-hosted runner (`[self-hosted, macOS, claude]`). Uses the user's keychain OAuth; no API-key path.
   - `.github/workflows/claude-probe.yml` — Tier 3 scheduled daily probe; opens a GitHub issue on version drift from the pinned `integration-notes.md`.

5. **Spec evolution (landed in the same session before code):**
   - New primitive: **track**. A workspace owns many tracks over its lifetime; each track is one worktree + branch + agent team + PR series. Spec §"Workspace and Track" + Decisions 29–32. Phase 19 added to the roadmap for multi-track UX (originally numbered Phase 18; shifted when the security phases — 13.H, 16.S, 17.T — were folded in on 2026-04-22).
   - Workspace lead committed as a persistent Claude Code session (Decision 31); hybrid routing reserved as future token optimization.
   - Fleet-scale stance: rely on Anthropic's own `rate_limit_event` signal + opt-in usage chip; no Designer-imposed concurrency caps (Decision 34). Phase 13.G updated.
   - Self-hosted-runner CI decision codified (Decision 33).
   - Two feedback entries: FB-0016 (test infrastructure mirrors product architecture) and FB-0017 (workspace as persistent feature-level primitive). Renumbered from 13/14 after rebase because main's UI-critique commit had already taken 13/14/15.

**Why:**
Phase 12.A of the roadmap required validating three bedrock assumptions: real Claude Code subprocess works as spec'd; file shapes match what the placeholder code assumed; the `Orchestrator` trait can absorb the real primitive without downstream ripple. The initial probe found the placeholder's `claude team init/task/message` CLI was speculative — no such subcommand exists. A follow-up web check showed agent teams are a real, shipped, env-var-gated feature with a natural-language-driven interaction model. The rewrite pivoted to the real primitive; the trait survived unchanged.

In the middle of the planning, the user pushed back on the "workspace = worktree = PR" 1:1 model as limiting for a non-engineer manager-persona. That surfaced the track primitive. Committed the direction in the spec now; UI implementation staged into Phase 19 (was Phase 18 at the time; shifted when the security phases folded in).

**Design decisions:**
- Native agent-teams primitive over pivoting to per-role `claude -p` workers (ADR 0001). Keeps Claude's built-in shared task list + mailbox + hook firing; rebuilds nothing.
- Stream-json as the primary lifecycle feed; file watcher is secondary. `rate_limit_event` + `system/task_*` subtypes appear in the stream and are richer than on-disk state.
- Backend coalesce partial messages at 120ms (decision D3, deferred to 13.D implementation).
- Workspace lead ships as a full Claude Code session in v1; hybrid routing reserved.
- Track primitive decouples the manager-level "feature" from the engineer-level "branch/PR" — differentiates Designer from Conductor/Crystal/Claude Code Desktop at the abstraction level.

**Technical decisions:**
- Deterministic UUIDv5 derivation for Claude's external IDs (`task_id` strings, `role@team` agent names) using the workspace UUID as namespace. Stable across restarts, no ID-mapping store needed.
- Long-lived subprocess per workspace; stream-json on stdin and stdout; mpsc channel fronts stdin to serialize writes.
- `--permission-prompt-tool stdio` instead of `--dangerously-skip-permissions` (Conductor's pattern) — clean path for 13.G approval gates.
- `kill_on_drop(true)` + 60s graceful shutdown timeout with `start_kill()` fallback.
- Self-hosted GitHub Actions runner for live CI: uses the user's real keychain OAuth; compliance-matched to production auth path; zero CI minute cost.

**Tradeoffs discussed:**
- Pivot-to-raw-sessions vs. native-teams-primitive: native wins because we'd otherwise rebuild Claude's coordination infrastructure.
- API-key CI auth vs. self-hosted-runner CI: self-hosted wins because API-key mode tests a different code path than ships (OpenClaw-adjacent for cloud subscription proxying).
- Fleet concurrency caps vs. rely-on-Anthropic-signals: signals win; users on Conductor routinely run ~10–12 concurrent tracks and that's within intended use.
- Hard concurrency-cap defaults vs. conservative single-track default with opt-in parallelism: conservative default wins (matches Decision 19 "suggest, do not act").

**Lessons learned:**
- The placeholder code's biggest mistake was assuming a CLI subcommand tree the product doesn't have. The real surface is natural-language-driven. Should have probed before coding the stubs. Noted as a general principle: all integration modules start with a probe + `integration-notes.md` before any stub.
- The workspace/track reframe was not on the original roadmap; it emerged from user feedback mid-plan. The right thing was to commit the primitive to the data model now (event shape extensibility) and stage the UI for later rather than defer the data work too.
- `ps` gave us Conductor's actual command line by accident — useful signal that we now know Conductor uses stdio permissions. Adopted.

---

### Phase 12.B — Staff UX designer + staff engineer review pass SAFETY
**Date:** 2026-04-21
**Branch:** phase-12b-plan
**Commit:** pending

**What was done:**
Two-lens post-implementation review (staff UX designer + staff engineer) run in parallel against the freshly-landed Phase 12.B backend. Converged on a prioritized fix list, applied all P0/P1/P2 items, added 13 new tests to lock the fixes. Concretely:

**Correctness fixes (P0).**
- `HelperHealth::running` no longer lies under lock contention. Added a `parking_lot::RwLock<HelperHealth>` published in lock-step with `SupervisorState` mutations; `health()` reads lock-free and always reports truthful state even during in-flight round-trips.
- `HelperError::Timeout(Duration)` is now a distinct variant. Boot-probe deadline overruns, write deadlines, and read deadlines all map to `Timeout`, not `Unavailable`. `select_helper` discriminates `PingTimeout` vs `PingFailed` structurally instead of substring-matching "deadline" in error strings.
- Split `FallbackReason::PingFailed` into three reasons: `UnsupportedOs` (matches `Reported("macos-too-old")`), `ModelsUnavailable` (matches `Reported("foundation-models-unavailable")`), and residual `PingFailed` for genuinely unknown errors. Each now carries a `RecoveryKind` (`User` / `Reinstall` / `None`) so the UI can route retry affordances correctly.
- `stub_helper` parses requests with `serde_json` instead of substring-matching `"kind":"ping"` — a prompt containing that literal no longer misfires.
- `audit_claim` parser handles real-model responses with trailing punctuation or sentence wrapping (`"Supported."` → `Supported`, `"contradicted by evidence"` → `Contradicted`). Normalized by taking the first alphabetic word of the lowercased response.
- NullHelper vocabulary now matches the user-facing taxonomy: `ping()` returns `"unavailable"` (not `"null / disabled"`); `generate()` returns `[unavailable <job>] <prompt prefix>` (not `[offline …]`). Added explicit docstring that the `generate()` output is a **diagnostic marker**, not a summary — 13.F surfaces must branch on `kind == "fallback"` and render a skeleton instead of the returned string.

**API hygiene (P1).**
- `cmd_helper_status` returns `HelperStatusResponse` directly, not `Result<_, IpcError>` — it cannot fail, and the false `Result` forced dead error handling at callers.
- `HelperStatusResponse` gained three Rust-owned fields: `provenance_label` ("Summarized on-device" / "Local model briefly unavailable" / "On-device models unavailable"), `provenance_id` (stable kebab-case for `aria-describedby`), and `recovery` (`user` / `reinstall` / `none`). 13.F's three surfaces (spine row, Home recap, audit tile) can drive provenance off one DTO without re-implementing the string map.
- `SwiftFoundationHelper::subscribe_events()` exposes a `broadcast::Receiver<HelperEvent>` with `Ready { version, model }` / `Degraded { consecutive_failures }` / `Demoted` / `Recovered`. `AppCore::subscribe_helper_events()` forwards via a small bridge task so callers receive events without depending on the concrete helper type. 13.F can re-render provenance on transitions without polling per-artifact.
- Swift helper: `JSONEncoder().encode` wrapped in `do/catch` producing a last-resort `{"kind":"error","message":"encode-failed"}` frame; `writeFrame` returns `Bool` so main loop breaks on closed stdout instead of spinning. Foundation-Models errors use `String(describing:)` rather than `localizedDescription` (often empty on Apple SDK errors).
- `probe_helper` is now generic over `Arc<H: FoundationHelper + ?Sized>` — accepts `Arc<dyn FoundationHelper>` for symmetry with the rest of the crate.
- `HelperTuning::new()` debug-asserts non-empty backoff, ≥1 max-failures, non-zero deadline.

**Test quality (P1/P2).**
- Replaced the wall-clock sleep loop in `supervisor_demotes_after_max_failures` with a bounded polling loop; no longer races on slow CI.
- Added two deterministic event tests: `events_emit_ready_on_first_success_and_degraded_on_failure` and `events_emit_demoted_once_threshold_crossed`.
- Added seven new DTO unit tests in `ipc.rs` covering every `FallbackReason` variant (taxonomy, recovery routing, provenance label/id).
- Added two new `core.rs` unit tests for `fallback_reason_from_probe_error` and `RecoveryKind::recovery`.
- `ops.rs` gained `audit_trims_trailing_punctuation_and_sentence_wrap` to regression-test the parse fix via a fixed `FoundationHelper` impl.

**Doc moves / vocabulary refinement.**
- "Fallback summary" draft vocabulary replaced with the three-way taxonomy above. Pattern-log entry updated accordingly.
- "Supervisor fails fast" pattern-log entry moved into `integration-notes.md` §12.B (it's a code contract, not a UX pattern).
- `integration-notes.md` extended with: granular fallback-reason table with `recovery` column; explicit "NullHelper output is a marker, not a summary" guidance for 13.F; "`fallback_detail` is diagnostic-only" constraint; helper-events protocol description.
- New pattern-log entry: "Helper events fan-out via broadcast, not event-stream" — explains why helper-health transitions don't live in the persisted event log.
- PACKAGING.md no longer leaks the `NullHelper` class name into docs ("continues with on-device features disabled").

**Metrics.**
- Rust tests: 31 → **43 passing**, all green (+12 net: 2 core unit, 7 ipc unit, 2 event integration, 1 audit regression).
- Frontend tests: 11 passing (unchanged — no frontend files touched).
- Mini invariants: 6/6 passing.
- `cargo clippy --workspace --all-targets -- -D warnings` clean.
- `tsc --noEmit` clean.

**Why:**
The three-lens plan caught the right strategic calls but the first-pass implementation left real correctness bugs (health snapshot lying under load, string-matched error discrimination, trailing-punctuation parse miss) and vocabulary that didn't survive UX scrutiny ("Fallback summary" over-promises; `[offline]` contradicts our own rationale for avoiding that word). Better to catch those on the same branch than to let them bleed into 13.F's implementation.

**Design decisions:**
- **Three-way provenance taxonomy, not two.** Live → transient → terminal, keyed by recovery affordance. Lets 13.F branch cleanly on whether to offer retry without parsing error strings.
- **Rust owns the vocabulary.** `provenance_label` + `provenance_id` are computed server-side in the IPC handler. All three 13.F surfaces get identical copy and identical `aria-describedby` anchors without coordinating.
- **`NullHelper::generate` is explicitly marked as a diagnostic marker.** 13.F renderers that consume `LocalOps::*` must branch on `kind == "fallback"` and show a skeleton. Documented in integration-notes so a 13.F reader can't miss it.
- **Broadcast channel, not event-log, for helper transitions.** Helper health is per-process runtime state; persisting it as `EventPayload` variants would pollute per-workspace event replay with process-scoped noise.

**Technical decisions:**
- **Separate `record_success` from `Ready` emission.** Event firing needs version/model strings, which are only known after the Pong is parsed. `record_success` now only handles health publishing + `Recovered` (no data dependency); `Ready` is emitted explicitly from `ping()` after the Pong fields are captured and `has_succeeded_once` transitions for the first time.
- **`build_event_bridge`.** One tokio spawn per boot that forwards from the supervisor's internal `broadcast::Receiver` to an `AppCore`-owned `broadcast::Sender`. Prevents `AppCore` from having to know the concrete helper type to hand out receivers, keeps `helper: Arc<dyn FoundationHelper>` clean.
- **Pure `fallback_reason_from_probe_error` mapper.** Tested in isolation; the one place we still string-match (`Reported("macos-too-old")`, `Reported("foundation-models-unavailable")`) is against documented Swift-side machine tags, not against our own format strings — so changing a Rust error format can't silently reroute.
- **Cached `HelperHealth` via `parking_lot::RwLock`.** `health()` is now a pointer read, doesn't block on the async supervisor mutex. Updated by `publish_health(state)` at every state-mutation point (success, failure, spawn).

**Tradeoffs discussed:**
- **Three provenance strings vs. two.** Two was simpler, but conflated recoverable and terminal fallbacks — which the UI needs to distinguish to decide whether to offer retry. Three costs one more string and one more `provenance_id`, pays off by removing a renderer-side branch.
- **Separate broadcast channel in AppCore vs. expose supervisor's channel directly.** Direct would save the forwarding task but tie AppCore to `SwiftFoundationHelper` concrete type. The forward is ~20 lines and keeps the `Arc<dyn FoundationHelper>` interface clean.
- **Ready event in `ping()` vs. `record_success`.** Record_success is where the success counter resets, so it felt like the natural home — but it doesn't have the Pong fields. Splitting keeps each function responsible for exactly what it sees.

**Lessons learned:**
- Review on the same branch is cheaper than follow-up PR. The UX reviewer caught that "Fallback summary" implied `NullHelper::generate` returns a real summary, which it doesn't. Left alone, that would have shipped into 13.F's render path.
- String-matching on error messages for variant discrimination is always fragile, no matter how brief the strings look. The `"deadline"` substring match was technically correct but broke the principle of using types for discrimination. Added a `Timeout` variant; the match now compiles or doesn't — no silent drift.
- Cached-state patterns for hot reads (`parking_lot::RwLock<HelperHealth>`) are almost free and pay back immediately. Don't defer until performance is a problem.

---

### Phase 12.B — Foundation helper infrastructure (three-perspective plan + supervisor) SAFETY
**Date:** 2026-04-21
**Branch:** phase-12b-plan
**Commit:** pending

**What was done:**
Reviewed Phase 12.B through three lenses (staff UX designer, staff engineer, staff designer engineer), captured the plan at `.context/phase-12b-plan.md` with an optimization pass applied, then implemented the backend half. Shipped: (1) Swift helper polish — `--version` flag, `unknown-request` handling, `localizedDescription`-wrapped Foundation-Models errors. (2) `HelperSupervisor` — async with 5-step exponential backoff `[250, 500, 1000, 2000, 5000]` ms, permanent demotion to `NullHelper` after 5 consecutive failures, 2 KB bounded stderr ring drained by a background task, fail-fast on in-flight failures (no UI blocking), configurable `HelperTuning` for tests. (3) `AppConfig::helper_binary_path` with priority-ordered resolution: `DESIGNER_HELPER_BINARY` env → `.app` bundle sibling in `Contents/MacOS/` → Cargo workspace dev path. `DESIGNER_DISABLE_HELPER=1` kill-switch. (4) `select_helper()` with structured `FallbackReason` variants, 750ms boot probe. (5) `AppCore.local_ops: Arc<dyn LocalOps>` wired at boot — `FoundationLocalOps<H: ?Sized>` relaxed for trait objects. (6) `cmd_helper_status` IPC + flat `HelperStatusResponse` DTO in `designer-ipc`. (7) Stub helper at `crates/designer-local-models/src/bin/stub_helper.rs` — CLI-arg driven, parallel-test-safe, modes: `ok`, `slow_ping`, `die_after_ping`, `always_die`, `panic_to_stderr`, `bad_frame`. (8) 6 new `runner_boot.rs` integration tests + 6 `real_helper.rs` tests (env-gated silent skip). (9) `scripts/build-helper.sh` — swift build + smoke `--version` check. (10) Docs: new `core-docs/integration-notes.md` §12.B, `apps/desktop/PACKAGING.md` helper section with Phase-16 `externalBin` plan, `plan.md` / `pattern-log.md` / `generation-log.md` updates. Zero UI changes.

**Why:**
Phase 12.B blocks 13.F (local-model surfaces). Today's work landed everything that doesn't need the Apple Intelligence hardware — the supervisor, config wiring, fallback diagnostics, IPC surface, and a stub-based test harness that exercises the supervisor on any host. The final validation (run on an AI-capable Mac, confirm the SDK call shape) is a manual follow-up that updates `integration-notes.md` with observed deltas.

**Design decisions:**
- **Zero UI changes in 12.B.** FB-0007 (invisible infrastructure) and FB-0002 (suggest, don't act) argued against announcing Apple Intelligence. Nothing on screen yet has provenance that depends on helper availability; the indicator anchors better on real 13.F output than on an abstract capability pill.
- **Vocabulary pre-drafted for 13.F.** "Summarized on-device" / "Fallback summary" locked in `pattern-log.md`.
- **Provenance at the artifact, not the chrome.** Explicitly rejected the global topbar chip. Pattern logged for 13.F.
- **No Settings UI, no onboarding slide.** `DESIGNER_DISABLE_HELPER=1` covers the diagnostic case; no user-facing toggle for a dependency 99% of users will never think about.

**Technical decisions:**
- **Inside-the-bundle install, not `~/.designer/bin/`.** First plan said user-space install. Industry-conventions pass (Chrome / Electron / VS Code all bundle helpers inside `Contents/MacOS/`) corrected it to a dev-time `.build/release/` path that maps directly to the Phase-16 bundle path. One signing pass, atomic updates, hardened-runtime compatible, zero Phase-16 re-path work.
- **Fail-fast supervisor over blocking retry.** Initial draft had a single-shot retry. Rejected as a hack per user directive ("do whatever is most robust and scalable"). The supervisor never sleeps under the request lock: failing requests return `Unavailable` with the stderr snapshot, the cooling-off window is consulted at the *start* of the next request, respawn happens lazily. UI call time bounded at the per-request deadline (5s default) even during a crash storm.
- **Configurable `HelperTuning`.** Hardcoded const backoffs would make the demotion test take 8.75s. Extracted a small struct with `Default`; tests use 10ms steps and finish under 500ms.
- **Stub via `src/bin/stub_helper.rs` + `CARGO_BIN_EXE_stub_helper`.** Standard Cargo pattern. Stub reads mode from argv (per-spawn) not env (process-global) — parallel tokio tests otherwise stomp each other.
- **`H: ?Sized` on `FoundationLocalOps`.** `AppCore::helper` is `Arc<dyn FoundationHelper>`; relaxed the bound so trait objects pass through without re-concretizing. Zero runtime cost.
- **Flat `HelperStatusResponse` DTO.** Keeps the TS render trivial; boot status + live health merged for the UI's single-poll case.

**Tradeoffs discussed:**
- **Stub binary vs. mock trait impl.** Mock would be faster but wouldn't exercise pipe handling, `tokio::process` semantics, stderr drain, or read/write timeout paths. Stub costs one 70-line binary; catches real IO bugs.
- **Demotion flag vs. swapping the Arc in AppCore.** Swapping is architecturally cleaner but needs mutable `AppCore.helper` or a Mutex layer. Kept the internal flag: demoted `SwiftFoundationHelper` short-circuits all exchanges with `Unavailable`; `helper_health()` returns `running: false`. 13.F can build "re-enable helper" on top of this without architectural change.
- **Boot ping deadline 750ms vs. 500ms.** 750ms accommodates a cold Swift spawn + Foundation Models warm-up on a freshly booted Mac, still imperceptibly short for UX.
- **Status + health as one struct vs. two.** Conceptually separate (boot selection = immutable; health = mutable), merged in the IPC DTO where the UI wants one row.

**Lessons learned:**
- Env-var-based per-test config is a trap in tokio — parallel tests race on global env. Argv is the right knob for per-child test modes.
- Hardcoded consts in a supervisor make demotion untestable in finite time. Extract a tuning struct with `Default` *before* writing the first backoff test.
- "What's the industry standard?" is a cheap but valuable question. First-draft defaults ("install to `$HOME/.designer/bin/`") were structurally worse than the standard pattern (inside the `.app`), and the difference rippled into Phase 16. Asking early saved a re-plumbing step.

---

### Phase 12.C simplify pass — Tauri adapter, parallel boot, wire tests
**Date:** 2026-04-21
**Branch:** tauri-shell

**What was done:**
Three parallel agents reviewed the Phase 12.C diff (code reuse, code quality, efficiency). Consolidated findings, fixed each actionable item, added the two highest-value missing tests. Extracted `packages/app/src/ipc/tauri.ts` — a runtime adapter that owns `__TAURI_INTERNALS__` detection, dynamic-imports `invoke` / `listen` behind module-cached promises, and handles the "torn before ready" async-listener race in one place. `TauriIpcClient` and `App.tsx`'s menu listener now both consume this helper; the duplicated 20-line teardown dance in `App.tsx` + the dead `listenerTeardowns: Set<() => void>` field in `TauriIpcClient` are gone. Parallelized `bootData` in the frontend store: the three nested awaits (projects → workspaces → spines) became two `Promise.all` waves, cutting cold-start IPC latency from ~N+M+1 sequential calls to three parallel batches. Added Rust tests: `StreamEvent::from(&EventEnvelope)` round-trip in `designer-ipc` (2 tests — kind/sequence/timestamp/payload flattening + `summary: None` omission) and `AppCore::open_tab` / `spine` in `designer-desktop` (4 tests — tab append + project spine + workspace spine + unknown-workspace-empty). 29 Rust tests + 11 frontend tests + 6/6 Mini invariants + clippy clean in both dev and release.

**Why:**
The 12.C review pass caught runtime bugs; this simplify pass tightens the code that compiled. The Tauri adapter eliminates a pattern-duplication drift risk (two call sites of the torn-flag dance could drift as Tauri's event API evolves); the parallel bootData is a straight latency win; the new tests cover wire boundaries (StreamEvent shape) and new AppCore operations (`open_tab`, `spine`) that previously had no Rust-side coverage.

**Design decisions:**
- `ipc/tauri.ts` is the only module that touches `@tauri-apps/api`. Clients never dynamic-import the package directly. Keeps web/test builds from loading native bridges and gives a single place to evolve if Tauri's JS surface changes.
- The adapter returns a synchronous-to-the-caller teardown fn from `listen()`, even though the underlying registration is async. Pattern handles "user tore down the listener before the subscription registered" without leaking.
- `bootData` waits on `listProjects` + `spine(null)` first (they're independent), then fans out `listWorkspaces(p)` over projects, then fans out `spine(w)` over all workspaces. Three waves, not four — every wave does all its work in parallel.

**Technical decisions:**
- Module-level `invokePromise` / `listenPromise` are thunks (`() => import(...)`) rather than immediately-invoked so test environments that don't stub the Tauri package aren't forced to evaluate the import. Subsequent `await`s hit the ES-module cache after first call.
- `StreamEvent::from` test uses `Timestamp::UNIX_EPOCH` so the RFC3339 output is deterministic (`"1970-01-01..."`); no clock flakiness.
- `AppCore` tests leak the `tempdir()` rather than letting it drop at end of test. The core holds open SQLite connections; dropping the tempdir mid-test would race the pool shutdown. Leak is acceptable — tests are short-lived processes.

**Tradeoffs discussed:**
- Considered caching `Settings::load` in `AppCore::settings` field per the efficiency agent's finding. Rejected — the settings file is <200 bytes and load is O(1); caching adds state consistency responsibility (when does it invalidate?) without material perf win.
- Considered moving `spine`'s summary formatting to a `SpineRow` builder method per the quality agent. Rejected — all current formatting is placeholder; Phase 13.F replaces wholesale with `LocalOps::summarize_row`. Extracting a builder now would be premature.
- Agent 2 flagged a potential camelCase/snake_case mismatch (TS sends `projectId`, Rust expects `project_id`). Verified: Tauri v2 auto-converts between camelCase (JS default) and snake_case (Rust default) for command args. My code is correct for v2.

**Roadmap alignment check:**
All Phase 12.C deliverables from `roadmap.md` are met with one intentional deviation: the capability set is tighter than the roadmap suggested. Roadmap listed a restrictive "allowlist" (v1 terminology) including pre-declared FS / shell / network scopes. Tauri v2 uses capability plugins — you can only grant what you've pulled in as a dep. I pulled in no FS / shell / dialog / network plugins because 12.C doesn't need them; each arrives with the phase that uses it (13.E: FS + dialog for repo picker; 13.D: shell for claude; 13.F: shell for the Foundation helper; Phase 16: network for updater). This is stricter than the roadmap asked and gives the 12.C build the smallest possible surface to audit.

**Lessons learned:**
- Dynamic-import hygiene matters more than it looks. The old inline `(async () => { const { listen } = await import(...) })()` pattern was fine per file; across two call sites it was a drift risk.
- Spawning review agents in parallel and aggregating is faster than doing review serially and catches different classes of issues — code-reuse agent caught the adapter-extraction opportunity; efficiency agent caught the bootData parallelization; quality agent caught the comment-cleanup work.
- Adding tests at wire boundaries (serde round-trips, IPC command surfaces) pays more than adding tests of internal helpers. The StreamEvent test would catch a TS contract break that no other test would.

### Phase 12.C review pass — bug fixes + UX polish
**Date:** 2026-04-21
**Branch:** phase-12c-plan

**What was done:**
Joint staff-engineer + staff-UX re-review of the Phase 12.C implementation surfaced four defects and three polish items. Fixed all of them. (1) Window double-creation: `tauri.conf.json` declared a "main" window and `.setup()` also built "main" → Tauri creates config windows before setup runs, so the programmatic builder would error at boot. Removed `windows[]` from the config; window creation is now entirely programmatic (required anyway to pass the resolved theme as a URL hash). (2) Duplicate `title_bar_style(Overlay)` call eliminated. (3) File > New Project… menu item was emitting `designer://menu/new-project` with nothing listening on the frontend; added an `App.tsx` effect that listens under Tauri and triggers a new `promptCreateProject()` store action (shared with the `+` strip button so the two flows stay synced). (4) NSWindow background hex was `#FAFAFA` / `#0B0B0B` — close to but not matching `--color-background = --gray-1 = mauve-1` (`#fdfcfd` / `#18181a`). Dark-mode diff was visibly noticeable (0x0B → 0x18 is ~8% luminance). Switched to exact RGBA tuple returned from `ResolvedTheme::background_rgba()`. (5) Extracted a `make_main_window` helper used by both boot and dock-reopen so the two call sites cannot drift. (6) Dropped unused `_app: AppHandle` arg from `set_theme`. (7) Menu label now "New Project…" per macOS HIG (ellipsis = command prompts for input).

**Why:**
The initial 12.C ship compiled and passed lint/test gates, but a careful code review caught four bugs — one of which (double-creation) would have crashed the app on first launch. The review also surfaced paper-cut UX (dead menu item) and a subtle but visible cold-boot color mismatch in dark mode. Each fix is small and local; the aggregate effect is a shell that actually boots correctly, renders without a flash, and has a fully-wired menu.

**Design decisions:**
- Shared `promptCreateProject()` store action rather than a pub/sub between `App.tsx` and `ProjectStrip`. Single source of truth for the creation flow; adding more entry points (command palette, contextual menu) is a one-line addition.
- `make_main_window` helper takes `impl Manager<R>` so both the `App` (at setup) and `AppHandle` (at reopen) can pass themselves in. No code duplication; configuration changes land in one place.

**Technical decisions:**
- Window config moved entirely from `tauri.conf.json` to programmatic construction. Rationale: the theme-via-URL-hash pattern requires runtime construction anyway, and mixed config/code window creation is a common Tauri v2 footgun.
- `ResolvedTheme::background_rgba() -> (u8, u8, u8, u8)` instead of a hex string. Tauri's API wants bytes; the string-to-parse round-trip was unnecessary machinery.
- Frontend menu listener uses the same `'__TAURI_INTERNALS__' in globalThis` guard as `ipcClient()` — the effect is a no-op in vitest/jsdom.

**Tradeoffs discussed:**
- Considered adding a second entry for `promptCreateProject` via an app-level event bus; rejected — the store action is simpler, testable, and doesn't introduce a new pattern for callers to learn.
- Considered consolidating `#[cfg(debug_assertions)]` menu branches; kept as-is because the debug-only "Toggle DevTools" genuinely should not ship in release.

**Lessons learned:**
- When a Tauri v2 app uses programmatic windows, the `windows[]` array in the config should be empty. Declaring a window in both places is a quiet footgun — no build-time error, crash at runtime.
- Token-derived hex is worth the small lookup cost; approximating with "close enough" values loses the designer-engineer's trust fast.
- Review caught what tests couldn't: nothing in the Rust or React test suite exercised the actual Tauri boot path or the menu IPC. Interactive smoke (`cargo tauri dev`) on the user's machine remains the final verification.

### Phase 12.C shipped — Tauri v2 shell binary
**Date:** 2026-04-21
**Branch:** phase-12c-plan

**What was done:**
Replaced the CLI-demo `main.rs` in `apps/desktop/src-tauri/` with a full Tauri v2 application shell. React frontend now renders against a live `AppCore` (not `MockCore`) when running under Tauri; events stream from the Rust event store to the frontend via the `designer://event-stream` channel. All eight `#[tauri::command]` handlers are registered; `open_tab` and `spine` are new `AppCore` operations (`request_approval` / `resolve_approval` deliberately stubbed — those are 13.G). Theme persists in a sidecar `~/.designer/settings.json`; resolved at boot and passed to both NSWindow background and a URL hash so `index.html` can set `documentElement.dataset.theme` before React boots — zero cold-boot color flash. Standard macOS menu set (App/File/Edit/Window/Help + debug-only View); ⌘R reserved for the frontend. `data-tauri-drag-region` spacer at the top of the project strip clears the overlay-styled traffic lights. 23 Rust tests (+4 new settings tests) + 11 frontend tests + 6/6 Mini invariants + clippy all clean.

**Why:**
Phase 12.C was the single gate unblocking every track in Phase 13 — the frontend needed a real Rust runtime to talk to, and every Phase 13 track (agent wire, git + repo linking, local-model surfaces, safety + Keychain) starts with a live `AppCore` wired to the UI. Without the shell, the React app could only exercise `MockCore`, and the event store had no way to broadcast to any consumer.

**Design decisions:**
- Zero-flash cold boot uses three synchronized layers: NSWindow background color via `WebviewWindowBuilder::background_color`, `#theme=...` URL hash consumed by an inline `<script>` in `index.html` before React mounts, and `tauri.conf.json` `backgroundColor` as the no-window-yet fallback. Pattern-log entry explains why this matters (cold-boot color mismatch is the most visible "cheap desktop app" tell).
- Theme choice stored in sidecar `settings.json`, not the event store. Theme is per-install UI state; syncing it to a phone over Phase 14 would be wrong.
- Standard macOS menu omits ⌘R so the frontend can reclaim it for a workspace-level refresh action later.
- `titleBarStyle: Overlay` + `.app-strip-drag` spacer gives the Mini-on-desktop traffic-light inset look without custom title-bar chrome. Simpler than a full custom chrome, cleaner than a regular title bar.
- Vibrancy via `NSVisualEffectView` deferred — the plan said "ship with vibrancy", but visual testing requires actual window inspection; stubbed out until Phase 15 with a clear pattern-log entry to pick it up then.

**Technical decisions:**
- Tauri v2 (not v1). The roadmap's "allowlist" language was pre-v2; v2 uses per-command capabilities in `src-tauri/capabilities/default.json`.
- `#[tauri::command]` wrappers in `commands.rs` delegate to the existing `ipc::cmd_*` async functions — tests continue to invoke the latter directly without a Tauri runtime.
- Bundle identifier: `com.benyamron.designer` (user-chosen; see `.context/phase-12c-plan.md` confirmed decisions).
- Rust `StreamEvent` flattened to match TS `{kind, stream_id, sequence, timestamp, summary, payload}` via `From<&EventEnvelope>` in `designer-ipc`. Chose to update Rust (localized) rather than TS (distributed) consumers.
- `@tauri-apps/api@^2` installed in `@designer/app`; `invoke` and `listen` are dynamic-imported so jsdom/web builds don't break.
- Feature flag for no-Tauri builds was in the plan; dropped during implementation — Tauri v2 on macOS builds cleanly with system frameworks, no WebView2-style pain that would warrant the complexity.
- Event bridge (`events.rs`) forwards `broadcast::Receiver<EventEnvelope>` → `app.emit(...)`; handles `RecvError::Lagged` by logging and continuing rather than crashing (frontend re-syncs on next user action).

**Tradeoffs discussed:**
- IPC scope gap: option B chosen (add `open_tab` + `spine` to AppCore; stub approvals) over A (narrowest, 4 commands only, broken UI) or C (pull 13.G's approval work forward). B keeps 12.C's "shell works end-to-end" promise without expanding scope into safety-surface design.
- Theme persistence: sidecar file over event-store event. Rationale tracked in pattern-log — events are domain truth and will sync to mobile in Phase 14; user's theme preference should not.
- Icon: shipped with a placeholder (Python-generated black square with stylized "D"), not blocking on real brand assets. Real icon is a Phase 16 signing-and-bundle item.

**Lessons learned:**
- Tauri v2's `Emitter` + `Manager` traits need explicit `use` imports — easy miss. Tauri's compile errors are good but the trait-in-scope message is far from the call site.
- `WebviewWindowBuilder` instead of relying on `tauri.conf.json` window config gives precise control over the boot sequence. Needed for the theme-passed-via-URL-hash approach.
- Tests for the settings module were worth the time — covered the corrupt-file path that would otherwise silently eat a bad settings file on boot.
- Did not run `cargo tauri dev` (requires interactive GUI environment). End-to-end visual smoke test is deferred to first run on the user's machine; code compiles, unit tests pass, clippy is clean, and the build produces a binary.

### Mini installed + initial design language elicited
**Date:** 2026-04-21
**Branch:** mini-install
**Commit:** pending

**What was done:**
Installed Mini design system at `packages/ui/` via Mini's `install.sh`. Installed 6 design-system skills at `.claude/skills/` (`elicit-design-language`, `generate-ui`, `check-component-reuse`, `enforce-tokens`, `audit-a11y`, `propagate-language-update`), the invariant runner at `tools/invariants/`, and Mini templates at `templates/`. Ran greenfield elicitation against the prior `design-language.draft.md`; produced the final `core-docs/design-language.md` with all 10 axioms set and the draft's Core Principles / Depth Model / Review Checklist carried through. Seeded `core-docs/component-manifest.json`, `core-docs/pattern-log.md`, and `core-docs/generation-log.md`. Appended a marker-delimited Mini section to `CLAUDE.md` and extended the Core Documents table to list the new docs. Updated `packages/ui/styles/tokens.css` to reflect elicited values: fonts Geist + Geist Mono, radii 3/6/10/14, gray→mauve alias, accent→gray monochrome binding (dropped indigo + crimson imports). Synced Mini pin to `83df0b2` (latest; adds worktree-safe install check).

**Why:**
Designer's design-language scaffolding needed to become real before any surface ships. Mini is the intended substrate; installing it now — before Phase 8 frontend wiring — means the tokens, axioms, skills, and invariants are ready and the design decisions are made when real UI work starts. Elicitation converts the draft's prose principles into Mini's axiom → token cascade.

**Design decisions:**
- **Monochrome accent (axiom #3).** Notion/Linear-style greyscale, rejected chromatic accent candidates (purple overlaps Linear; terracotta/red overlap Claude brand or read too hot). Semantic colors (success/warning/danger/info) stay chromatic because they're doing signal work, not decoration. Enforced in code: `--accent-*` binds to `--gray-*`; no Radix chromatic import.
- **Mauve gray flavor (axiom #4).** Warmer than pure gray, still feels professional. Olive and sand are explicit alternatives to A/B once real surfaces exist. Swap mechanism documented in `pattern-log.md`.
- **Geist + Geist Mono (axiom #6).** Starting choice, font wiring deferred to Phase 8. System fallbacks in the stack mean nothing breaks if Geist isn't loaded.
- **Motion principle amended.** Draft said "motion is functional, not decorative." User amended during elicitation: snappy remains the personality, but considered liveliness is welcome — "it's a design tool and should feel nice." No gratuitous motion.
- **Theme principle amended.** Draft said "dark-default, light-parity required." User amended: system-default (`prefers-color-scheme`), both first-class, parity required.
- **Surface hierarchy = 3 tiers.** Navigation / Content / Float map directly to Mini's flat / raised / overlay. Modals borrow the overlay tier until a reason to distinguish appears.

**Technical decisions:**
- **Mini installed at `packages/ui/`.** Standard Mini layout. Fork-and-own tokens in `tokens.css` and `archetypes.css`; everything else tracks upstream via `./scripts/sync-mini.sh`.
- **Frontend wiring deferred.** No Radix npm install, no CSS import wiring, no `@mini/*` TS path alias. That's Phase 8 work per roadmap. Today's work is design data, not build plumbing.
- **Accent rebinding enforced in code, not left as policy.** Originally considered documenting "monochrome" in the design language but leaving indigo/crimson imports in tokens.css "for Phase 8." Rejected — leaves a latent contradiction between language and tokens. Rebound `--accent-*` to `--gray-*` in the fork-and-own `tokens.css` directly.
- **Gray flavor swap via alias, not rename.** Imports changed from `gray.css` to `mauve.css`; `--gray-N: var(--mauve-N)` alias added so downstream Mini CSS (axioms.css, primitives.css) keeps referencing `--gray-N` unchanged. This is Mini's sanctioned swap pattern.

**Tradeoffs discussed:**
- **Invoke `/elicit-design-language` via the Skill tool vs. run the procedure manually.** Chose manual — the task required cross-referencing specific inferred axioms from the draft before asking cold, which the skill's stock interview doesn't do. Downside: no skill-tool telemetry firing. Compensated by adding a real `pattern-log.md` entry capturing the elicitation rationale — Mini's canonical log for this.
- **Update tokens.css now vs. defer to Phase 8.** Deferred fonts + radii initially; user review pushed toward "enforce the design language in code now rather than document aspirationally." Agreed — drift between language and tokens is the failure mode Mini is designed to prevent.
- **Chromatic accent candidates explored and rejected:** purple (Linear overlap), terracotta (Claude-brand overlap), pure red (too intense), indigo (Mini default — chose not to inherit).

**Lessons learned:**
- Mini's `install.sh` had a `-d "$DEST/.git"` check that fails in git worktrees (where `.git` is a file). Worked around with a sed-patched temp copy; the upstream fix had already landed in Mini's main branch (commit `83df0b2`) but wasn't pinned yet. Syncing bumped the pin.
- The draft's principles survived elicitation with surprisingly few amendments — two principles adjusted (motion, theme), two added to the Review Checklist (semantic-color policing, monochrome policing). Evidence that the product-level thinking was right; only the defaults needed to be made concrete.
- `elicit-design-language` skill's interview script works well for cold elicitation. For an already-primed draft, it's better to state inferences upfront and ask the user to confirm/refine — saves one round trip per axiom and produces better answers because the user is reacting to a concrete proposal.

---

### Project spec, compliance framing, and core docs set up
**Date:** 2026-04-20
**Branch:** initial-build
**Commit:** pending

**What was done:**
Moved the repo from a single placeholder `SPEC.md` (policy and compliance framing only) to a full product specification plus the `core-docs/` template structure. `SPEC.md` content is now integrated into `core-docs/spec.md` alongside vision, product architecture, UX model, agent model, tech stack, decisions log, and open questions. Added `CLAUDE.md` at repo root. Populated `core-docs/plan.md` with the build roadmap, `core-docs/feedback.md` with captured user direction, `core-docs/workflow.md` as the session guide, and `core-docs/design-language.md` as scaffolding for future design work.

**Why:**
The prior `SPEC.md` covered only the Anthropic compliance model — enough to avoid bad patterns, not enough to build against. A week of collaborative spec'ing produced 28 architectural and product decisions. The project needed a durable home for those decisions plus the conventional `core-docs/` shape so future agents can load context predictably.

**Design decisions:**
- Target user is a non-technical operator (designer, PM, founder, full-stack builder), not a developer. This re-frames every surface decision.
- Manager-of-agents metaphor drives nomenclature (project / workspace / tab), UX (three-pane + activity spine), and agent behavior (persistent team lead, ephemeral subagents, role identities only).
- Four-tier attention model (inline / ambient / notify / digest) — agents can surface richly in active contexts but do not unilaterally open tabs.
- Tabs are the sole working-surface primitive; panels-within-tabs rejected as unnecessary complexity.
- Templates over types for new tabs — defaults without constraints.
- Project docs live in the repo as `.md` files. Agents pick them up as codebase context.

**Technical decisions:**
- Stack: Tauri + Rust core + TS/React frontend + Swift helper for Apple Foundation Models. Tauri chosen over Electron for subprocess-under-load behavior, footprint, and security defaults.
- Event-sourced workspace state for audit, time-travel, and mobile-ready sync.
- Abstract `Orchestrator` trait with Claude Code agent teams as the first implementation. Anthropic will iterate; we keep an interface seam.
- Local models serve only the ops layer (audit, context optimizer, patterns, recaps). They never replace Claude for building.
- SQLite holds app-only state; project artifacts live as `.md` in the repo.

**Tradeoffs discussed:**
- Tauri vs Electron vs SwiftUI: chose Tauri. Electron was the faster-to-ship fallback; SwiftUI would have lost Monaco/Mermaid/markdown ecosystem. Wails considered and rejected given Rust's subprocess story matches Designer's workload better.
- Rich GUI vs terminal-like Conductor feel: rich. Compliance guidance restricts auth and proxying, not presentation.
- Agent-teams primitive adoption: adopt, but abstract. Anthropic's multi-agent primitives are experimental and will move; we do not want to be locked in.
- Mobile-from-day-one: yes, in the data layer. No mobile client in early phases.

**Lessons learned:**
- The 2026 OpenClaw ban clarified the real compliance line: OAuth token handling and subscription proxying, not UI richness. Designer is well inside the line.
- The Claude Code agent-teams documentation revealed that our intended workspace primitive maps almost exactly onto Anthropic's team primitive. This shortened the architecture significantly — we build above, not around.
- "Panels vs tabs" was a distraction. Tabs + `@` + split view is the cleaner answer.

---

### Initial build — backend + frontend foundation + design lab + polish scaffolding
**Date:** 2026-04-21
**Branch:** preliminary-build
**Commit:** pending

**What was done:**
Executed Phases 0–11 of `core-docs/roadmap.md` as a single preliminary build. Produced:

- **Rust workspace** (`Cargo.toml` + 9 crates): `designer-core`, `designer-claude`, `designer-git`, `designer-local-models`, `designer-audit`, `designer-safety`, `designer-sync`, `designer-ipc`, `designer-cli`. Tauri shell lives at `apps/desktop/src-tauri/` (library + thin `main`; real Tauri runtime wiring is a binary-edge concern documented in `apps/desktop/PACKAGING.md`).
- **Event-sourced core** (`designer-core`): typed IDs (UUIDv7), `StreamId` enum, `EventEnvelope` + 25 `EventPayload` variants, `EventStore` trait with `SqliteEventStore` impl (WAL mode, r2d2 pool, optimistic concurrency, broadcast subscription), `Projector` projection producing live `Project` + `Workspace` aggregates, manual migration ledger.
- **Orchestrator abstraction** (`designer-claude`): `Orchestrator` trait + `OrchestratorEvent` wire shape; `MockOrchestrator` for tests/demo; `ClaudeCodeOrchestrator` that shells out to `claude` with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; file watcher for `~/.claude/teams/` and `~/.claude/tasks/`.
- **Safety infrastructure** (`designer-safety`): `ApprovalGate` (request/grant/deny → events), `CostTracker` with configurable `CostCap` and read-before-write enforcement, `ScopeGuard` with allow/deny glob rules + deny-overrides-allow, `CspBuilder::strict()` matching the iframe sandbox attributes in the frontend.
- **Audit log** (`designer-audit`): append-only writer + category filter over the same SQLite store (one source of truth).
- **Git ops** (`designer-git`): `GitOps` trait with real `git`/`gh` subprocess impl, worktree create/remove, branch lifecycle, commit, diff numstat, PR create via `gh`, plus a `recent_overlap()` primitive for cross-workspace conflict detection.
- **Local-model ops** (`designer-local-models`): `FoundationHelper` trait, `SwiftFoundationHelper` with 4-byte-length-framed JSON-over-stdio, `NullHelper` fallback, typed jobs (`context_optimize`, `recap`, `audit_claim`, `summarize_row`) with response cache (SHA-256 keyed, TTL) and token-bucket rate limiter. Swift helper source (`helpers/foundation/Sources/main.swift`) wraps Apple Foundation Models behind a `#if canImport(FoundationModels)` gate.
- **Sync protocol** (`designer-sync`): versioned `SyncFormat`, `NodeId` + `VectorClock` causality, `SyncSession` state machine, `OfflineQueue`, `PairingMaterial` with deterministic 6-digit code derivation.
- **IPC types** (`designer-ipc`): shared Rust ↔ TS shape for Tauri commands.
- **CLI** (`designer-cli` → `designer` binary): Phase-2 verification surface — creates a project + workspace, spawns a mock team, assigns a task, prints the full event timeline.
- **React app** (`packages/app` as `@designer/app`): Vite + TS, Mini CSS imported, three-pane layout (project strip, workspace sidebar, main view, activity spine), Cmd+K quick switcher, four tab templates (Plan/Design/Build/Blank), Home tab with six Notion-style blocks, ambient activity spine with state-pulse + recent events, streaming chat UI (character-by-character, reduced-motion aware), sandboxed prototype preview with strict meta-CSP + iframe sandbox + live variant explorer + pin-drop annotation layer, component catalog rendering Mini tokens live, onboarding slab. Deterministic `MockIpcClient` lets the app run fully in a browser with no Tauri.
- **Tests** (19 Rust, 5 frontend): event store round-trip, optimistic concurrency, projector replay, live subscription; mock orchestrator emits team/task events; approval gate state transitions; cost cap enforcement; scope allow/deny; strict CSP builder; vector-clock concurrency detection; handshake version mismatch; pairing-code determinism; git commit + diff round-trip (runs only when git binary is present); foundation helper null fallback + audit parsing; mock core seeds + event delivery; React app boots into seeded state.
- **Polish scaffolding**: `Updater` trait + `NoopUpdater`, `CrashReport` + `install_panic_hook` (opt-in, local-first, never uploads without consent), `PACKAGING.md` signing/notarizing runbook.
- **Invariants**: 6/6 Mini invariants pass on `packages/app/src` after routing all borders, breakpoints, and durations through tokens, and converting the sandboxed prototype CSS to use CSS system colors (`Canvas`/`CanvasText`/`GrayText`) so agent-authored previews follow the host's light/dark scheme without hex literals.

**Why:**
The roadmap sequenced 12 phases over ~16 weeks. A preliminary end-to-end pass validates every seam between subsystems and lets later phases focus on substance rather than scaffolding. Doing all of it in one pass also surfaces cross-phase concerns early — the event store's schema shape is the biggest one, and it settled on the first attempt.

**Design decisions:**
- **`AppCore` is a plain-Rust library, Tauri is the edge.** The shell binary will register IPC commands that delegate to `AppCore` methods. All behavior is exercisable from the CLI + tests without a WebView. This kept the whole backend building + testing on CI-class environments without WebKit.
- **One SQLite table, not five.** Approvals, costs, scope denials, and audit entries are all events in the same `events` table. Projections derive per-concern aggregates. Two wins: single source of truth for replay/sync, and projections can evolve without schema migrations.
- **Strict CSP + iframe sandbox for prototype preview, system colors for agent content.** The agent produces any HTML it wants; the sandbox denies all script, connect, frame, worker, and object origins. The fixture CSS uses `Canvas`/`CanvasText`/`GrayText` so the sandboxed content honors the host theme without needing to know Designer's token set — matching design-language axiom §Theme (system-default, both modes first-class).
- **Mock-first orchestrator + IPC.** Demo data is an opinionated 2-project / 2-workspace seed so empty-state design wasn't the first thing a reviewer sees. Empty states remain load-bearing (design-language patterns §3) but the mock serves the demo + contract tests.
- **Monochrome + Mini semantic scales for all signal.** State dots use `--color-foreground` (active, animates) → `--gray-8` (idle) → `--warning-9` (blocked) → `--info-9` (needs-you) → `--danger-9` (errored). Each is derived from Mini tokens; no chromatic-accent dependency despite the signal-rich UI.

**Technical decisions:**
- **`rusqlite` + `r2d2` over `sqlx`.** `sqlx` macros need compile-time DB prep; we'd have to ship a `.sqlx/` directory or set `SQLX_OFFLINE` gymnastics. Plain `rusqlite` inside `spawn_blocking` is faster to iterate and keeps the build hermetic. The async story works out because SQLite is single-writer anyway.
- **UUIDv7 for all IDs.** Monotonic-by-creation so `ORDER BY id` matches `ORDER BY timestamp` within a host — useful for event-stream scans — and cross-host uniqueness is still guaranteed.
- **Optimistic concurrency via `expected_sequence`.** Prevents lost writes when two callers try to append to the same stream. Tests assert this path explicitly.
- **`globset` for scope rules.** Git-style glob matches, same mental model the user already has for `.gitignore`.
- **JSON-over-stdio with 4-byte BE length framing for the Swift helper.** Protocol is Rust-typed on both sides; versioned response shapes. A future move to XPC (macOS-native) can replace the transport without touching the domain.
- **Stable empty values for `useSyncExternalStore`.** Selector functions that returned fresh `[]` or `{}` literals caused infinite render loops; a shared `emptyArray()` from `util/empty.ts` fixed it. Documented in code.
- **CSS custom properties + fork-and-own `tokens.css` for Designer-specific tokens.** Added `--border-thin`, `--border-strong`, `--breakpoint-*`, `--motion-pulse`, `--motion-blink`. These don't belong in Mini's core contract but they belong somewhere — fork-and-own is the sanctioned extension point.
- **`em`-based media queries** (CSS limitation: custom properties can't appear inside `@media` conditions). Kept in sync with `--breakpoint-*` by comment convention.

**Tradeoffs discussed:**
- **Actually spawning Claude Code in tests vs. mocking.** We didn't have the user's Claude auth or the right SDK version, and shipping tests that call external binaries flakes CI. `MockOrchestrator` implements the full `Orchestrator` contract; `ClaudeCodeOrchestrator` is ready for the Phase 0 spike to validate against. Phase 0's deliverable was "findings"; this preliminary build folds Phase 0's design artifacts (trait shape, watcher classifier) into Phases 1–2.
- **Full Tauri runtime vs. library-first core.** Wiring the Tauri runtime inline would've made the demo a single binary, but also pulled WebKit + macOS SDK requirements into every build. The library-first approach compiles + tests anywhere; the shell binary is a thin `tauri::Builder` addition at the edge.
- **Rich demo seed data vs. pure empty state.** The mock seeds two projects and two workspaces so the first thing a reviewer sees is texture, not a blank canvas. This is the right default for a design-tool demo; the empty-state pattern (design-language §Patterns) still applies when there's truly nothing.
- **Custom store vs. Zustand.** A 40-line `createStore` + `useSyncExternalStore` covers everything Designer needs; Zustand would add an npm dep for the same surface area.

**Lessons learned:**
- **SQLite PRAGMAs can't run inside a transaction.** First pass put `PRAGMA journal_mode = WAL;` in the migration SQL; tests failed with "Safety level may not be changed inside a transaction." Moved PRAGMAs to the connection initializer (`with_init` on `SqliteConnectionManager`).
- **`useSyncExternalStore` is aggressive about snapshot equality.** Any selector returning a fresh `[]`/`{}` on a cold state loops infinitely. Stable empty constants are the fix; writing that down in `util/empty.ts` with a comment prevents re-discovery.
- **CSS custom properties don't expand inside `@media` conditions.** Had to revert to `em`-based media queries; these are also accessibility-friendly so the regression became a small improvement.
- **Invariant scanner flagged agent-sandbox hex colors.** The sandboxed prototype preview is *agent-authored content*, not Designer's UI; enforcing Mini tokens on it would be wrong. Swapped to CSS system colors (`Canvas`, `CanvasText`, `GrayText`) — themed-aware, scanner-clean, and keeps the agent's HTML decoupled from Designer's token set.
- **Demo CLI end-to-end check is worth the weight.** Catching one real scenario — create project, create workspace, spawn team, assign task, replay log — exercises every crate together and surfaced the PRAGMA issue immediately.

**Next:**
- Wire the Tauri shell binary (register commands from `designer-desktop::ipc` as `#[tauri::command]`, hook the updater/crash modules).
- Run the Phase 0 spike against a real Claude Code install to validate the agent-teams file shapes; update `watcher::classify` and the `ClaudeCodeOrchestrator` arg list if the observed reality differs.
- Verify the Swift helper builds on an Apple Intelligence-capable Mac; tune the `FoundationModels` API call to match the shipping SDK.
- Performance pass: measure cold start + idle memory + streaming load on a real build; currently unmeasured because no Tauri runtime is linked.

---

### Multi-role review pass on the preliminary build
**Date:** 2026-04-21
**Branch:** preliminary-build
**Commit:** pending

**What was done:**
Three-perspective review (staff engineer, staff designer, staff design engineer) of the Phases 0–11 preliminary build. Produced a prioritized punch list and implemented it. Summary of changes:

- **Correctness.** Fixed a SQLite "database is locked" race on first open: WAL journal_mode is a database-level setting, so flipping it inside `SqliteConnectionManager::with_init` caused pool-concurrent connections to fight over it. Now we flip WAL + synchronous on a one-shot bootstrap connection in `SqliteEventStore::open` before the pool is built. `with_init` only sets `foreign_keys=ON`.
- **Performance.** `AppCore::create_project` / `create_workspace` stopped doing an O(N) log replay after every append; they now `projector.apply(&env)` the returned envelope directly. Kept `sync_projector_from_log` for external-writer repair paths.
- **Clippy hygiene.** Removed dead `Tracker` trait, dead `GlobSetExt` helper; derived `Default` on `ClaudeCodeOptions` + `NodeId`; `or_insert_with(Vec::new)` → `or_default`; `&self.secret` → `self.secret` (Copy); deleted `#[allow]`-shielded unused-import. Exposed `SANDBOX_ATTRIBUTE` through `designer-safety::lib` so it's live surface, not dead code. `cargo clippy --workspace --all-targets` now clean.
- **Accessibility.** Added a skip-to-content link (WCAG 2.4.1). Fixed the h1/h2/h3 hierarchy — topbar `h1` = workspace name, tab body `h2` = tab title, card `h3` = block title (was two `h1`s per page). `role=tab` ↔ `role=tabpanel` now linked via `aria-controls` + `aria-labelledby`; roving `tabIndex` + Arrow-key navigation across tabs. Focus trap on the Cmd+K dialog (Tab/Shift-Tab cycle within the dialog).
- **UX craft.** Humanized event-kind strings in the activity spine + Home's needs-you card (`project_created` → "Project created", `agent_spawned` → "Agent joined", etc.) via a new `humanizeKind` util. Added a "+ Project" affordance on the project strip. Chat bubble alignment moved from inline style to a CSS `data-author` selector — the flex container needed `align-items: stretch` for `align-self` to activate.
- **Mini procedural docs.** Updated `generation-log.md` with two entries (Phase 8–10 build + this review pass); populated `component-manifest.json` with 17 managed components; added six new `pattern-log.md` entries (project-token extensions, color-role aliases in app.css vs. tokens.css, CSS system colors for sandboxed agent content, Mini-primitive deferral decision, SQLite WAL boot-once reasoning, em-based breakpoints).
- **Tests.** Added 6 frontend tests: `humanizeKind` mapping (known + fallback), tab-panel ↔ tab ARIA linkage, skip-link presence, onboarding dismissal persistence. Helper `boot()` tolerates already-dismissed onboarding via `localStorage.clear()` in `beforeEach`. Now 11 frontend tests + 19 Rust tests; all pass.

**Why:**
The preliminary build landed with breadth; this pass chased depth. A bug-prone startup race, an O(N) hot path on every write, and a11y gaps that a manager-cockpit audience would feel were the concrete risks. The Mini procedural docs were out of sync — `generation-log.md` still had its example-only state — which would have caused `propagate-language-update` and `check-component-reuse` skills to miss the entire Phase 8–10 output on their next run.

**Design decisions:**
- **Humanize event kinds client-side.** The events table keeps `snake_case` identifiers (stable across frontends and sync peers); the mapping lives in TS so we can tune the phrasing per surface without schema changes.
- **h2 for tab bodies, h3 for cards.** Tab bodies conceptually nest under the workspace (`h1` in topbar). Cards nest under the tab. One heading outline per page; screen-reader nav is now coherent.
- **Skip-link pattern.** Standard WCAG pattern: visually hidden until `:focus`, then animates into the top-left with a visible focus ring. Only triggered by keyboard — mouse users never see it.
- **Focus trap in Cmd+K dialog.** Tab/Shift-Tab cycle within the dialog. Escape closes. Mouse-backdrop closes. No programmatic focus-hijack on route changes; focus returns naturally when the dialog unmounts.

**Technical decisions:**
- **WAL bootstrap connection.** The alternative was a mutex around pool-construction or a single-writer pool (`max_size=1`); both are coarser than the one-shot init connection.
- **Apply-on-append projector.** Keeps the projector strictly in sync with the store without double-scan. The broadcast subscription still exists for consumers that didn't drive the write themselves (CLI, future sync peers).
- **Humanize map in a plain object.** `Record<string, string>` is trivially tree-shakable + testable; no i18n framework commitment yet. When i18n lands, the map becomes its resource file.
- **`data-author` attribute on chat bubbles.** Keeps styling in CSS; component stays behavior-focused. Also cleaner for screenshot tests later.

**Tradeoffs discussed:**
- **Mini primitives now vs. later.** Considered converting AppShell/HomeTab/ActivitySpine to `Stack`/`Cluster`/`Box` this pass. Deferred to Phase 12b — the current inline-flex patterns are tight and swapping introduces renaming noise across many files. If the drift grows with more surfaces, we do it then.
- **Real Claude Code integration test.** Considered running against a real install. Skipped because the test environment lacks Claude auth; a `CLAUDE_CODE_INSTALLED=1`-gated test is the right pattern and is queued in Phase 12a.
- **Event ID correlation.** Would let the activity spine show "approval denied because cost cap hit" as a chain. Adds schema churn now; scheduled for 12b when the spine gets richer drilldown.

**Lessons learned:**
- **`useSyncExternalStore` ergonomics.** Second time a "fresh literal → infinite render" bug surfaced here (first was empty arrays; this time tests held state across runs). The fix pattern — `beforeEach(() => localStorage.clear())` + tolerant `boot()` — is worth codifying if we add more tests that depend on app boot state.
- **SQLite PRAGMAs aren't per-connection.** First pass put `journal_mode=WAL` in `with_init`; second pass learned that WAL is a database-level mode, stored persistently in the file header. One bootstrap flip is correct; per-connection PRAGMAs are only for session-scoped settings like `foreign_keys`.
- **Clippy as a reviewer.** Caught three dead-code trails (a trait, a helper trait-extension, a constant) that had snuck in during rapid scaffolding. Worth running `cargo clippy --workspace --all-targets` in CI.

---

<!-- Add new entries above this line, newest first. -->
