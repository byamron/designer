# Plan

Near-term focus and active work items. See `roadmap.md` for the full phased sequence; see `spec.md` for architectural decisions; see `parking-lot.md` for deferred phases with re-activation triggers; see `history.md` for shipped-work detail (every entry referenced below has a fuller record there).

## Operating principle

Build / Harden alternation per ADR 0009. The active sequence is one Build phase (one feature, one track) followed by a Harden phase (no new features — only test coverage, friction closure, design-language enforcement, demo gatekeeping). Ship when no critical friction blocks the next Build — a human judgement, not a friction-count of zero. Every release tag carries a checked-in golden-path screencast bound to a Playwright test.

## Current focus

| Phase | State | What it ships |
|---|---|---|
| **24 — Chat pass-through** | In flight, **mid-cycle**. All work behind `show_chat_v2` (default OFF) until the renderer + tests catch up to flip-on quality. **Shipped:** steps 1–3 (PR #119 — event vocabulary, dual-mode translator, activity bridge), step 4 (PR #130 — user-only dispatch contract pinned with a test + doc-comment in `AppCore::post_message`), steps 5–6 (PR #120 — chat-thread reducer + renderer), step 7 (PR #124 — send-while-streaming queue + stop-and-send + SendMenu), steps 8–9 + §5.7 announcement (PR #125 — Esc priority chain, SIGINT interrupt via `libc::kill`, assertive "Agent interrupted" `aria-live`). **Remaining:** step 10 (render-time activity indicator), step 11 (detectors recognize both shapes), step 12 (§5.6 error-state copy mapping), step 13 (A1–A12 acceptance tests). Then the coalescer can be deleted (step 3 cleanup) and `show_chat_v2` can default ON. | 1:1 stream-json projection per ADR 0008. Coalescer deletion. Renderer rewrite, queue UX, ESC + SIGINT, detector updates, error copy, A1–A12 tests, Mini docs. |
| **24H — Chat polish + first-run audit** | Next | Friction inbox triaged against chat-v2; first-run audited against v0.1.2 subtractions; "What's new" card for hidden surfaces; v0.1.2 screencast checked in. |
| **24I — AppCore integration test harness** | Next (lands solo) | Boot AppCore in a test, drive via IPC, assert on event log. Wired to CI. Foundation for every Harden phase that follows. |
| **25 — Inline approvals** | Build (after 24I) | Approval card renders inline under the agent message that requested the tool. Inbox modal retires. (PR #103 shipped the manager-grade inline `ApprovalBlock` rewrite; this phase finishes the migration off the inbox modal.) |
| **25H — Token enforcement + Settings cull** | Harden | Custom ESLint rule banning inline `style={{...var(--…)}}`; 9 holdouts migrated to Mini primitives; Settings → ~600 LOC removed; component manifest 47 → ~20. |
| **26 — Designer Noticed: one detector** | Build | One friction-driven detector end-to-end on local models with Home-tab proposal accept/reject. Other 7 keep emitting events behind hidden UI per ADR 0009 §3. |
| **26H — Demo gate automation** | Harden | Playwright golden-path on Linux; macOS spot-check process; release tag binds test ↔ screencast. |

## Subtractions in flight (lands across 24H + 25H)

Per ADR 0009, these ship with a v0.1.2 "What's new" card explaining each:

- **5 stub block renderers** hidden behind `DESIGNER_SHOW_STUBS=1`.
- **7 of 8 Designer-Noticed detector UIs** hidden via in-app Settings toggle. Detectors keep emitting events (frozen-contract additive); UI surfaces one at a time as proposals earn user acceptance.
- **Model selector** hidden behind a flag until per-message subprocess respawn is robust (frame as "behind flag," not removed).
- **Settings cull** — dev escape hatches move to ⌥-click Advanced pane; user-facing toggles users shouldn't think about removed.

## Parked (see `parking-lot.md`)

Phase 22 unshipped sub-phases (22.C / 22.D / 22.E / 22.H / 22.M / 22.N / 22.N.1; 22.A / 22.B / 22.G / 22.I shipped and stay), Phase 21.A2 remaining detectors past the active one, Phase 15.H (inline commenting), Phase 17 (team-tier trust), Phase 18 (mobile), Phase 19 (workspace scales up), Phase 20 (parallel-work coordination), Phase 23.E.f3 (memory chip), `core_*/commands_*` reorganization, macOS Playwright CI runner. Each carries a friction-driven primary trigger and a time-based fallback.

## Open questions

- **Active detector pick (Phase 26):** default candidate is `repeated_correction`; final pick at phase start, gated on dogfood evidence. The friction log will name the pattern hitting the user repeatedly.
- **Detector unhide UI (Phase 26):** in-app Settings toggle preferred; feature flag is fallback. Decided at Phase 26 implementation.
- **12.B Apple-Intelligence round-trip:** still needs one run on an Apple-Intelligence-capable Mac to close the SDK-shape delta in `integration-notes.md` §12.B.
- **Phase 24 sequencing:** translator + bridge + renderer + queue + Esc/SIGINT + user-only dispatch contract all shipped behind `show_chat_v2` default OFF (PRs #119, #120, #124, #125, #130). Remaining workspace steps: 10 (render-time activity indicator), 11 (detector dual-shape recognition), 12 (§5.6 error-copy mapping), 13 (A1–A12 acceptance tests). Tests are the load-bearing gate before `show_chat_v2` defaults ON — see the Phase 24H roadmap entries for the three render-altitude tests (`bootReplaying`, queue auto-dispatch, `InterruptAnnouncement`) that gate on the flag becoming testable. The coalescer + per-tab `first_seen_at` tables in `core_agents.rs` (step 3) remain in place until `show_chat_v2` defaults ON.

## Where shipped work lives

`history.md` carries the shipped-work log with why / tradeoffs / decisions for every PR through PR #119 (Phase 24 foundation, 2026-05-04). The 2026-05-05 backfill pass added 22 PR entries (#95, #98, #99, #100–#119) that had been documented only in `plan.md`'s Current Focus prose; each backfill entry carries a provenance note distinguishing first-person rationale from agent-reconstructed framing. A second entry was appended 2026-05-10 for PR #125 (Phase 24 §5.4.2 SIGINT + Esc + §5.7 announcement). PRs #120, #122, #123, #124, #126 are not yet in `history.md` — read their commit messages + the PR-body Reviewer-notes sections for design rationale until backfilled. Earlier coverage: Phase 13 wire-up (D/E/F/G/H/I), the Dogfood Push (DP-A/B/C/D + v0.1.0 release), Phase 21.A1 (Designer-Noticed foundation + first detector), Phase 23 chat hardening (full sequence 23.A–23.F + follow-ups including 23.B activity indicator, 23.E per-tab subprocess, 23.E.f1 banner reframe), Phase 22 advance slice (22.A / 22.B / 22.G / 22.I shipped behind feature flags), Phase 24 spec + ADR 0008 + foundation.
