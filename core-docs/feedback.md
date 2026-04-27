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

### FB-0032: Filepath inputs default to a native picker, never plain text
**Date:** 2026-04-26
**Source:** user correction (first-real-build dogfood, PR #24 follow-up)

**What was said:** The CreateProjectModal asked the user to type the project folder path into a text input ("~/code/my-project"). Reaction: "i need a file picker here to my finder/desktop — nobody should ever need to type in the full filepath (we should be catching UX issues like this — log in feedback)."

**Synthesized rule:** Any UI that asks for a filesystem path must front a native picker (Finder folder/file dialog on macOS) as the primary affordance. A text input is acceptable only as a fallback for power-users — never the only way in. Generalize: "manager, not engineer" extends to *every* input modality — if there is a native OS affordance for the data we're asking for, the user should never have to type the literal value. Audit the rest of the app for the same pattern (color, file paths, dates, etc.) when adding new forms; flag during PR review the moment a free-text field implies "the user knows the literal syntax."

**Applies to:** ux, code (every modal/dialog with a filesystem-path field)

### FB-0031: Cache "in-flight" separately from "resolved" — concurrent callers must share one round-trip
**Date:** 2026-04-25
**Source:** review feedback (Phase 13.F PR #18)

**What was said:** First-pass `SummaryDebounce` stored only resolved values. Two callers 100ms apart over an 800ms helper each saw cache-miss and dispatched their own helper request. Reviewer flagged it as a blocking debounce-burst race.

**Synthesized rule:** Any "expensive call coalesces under a key" cache must distinguish *resolved* from *in flight*. Subsequent callers within the window subscribe to the in-flight future (e.g., a `tokio::sync::watch::Sender<Option<T>>`) instead of starting their own. Eviction policy: never drop an in-flight slot — its receivers would error. Tested with a deliberate concurrent-burst case; default `helper.call_count() == N` is the regression signal.

**Applies to:** rust-core, performance, local-models

### FB-0030: Cross-workspace boundaries belong on the IPC, not in-memory
**Date:** 2026-04-25
**Source:** review feedback (Phase 13.F PR #18)

**What was said:** First-pass `cmd_audit_artifact` took only `artifact_id`; a misbehaving caller could land an audit comment in any workspace by passing a foreign artifact id. Reviewer flagged the missing boundary check as blocking.

**Synthesized rule:** When an IPC writes to a workspace stream derived from request data (artifact id → artifact's workspace_id), the request must carry the caller's `expected_workspace_id` and the implementation must reject mismatches. Don't rely on the frontend "knowing" — the boundary is a server-side invariant. Future-proofs the seam for per-workspace authorization (13.G).

**Applies to:** rust-core, ipc, safety

### FB-0029: Modal scrim dismisses on click, not mousedown
**Date:** 2026-04-25
**Source:** review feedback (Phase 13.E hardening)

**What was said:** The first cut of `RepoLinkModal` used `onMouseDown` on the scrim — a drag that started inside the dialog content and ended on the scrim would surprise-dismiss the modal mid-edit.

**Synthesized rule:** Use `onClick` for scrim-dismiss on every modal. `click` only fires when mousedown and mouseup land on the same element, so a text-selection drag that crosses out of the dialog will not trigger dismissal. Pinned with a vitest case so this can't quietly regress.

**Applies to:** ux, code (every modal in the app)

### FB-0028: Frontend modals must trap Tab focus
**Date:** 2026-04-25
**Source:** review feedback (Phase 13.E hardening)

**What was said:** `RepoLinkModal` had `aria-modal="true"` but Tab still escaped into the AppShell behind the scrim, breaking the `aria-modal` contract.

**Synthesized rule:** Every modal that ships with `aria-modal="true"` must also implement a Tab/Shift-Tab focus trap. The "collect focusables → cycle on first/last" pattern in `RepoLinkModal.collectFocusable` is the canonical implementation; it skips `inert` and `aria-hidden` (jsdom-compatible — do not filter on `offsetParent`). Reuse / lift to a hook the next time we add a modal.

**Applies to:** ux, code, a11y

### FB-0027: Backend hardening — bound subprocesses, validate inputs, dedupe action commands
**Date:** 2026-04-25
**Source:** review feedback (Phase 13.E hardening)

**What was said:** Three classes of bug surfaced in the initial 13.E build: (1) `gh pr create` was unbounded — a stalled network would hang the UI indefinitely; (2) branch names flowed straight into `git worktree add -b <name>` without validation, opening an argument-injection vector when a name starts with `-`; (3) rapid double-clicks on Request Merge would race two `gh pr create` calls instead of deduplicating.

**Synthesized rule:** Three durable rules for every IPC handler that fans out to a slow side-effecting subprocess:

1. **Bound the subprocess** with `tokio::time::timeout(Duration, …)`. Test-overridable via a process-global slot so tests run in milliseconds. On timeout, leave projected state untouched so the user can retry; never half-commit.
2. **Validate every string** that becomes a command argument. Fail-closed at the IPC boundary on leading `-`, whitespace, control chars, and tool-specific metacharacters. Don't trust git to reject — git will, but error messages from "argument injection that happened to fail" are useless to the user.
3. **Idempotent commands use an in-flight set** (`Mutex<HashSet<Key>>` + RAII drop-guard). Same shape applies to approval-grant in 13.G.

**Applies to:** code, security, architecture

### FB-0026: Live dev-panel knobs are how Designer's surface register gets tuned
**Date:** 2026-04-24
**Source:** user direction (design loop)

**What was said:** Across multiple iterations on the floating-surface tokens (compose fill, main-tab fill, surface sand, tab opacity, border intensity, shadow intensity, tab corner variant, main tab radius, compose radius), the user repeatedly preferred *adding a slider* over *picking a value*. Quote: *"can we add a segmented toggle to the dev panel where we try all of these options"* — the tab-corner variant toggle. And: *"add main tab container border radius and compose box border radius to the dev panel."*

**Synthesized rule:** Whenever a surface-register decision has more than two plausible answers, the right move is a `SurfaceDevPanel` slider/toggle backed by a `--dev-*` CSS variable, rather than picking one and shipping. The slider is the design tool — production defaults are baked in only after the user has dialled the value live. This is FB-0022 ("bake dev-panel explorations into the design language when they land") generalized: the dev panel is the canonical mechanism for design exploration, not just an occasional escape hatch. Confirmed by the working pattern across this PR (six knobs + a tab-corner variant toggle, then production defaults baked in to match the user's chosen config).

**Applies to:** ux, design-system, workflow

### FB-0025: Three-tier artifact presence — inline, pinned, on-demand
**Date:** 2026-04-24
**Source:** user direction

**What was said:** *"artifacts that might get created: specs, wireframes, reports, diagrams, then all code file changes and diffs… there is value in Conductor's file tree for people who want to dig in, but I also don't think we should show this by default since we are moving up in abstraction. Things like this should be available, but we shouldn't push them on the user."* And: *"pinned artifacts at the top, but maybe above that one line with the team-lead active / agent status."*

**Synthesized rule:** Artifacts have three visibility tiers. Inline — where they're produced (in the thread at write time). Pinned — user-promoted, lives in the workspace rail alongside agent status. On-demand — reachable via search, project-level timeline, and the engineering drawer; never pushed in chrome. This maps directly to the four-tier attention model (FB-... / Decision 14): the thread body is "focused," the rail is "ambient," and the engineering drawer is "notify + digest." Codified in spec Decision 37. The rail renders pinned artifacts above the agent tree so pins act as the user's working context shelf, not an afterthought below activity.

**Applies to:** ux, product, architecture

### FB-0024: Tabs are views, not modes — one workspace surface, typed artifact blocks inline
**Date:** 2026-04-24
**Source:** user direction

**What was said:** *"The original idea was just that there were three types of tabs to add to any workspace. I agree with the idea of folding everything into one surface type. But is there still value in being able to have multiple tabs in a workspace? … Could that be a new tab, or would we want to surface those as artifacts somewhere else?"* And later: *"tabs are no longer 'plan' / 'design' and the artifacts can be used throughout new tabs (tabs are views, not modes)."*

**Synthesized rule:** Designer does not ship separate Plan / Design / Build tab types. Every tab in a workspace renders the same `WorkspaceThread` surface: a continuous scroll of typed artifact blocks (spec, code-change, PR, approval, report, prototype, comment, task-list, diagram, variant, track-rollup, message) produced by agents and the user. Additional tabs still open, but they are lenses — side threads scoped to a different thread id, artifact lenses, or split panes — not different modes. A new tab = blank thread with compose input + starter suggestions. The user never picks a mode before they can work. Codified in spec Decision 11 (amended) and 36.

**Applies to:** ux, product, architecture

### FB-0023: Enterprise-grade security is a launch requirement, not a follow-on
**Date:** 2026-04-23
**Source:** user direction

**What was said:** *"I want to make sure that we are planning for enterprise tool grade security as we prepare to launch this product. individuals and teams with sensitive data need to be able to rely on this. we as the builders shouldn't be able to see any of their code or requests (those should just run through the local claude on their machines) and the app should store local data to feed local llms etc, but we shouldn't collect data from users."* On follow-up: *"by enterprise grade, i mean a tool that companies would be comfortable with their employees using, given the existing scope that we've defined."* Also: *"remove any commitment to open source — we have not decided this yet."*

**Synthesized rule:** Sensitive-data teams are a named target user, not a post-launch segment. "Enterprise-grade" means *a tool companies are comfortable letting their employees use on sensitive work*, given Designer's existing scope as a local-first, per-user desktop cockpit for the user's own Claude Code install. It does **not** mean identity-federation (SSO/SAML/SCIM) — Designer does not host user accounts. It means the security *properties* a company's IT or security team evaluates before approving the tool. No commitments to open-sourcing the codebase appear anywhere in the docs until the user makes that business decision. Security work is folded into GA, ship, and team-tier gates — not deferred to a separate hardening phase. The operating principles:

- **Zero network traffic from Designer itself.** Every observable egress must be attributable to Claude Code, the user's own git / gh operations, or a tool an agent explicitly invoked. Updater and opt-in crash-report are the only Designer-owned endpoints and both require user consent.
- **Worktree is the enforcement boundary.** We constrain what agents *write* (pre-write scope + approval gates in Rust core) and surface what they *do* (activity spine, signed event log). We do *not* sandbox Claude's network egress or strip prompt-injection patterns from repo content — both would break the product.
- **Risk-tiered gates, not prompt-on-everything.** The many-agents value prop dies under approval fatigue. Irreversible-or-cross-org actions get Touch ID; routine writes get in-app approval; first-use-per-tool gets a per-track capability grant. Approval density scales with blast radius.
- **Credibility via pentest, not SOC 2 theater.** Independent third-party pentest + plain-language trust statement ship with the first signed DMG. SOC 2 is reactive to named enterprise deals, not pursued preemptively.
- **Tamper-evidence at GA, not at team-tier.** If we claim sensitive-data teams can rely on Designer at launch, the event log must actually be tamper-evident at launch (HMAC chain + periodic anchor).

Codified in spec §5 (new hard invariants) and `security.md` (threat model, 13.H / 16.S / 17.T / 18 phase tranches, plain-language trust statement).

**Applies to:** architecture, product, roadmap, launch positioning, ux (approval flows), compliance

### FB-0022: Bake dev-panel explorations into the design language when they land
**Date:** 2026-04-23
**Source:** user direction

**What was said:** After ~24 hours of tuning the surface register behind a live dev panel (gutter / tab-gap / compose-pad / shadow / tab-style), the user landed on values and said "lock in the config and get rid of this dev panel for now." The knob pattern itself was successful — we reached the right values faster than staff guesswork would have.

**Synthesized rule:** Live dev panels are a legitimate design tool during contentious token/layout decisions. Ship them behind `MODE === "development"`, let real use decide, then retire them and bake values into `app.css` / `tokens.css`. Don't leave dev panels mounted in prod; don't scrap them prematurely before a decision has earned the right to ship.

**Applies to:** workflow, design tooling, token system

### FB-0021: Content surface should invert by mode, not stay "raised" in both
**Date:** 2026-04-23
**Source:** user direction

**What was said:** On seeing a dark-mode render with the surface one step brighter than the page (Slack / Linear convention), the user asked for "off-black" in dark mode — main surface darker than the sand sidebars. Light stays white on sand.

**Synthesized rule:** `--color-content-surface` is `white` in light and `var(--gray-1)` (sand-dark-1) in dark — brightness direction inverts by mode. Both readings honor "this is the work, that is chrome"; the polarity just flips. Other surface roles (`--color-surface-flat/raised/overlay`) stay monotonic (brighter-than-background in both modes) because they're secondary containers, not the main figure.

**Applies to:** ux, color, design-language

### FB-0020: Match Radix Colors v3's activation model — class, not prefers-color-scheme
**Date:** 2026-04-22
**Source:** user correction

**What was said:** User's system was in dark mode but the app rendered light. The `@media (prefers-color-scheme: dark)` override was firing, but Radix Colors v3 (`sand.css` / `sand-dark.css`) activates scales only via `.dark` / `.dark-theme` classes. So `--color-content-surface: var(--gray-3)` resolved to light-mode sand-3 (warm beige), tinting the surface.

**Synthesized rule:** Theme-dependent CSS overrides MUST use the same activation signal as Radix — `.dark` / `.dark-theme` (and Designer's `[data-theme="dark"]` escape hatch). Do not rely on `@media (prefers-color-scheme)` alone; the two systems don't talk. The inline zero-flash script in `index.html` applies both the class and `[data-theme]` synchronously so the first paint is consistent.

**Applies to:** theming, dark mode, css architecture

### FB-0019: No hidden false affordances — even during Phase-gated rollouts
**Date:** 2026-04-23
**Source:** review feedback

**What was said:** HomeTabA's Autonomy SegmentedToggle shipped with a stub `onChange: () => {}` because the real mutation is Phase-13 (IPC-gated). Staff review flagged this as a false affordance — the user clicks and nothing happens.

**Synthesized rule:** When a control is visually "live" but the wire isn't in place yet, it must give local optimistic feedback — a project-scoped override in the app store that the UI reads, to be replaced by the real mutation when the IPC lands. If optimistic update is infeasible, ship the control as `disabled` with a `Coming soon` tooltip. Stubbed onChange callbacks that do nothing violate axiom "false affordances are a bug."

**Applies to:** ux, component contracts, agent behavior

### FB-0018: Minimal sidebar — branch is tool plumbing, not persistent chrome
**Date:** 2026-04-22
**Source:** user correction

**What was said:** The workspace sidebar originally rendered `status icon + workspace name + base_branch` as three visual tokens on each row. The user pushed back: "as we move up in abstraction, is the branch important? we are minimal - only the most important information gets surfaced like this."

**Synthesized rule:** Sidebar rows for high-abstraction surfaces (workspaces, projects, recent reports) carry at most *status + identifier*. Secondary information (branch name, count, timestamp) travels in `title` attributes or hover reveals, not as persistent row chrome. If a secondary field feels load-bearing, push it into the surface itself (workspace view, home panel) rather than the nav.

**Applies to:** ux, information architecture, sidebar copy

### FB-0017: Workspace is a persistent feature-level primitive, decoupled from git
**Date:** 2026-04-21
**Source:** user direction

**What was said:** During Phase 12.A planning, the user pushed back on "one workspace = one worktree = one PR" as the workspace model. Verbatim: *"I don't really accept that 1 workspace needs to be one worktree — i use this in conductor and as a non engineer, it's limiting for me because i don't think in terms of PRs. I often want to continue working in a workspace after the first PR because that workspace has my context for that feature, and feature iteration often includes multiple PRs. if i was working with a team of people, their work would not all fit into one PR. As agents get more powerful, one PR/worktree will be tiny in the grand scheme of things."*

**Synthesized rule:** The workspace is a persistent, feature-level primitive that holds context, decisions, chat history, and attention state across many PRs. It must not be coupled to any git artifact. A new primitive — **track** — sits below it and owns the git-bound state (one worktree + one branch + one agent team + one PR series per track). A workspace contains many tracks over its lifetime, sequential or parallel. The user never has to think in branches or worktrees; those surface as status details only on drill-in. This is a structural product differentiator — the manager's abstraction level above git, above sessions, above Claude's agent-teams primitive. Codified in spec Decisions 29–32 and Phase 19.

**Applies to:** architecture, data model, ux, agent orchestration, product differentiation

### FB-0016: Test infrastructure must match the product's local-first architecture
**Date:** 2026-04-21
**Source:** user correction

**What was said:** When Claude ("assistant") proposed an `ANTHROPIC_API_KEY` + `--bare` mode path for CI live-integration tests, the user rejected it: *"the proper approach is not API or openclaw model — it's conductor. this is supposed to be a wrapper on top of claude code that enables you to log into an existing subscription locally, connect it to our app, and run claude code through our UI."*

**Synthesized rule:** CI that exercises real Claude integration must use the same code path the user uses in production — user's installed Claude Code, user's OAuth-from-keychain, user's subscription. No API-key CI path (tests a different auth path than production). No service-account subscription on a cloud runner (OpenClaw-adjacent compliance risk). The correct primitive is a **self-hosted GitHub Actions runner on the user's own Mac**; workflows run locally with real `claude`, real keychain, real auth. Codified in spec Decision 33.

**Applies to:** testing, ci, compliance, architecture

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
