# Mini Enforcement Layer — Tightening Plan

**Status:** Draft v2, post-staff-review
**Date:** 2026-05-10
**Owner:** ben

## Context

An audit of the Mini design system showed that the source-of-truth artifacts (`design-language.md`, `component-manifest.json`, `pattern-log.md`) and the invariants check are well-maintained and doing real work. The **skills layer** (`.claude/skills/generate-ui`, `enforce-tokens`, `check-component-reuse`, etc.) is well-designed but effectively unused: `generation-log.md` has 52 entries, all marked `trigger: manual`. The procedure is being followed by hand, which works at current scale but won't survive parallel agents producing UI without per-PR human review.

The north star is **highly automated, consistent, polished, AI-generated UI in accordance with the Mini system and design language.** This plan tightens the enforcement layer so the north star holds as parallelism increases.

### Reframe (from v1 staff review)

Three reviews of v1 converged on a single critique: **the plan optimized for compliance, not craft.** Token compliance and manifest hygiene are necessary but not sufficient — a perfectly token-compliant UI can still be poorly designed; a perfectly catalogued component can still be the wrong abstraction. v2 fixes this by:

1. **Moving leverage upstream.** The most leverage is at *prompt time*, before code exists. v2 makes reuse and prior-art consultation cheaper than deviation at the moment Claude is about to compose.
2. **Hoisting the high-leverage items.** The manifest index and reuse-decision block were buried in Phase 5 in v1; they're the items that actually change default behavior, so they move to Phase 1.
3. **Connecting craft signal.** `pattern-log.md` is where design reasoning lives. v2 wires it into the pre-generation path and into the log schema, so craft accumulates rather than scatters.
4. **Tightening before extracting.** v1 made Phase 4 (pattern extraction) depend on a free-form log schema. v2 tightens the schema first so extraction has signal to find.

## Goals

1. **Reuse is the default path.** When Claude is about to generate UI, existing components and archetypes are surfaced *before* composition, not logged afterward.
2. Skills fire on real UI prompts, not just verbatim trigger verbs.
3. Source of truth (manifest, design language, pattern-log) stays structurally honest without manual policing.
4. Token, a11y, *and craft* invariants catch more than just hex/px/ms.
5. Patterns get extracted from generation-log signal back into the design language.
6. The enforcement layer itself has a friction-reporting path so it can be tuned, not tuned out.

## Non-goals

- Hard-gating every UI commit on log-entry presence (gaming risk).
- Replacing manual judgment where judgment matters (archetype choice, deviation decisions).
- Building a hosted enforcement service. Designer is local-first; enforcement runs in CI and (optionally) pre-commit hooks.
- Mobile/Swift surfaces. Separate language work; deferred.
- Replacing CSS-level subjective taste with rules (no auto-rewriting "ugly").

---

## Phases

Phases are independent except where noted. Phase 1 lands the highest-leverage items (pre-generation surface + structural hygiene). Phase 2 makes skills fire on real prompts. Phase 3 tightens log schema (prerequisite for Phase 4). Phase 4 extracts signal back into the design language. Phase 5 is craft enforcement.

---

### Phase 1 — Pre-generation friction + structural hygiene

**Theme:** Make the right action cheaper than the wrong one, and catch structural drift in CI.

**1.1 Manifest-drift CI check (scoped + warn-first)**

- New script: `tools/invariants/manifest-drift.mjs`.
- **Scope (managed dirs):** `packages/app/src/components/**`.
- **Exempt:** `packages/ui/src/` (track-closely Mini components, synced via `./scripts/sync-mini.sh`); test files (`*.test.tsx`, `*.stories.tsx`); generated files.
- **Fails when:**
  - A new `.tsx` file is added under a managed dir without a matching `component-manifest.json` entry.
  - A manifest entry's `path` points to a file that no longer exists.
- **Does not fail when:** an existing file (already in manifest, or already known-untracked) is edited. Trivial-edit short-circuit (Phase 2.2) and routine modifications do not trigger drift.
- **Escape hatch:** explicit `status: "legacy"` or `status: "untracked"` in the manifest entry with a required `rationale` field. Count of legacy entries surfaced in a CI report so drift is *visible*, not *hidden*.
- **Rollout:** ship as **warning-only for 2 weeks**, with a CI summary line `manifest-drift: N new untracked / M legacy`. Promote to blocking once the new-untracked count is zero. Mirror the warn-first ramp used in 1.3 and 3.3.
- Wired into `.github/workflows/ci.yml` as a separate job.
- **Warning copy:**
  ```
  ⚠️  Manifest drift detected
    New file with no manifest entry: packages/app/src/components/FooBar.tsx
    Add an entry to core-docs/design-system/component-manifest.json (template:
    tools/manifest/sync.mjs packages/app/src/components/FooBar.tsx),
    or mark `status: "untracked"` with a rationale.
  ```
- Estimated: half a day.

**1.2 Agent-readable manifest index**

- Auto-generate `core-docs/component-manifest.index.md` — a flat, grep-friendly view of the manifest with one-line descriptions, primary use cases, and `primitives_used`/`archetypes_used`.
- New script: `tools/manifest/build-index.mjs`. Regenerates whenever the manifest changes (CI step + pre-commit option).
- **Why hoisted from v1 Phase 5:** the cost of "check reuse first" is dominated by the cost of scanning 59 JSON entries. A flat markdown index makes the reuse-check cheap enough to actually happen every time.
- Estimated: half a day.

**1.3 Pre-generation reuse surface in `generate-ui`**

- New skill step **0** (runs before current step 1): given the user's intent, search the manifest index + archetype list and surface candidates *to the user* in the response before composing code.
- Output format (mandatory in skill output):
  ```
  Pre-generation reuse check:
  - <Component / Archetype>: <one-line fit assessment>.
  - <Component / Archetype>: <one-line fit assessment>.
  Selected approach: reuse <X> / extend <Y> / generate new <Z>.
  Reason: <interaction reason | semantic reason | visual-design reason>.
  ```
- **Why this matters:** v1's reuse-decision block lived in the *log* (post-hoc). v2 lifts it into the *response* (visible to the human, gateable in code review).
- **Pattern-log seeding:** the step also greps `pattern-log.md` for similar prior decisions (keyword match on user intent) and surfaces the top 2–3 with their rationale links.
- Estimated: 1 day (skill rewrite + index/log search helpers).

**1.4 Pre-commit invariants check (optional, opt-in)**

- The repo has no existing hook framework. v2 does **not** install one as a hard requirement. Instead:
  - Ship `scripts/install-hooks.sh` that opt-in installs a pre-commit hook running `node tools/invariants/check.mjs` on staged UI files.
  - Document in README/CLAUDE.md as a dev convenience.
  - **CI is the hard gate** (Phase 1.5 / existing). `--no-verify` bypass is acceptable because CI catches it on PR.
- Estimated: 1–2 hours.

**1.5 Extend invariants: contrast-pair check (warning-first, ramp to blocking)**

- `audit-a11y` specifies WCAG AA contrast across accent × mode combinations. Codify the deterministic part:
  - Parse CSS for `color: var(--X)` + `background: var(--Y)` pairs (including resolved cascades through `axioms.css`).
  - Walk the resolution graph across (`light-theme` | `dark-theme`) × every `[data-accent="*"]` defined in `axioms.css`.
  - Look up final Radix color values from a vendored snapshot of Radix tokens.
  - Compute WCAG contrast; fail if `< 4.5:1` (text) or `< 3:1` (large text / UI elements).
- **Estimate revised: 2–3 days** (theme matrix resolution + Radix color vendoring + false-positive tuning). v1's 1-day estimate was wrong.
- **Rollout:** warning-only for 2 weeks. Define promotion criteria: if ≥80% of failures are actionable (real contrast issue), promote to blocking; if <60%, pause and tune rules.
- New invariant ID: `contrast-pair-aa`.
- **Warning copy:**
  ```
  ⚠️  Contrast-pair invariant: AsyncButton text fails WCAG AA in dark-theme + crimson accent
    color: var(--accent-9) on background: var(--color-surface-raised) → 3.2:1 (need 4.5:1)
    Fix: use --accent-11 for text on raised surfaces, or move text to a non-accent token.
    Reference: design-language.md §contrast.
  ```

**Phase 1 success criteria:**
- Generation-log entries (from new UI work) contain the pre-generation reuse block ≥90% of the time.
- Manifest drift: zero new untracked entries; legacy count visible and explicit.
- Contrast-pair check has a tuned ruleset within 2 weeks and is promoted to blocking or explicitly deferred with a rationale.

---

### Phase 2 — Skills fire on real prompts

**Theme:** Close the trigger gap between "what we say invokes the skill" and "what prompts actually appear."

**2.1 Rewrite `generate-ui` trigger description (path-based primary)**

- **Front-load path-based trigger:**
  ```
  Fires on any edit that lands in `packages/app/src/components/**` or
  `packages/ui/src/**` and changes visual or structural code, regardless
  of the prompt's verb (build, refactor, fix, implement Phase X, adjust,
  rename, etc.). Secondary trigger: generation/modification verbs applied
  to UI (build/create/generate/modify/extend/refactor/redesign).
  Does NOT fire on audit verbs or language-level work.
  ```
- The verb list moves from primary trigger to secondary cue.

**2.2 Trivial-edit short-circuit (clarified vs 1.1)**

- Add explicit "Trivial edits" section to `generate-ui/SKILL.md`. Short-circuit conditions:
  - Copy-only changes (string content, no structural or visual change).
  - Comment edits.
  - Prop renames with no behavior change.
  - Bug fixes touching ≤10 lines, no new tokens, no new components.
- **For trivial edits:** skip step 0 (pre-generation reuse surface), step 1 (full reuse check), step 5 (a11y deep dive), step 6 (full manifest update — file is already in manifest by definition for an edit). Still run step 4 (invariants) and append a one-line log entry (`trigger: trivial-edit`).
- **Explicit non-conflict with 1.1:** trivial edits act on files that *already exist* in managed dirs. Phase 1.1 fails only on *new* files without entries, so trivial-edit short-circuit and manifest-drift cannot collide.

**2.3 Update CLAUDE.md "Procedure for UI tasks"**

- Reference `generate-ui` as the explicit entry point: "Any edit to `packages/app/src/components/**` or `packages/ui/src/**` routes through `generate-ui`."
- Document the trivial-edit short-circuit boundary.
- Add: "If you've started editing UI without invoking `generate-ui`, stop, surface the reuse check, and proceed."

**2.4 Add `.claude/rules/mini-ui-entry-point.md`**

- Imperative rule (rules load every turn):
  ```
  When editing files under `packages/app/src/components/**` or
  `packages/ui/src/**`, invoke generate-ui's procedure. If you have
  already started, run step 0 (pre-generation reuse surface) now with
  your current edits as context. The reuse-check output must appear in
  your response — missing it = procedure skipped.
  ```
- Reason: rules are persistent context; skills are probabilistic. The rule closes the gap where Claude reads a non-generation verb prompt and doesn't fire the skill.

**Phase 2 success criteria:**
- New generation-log entries show `trigger: generate-ui` for substantive UI work; `trigger: trivial-edit` for short-circuited cases; `trigger: manual` only when the procedure genuinely couldn't fire (and with a one-line reason).
- The next 10 UI-touching PRs each have a corresponding generation-log entry containing the pre-generation reuse block.

---

### Phase 3 — Generation-log schema tightening + soft audit trail

**Theme:** Make the log machine-readable so Phase 4 can extract signal, not noise.

**3.1 Tighten the generation-log schema (prerequisite for Phase 4)**

- Restructure `deviations`:
  ```yaml
  deviations:
    - category: token | archetype | interaction | a11y | scope
      description: <one sentence>
      pattern-log-ref: <anchor in pattern-log.md, or null if not warranted>
      feedback: accepted | rejected | pending
  ```
- `feedback: pending` is **not allowed at PR-merge time** — must resolve to `accepted` or `rejected` (Phase 5.3 in v1; merged into Phase 3 in v2 because schema tightening and resolution are the same concern).
- `prompt` field: summarize, do not paste full conversation. Long prompts truncated to ≤200 chars + link to PR.
- Add fields:
  - `skill-version`: version of generate-ui in effect at this firing (so historical entries don't drift with skill rewrites).
  - `reuse-considered: [list of components/archetypes Claude evaluated before composing]`.
- Update `core-docs/design-system/generation-log.md` header to document the new schema.
- **Migration:** existing 52 entries grandfathered (no retro-fill). New entries follow the new schema. Validator (3.2) only enforces on entries after a cutoff date.

**3.2 Generation-log schema validator**

- New script: `tools/mini/validate-log.mjs`.
- Enforces the v2 schema on entries dated after the cutoff.
- **Rollout:** warning-only until ≥90% of new entries pass. Promote to blocking with a `--strict` flag.
- Required for Phase 4 (machine-readable log is the input).
- **Warning copy:** specifies which field failed and an example of correct shape.

**3.3 Manifest auto-update helper**

- New script: `tools/manifest/sync.mjs`.
- Reads a `.tsx` file and emits a draft manifest entry (name, path, primitives_used and archetypes_used parsed from imports/JSX, tokens_referenced parsed from CSS).
- Output is a JSON snippet to splice into `component-manifest.json`; doesn't auto-commit.
- Reduces friction: manifest-update step becomes "run script → refine description → splice in."

**3.4 Generation-log pre-commit reminder (advisory, opt-in)**

- Bundled with the optional pre-commit hook from 1.4. Non-blocking.
- Prints when UI files are staged without a generation-log diff. Specific copy:
  ```
  Heads up — UI files staged but core-docs/design-system/generation-log.md not updated.
  If you ran generate-ui's procedure, run step 6 to add the entry
  (template: tools/mini/log-entry-template.md). If you skipped the procedure
  (trivial edit?), no action needed.
  ```
- For Claude sessions: surfaces as tool output and becomes a prompt for the next step.

**Phase 3 success criteria:**
- ≥90% of new generation-log entries pass `validate-log.mjs --strict`.
- No PR merges with `deviations: pending`.
- `pattern-log.md` grows by at least one referenced entry per substantive new component.

---

### Phase 4 — Pattern extraction (depends on Phase 3 signal)

**Theme:** Close the loop — log signal feeds back into the design language and pattern-log.

**4.1 Amendment-mode scan script**

- New script: `tools/mini/find-recurring-deviations.mjs`.
- Reads `generation-log.md`, parses structured `deviations`, and surfaces:
  - Tokens referenced ≥3 times that aren't in the design language (candidate new tokens).
  - Deviations with `feedback: accepted` appearing ≥3 times (candidate token amendments or new archetypes).
  - Components flagged in `deviations` but used in production (candidate manifest entries / refactors).
  - **New (v2):** `reuse-considered` candidates frequently considered but rejected — surfaces "should we add a variant here?" signal.
- Outputs a markdown report for human/Claude review.
- **Run cadence:** at phase boundaries. Added to phase-close checklist in `core-docs/workflow.md`.

**4.2 Recurring-success extraction**

- Counterpart to 4.1: components used ≥N times with `feedback: accepted` and no deviations are candidates for promotion (e.g., from project component to archetype, or recommended primary in the manifest's `recommended` field).
- Same script, separate report section. Counters the v1 bias of only mining for deviations.

**4.3 Phase-close amendment review**

- Process, not tooling: at phase boundaries, run 4.1 + 4.2, review candidates, propose token amendments via `elicit-design-language` in amendment mode and pattern-log additions where novel reasoning surfaces.
- Captured in `core-docs/workflow.md` as a phase-close step.

**Phase 4 success criteria:**
- At least one token amendment per phase comes from log signal rather than ad-hoc developer intuition.
- At least one pattern-log entry per phase comes from a recurring deviation's resolution.

---

### Phase 5 — Craft enforcement (the part v1 was missing)

**Theme:** Move beyond compliance to craft. Token compliance ≠ good design.

**5.1 Formalize interaction-pattern axioms**

- `design-language.md` already documents excellent interaction patterns informally (chat asymmetry, Linear-style tabs, false-affordances-are-bugs, weight policy, two-tier surface register). Promote them to explicit axioms with IDs (mirroring the token axioms).
- New section in `design-language.md`: `## Interaction axioms` with IDs like `IA-01: every input has a non-color error signal`, `IA-02: every dismissible surface has ESC + focus return`.
- These become referenceable in pattern-log, reuse-decision blocks, and the craft-audit checklist.

**5.2 `audit-craft` skill (analog to `audit-a11y`)**

- New skill: `.claude/skills/audit-craft/`.
- Runs on demand (audit verb) or as a step in `generate-ui` (lighter inline version).
- Checks (initial set):
  - Does the surface compose primitives, or is it bespoke layout?
  - Does the weight hierarchy follow the weight policy axiom?
  - Does the spacing rhythm match the design language's spacing scale?
  - Does motion respect reduced-motion?
  - For new components: does the reuse-decision block contain *design reasoning* (interaction / semantic / visual), not just "different"?
- Output is a checklist with pass/warn/fail per item. Warn does not block; fail blocks if invoked as part of `generate-ui`.

**5.3 Reuse-decision block requires design reasoning**

- Tighten the block specified in Phase 1.3:
  ```
  Reuse-decision:
  - <Component>: rejected — <interaction reason | semantic reason | visual-design reason>.
  - <Archetype>: rejected — <design reason>.
  Generating new: <Component> because <reason>
    (vs. extending via <alternative>).
  Pattern-log: <anchor or 'novel'>.
  ```
- Bare reasons like "doesn't fit" or "different" do not pass. Validator (3.2) parses the block and flags weak reasons.

**5.4 Skill output quality baseline (FOLLOW-UP, not blocking)**

- Establish a before/after baseline: capture 5 representative surfaces (button, form, modal, list, card) hand-coded vs. `generate-ui`-fired. Compare:
  - Invariant pass rate.
  - Token usage density.
  - Primitive composition rate.
  - Subjective craft (human-reviewed).
- Lets the plan prove `generate-ui` actually improves outputs, not just makes compliance loud.
- Not blocking — but if not done, Phases 1–4 deliver compliance theater without proof.

**Phase 5 success criteria:**
- Interaction axioms documented and referenced from at least one reuse-decision block per substantive PR.
- `audit-craft` runs as part of `generate-ui` on substantive generations; warnings appear in the response.
- Baseline experiment (5.4) completed; results published in `core-docs/design-system/pattern-log.md` or a new `mini-quality-baseline.md`.

---

## Sequencing

- **Week 1:** 1.1 (warn-only), 1.2, 1.3, 1.4, 2.1, 2.3, 2.4. Pre-generation surface + manifest index + skill rewrites + rule. Highest leverage; ship first.
- **Week 2:** 1.5 (contrast, warn-only), 2.2, 3.1, 3.4. Schema tightening + remaining triggers.
- **Week 3:** 3.2, 3.3, 5.1, 5.3. Validator + auto-helper + interaction axioms + reuse-block tightening.
- **Week 4:** 5.2 (audit-craft), 5.4 baseline.
- **Month 2+ (after log signal accumulates):** Phase 4.

All phases can run parallel to dogfood-readiness work (updater / chat pass-through / bug sweep). No blocking dependencies on dogfood-path code.

### Promotion gates (warn → block)

Three layers ship warn-first and promote to blocking based on data:

| Layer | Warn period | Promote criteria |
|---|---|---|
| 1.1 manifest-drift | 2 weeks | New-untracked count == 0 across 2 consecutive weeks |
| 1.5 contrast-pair | 2 weeks | ≥80% failures actionable (real contrast issue) |
| 3.2 log validator | until 90% pass | ≥90% of new entries pass schema |

Each layer has an explicit rollback condition: if false-positive rate exceeds threshold or the layer creates more friction than signal, demote back to warning-only and file a follow-up.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Skill theater — skill claims to run but procedure is skipped. | Pre-generation reuse block (1.3) lives in the *response*, not the log. Missing block = procedure skipped = caught in code review. Validator (3.2) parses log entries for weak reuse reasons. |
| Log gaming — cargo-cult entries to satisfy validator. | Validator only checks schema, not subjective quality. Quality comes from review + Phase 5.3 design-reasoning requirement. |
| Manifest escape hatches overused. | `status: legacy` requires `rationale`. CI surfaces legacy count so drift is *visible*. |
| Friction tax on small edits. | Trivial-edit short-circuit (2.2), manifest auto-update helper (3.3), no log-entry hard gate (3.4 advisory). |
| Contrast check too noisy. | Warn-first 2 weeks; explicit ≥80% / <60% promotion / pause thresholds. |
| Pre-commit hooks bypassed (`--no-verify`). | Pre-commit is opt-in (1.4); CI is the hard gate. Bypass is OK because CI catches it. |
| Rule + skill compose nondeterministically. | Path-based trigger is *primary* in 2.1; rule (2.4) requires the reuse-check output to appear in the response. Both surface the same artifact, so they reinforce. |
| Phase 4 extracts noise. | Schema tightening (3.1 + 3.2) is a hard prerequisite; Phase 4 starts only after ≥90% of entries pass strict validator. |
| Compliance without craft. | Phase 5 (audit-craft, interaction axioms, design-reasoning requirement) explicitly addresses this. Phase 5.4 baseline experiment proves whether outputs actually improve. |
| Enforcement tooling itself becomes friction. | New friction category: tooling friction. Captured via a comment in generation-log entries (`feedback: "this check is broken / noisy"`); 4.1 amendment scan surfaces procedural debt, not just token debt. Standalone follow-up on the friction-reporter UI to add a "tooling" category. |
| Mini upstream sync introduces components the manifest doesn't know about. | `scripts/sync-mini.sh` should seed manifest entries for new archetypes/primitives. Tracked as follow-up; not blocking. |
| Branch protection assumed but not configured. | Prerequisites section below — verify GitHub branch protection before promoting any check to blocking. |

## Prerequisites

- GitHub branch protection on `main` enforces CI status checks and requires PR review. Verify in repo settings before promoting any check from warning to blocking. Without it, Phase 1.1 / 1.5 / 3.2 blocking promotion is best-effort.
- Radix color values vendored (snapshot) for contrast-pair check (1.5).

## Follow-ups (out of scope for this plan, but tracked)

- **Pre-generation pattern-log seeding** beyond keyword match — embed-based similarity for prior decisions.
- **Friction-reporter "tooling" category** so enforcement-layer friction routes into the existing flow.
- **Mini sync manifest auto-seeding** when upstream Mini ships new primitives/archetypes.
- **Skill output baseline experiment** (5.4) — not strictly out of scope, but flagged as FOLLOW-UP because it's investigative, not constructive.
- **Mobile/Swift language enforcement** when mobile work begins.
- **Interaction axiom enforcement in CI** — Phase 5.1 documents axioms; mechanical enforcement (e.g., "every dialog has an ESC handler") is a future pass.

## Out of scope

- Replacing human judgment on archetype/component selection.
- Hosted dashboards.
- Auto-rewriting subjective taste (visual polish remains a human/AI judgment, not a rule).
- Forcing a single style for generation-log entry prose (free-form `description` fields stay free-form within the structured schema).

---

## Changelog

- **v2 (2026-05-10):** Reframed compliance → craft after staff-perspective review. Hoisted manifest index + reuse-decision block to Phase 1. Added pre-generation reuse surface (1.3). Tightened log schema before Phase 4. Resolved 1.1/2.2 conflict by scoping drift to new files only. Pre-commit demoted to opt-in; CI is the hard gate. Contrast-pair estimate revised 1 day → 2–3 days. Added Phase 5 (craft): interaction axioms, audit-craft skill, design-reasoning requirement in reuse-decision block, output baseline experiment. Specified warning copy per layer. Added tooling-friction loop. Added prerequisites section.
- **v1 (2026-05-10):** Initial draft.
