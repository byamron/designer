# Parking lot

Phases that are deferred — not deleted. Each entry has a friction-driven primary trigger and a time-based fallback. When a trigger fires, the phase moves back to active in `roadmap.md`.

See `core-docs/architecture/adr/0009-trustworthy-shipping.md` for the rationale and contract for this file.

## How to read this file

| Field | Meaning |
|---|---|
| **Deferred** | Date the phase moved out of active roadmap. |
| **Reason** | One-line summary of why it isn't load-bearing now. |
| **Primary trigger (friction-log)** | A user-perceptible signal that pulls the phase back. Friction reports, dogfood asks, or observable workspace state. Never telemetry that doesn't exist. |
| **Time fallback** | A phase identifier (e.g. *"reassess after Phase 27 ships"*) that revisits the entry regardless of friction signal. Prevents drift. |
| **Source** | Anchor in `roadmap.md` where the verbatim content lives. |
| **Unhide path** | How the feature returns to active state — flag flip, in-app toggle, or UI restoration. |

## How to work with this file

- **Adding an entry:** when the active roadmap moves a phase out, copy its verbatim content into `roadmap.md` under a `**Parked: see parking-lot.md**` callout, then add the metadata entry below. Don't move content into this file — it stays in `roadmap.md` as the source of truth so cross-references don't break.
- **Removing an entry:** when a trigger fires, move the phase back into the active sequence in `roadmap.md` and delete the entry here. Log the trigger event in `history.md` so the why stays recoverable.
- **Reviewing on time fallback:** at the start of each named fallback phase (e.g. Phase 27), scan this file for entries whose fallback names that phase. Decide each: re-activate, defer further (update fallback), or close out (move to "Closed-out entries" below).

---

## Active entries

### Phase 22 — Project Home redesign (unshipped sub-phases only)

- **Deferred:** 2026-05-04
- **Already shipped (NOT parked):** 22.G team identity color tokens (PR #108), 22.B Recent Reports Home-tab surface (PR #109, behind `show_recent_reports_v2` flag), 22.A roadmap canvas foundation (PR #112, behind `show_roadmap_canvas` flag), 22.I track shipping history + PrOpen→Merged crossfade (PR #114). These remain in the codebase as the Phase 22 foundation; the parking lot does not touch them.
- **Reason for parking the rest:** the four shipped sub-phases provide the structural foundation; the remaining sub-phases (22.C / 22.D / 22.E / 22.H / 22.M / 22.N / 22.N.1) expand the surface count when the active priority is shrinking it. Defer until dogfood signal demonstrates the foundation is being used and the missing affordances are felt.
- **Primary trigger:** User files ≥3 friction reports (via the Friction widget) naming one of: canvas density / completeness, Recent Reports completeness, missing edit / proposal flow on canvas, missing attention column, missing click-into-agent, or missing merge queue. OR: an explicit feature request in Settings → Friction or chat for any of those affordances. OR: the four shipped 22 sub-phases (22.A / 22.B / 22.G / 22.I) all flip their feature flags to default-on and the user asks for the next layer.
- **Time fallback:** Reassess after Phase 27 ships.
- **Source:** `roadmap.md` §"Phase 22 — Project Home redesign" sub-phases 22.C / 22.D / 22.E / 22.H / 22.M / 22.N / 22.N.1.
- **Unhide path:** Promote individual unshipped sub-phases back to active sequence in roadmap.md. Each is independently shippable per the original Phase 22 spec; no architectural rework needed.

### Phase 21.A2 — Designer-Noticed detectors past the active one

> **Note (2026-05-16):** Superseded by the broader Designer Noticed cut from v1 per ADR 0010 §3.10. The full portfolio (Phase 21.A foundation, Phase 26 first end-to-end detector, and the remaining detectors in this entry) is now parked under one umbrella. See the *Designer Noticed — entire portfolio* entry below for the broader rationale and trigger; this entry is retained for the original per-detector specs.

- **Deferred:** 2026-05-04 (originally); superseded by broader portfolio cut 2026-05-16
- **Reason:** All 8 detectors in `crates/designer-learn/src/detectors/` are shipped at the foundation layer (events emit, fixtures pass), but only ONE has a polished end-to-end loop. Surfacing 8 simultaneously dilutes the trust signal — the user can't tell which detector is reliable. Pick the friction-driven leader; defer the rest until proven. Now also superseded by the structural cut below.
- **Primary trigger:** User accepts ≥3 proposals from the active detector (visible as `ProposalAccepted` artifacts in the event log) AND files a friction report or in-chat ask requesting a second detector by name (e.g., "I want Designer to also notice cost spikes" / "watch for scope creep"). **Now also gated on the broader portfolio re-activation trigger** (see *Designer Noticed — entire portfolio* entry).
- **Time fallback:** Reassess after Phase 28 ships.
- **Source:** `roadmap.md` §"Phase 21.A2 — Detector squad" — detector list and per-detector specs preserved verbatim.
- **Unhide path:** In-app Settings toggle per detector. Detectors continue to emit `FindingRecorded`/`ProposalEmitted` events while UI is hidden (per ADR 0009 §3 frozen-contract pattern). Now additionally requires re-activation of the broader portfolio per the entry below.

### Designer Noticed — entire portfolio (Phase 21.A foundation, Phase 26 first detector, Phase 21.A2 remainder)

- **Deferred (cut from v1):** 2026-05-16
- **Reason:** ADR 0010 §3.10 cut Designer Noticed from v1 entirely. The strategic narrowing repositioned Designer as router-mode-first — a hub that sits above the user's existing AI-build tools rather than driving execution itself. In router-mode, Designer does not host Claude Code session transcripts, which is exactly what Forge-style workflow-pattern detection needs as input. Without transcripts, the detector portfolio would ship without its data source — vestigial. Forge (the user's Claude Code plugin, separate product) is the working version of session-transcript pattern detection and remains the right home for that capability until Designer's surface area changes.
- **Primary trigger:** Designer hosts work surfaces of its own (prototyping, in-app codification authoring with session capture, embedded chat sessions where transcripts live in Designer's event store, or similar) where session-pattern analysis would apply, AND ≥3 friction reports or explicit asks for Forge-style pattern detection on Designer-hosted work.
- **Time fallback:** Reassess after v1.0 ships (the first stable release of router-mode Designer).
- **Source:** `core-docs/architecture/adr/0010-intent-preservation-positioning.md` §3.10 (v1 disposition table — Designer Noticed row marked *Cut from v1*) and §7 (roadmap implications — Designer Noticed moved from *Reshaped* to *Cut from v1*).
- **Unhide path:** Author a new ADR (likely 0011+) that decides what work-surface-pattern detection looks like *at Designer's altitude* (judgment moments, codification candidates, taste-drift attention calls) — distinct from Forge's *Claude-Code-session* altitude. The existing `crates/designer-learn/src/detectors/` foundation may be partially repurposable; the detector portfolio itself almost certainly needs to be redesigned around taste-altitude signals rather than coding-workflow signals. Re-promote Phase 21.A foundation + Phase 26 first end-to-end loop to active sequence with the new altitude scope.

### Phase 15.H — Inline commenting & element annotation

- **Deferred:** 2026-05-04
- **Reason:** Speculative. No dogfood signal that text-on-design feedback is a recurring need; the Friction widget already captures the "this affordance feels wrong" loop with screenshot + anchor.
- **Primary trigger:** ≥3 friction reports requesting inline annotation OR a recurring user ask for "comment on this region of a prototype/design."
- **Time fallback:** Reassess after Phase 28 ships.
- **Source:** `roadmap.md` §"Phase 15.H — Inline commenting & element annotation".
- **Unhide path:** Promote to active sequence; spec already exists.

### Phase 19 — Workspace scales up

- **Deferred:** 2026-05-04
- **Reason:** Multi-track UX, forking, and reconciliation only matter when a workspace has many concurrent tracks. Today's dogfood pattern is one active track per workspace.
- **Primary trigger:** A workspace genuinely has >5 concurrent tracks (visible in workspace list) AND user reports friction managing them OR explicitly asks for fork/reconcile affordances.
- **Time fallback:** Post-v1.
- **Source:** `roadmap.md` §"Phase 19 — Workspace scales up".
- **Unhide path:** Promote to active sequence post-v1.

### Phase 20 — Parallel-work coordination layer

- **Deferred:** 2026-05-04
- **Reason:** Project-level primitive that automates what Phase 13.0 did by hand. Useful but not load-bearing while parallel-track count stays low. The manual approach (Phase 13.0 scaffolding PR) remains documented in `roadmap.md` for the cases where it's needed.
- **Primary trigger:** Same as Phase 19 — a project genuinely runs >5 parallel tracks AND user reports coordination friction.
- **Time fallback:** Post-v1.
- **Source:** `roadmap.md` §"Phase 20 — Parallel-work coordination layer".
- **Unhide path:** Promote to active sequence; gates on Phase 19 substantially complete.

### Phase 23.E.f3 — Per-workspace memory chip

- **Deferred:** 2026-05-04 (was deferred at Phase 23.E ship; now formally parked).
- **Reason:** Per-tab Claude subprocess (Phase 23.E) means a workspace with 10 tabs runs ~1 GB resident. A topbar memory chip would help, but only matters when a user actually hits memory pressure.
- **Primary trigger:** A user reports memory pressure or asks "why is Designer using so much RAM."
- **Time fallback:** Reassess after Phase 27 ships.
- **Source:** `roadmap.md` §"Phase 23.E follow-ups" entry 23.E.f3.
- **Unhide path:** Promote to active sequence; ~1 day full-stack effort estimated in original roadmap entry.

### Phase 17 — Team-tier trust

- **Deferred:** 2026-05-04 (was always post-v1; formalized here so the active roadmap is honest about its scope).
- **Reason:** Encryption at rest, MDM, SIEM export, bug bounty, GitHub App. None matter until there's a paying team customer; v1 is a single-user cockpit.
- **Primary trigger:** First paying team customer or explicit team-pricing initiative.
- **Time fallback:** Post-v1.
- **Source:** `roadmap.md` §"Phase 17 — Team-tier trust"; detail in `security.md`.
- **Unhide path:** Promote to active sequence post-v1.

### Phase 18 — Mobile

- **Deferred:** 2026-05-04 (was always post-v1; formalized here).
- **Reason:** Mobile client for remote control of the user's desktop Claude Code. Architecture is event-sourced from day one (Decision 20) so this is forward-compatible; UI implementation is post-v1.
- **Primary trigger:** Desktop product is shipped and stable (a v1.0 tag exists) AND mobile becomes a strategic priority.
- **Time fallback:** Post-v1.
- **Source:** `roadmap.md` §"Phase 18 — Mobile" + `spec.md` §Mobile Strategy.
- **Unhide path:** Promote to active sequence post-v1.

### `core_*/commands_*` reorganization

- **Deferred:** 2026-05-04
- **Reason:** The split convention (`core_agents.rs` + `commands_agents.rs`, etc.) was Phase-13 parallel-agent collision avoidance. With one track per Build phase under ADR 0009, the convention's load-bearing case disappears, but reverting it across 5+ files with TODO(13.X) markers is a multi-PR refactor — not a Harden-phase subtraction. Reclassified from v1 plan's "subtract" list to here.
- **Primary trigger:** Active parallel tracks drop to zero AND ≥2 friction reports flag the convention's cognitive cost OR a contributor asks why the split exists.
- **Time fallback:** Reassess after Phase 27 ships.
- **Source:** `CLAUDE.md` §"Parallel track conventions". The convention stays documented; the *deprecation* is what's parked.
- **Unhide path:** Author a dedicated reorganization PR. Modules organize by domain (chat, repo, safety, learning); `ipc.rs` registration boilerplate naturally shrinks.

### macOS Playwright CI runner

- **Deferred:** 2026-05-04
- **Reason:** Phase 26H ships Linux Playwright + manual macOS spot-check. A macOS GitHub Actions runner has a per-minute price multiplier vs. Linux (~10×) plus toolchain setup friction. Not justified until the Linux/spot-check combo misses a release-blocking bug. Cost re-evaluated when this trigger fires.
- **Primary trigger:** Linux baseline + manual macOS spot-check fails to catch a regression that ships to dogfood AND the cost of catching it earlier is clearly worth the runner spend.
- **Time fallback:** Reassess after Phase 28 ships.
- **Source:** `roadmap.md` §"Phase 26H — Demo gate automation" + ADR 0009 §1.D.
- **Unhide path:** Add a macOS-runner job to `.github/workflows/regenerate-visual-baselines.yml` and gate releases on it.

---

### Compose queue — attachment + meta queueing (currently text-only)

- **Deferred:** 2026-05-07
- **Reason:** PR #124 (Phase 24 §5.4) ships per-tab queueing of message text only. If a user has files attached and presses ⏎ during a streaming turn, the text queues but attachments stay attached to the live composer (not bundled with the queued message). Auto-dispatch fires text-only — the attachments would dispatch on the *next* user send if they're still attached. Acceptable v1 cut: dogfood typically queues text-only follow-ups during streaming; attachment-while-streaming is rare. If it's not, the queue shape extends to `QueuedMessage = { text, attachments, meta }` with corresponding localStorage migration.
- **Primary trigger:** ≥2 friction reports about attachments disappearing or behaving unexpectedly when used with the queue, OR an explicit user ask for "queue my attachments too."
- **Time fallback:** Reassess after Phase 27 ships.
- **Source:** PR #124 implementation deferral (documented in spec §5.4 + commit message).
- **Unhide path:** Promote to active sequence; extend `setQueuedMessage` shape; bump localStorage decode/encode to handle the richer payload (additive — old string entries decode as `{ text, attachments: [], meta: defaults }`); update auto-dispatch handler in `WorkspaceThread.tsx` to pass attachments + meta through.

---

### Compose queue — out-of-active-tab auto-dispatch

- **Deferred:** 2026-05-07
- **Reason:** PR #124's auto-dispatch effect lives in `WorkspaceThread.tsx` and fires only for the focused tab. If the user queues a message on tab A, switches to tab B, and tab A's turn ends while inactive, the queue persists but doesn't auto-fire. The user sees the chip when they switch back to A and can manually re-send. Acceptable v1 cut: cross-tab streaming awareness is a different feature (per-tab Claude subprocess from Phase 23.E means each tab finishes independently, and the user is typically watching the tab they care about). If dogfood surfaces it, a global watcher (App-level effect against `appStore.queuedMessageByTab` × `dataStore.activity`) dispatches across all tabs.
- **Primary trigger:** ≥2 friction reports about queues "not firing" on inactive tabs, OR the user explicitly asks for cross-tab queue auto-dispatch.
- **Time fallback:** Reassess after Phase 27 ships.
- **Source:** PR #124 implementation deferral (documented in `WorkspaceThread.tsx` effect comment + spec §5.4 multi-tab subsection).
- **Unhide path:** Move the auto-dispatch effect from `WorkspaceThread.tsx` to a global `useQueueAutoDispatch()` hook mounted in `App.tsx`. Iterate `queuedMessageByTab`; for each, look up the workspace via `dataStore.workspaces`, watch the activity slice, dispatch on transition. Consideration: `cmd_post_message` needs both `workspace_id` and `tab_id` — either change `queuedMessageByTab` to `{ workspace_id, text }` shape, or look up workspace from tab via the workspace tree.

---

### `InterruptedMarker` — distinguish synthesis from user-triggered interrupt

- **Deferred:** 2026-05-06
- **Reason:** `applyOrphanTurnGuard` synthesizes `Interrupted` at the renderer level for any open turn whose subprocess wasn't running at boot (spec §4.2 / A2). Phase 23.F's user-triggered SIGINT also produces `Interrupted`. The renderer currently shows the same one-word marker ("Interrupted") for both. They're different stories: synthesis = "Connection dropped" (passive, the world acted), user SIGINT = "Stopped by you" (active, you acted). UX review on PR #120 flagged this; the fix needs a `synthesized: bool` field threaded through `TurnAccumulator` so the renderer can pick the right copy. Not a blocker for Phase 24 ship — the marker is honest in both cases, just less precise than it could be.
- **Primary trigger:** A user reports confusion about why a turn is marked Interrupted, OR ≥2 friction reports requesting clearer explanation of the marker.
- **Time fallback:** Reassess after Phase 27 ships.
- **Source:** PR #120 staff-review Round 2 (UX FOLLOW-UP).
- **Unhide path:** Promote to active sequence; thread `synthesized: bool` through `TurnAccumulator` (`applyOrphanTurnGuard` sets true; user-SIGINT path sets false). Renderer chooses copy — `synthesized` → "Connection dropped"; otherwise → "Stopped by you".

---

### Copy affordance on agent code blocks (and optionally turns)

- **Deferred:** 2026-05-13
- **Reason:** Chat-UX research pass (synthesis in `phase-24-pass-through-chat.md` Appendix C) surfaced that the chat-v2 surface has no `navigator.clipboard` integration — managers who want to paste a Claude-generated snippet into a terminal or a doc currently select-and-⌘C. Universal in ChatGPT / Claude.ai / Cursor. Staff-UX review favored scoping to **code blocks only** for v1 (per-turn copy is engineer-y and adds hover chrome to every agent message). Not load-bearing for current dogfood (no friction reports yet); ship when one lands or as a side-of-desk pickup during Phase 25 (inline approvals) which already touches per-turn affordances.
- **Primary trigger:** ≥1 friction report citing "wanted to copy Claude's code/response" OR a Phase 25 PR that already touches per-turn hover affordances (opportunistic pickup).
- **Time fallback:** Reassess after Phase 27 ships.
- **Source:** Chat-UX research synthesis, 2026-05-13; `phase-24-pass-through-chat.md` Appendix C item 3.
- **Unhide path:** Add a hover-revealed (and `:focus-within`-revealed for keyboard) `IconButton` inside `MessageProse`'s `<pre>` block render. `navigator.clipboard.writeText`; aria-live="polite" "Copied" confirmation after click. Honor reduced-motion (instant reveal). Microcopy + Mini token review before merge.

---

### Conversation rewind / undo-a-turn affordance

- **Deferred:** 2026-05-13
- **Reason:** Claude Code's terminal CLI ships `/rewind` (single-Esc interrupts; double-Esc opens a checkpoint picker). The chat-UX research synthesis proposed binding the same gesture (Esc-Esc) in Designer as a pass-through to a future `cmd_rewind` IPC. Both staff reviews rejected the **gesture** (Esc is already overloaded by the §5.4.1 priority chain; chord double-taps are hostile to keyboard users with motor impairments) but kept the **capability** as worth pursuing once the trigger surface is designed and the upstream protocol is clearer. There is no stdio `/rewind` protocol today — `/rewind` is a slash command typed into Claude Code's TUI, not part of the streaming-input control protocol. Without an upstream wire, Designer would be inventing its own conversation-mutation primitive (event-log replay-mutation, etc.), which goes well beyond pass-through.
- **Primary trigger:** EITHER (a) Anthropic publishes a stdio/control-protocol surface for `/rewind` (`code.claude.com/docs/en/agent-sdk/...`) that Designer can pass through to, OR (b) ≥3 friction reports asking to undo a user message / restore a previous turn within a 2-week window.
- **Time fallback:** Reassess after Phase 28 ships.
- **Source:** Chat-UX research synthesis, 2026-05-13; `phase-24-pass-through-chat.md` Appendix C item 9.
- **Unhide path:** Build phase, not a polish entry. When the trigger fires: design a per-turn hover affordance ("rewind to here" on the agent message), not a global chord. Pairs naturally with Phase 25's per-turn approval cards. If the upstream protocol lands first, ride it; if user signal lands first, scope the Designer-side semantics (event-log truncation? branch? virtual replay?) and write an ADR — this is not a one-line IPC.

---

### Per-turn cost / usage chip

- **Deferred:** 2026-05-13
- **Reason:** `TurnAccumulator.usage` is populated by `agent_turn_ended` events (`packages/app/src/store/chatThread.ts:75`, `:292`) and is currently unread by the renderer — the data exists, the chip doesn't. Staff-UX review noted per-turn cost (often <$0.01) is engineer signal, not manager signal — workspace-level roll-up is the manager-grade register, and the workspace-level chip belongs with Phase 13.I (cost cap enforcement) where it's coherent with a per-project budget readout. Shipping per-turn first is the engineer's lens; defer.
- **Primary trigger:** Phase 13.I (cost cap enforcement) begins, OR ≥2 dogfood reports asking "how much did this turn cost."
- **Time fallback:** Reassess after Phase 27 ships.
- **Source:** Chat-UX research synthesis, 2026-05-13; `phase-24-pass-through-chat.md` Appendix C item 12.
- **Unhide path:** Scope to workspace-level cost first (header chip "$0.X this workspace"); per-turn second only if managers ask. Coordinate with `CostTracker` (`crates/designer-claude` cost extraction per Phase 24 §3.1) to avoid divergent numbers. Monetary precision rule: always 2-decimal cents ("$0.01" not "$0.0123"). Not announced via aria-live (would flood for chatty sessions); visual chip only.

---

### Tool-result rich rendering (Read / Edit / Grep / Bash)

- **Deferred:** 2026-05-13
- **Reason:** `ToolResultPanel` (`ChatStreamRenderer.tsx:345–378`) renders all tool results as a 40-line-capped `<pre>`. Phase 24 spec §9 explicitly defers "tool-result rich rendering" past the Phase 24 architectural pass. The chat-UX research synthesis re-surfaced this as a manager-comprehensibility upgrade (Edit's textual JSON dump is the obvious offender — a +/- diff with file-path header would be a manager-grade win), but staff-engineer and staff-UX reviews agreed it's a real BUILD-sized phase: each tool needs its own design pass (Edit = diff with header; Grep = grouped-by-file result list; Bash = stdout/stderr split with exit code), each may introduce host actions (clickable filenames need an open-in-editor surface Designer doesn't have today), and the 40-line truncation logic interacts with structured rendering. Not Harden material.
- **Primary trigger:** ≥3 friction reports about unreadable tool output (especially Edit JSON blobs or Grep multi-file dumps), OR Phase 25 (inline approvals) ships and the next Build phase is open for a candidate that ties cleanly to manager comprehension of agent actions.
- **Time fallback:** Reassess after Phase 27 ships — likely promote to the active Build sequence here regardless of friction signal because Edit's JSON-blob register is a known craft floor.
- **Source:** Chat-UX research synthesis, 2026-05-13; `phase-24-pass-through-chat.md` Appendix C item 10. Original spec deferral: `phase-24-pass-through-chat.md` §9 (Out of scope).
- **Unhide path:** Phase it incrementally — Edit first (highest value; existing diff infrastructure from `CodeChange` artifacts to repurpose), then Bash (stdout/stderr split + exit code), then Grep (grouped result list). Read is fine as-is (the `· Read plan.md` head + expand-to-content register is already terse-correct). Each tool's structured render gets a craft pass via `uncommon-care` before merge. Add `ToolEditPanel`, `ToolBashPanel`, `ToolGrepPanel` to `component-manifest.json`; keep the generic `ToolResultPanel` as the fallback for unknown tools.

---

### Hidden-detector decommission convention (future ADR)

- **Deferred:** 2026-05-05
- **Reason:** ADR 0009 §3 codifies hidden-but-emitting events (Designer-Noticed detectors continue to emit `FindingRecorded`/`ProposalEmitted` while UI is hidden, per the additive-only rule from ADR 0002). It does not yet codify how a detector is *fully* decommissioned (Rust emitter removed, event variant retired). The 13.L envelope-version-bump precedent (`FrictionLinked → FrictionAddressed`) is the model. Not load-bearing until a detector is genuinely sunset.
- **Primary trigger:** A Designer-Noticed detector is being permanently removed from the codebase (not just hidden) — e.g. Forge subsumes its functionality and Designer's copy provides no marginal value.
- **Time fallback:** Reassess after Phase 28 ships.
- **Source:** PR #122 staff-perspective review (engineer FOLLOW-UP).
- **Unhide path:** Author the ADR when the trigger fires; cite ADR 0002, ADR 0008, and ADR 0009 §3 as the contract chain.

---

## Closed-out entries

*(None yet. When a parking-lot entry is closed — either by re-activation or formal decommission — log the close-out reason and date here for institutional memory.)*
