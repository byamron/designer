# ADR 0009 — Trustworthy shipping: Build/Harden alternation and the parking lot

**Status:** proposed
**Date:** 2026-05-04
**Deciders:** user, after a three-perspective review of the current roadmap (engineer / UX / design engineer) flagged feature accretion outpacing the core product reaching a flawless state
**Supersedes:** none. Builds on ADR 0002 (frozen-contract additive-only event vocabulary), ADR 0008 (Phase 24 chat pass-through), and the four product principles in `CLAUDE.md` §Product Principles.

## Context

Designer has shipped 25 numbered phases since `preliminary-build` and currently has Phase 22, 23 follow-ups, 24, and 21.A2 active concurrently. Dogfood has consistently surfaced foundation gaps that earlier phases could have caught: per-tab subprocess regressions (23.E), tool-use ordering drift (24), first-run blockers (PR #24), the model-selector retry loop. Every dogfood pivot ships, but each ship leaves the next layer of friction unaddressed because the active surface is too wide. The user's framing: *"we've added tons of features too fast without the core product actually working."*

Two structural forces drove the accretion:

1. **No principle distinguishes "demoable end-to-end" from "wired up."** The Quality Bar lists Functional / Safe / Performant / Crafted, but a feature that meets all four can still ship in a state where a screen-recording would expose seams (placeholder copy, stubbed sub-features, error states reaching the user verbatim).
2. **No mechanism defers work without forgetting it.** When a phase is interesting but not load-bearing, the alternative to shipping it is leaving it in `roadmap.md` indefinitely. Cognitive load on the active roadmap grew from ~5 to ~25 phases over two months.

The user wants ambition preserved (every deferred phase is still on the table for a future cycle) but execution tightened (one feature at a time, demoable at every checkpoint, infrastructure paid for before features compound on it).

## Decision

Three coupled changes:

1. **A new product principle** — "Shipped state is trustworthy" — added as the seventh entry in `CLAUDE.md` §Product Principles and as an entry in `spec.md` §Decisions Log.
2. **Build / Harden alternation** — the roadmap's active sequence flips from `Phase N → N+1` to strict alternation: each `Build` phase ships one feature on one track; each `Harden` phase that follows contains only the four work categories listed in §1.B below. This is documented in `CLAUDE.md` §How to Work and reflected in `roadmap.md`.
3. **A parking-lot mechanism** — a new file `core-docs/parking-lot.md` holds every deferred phase with a friction-driven primary trigger and a time-based fallback. Phases live there until a trigger fires; they do not live in the active roadmap.

### 1.A The principle

```
Shipped state is trustworthy. Every shipped surface works end-to-end
without seams, stubs, or false affordances. Unfinished features hide
entirely (feature flags, not visible stubs) until they're flawless.
When we simplify or hide work, we say why in release notes — never
silent removals. Verification: a human-recorded golden-path
screencast per release tag, checked into the repo and bound to a
Playwright test that fails the release on regression.
```

The principle is user-facing (manager voice: *trust*, not developer voice: *demo*). The screencast is the artifact that makes it falsifiable; the Playwright binding is the gate that prevents the screencast from rotting out of sync with the product.

### 1.B Build / Harden alternation

Active roadmap structure:

```
Phase 24    Build:  one feature, one track
Phase 24H   Harden: no new features
Phase 24I   Harden: integration test harness (split out per engineer review)
Phase 25    Build:  one feature, one track
Phase 25H   Harden: no new features
…
```

A Harden phase contains only:

1. **Test coverage** — integration tests, regression tests, fixture work.
2. **Friction closure** — friction-inbox triage; resolve or park each entry. Gate: *no critical friction blocks the next Build* (a human judgement, not a count of zero).
3. **Design-language enforcement** — token migration, primitive composition, manifest cull, generation-log entries.
4. **Demo gatekeeping** — record golden-path screencast; verify against Playwright test; first-run flow audit against any subtractions.

Bug fixes that cross feature boundaries (e.g. closing a friction report requires an event-vocabulary change) are allowed under category 2; they are closure work, not new feature tracks.

A Build phase is one feature on one track. The `core_*/commands_*` parallel-track convention from Phase 13 is no longer applied — see `parking-lot.md` for the reorganization entry. New work organizes by domain.

### 1.C The parking lot

`core-docs/parking-lot.md` holds every deferred phase. Each entry has:

- **Deferred:** date the phase moved out of active roadmap.
- **Reason:** one-line summary of why it isn't load-bearing now.
- **Primary trigger (friction-log):** a user-perceptible signal that pulls it back. Friction reports, dogfood asks, or observable workspace state. **Never telemetry that doesn't exist.**
- **Time fallback:** a phase identifier (e.g. *"reassess after Phase 27 ships"*) that revisits the entry regardless of friction signal. Prevents drift.
- **Source:** a link or anchor to the original `roadmap.md` content. Verbatim text is preserved.
- **Unhide path:** how the feature returns to active state — flag flip, in-app toggle, or UI restoration. Specified per entry; default is in-app Settings toggle.

Triggers are user-perceptible by construction. *"≥2 daily users with ≥3 active workspaces"* is rejected because Designer collects no telemetry (see §3 below). *"User files ≥3 friction reports flagging Home density"* is accepted because it reads from the existing Friction event vocabulary.

### 1.D Verification

Per release tag (`v*`):

1. The maintainer records a golden-path screencast — opens Designer, performs the cockpit's primary path (create project → start workspace → post message → see response → see artifact → approve a tool use → ship a track), narrates briefly. Target length: 2–3 min; if the path runs longer, trim it. Saves to `core-docs/screencasts/v<version>.webm` (preferred over `.mov` for size; H.264 + 1080p + 30fps) and references it from `history.md`. Per-release file budget: 50 MB. If a release would exceed budget, switch to git-LFS before tagging — Phase 24H sets up `.gitignore` exception (`!core-docs/screencasts/v*.webm`) and a pre-commit size-check hook.
2. A Playwright test in `apps/desktop/tests/golden-path.spec.ts` exercises the same path against a Linux build (existing CI infra; no new macOS-runner cost).
3. Release tag CI runs the Playwright test. Failure blocks the tag.
4. The maintainer manually spot-checks the macOS build before publishing the release. Findings flow to the friction inbox.

The Playwright test gates the release; the screencast documents what trustworthy looks like at that version. macOS Playwright CI is parked (see `parking-lot.md`).

## Consequences

### Positive

- **Cognitive load on active roadmap drops** from 25 phases to 7 (Phase 24 → 26H) plus a parking-lot index. Plan.md drops from 517 lines to ≤100.
- **Every release tag has a checked-in screencast** that documents what end-to-end correctness looked like at that version. New contributors and dogfood users can see the intended state.
- **Hidden work doesn't rot** because every parking-lot entry has a time fallback. Triggers are user-felt, so revisits happen on real signal.
- **Demo discipline is enforceable** because the principle binds to a Playwright test, not to a feeling. The screencast is the proof; the test is the gate.

### Negative

- **Throughput per quarter declines** in the short run. One feature per ~3-week Build/Harden cycle is a slower headline pace than the recent five-PRs-a-day Dogfood Push cadence. The trade is that each shipped feature is actually demoable.
- **Some currently-visible surface gets hidden** — 5 stub block renderers, 7 of 8 Designer-Noticed detector UIs, the model selector, ~600 LOC of Settings escape hatches. A returning user notices things missing; mitigated by the v0.1.2 "What's new" card explaining what was simplified and why.
- **Frozen-contract drift risk** — hidden Designer-Noticed detectors continue to emit `FindingRecorded`/`ProposalEmitted` events into the log per ADR 0002 additive-only rule. The events are valid; they have no UI surface until the unhide path runs. This is an explicit Designer convention (see §3), not a leak.
- **The macOS visual-regression gap stays open** — current Playwright runs on Linux; the macOS surface is verified by manual maintainer spot-check. If a release ships a macOS-only rendering bug, the friction loop catches it on the next dogfood session, not at CI time. Acceptable for v1; revisit when the cost is justified (parking-lot entry).

### Frozen contracts and hidden features

Per ADR 0002, `EventPayload` is additive-only. When a feature is hidden but its events still emit (Designer Noticed detectors are the load-bearing case), the convention is:

- **Events keep emitting.** The Rust event source stays active. Logs decode forever.
- **UI hides.** The render path is gated behind an in-app Settings toggle (preferred) or a feature flag (alternative). The toggle defaults off until the unhide path runs.
- **Detectors stay disabled by default at the configuration layer** when overlap with Forge or another in-flight system would noise-up the log.

This is deliberate. Hidden-but-emitting is not dead code; it is a decoupling between the event log (forever-additive) and the UI surface (revertible). Future ADRs can decommission a detector entirely (an additive removal), but that is a contract change requiring its own ADR.

## Alternatives considered

- **Keep the current roadmap, add a "demo-flawless" tag to phases.** Rejected: tagging without restructure does not change throughput or cognitive load. The user's framing was that the active surface is too wide, not that prioritization was wrong.
- **Cull active phases without a parking-lot mechanism.** Rejected: the user explicitly said *"I don't want to forget things we remove."* A cull without preservation forces re-litigation later.
- **Use telemetry-based triggers** (DAU, proposal acceptance counts). Rejected: Designer collects no telemetry per `spec.md` §Anthropic Compliance Model. Triggers must read from the existing friction-log + dogfood-feedback paths.
- **Separate "Build" and "Harden" tracks running in parallel.** Rejected: parallelism was the source of the gap (per Phase 13 review). Strict alternation forces foundation work to land before more features compound on it.
- **Make the screencast a release-day human ritual without a Playwright binding.** Rejected: a video file rots out of sync with the product as soon as the next Build phase ships. The Playwright test is what keeps the screencast honest.

## Implementation

In order, all in this PR:

1. Create `core-docs/adr/0009-trustworthy-shipping.md` (this file).
2. Create `core-docs/parking-lot.md` with entries for the 10 deferred phases.
3. Append the principle to `CLAUDE.md` §Product Principles. Add a fifth Quality Bar item (Trustworthy). Note Build/Harden alternation in §How to Work.
4. Append a Decision-Log entry to `core-docs/spec.md` referencing this ADR.
5. Restructure `core-docs/roadmap.md`: active section shrinks to Phase 24 → 26H; deferred phases tagged inline with a `**Parked: see parking-lot.md**` callout (verbatim content preserved); Build/Harden alternation made explicit.
6. Rewrite `core-docs/plan.md` Current Focus as one line per active phase, capped at ≤100 lines. Detail moves to `history.md`.
7. Append a generation-log entry per the Mini procedure (process change with documentation impact).

The Playwright golden-path test, the macOS spot-check process, and the screencast template land in Phase 26H, not in this PR. This PR establishes the principle and the structure; the verification mechanism implements in the Harden phase that produces it.

## Open questions

- **Which Designer-Noticed detector becomes the active one?** Default candidate is `repeated_correction` (per UX review: "you keep fixing this same thing" lands as observed empathy). Final pick at Phase 26 start, gated on dogfood evidence — the friction log will name the pattern that's hitting the user repeatedly. Not a blocker for this ADR.
- **In-app toggle vs. feature flag for hidden-detector unhide path.** Settings toggle is preferred (user-discoverable); feature flag is fallback (developer-only). Decision deferred to Phase 26 implementation.
- **What about features that are hidden for stability, not strategy?** The model selector is the load-bearing case. Frame as *"behind flag until polished"* and re-shipped via flag flip in a future Harden phase. Not a parking-lot entry — it's still on the active surface, just gated.
