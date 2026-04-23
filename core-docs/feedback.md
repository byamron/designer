# Feedback Log

User feedback synthesized into actionable guidance. When the user gives feedback — corrections, preferences, reactions, direction changes — the relevant insight is captured here so it shapes all future work.

This is not a transcript. Each entry distills feedback into a rule or preference that applies going forward.

---

## How to Write an Entry

```
### FB-XXXX: [Short summary of the feedback]
**Date:** YYYY-MM-DD
**Source:** user correction | user preference | user direction | review feedback

**What was said:** Brief, factual summary of the feedback.

**Synthesized rule:** The actionable takeaway — what to do differently going forward.

**Applies to:** [areas this affects: ux, code, architecture, workflow, etc.]
```

### Numbering
Increment from the last entry. Use `FB-0001`, `FB-0002`, etc.

### Source types
- **user correction** — user fixed something you did wrong
- **user preference** — user expressed a stylistic or process preference
- **user direction** — user set strategic direction or priorities
- **review feedback** — issues found during code/design review

---

## Entries

### FB-0020: Bake dev-panel explorations into the design language when they land
**Date:** 2026-04-23
**Source:** user direction

**What was said:** After ~24 hours of tuning the surface register behind a live dev panel (gutter / tab-gap / compose-pad / shadow / tab-style), the user landed on values and said "lock in the config and get rid of this dev panel for now." The knob pattern itself was successful — we reached the right values faster than staff guesswork would have.

**Synthesized rule:** Live dev panels are a legitimate design tool during contentious token/layout decisions. Ship them behind `MODE === "development"`, let real use decide, then retire them and bake values into `app.css` / `tokens.css`. Don't leave dev panels mounted in prod; don't scrap them prematurely before a decision has earned the right to ship.

**Applies to:** workflow, design tooling, token system

### FB-0019: Content surface should invert by mode, not stay "raised" in both
**Date:** 2026-04-23
**Source:** user direction

**What was said:** On seeing a dark-mode render with the surface one step brighter than the page (Slack / Linear convention), the user asked for "off-black" in dark mode — main surface darker than the sand sidebars. Light stays white on sand.

**Synthesized rule:** `--color-content-surface` is `white` in light and `var(--gray-1)` (sand-dark-1) in dark — brightness direction inverts by mode. Both readings honor "this is the work, that is chrome"; the polarity just flips. Other surface roles (`--color-surface-flat/raised/overlay`) stay monotonic (brighter-than-background in both modes) because they're secondary containers, not the main figure.

**Applies to:** ux, color, design-language

### FB-0018: Match Radix Colors v3's activation model — class, not prefers-color-scheme
**Date:** 2026-04-22
**Source:** user correction

**What was said:** User's system was in dark mode but the app rendered light. The `@media (prefers-color-scheme: dark)` override was firing, but Radix Colors v3 (`sand.css` / `sand-dark.css`) activates scales only via `.dark` / `.dark-theme` classes. So `--color-content-surface: var(--gray-3)` resolved to light-mode sand-3 (warm beige), tinting the surface.

**Synthesized rule:** Theme-dependent CSS overrides MUST use the same activation signal as Radix — `.dark` / `.dark-theme` (and Designer's `[data-theme="dark"]` escape hatch). Do not rely on `@media (prefers-color-scheme)` alone; the two systems don't talk. The inline zero-flash script in `index.html` applies both the class and `[data-theme]` synchronously so the first paint is consistent.

**Applies to:** theming, dark mode, css architecture

### FB-0017: No hidden false affordances — even during Phase-gated rollouts
**Date:** 2026-04-23
**Source:** review feedback

**What was said:** HomeTabA's Autonomy SegmentedToggle shipped with a stub `onChange: () => {}` because the real mutation is Phase-13 (IPC-gated). Staff review flagged this as a false affordance — the user clicks and nothing happens.

**Synthesized rule:** When a control is visually "live" but the wire isn't in place yet, it must give local optimistic feedback — a project-scoped override in the app store that the UI reads, to be replaced by the real mutation when the IPC lands. If optimistic update is infeasible, ship the control as `disabled` with a `Coming soon` tooltip. Stubbed onChange callbacks that do nothing violate axiom "false affordances are a bug."

**Applies to:** ux, component contracts, agent behavior

### FB-0016: Minimal sidebar — branch is tool plumbing, not persistent chrome
**Date:** 2026-04-22
**Source:** user correction

**What was said:** The workspace sidebar originally rendered `status icon + workspace name + base_branch` as three visual tokens on each row. The user pushed back: "as we move up in abstraction, is the branch important? we are minimal - only the most important information gets surfaced like this."

**Synthesized rule:** Sidebar rows for high-abstraction surfaces (workspaces, projects, recent reports) carry at most *status + identifier*. Secondary information (branch name, count, timestamp) travels in `title` attributes or hover reveals, not as persistent row chrome. If a secondary field feels load-bearing, push it into the surface itself (workspace view, home panel) rather than the nav.

**Applies to:** ux, information architecture, sidebar copy

### FB-0015: Every pane should be togglable, and rails need drag affordances
**Date:** 2026-04-22
**Source:** user direction

**What was said:** "There should be a way to toggle this sidebar on and off (this goes for all sidebars). Ideally, they would be draggable as well to different sides. We may need a drag handle indicator that should show up on hover."

**Synthesized rule:** Workspace sidebar, activity spine, and project strip are each independently togglable via keyboard shortcut (⌘[, ⌘], ⌘\\) and via an IconButton in the pane's header. Collapsed state persists per install. Every pane edge has a hover-revealed drag handle (4px wide, col-resize cursor) that currently clicks-to-toggle; when drag-to-reorder lands, the same handle anchors it. Visible state is the exception to the default (panes open); user-collapsed state is durable.

**Applies to:** ux, layout, frontend

### FB-0014: Three text sizes in app chrome, not eight
**Date:** 2026-04-22
**Source:** user correction

**What was said:** "This text feels too large — I want to do an audit of all the text styles we have. I don't think we need more than 2 or 3 sizes, and they don't have to be super different. Then we should have clear guidelines about what size gets used when." Separately: "This feels too big in relation to the standard text it's next to" (on the branch chip).

**Synthesized rule:** App chrome uses three text roles — `caption` (12px, meta/labels/kbd), `body` (16px, the default for every control/message/list-row/title), and `h3` (24px, reserved for empty-state and onboarding hero). Hierarchy inside the body band comes from `--weight-medium` and `--color-muted`, not from new intermediate sizes. The other tokens (`lead`, `h4`, `h2`, `h1`, `display`) stay in the token file for edge surfaces but must be justified if introduced to shipped UI. Codified as axiom #15.

**Applies to:** ux, typography, design-language

### FB-0013: Icon-only buttons need standard hit targets and the tooltip system must be first-class
**Date:** 2026-04-22
**Source:** user correction

**What was said:** "Make sure that click/hover targets are large enough to meet minimum accessibility standards — this one also just looks way too small. Icon buttons should have a standard target size. Also, the tooltips are good but they should show immediately on hover for all the interactive elements that have them. Also, for those with keyboard shortcuts, they should show in the tooltip."

**Synthesized rule:** Two hit-target sizes: `--target-sm` (24px, dense inline affordance) and `--target-md` (32px, the default for nav/topbar/compose icons). Every icon-only button flows through an `IconButton` component that enforces the size, carries a required tooltip label, and exposes a `shortcut` prop. Tooltips must appear immediately on hover and on keyboard focus (no delay), render in a custom popover, and render the shortcut as a right-aligned kbd. Codified as axiom #14. The HTML `title` attribute remains as a graceful fallback but new UI should reach for the `Tooltip` component.

**Applies to:** ux, a11y, component-library, design-language

### FB-0012: Monochrome (Notion/Linear register) is Designer's visual identity
**Date:** 2026-04-21
**Source:** user direction

**What was said:** During design-language elicitation, the user considered purple (Linear overlap), terracotta/orange (Claude-brand overlap), and pure red (too hot), then landed on "honestly as a tool, white/black/greyscale like Notion or Linear might be nice." Paired intensities: `calm` (default neutral) and `energized` (high-contrast for active/streaming/needs-you).

**Synthesized rule:** No chromatic accent in Designer's default palette. `--accent-*` binds to `--gray-*` in `tokens.css`. Semantic colors (`success`/`warning`/`danger`/`info`) remain chromatic because they're signal, not decoration. Introducing a chromatic accent requires amending design-language.md axiom #3 first.

**Applies to:** ux, visual identity, design-language, tokens

### FB-0011: Motion is snappy but allowed considered liveliness
**Date:** 2026-04-21
**Source:** user correction

**What was said:** Draft principle 6 said "motion is functional, not decorative." During elicitation the user amended: "snappy, but there can be some subtle fun/decoration. It should feel alive/lively and considered. This is a design tool after all. It should feel nice."

**Synthesized rule:** Motion defaults to `snappy` personality (`--motion-quick` / `--motion-standard` dominate). Small, deliberate decorative touches are welcome when they reinforce "alive on engagement" — but not gratuitous or spring-expressive. Every interaction must have a `prefers-reduced-motion` fallback.

**Applies to:** ux, animation, design-language

### FB-0010: Explore and debate before committing to implementation
**Date:** 2026-04-20
**Source:** user preference

**What was said:** Across this conversation the user repeatedly framed decisions as "let's brainstorm," "let's ideate and debate," "let's think through this," "we should not commit yet." Clarifying questions were welcomed rather than treated as friction.

**Synthesized rule:** Before implementation, surface alternatives, tradeoffs, and open questions rather than jumping to a chosen path. For exploratory questions, respond with a recommendation plus the main tradeoff and leave the user room to redirect. Ask clarifying questions when the load-bearing premise is ambiguous — do not assume.

**Applies to:** workflow, planning, conversation style, agent behavior

### FB-0009: Compliance invariants are hard constraints
**Date:** 2026-04-20
**Source:** user direction

**What was said:** The user repeatedly verified compliance framing (Anthropic ToS, OpenClaw ban, prompt-scaffolding lines) and treats the compliance invariants as non-negotiable rather than guidelines to balance.

**Synthesized rule:** The invariants in `spec.md` §5 are hard constraints, not soft preferences. A proposal that would violate any of them must be halted and surfaced to the user before proceeding. Specifically: never handle Claude OAuth tokens; never proxy Claude through a backend Designer controls; never run Claude Code off the user's machine; maintain distinct brand; never rewrite Claude's identity in prompts.

**Applies to:** architecture, auth, prompt engineering, mobile strategy, marketing

### FB-0008: Working name is Designer
**Date:** 2026-04-20
**Source:** user direction

**What was said:** After exploring Helm / Ensemble / Foundry / Score and other directions, keep the working name Designer for now.

**Synthesized rule:** Use "Designer" as the product name in docs, code identifiers, and copy. Treat it as provisional — may be renamed before public launch. Do not pre-commit to alternatives.

**Applies to:** docs, branding, code identifiers, copy

### FB-0007: Absorbed tools should feel invisible, with subtle surfacing
**Date:** 2026-04-20
**Source:** user direction

**What was said:** Forge, LLM-Auditor, and Mini should be opinionated layers that make the workflow better without the user constantly prompting. Can be pretty invisible, but we should make it clear we are making optimizations even if presentation is subtle.

**Synthesized rule:** Integrate absorbed tools as infrastructure. No dedicated "Forge panel" or "Auditor view" in the default UI. Surface their effects inline in subtle ways ("Noticed a pattern — proposing a rule", "Flagged this claim for review"). Settings screens can expose their names; everyday UI should not.

**Applies to:** ux, product-marketing, tooling

### FB-0006: Summarize by default, drill on demand
**Date:** 2026-04-20
**Source:** user direction

**What was said:** There will simply be too many agents to expect a human to keep track of. Nice to see who is working and be able to expand when the user wants. Summarize activity to the workspace level but allow clicking into deeper levels.

**Synthesized rule:** Every awareness surface shows a high-level summary by default and supports drill-in. Activity spine is the primary expression: project > workspace > agent > artifact, with local-model-maintained summaries at each level.

**Applies to:** ux, local-models, information architecture

### FB-0005: Agents can surface richly in active contexts but must not open tabs unilaterally
**Date:** 2026-04-20
**Source:** user correction

**What was said:** Agentic work surfacing in the UI isn't necessarily bad. In Claude chat, artifacts appear automatically in a preview tab. In Conductor, agent streams appear in real time. Auto-populating isn't bad, but we also can't expect the human to look at everything.

**Synthesized rule:** Four-tier attention model: **inline** (active chat, rich surfacing), **ambient** (in workspace, signals only), **notify** (elsewhere, urgent only), **digest** (offline/return, summarized). Agents never open tabs unilaterally but can stream content richly into the tab the user is currently in.

**Applies to:** ux, agent behavior, event system

### FB-0004: Panels are tabs — do not build a separate panel primitive
**Date:** 2026-04-20
**Source:** user correction

**What was said:** Should panels just be tabs, and all share the workspace's context? You could @ other panels/tabs in each other. Do you need to see two tabs at once?

**Synthesized rule:** Tabs are the sole working-surface primitive. Shared workspace context is automatic. `@` references handle linking. Split view is an ad-hoc display affordance (drag to split), not a separate concept. Do not build panels-within-tabs.

**Applies to:** ux, frontend architecture, data model

### FB-0003: Project docs live in the repo as `.md` files
**Date:** 2026-04-20
**Source:** user direction

**What was said:** Docs should primarily be md files that are committed to the codebase. Context is everything with AI, so we want as much context as possible contained in the codebase.

**Synthesized rule:** Vision, roadmap, status, and specs live as `.md` files in the repo (canonical path `core-docs/` following the project template). Designer is a view over these files. App database (SQLite) holds only app-specific state — never shadow-copies of docs that would drift. Changes to docs commit to main silently; no branch-per-tab.

**Applies to:** data architecture, frontend, agent context loading

### FB-0002: Default autonomy — suggest, do not act
**Date:** 2026-04-20
**Source:** user preference

**What was said:** My intuition would be to default to less proactive (just suggest, don't automatically act), but this should be per-project configurable.

**Synthesized rule:** Out-of-the-box behavior is to suggest work and wait for user confirmation. More proactive modes (queued tasks, automatic starts, scheduled sends) are opt-in per project. The interface for increasing autonomy must be discoverable but not pushy.

**Applies to:** ux, agent orchestration, settings

### FB-0001: Agents have role-based identities only — no human names
**Date:** 2026-04-20
**Source:** user direction

**What was said:** We are not going to give agents human names.

**Synthesized rule:** Agents are referenced by role: team lead, design reviewer, test runner, etc. No name generators, no first-name personalities. Roles may be customized per project; human naming is off the table.

**Applies to:** ux, copy, agent system

---

<!-- Add new entries above this line, newest first. -->
