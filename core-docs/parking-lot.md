# Parking lot

Phases that are deferred — not deleted. Each entry has a friction-driven primary trigger and a time-based fallback. When a trigger fires, the phase moves back to active in `roadmap.md`.

See `core-docs/adr/0009-trustworthy-shipping.md` for the rationale and contract for this file.

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

- **Deferred:** 2026-05-04
- **Reason:** All 8 detectors in `crates/designer-learn/src/detectors/` are shipped at the foundation layer (events emit, fixtures pass), but only ONE has a polished end-to-end loop. Surfacing 8 simultaneously dilutes the trust signal — the user can't tell which detector is reliable. Pick the friction-driven leader; defer the rest until proven.
- **Primary trigger:** User accepts ≥3 proposals from the active detector (visible as `ProposalAccepted` artifacts in the event log) AND files a friction report or in-chat ask requesting a second detector by name (e.g., "I want Designer to also notice cost spikes" / "watch for scope creep").
- **Time fallback:** Reassess after Phase 28 ships.
- **Source:** `roadmap.md` §"Phase 21.A2 — Detector squad" — detector list and per-detector specs preserved verbatim.
- **Unhide path:** In-app Settings toggle per detector. Detectors continue to emit `FindingRecorded`/`ProposalEmitted` events while UI is hidden (per ADR 0009 §3 frozen-contract pattern).

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
