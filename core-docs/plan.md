# Plan

Near-term focus and active work items. See `roadmap.md` for the full phased sequence; see `architecture/spec.md` for architectural decisions; see `parking-lot.md` for deferred phases with re-activation triggers; see `history.md` for shipped-work detail (every entry referenced below has a fuller record there). For *why* the current direction is right and *what's fragile about it*, see `research/rationale.md` and `research/critique.md`.

## Operating principle

Build / Harden alternation per ADR 0009. The active sequence is one Build phase (one feature, one track) followed by a Harden phase (no new features — only test coverage, friction closure, design-language enforcement, demo gatekeeping). **Release at the close of every phase, Build or Harden** (ADR 0009 §1.E amendment, 2026-05-12) — Build-phase tags ship the new behavior into dogfood as soon as the feature-flag default flips ON and contract-level tests pass; Harden-phase tags ship the polished state once filed FOLLOW-UPs are closed. Ship when no critical friction blocks the next phase — a human judgement, not a friction-count of zero. Every release tag carries a checked-in golden-path screencast bound to a Playwright test.

## Current focus

| Phase | State | What it ships |
|---|---|---|
| **24 — Chat pass-through** | **✅ Build complete (PR #134, step 13).** `show_chat_v2` flipped default ON; A1–A12 acceptance criteria pinned to existing tests per the §6.1 audit (`core-docs/phases/phase-24-pass-through-chat.md`). PRs #119, #120, #124, #125, #130, #131, #132, #133, #134. **Next:** cut the Phase 24 Build release tag per the ADR 0009 §1.E build-phase release convention, then Phase 24I. | 1:1 stream-json projection per ADR 0008. Renderer rewrite, queue UX, ESC + SIGINT, detector updates, error copy, A1–A12 audit, Mini docs. |
| **24I — AppCore integration test harness** | **Next (lands solo, before 24H — reordered 2026-05-13)** | Boot AppCore in a test, drive via IPC, assert on event log. Wired to CI. Foundation for 24H's render-altitude FOLLOW-UPs and every Harden phase that follows. |
| **24H — Chat polish + first-run audit** | After 24I | Friction inbox triaged against chat-v2; first-run audited against the Phase-24 release's subtractions; "What's new" card for hidden surfaces; release screencast checked in. Render-altitude FOLLOW-UPs land as integration tests against the 24I harness. **Plus the 5 chat-UX research follow-ups filed 2026-05-13** (scroll-stickiness on chat-v2 — closes spec Q4; visible Stop button; streaming caret; reduced-motion chevron audit; queue-no-flush regression test). Triage rationale + 4 parked items + 3 dropped items recorded in `phase-24-pass-through-chat.md` Appendix C. |
| **25 — Inline approvals** | Build (after 24H) | Approval card renders inline under the agent message that requested the tool. Inbox modal retires. (PR #103 shipped the manager-grade inline `ApprovalBlock` rewrite; this phase finishes the migration off the inbox modal.) |
| **25H — Token enforcement + Settings cull** | Harden | Custom ESLint rule banning inline `style={{...var(--…)}}`; 9 holdouts migrated to Mini primitives; Settings → ~600 LOC removed; component manifest 47 → ~20. |
| **26 — Designer Noticed: one detector** | Build | One friction-driven detector end-to-end on local models with Home-tab proposal accept/reject. Other 7 keep emitting events behind hidden UI per ADR 0009 §3. |
| **26H — Demo gate automation** | Harden | Playwright golden-path on Linux; macOS spot-check process; release tag binds test ↔ screencast. |

## Subtractions in flight (lands across 24H + 25H)

Per ADR 0009, these ship with a "What's new" card on the Phase-24H release explaining each:

- **5 stub block renderers** hidden behind `DESIGNER_SHOW_STUBS=1`.
- **7 of 8 Designer-Noticed detector UIs** hidden via in-app Settings toggle. Detectors keep emitting events (frozen-contract additive); UI surfaces one at a time as proposals earn user acceptance.
- **Model selector** hidden behind a flag until per-message subprocess respawn is robust (frame as "behind flag," not removed).
- **Settings cull** — dev escape hatches move to ⌥-click Advanced pane; user-facing toggles users shouldn't think about removed.

## Pending validation (gates next architecture decision)

Before the roadmap rewrite and the iterate-vs-start-over architecture decision, three Tier 1 validation tasks should be completed. All three are captured in `research/critique.md` with full rationale and "what would change my confidence" criteria. Summary:

1. **Persona-validation conversations** (3+ calls, ~30 min each). The personas in `research/personas.md` are dogfood-informed but unvalidated against non-dogfood users. Talk to a designer-founder of a non-SaaS consumer app (Maya analog), a design lead at a 50–100-person team (Jordan analog), and an AI-coding-fluent indie maker (Sam analog). Ask specifically whether their pain matches the convergence-to-mean framing (Framing 1) or the intent-elicitation framing (Framing 2 — see `critique.md §A`). See `research/critique.md §1.1` for full task spec.
2. **Distill-step prototype** (1–2 days). The codification engine's distill step is an open ML problem and the load-bearing technical risk. Take 30–50 real redirections from the project lead's own GitHub history and run a local model + Claude on each to produce codification candidates. Evaluate against a held-out set. See `research/critique.md §1.2`.
3. **Spec-driven dev close-read** (a few hours). Kiro / Tessl / Intent / Spec Kit handle living specs more like Designer's codification primitive than the rationale acknowledged. Read one user's actual flow with one of them. Look for: do they want taste-shaped intent that the tool doesn't support, or is technical-spec scope enough? See `research/critique.md §1.3`.

Estimated total: ~1–2 weeks of cheap diligence. **The architecture decision (iterate / start-over / quarantine-and-extend) and the roadmap rewrite should both wait until these are complete** — see `critique.md §Summary: what to do before more strategic work` for the rationale.

## Parked (see `parking-lot.md`)

Phase 22 unshipped sub-phases (22.C / 22.D / 22.E / 22.H / 22.M / 22.N / 22.N.1; 22.A / 22.B / 22.G / 22.I shipped and stay), Phase 21.A2 remaining detectors past the active one, Phase 15.H (inline commenting), Phase 17 (team-tier trust), Phase 18 (mobile), Phase 19 (workspace scales up), Phase 20 (parallel-work coordination), Phase 23.E.f3 (memory chip), `core_*/commands_*` reorganization, macOS Playwright CI runner. Each carries a friction-driven primary trigger and a time-based fallback. **Plus the 4 chat-UX research items parked 2026-05-13:** hover-revealed copy on code blocks, conversation rewind / undo-a-turn affordance, per-turn cost chip, tool-result rich rendering (Read/Edit/Grep/Bash). Rationale + triggers in `parking-lot.md`; full synthesis in `phase-24-pass-through-chat.md` Appendix C.

## Open questions

- **Active detector pick (Phase 26):** default candidate is `repeated_correction`; final pick at phase start, gated on dogfood evidence. The friction log will name the pattern hitting the user repeatedly.
- **Detector unhide UI (Phase 26):** in-app Settings toggle preferred; feature flag is fallback. Decided at Phase 26 implementation.
- **12.B Apple-Intelligence round-trip:** still needs one run on an Apple-Intelligence-capable Mac to close the SDK-shape delta in `integration-notes.md` §12.B.
- **Phase 24 sequencing:** ✅ Build complete. All 13 workspace steps shipped (PRs #119, #120, #124, #125, #130, #131, #132, #133, #134). `show_chat_v2` flips default ON in step 13 per the §6.1 audit. Coalescer + chat-v1 specific arms inside `spawn_message_coalescer` are filed for Phase 24H cleanup (the function itself stays load-bearing as the broadcast→store bridge for `AgentTurn*` events; only the chat-v1-specific arms retire).
- **Chat-UX research synthesis (2026-05-13):** A research pass on AI chat UX best practices, Claude Code architecture, and coding-harness design patterns produced 12 recommendations against the shipped chat-v2 surface. Parallel staff-engineer + staff-UX reviews triaged them against ADR 0008 (pass-through) and ADR 0009 (Harden bar). Outcome: 5 landed in Phase 24H scope (above), 4 parked with friction-driven triggers (`parking-lot.md`), 3 dropped with explicit citations so they don't get re-proposed. Full triage record in `phase-24-pass-through-chat.md` Appendix C. Closes Q4 ("scroll-anchor behavior on long streams").

- **24I-before-24H reorder (2026-05-13):** documented order was 24 → 24H → 24I → 25; reordered to 24 → 24I → 24H → 25. Reasons: (a) 24H's render-altitude FOLLOW-UPs (`bootReplaying`, queue auto-dispatch, `InterruptAnnouncement`, §5.6 markers + `ErrorAnnouncement`) want an integration harness underneath them — landing them first means writing render-altitude tests then later wishing they were integration tests; (b) the deterministic `read_all` rowid-tiebreaker test from PR #125 was already filed *into* 24I, so the boundary was already fuzzy; (c) the coalescer-cleanup pre-condition is "≥1 dogfood week with no `show_chat_v2: false` overrides" — that week elapses naturally during 24I, so 24H can ship the cleanup confidently; (d) 24I is smaller (~3–5 days vs. ~1 week), so it's lower-risk to land first when chat-v2 is still settling from the flag flip. Mitigates the cognitive-load overlap flagged in PR #122's staff review.

## Where shipped work lives

`history.md` carries the shipped-work log with why / tradeoffs / decisions for every PR through PR #135 (docs reorder, 2026-05-13). The 2026-05-05 backfill pass added 22 PR entries (#95, #98, #99, #100–#119) that had been documented only in `plan.md`'s Current Focus prose; each backfill entry carries a provenance note distinguishing first-person rationale from agent-reconstructed framing. A second entry was appended 2026-05-10 for PR #125. A third backfill pass on 2026-05-13 added the nine remaining gap entries (#120, #122, #123, #124, #126, #127, #128, #129, #135) ahead of the v0.1.3 release tag. Earlier coverage: Phase 13 wire-up (D/E/F/G/H/I), the Dogfood Push (DP-A/B/C/D + v0.1.0 release), Phase 21.A1 (Designer-Noticed foundation + first detector), Phase 23 chat hardening (full sequence 23.A–23.F + follow-ups including 23.B activity indicator, 23.E per-tab subprocess, 23.E.f1 banner reframe), Phase 22 advance slice (22.A / 22.B / 22.G / 22.I shipped behind feature flags), Phase 24 spec + ADR 0008 + foundation, the full Phase 24 chat-v2 rewrite (#119–#134), and ADR 0009 + parking-lot adoption (#122).
