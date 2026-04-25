# Designer — Product Specification

This is the full product spec, architecture, UX model, compliance framing, and decisions log. Other `core-docs/` files reference this document for the source of truth.

---

## Vision

Designer is the cockpit for a new kind of product worker: a clear thinker with domain expertise who orchestrates a team of AI agents to take ideas from intent to shipped product. The user sets direction, reviews outcomes, and makes judgment calls. Agents handle execution. Git, branches, and PRs are plumbing that the user does not need to see to trust the work is happening.

Success looks like: a designer, product manager, or founder can run a full end-to-end product loop — idea, spec, wireframe, prototype, implementation, PR, shipped feature — inside one local application, without opening a terminal.

## Problem

Today, orchestrating AI agents means tab-switching between the orchestrator, project management, the repo, design tools, communication, and a terminal. Status models are tied to git primitives (PRs, branches), not to the mental model of a manager. Trust infrastructure — cost caps, approval gates, audit logs — is vibes-based. Design exploration is an afterthought in engineering-first tools.

The bottleneck has shifted from execution to three human problems: **context** (does the agent understand the goal?), **coordination** (do agents understand each other?), and **trust** (can I walk away?). These are design problems, and the tool that solves them becomes the primary interface for a new kind of work.

## Solution

A local-first macOS app that orchestrates the user's locally installed Claude Code, layered with:

- **A manager-of-agents metaphor** — persistent team lead per workspace, ephemeral subagents, role-based identities (no human names)
- **A cockpit UX** — project switcher + workspace sidebar + tab primitive + activity spine
- **A trust layer** — approval gates, cost caps, sandboxed previews, audit log, auditor integration
- **A learning layer** — Forge-style pattern detection, context optimization, digests
- **A design layer** — component lab, prototype browser, variant exploration, annotation
- **Local models for the ops layer** — audit, context, patterns, recap — so Claude tokens are spent on creative work

Claude Code is the runtime. Designer is the orchestration and workspace layer on top. We never handle Claude auth, never proxy Claude through a backend, never replace the model.

## Features

Capabilities inventory. Sequencing and status live in `roadmap.md`.

| Feature | Description |
|---|---|
| Project / workspace / track / tab primitives | Four-level hierarchy: project > workspace (persistent feature-level context) > track (bounded shipping unit, one per agent team) > tabs (surfaces). See "Workspace and Track" below. |
| Three-pane layout | Project strip + workspace sidebar + main view with tabs + activity spine |
| Home tab per project | Notion-style page: vision, roadmap, active workspaces, reports, needs-attention |
| Tab templates | Plan / Design / Build / Blank; defaults, not constraints |
| `@` reference system | Link tabs, files, agents, reports into any context |
| Claude Code team integration | Spawn agent teams, hook `TaskCreated`/`TaskCompleted`/`TeammateIdle`, observe events |
| Cross-workspace coordination | Project thread, conflict detection, shared design/roadmap state |
| Activity spine | Zoomable hierarchical status: project > workspace > agent > artifact |
| Four-tier attention model | Inline / ambient / notify / digest behavior across surfaces |
| Local-model ops layer | Audit, context optimizer, pattern detection, recaps — zero setup |
| Safety gates | Cost caps, publish/deploy/merge/prod-touch, auditor-flagged review |
| Design lab | Component catalog (Mini) + prototype browser with sandboxing + variants |
| Mobile client | Remote control for user's desktop Claude Code; light editing (phase 2) |

## Tech Stack

- **Shell:** Tauri (Rust core + WebView frontend)
- **Frontend:** TypeScript + React; Mini design system for components
- **Core logic:** Rust, Tokio async for concurrent subprocess/IO, event-sourced state
- **Persistence:** SQLite with WAL mode for app state; `.md` files in the repo for project artifacts
- **Local models:** Swift helper binary wrapping Apple Foundation Models (lightweight tasks); MLX for heavier local inference (if needed)
- **IPC:** Tauri `invoke` for UI ↔ core; JSON over stdio or XPC for core ↔ Swift helper
- **Git:** `git` binary via subprocess for worktree/branch/PR operations
- **Secrets:** macOS Keychain (never files)
- **Sync:** event-sourced protocol designed for mobile from day one

Module layout:

```
designer/
├── apps/desktop/                 # Tauri shell
├── crates/
│   ├── designer-core/            # Domain: projects, workspaces, events
│   ├── designer-claude/          # Claude Code lifecycle + team hooks
│   ├── designer-git/             # git ops, worktrees
│   ├── designer-local-models/    # MLX + Foundation Models
│   ├── designer-audit/           # Auditor rules, claim checking
│   └── designer-sync/            # Sync protocol
├── helpers/foundation/           # Swift binary
├── packages/
│   ├── ui/                       # Mini design system
│   ├── app/                      # React surfaces
│   └── shared/                   # TS types generated from Rust
└── mobile/                       # Phase 2
```

## Cost Structure

| Component | Cost | Notes |
|---|---|---|
| Claude Code usage | User's own Claude subscription or API | Designer never proxies or holds credentials |
| Local models | One-time download (MLX weights) | Optional; Foundation Models are system-provided |
| Developer infra | Code signing, notarization | Paid by maintainer |
| Hosting | None at launch | No backend; sync relay for mobile may add later |

Token economics are a defensive pillar: using local models for the ops layer (audit, context, patterns, recap) keeps Claude spend concentrated on creative work. Competitors routing every operation through Claude cannot easily match this.

## Nomenclature

- **Project** — a codebase and the ongoing effort around it (typically one repo). Owns vision, roadmap, design language, and canonical docs. Contains many workspaces.
- **Workspace** — a feature or initiative inside a project. Persistent context lives here: docs, chat history, decisions, attention state. Named after the feature, not a branch. Maps to a Linear project, Jira epic, or Linear initiative. A workspace contains many **tracks** over its lifetime.
- **Track** — a bounded unit of shipping work under a workspace. Each track owns one git worktree, one branch, one agent team, and produces one (or a small series of related) PRs. Tracks are ephemeral: when the PR lands, the track completes. Workspaces persist across many tracks — sequential (feature iteration) or parallel (divergent work toward the same goal).
- **Tab** — the working-surface primitive inside a workspace. Shares workspace context. Linked via `@` references. Split-viewable on demand.

Why this split: the unit of work is neither a PR (too narrow) nor a Linear issue (still too narrow). A feature or initiative often spans many PRs and several agents. **Workspaces decouple the manager's primitive (the feature) from the engineer's primitive (the branch/PR).** Tracks sit between them: bounded shipping units that the user can drill into but doesn't have to think about by default. As agents become more capable per turn, tracks grow while the workspace stays stable as the manager's anchor.

---

## Core Metaphor

The user is a **manager of a team of agents**. Agents have role-based identities (team lead, design reviewer, test runner). The manager sets direction, reviews outcomes, and intervenes when needed. Git, branches, PRs, worktrees are plumbing.

No human names for agents. Predictability and scalability beat personification; as the fleet grows into tens of agents, named individuals become noise.

---

## Workspace and Track

The workspace/track split is the structural move that lets Designer operate at the manager's level of abstraction while still respecting the primitives below it.

### Why two primitives, not one

A workspace is a **feature with persistent context** — the thing the user thinks and talks about ("the billing rebuild", "the onboarding overhaul"). Features outlive PRs. A single feature often ships across many PRs, over days or weeks, with interleaved design decisions, spec changes, and conversations.

A track is **one bounded unit of shipping work** — one worktree, one branch, one agent team, one PR's worth of effort. Tracks are short-lived and git-bound; workspaces are long-lived and context-bound.

This decoupling means: you never have to "open a new workspace to iterate on a feature after the first PR lands." You start another track. The workspace carries the accumulated context forward. As agents get more powerful and one turn produces more code, the track grows; the workspace stays the human-level anchor.

### How tracks relate to Claude's agent-teams primitive

Claude Code's agent-teams feature is single-cwd, single-lead, no nested teams. Each track uses the primitive fully and unmodified: one team per track, one worktree per team, one lead per team. We don't rebuild Claude's coordination — we use it at the track level and compose above it at the workspace level.

### Sequential and parallel tracks

- **Sequential** (common case): a workspace has one active track at a time. Track completes → archived as history → workspace starts the next track for the next iteration.
- **Parallel** (power case): a workspace has multiple active tracks simultaneously, each doing independent work toward the same feature. Cross-track conflict detection fires on shared files.

Default UX is sequential — most features ship that way. Parallel is available for users who need it; not the primary mental model to learn.

### Workspace lead

The workspace has a **lead** — a persistent Claude Code session scoped to the workspace. This is the user's primary interlocutor at the manager level; chatting with "the workspace" is chatting with this session.

The workspace lead is distinct from a track lead: it is a standalone Claude Code session — not itself the lead of an agent team — that orchestrates tracks via Designer's coordination layer. Track-level agent teams live below it and are spawned or dissolved as work flows.

The lead reads workspace-level context (docs in `core-docs/`, the workspace's decisions log, recaps of completed tracks digested by local models) and handles three things: manager-level conversation, track-spawning decisions ("what should we do next?"), and cross-track reconciliation ("these two tracks touched the same file — how do we resolve?"). When it determines work is needed, it asks Designer to spawn a track; when a track completes, Designer digests the output and feeds the summary back into the lead's context.

**Future direction — hybrid routing for token optimization.** A later phase may introduce selective escalation: local models (Apple Foundation Models / MLX) handle routine workspace chat (status rollups, context Q&A, recap), and the Claude session is invoked only for consequential decisions. This matches Decision 3 (local models for the ops layer) and is a structural token-cost optimization Designer can claim. v1 ships the simpler model — full Claude session at the workspace level — so the manager experience is rich from day one. The routing policy is an opt-in mode when explored (Phase 19 or later), not a default.

### Workspace forking (reserved)

A **fork** creates a sibling workspace from a common ancestor — used for variant exploration ("try approach A and approach B as parallel directions, not as pick-one"). The fork inherits the parent's docs, decisions, and chat history as a read-only baseline; from the fork point forward, both workspaces progress independently. Forks can later be **reconciled** — one absorbs the other, or one is archived, or both persist permanently.

Fork is a **Designer-level primitive**, not a git operation. It is distinct from multi-track: multi-track is parallel shipping toward one goal; forking is divergent exploration from a common baseline. A workspace can be forked *and* multi-track; the axes are orthogonal.

Fork is reserved for post-v1 implementation. The event vocabulary (`WorkspaceForked`, `WorkspacesReconciled`) is allocated now so future migration is zero.

---

## Anthropic Compliance Model

### Runtime arrangement

1. User installs Claude Code independently.
2. User authenticates Claude Code via its own login flow (`claude /login`).
3. Designer checks local availability and auth status; never participates in auth.
4. Designer invokes Claude Code as a subprocess and reads its structured events and stream output.

Designer never touches Claude credentials. Claude Code holds its own tokens; Designer is a harness around the binary, not around the auth.

### OpenClaw context

In 2026, Anthropic banned OpenClaw for using Claude.ai OAuth tokens to power programmatic workloads — subscription arbitrage. Anthropic's statement:

> "Using OAuth tokens obtained through Claude Free, Pro, or Max accounts in any other product, tool, or service — including the Agent SDK — is not permitted and constitutes a violation of the Consumer Terms of Service."

Designer is explicitly outside this line: we never take, hold, or use OAuth credentials.

### Prompt scaffolding — what we do / do not

**We do:** inject workspace/project/roadmap context, add behavioral guidance, template prompts behind UI actions, load skills and agent definitions, reformat input for model performance.

**We do not:** rewrite Claude's identity, hide the runtime, override Anthropic safety defaults, silently route prompts elsewhere. Claude is Claude; we wrap it.

### Hard invariants

- No in-app Claude.ai login UI.
- No Agent SDK as the customer-facing runtime.
- No proxying Claude through a Designer-owned cloud backend.
- Distinct brand — Designer is clearly its own product.
- Mobile (when it ships) routes through the user's desktop, never a hosted Claude.
- **Designer emits zero network traffic of its own.** All observable egress is attributable to Claude Code, the user's own git / gh operations, or a tool an agent explicitly invoked. Updater and (opt-in) crash-report are the only Designer-owned endpoints; both are user-consented and never silent.
- **The worktree is the enforcement boundary.** Designer does not sandbox Claude Code's network egress and does not proxy its traffic. We constrain what agents can *write* (via pre-write scope + approval gates in the Rust core) and surface what they *do* (via the activity spine and signed event log).
- **Enterprise-grade security is a launch requirement, not a follow-on.** Sensitive-data teams are a named target user. Risk-tiered gates — not prompt-on-everything — deliver that security without destroying the many-agents value prop. Detail in `security.md`.
- **Mobile sync is E2EE with an untrusted relay.** When the mobile client ships, no plaintext and no metadata cross the relay; pairing is explicit and verifiable.

See `security.md` for the threat model, phased implementation (13.H / 16.S / 17.T / 18), and the plain-language trust statement.

---

## Product Architecture

### Three-pane layout

```
[project strip] │ [workspace sidebar] │ [main view: tabs + activity spine]
```

- **Project strip** — Slack-style vertical icons. Cmd+K fuzzy switcher across projects, workspaces, tabs.
- **Workspace sidebar** — Conductor-style list of workspaces in the active project.
- **Main view** — active workspace with tabs and activity spine.

### Home tab (every project)

A Notion-style page with live blocks: vision (hand-edited), roadmap (AI-maintained with approval), active workspaces (live status), recent reports (agent-authored), needs-your-attention (safety gates, questions, conflicts). The Monday-morning surface.

### Tabs as the unified primitive

One primitive, not two. Every tab:

- Shares its workspace's context automatically (roadmap, active files, recent activity, project docs).
- References anything in the system via `@` — `@spec`, `@prototype`, `@team-lead`, `@report-monday`, `@workspace:onboarding`. References inject content as first-class context.
- Can be split-viewed with another tab ad-hoc (drag to split).

### Tab templates

Opening a new tab picks a template: **Plan** (chat + markdown), **Design** (prototype + component catalog), **Build** (task list + agent streams), **Blank**. Templates seed the tab; content is fully flexible after. Users can save custom layouts as templates; teams can share templates at the project level.

### Project docs live in the repo

Vision, roadmap, status, specs are `.md` files in `core-docs/`. Designer is a view over these files. App database holds only app-specific state (session IDs, UI state, audit events, approvals). Changes to docs commit to main silently. Code changes in a Build tab get a real feature branch.

---

## Agent Model

### Persistence

- **Workspace lead** — a persistent Claude Code session scoped to the workspace; the user's primary interlocutor at the manager level. Chat with "the workspace" is chat with this session. Orchestrates tracks via Designer's coordination layer (see "Workspace and Track" above). Future: hybrid routing (local models for routine chat, Claude for decisions) as a token-cost optimization.
- **Track lead + teammates** — a Claude Code agent team, one per track. The lead coordinates; teammates execute. Ephemeral: the team dissolves when the track's PR merges. Multiple tracks → multiple teams, never nested.
- **Subagents** — ephemeral helper agents within a track team; return results to their caller.
- No agent-level persistence beyond the workspace. Documentation in `core-docs/` plus the workspace's own event log provides rich enough context that a fresh track can pick up where previous tracks left off.

### One track = one Claude Code agent team

Claude Code's agent-teams feature gives us the coordination primitive: team lead, teammates with independent contexts, shared task list, mailbox, hook firing points. **One track = one team** is the exact match: single-cwd, single-lead, one bounded scope of work.

A workspace is composed of many such teams over its lifetime — sequential or occasionally parallel — but never nests them (matching Claude's "no nested teams" limitation). The workspace lead orchestrates at a level above agent-teams, using local models by default and escalating to its own Claude Code session for consequential decisions.

### Orchestrator abstraction

The Rust core defines an `Orchestrator` trait (`spawn_worker`, `assign_task`, `post_message`, `observe_events`). Claude Code agent teams are the first implementation. We do not bake Claude's task-list format into our core — we sync from it into our own data model. This future-proofs against Anthropic's iteration.

### Cross-workspace coordination

Claude Code has no project-level coordination; Designer fills the gap. Coordination operates on two axes — **reactive** (detect divergence after it starts) and **proactive** (prevent it before it starts).

**Reactive — detection + communication.**
- Workspaces read freely from shared project state (roadmap, design language, project thread, activity log).
- Team leads do not DM each other — they post to a project thread that other leads read. Auditable; keeps the user at the top of the hierarchy.
- Conflict detection flags overlapping file or intent changes to the user. Day-one version: "two workspaces touched the same file in the last 24h." Semantic-overlap v2 is backlog.

**Proactive — parallel-work coordination (Phase 20).**

When a project intends to run N workspaces or tracks in parallel toward a shared goal, the project layer analyzes contention *before* the work starts and produces a scaffold that makes the parallelism safe. Concretely:

- **Contention analyzer** — given the intended work splits, enumerate files each will touch (using `core-docs/`, recent event ownership, and per-role system prompts) and emit a contention report.
- **Scaffold generator** — for each contention zone, propose a partition: sibling modules, trait seams at shared hot spots, frozen event / IPC contracts. Emit a diff for user review.
- **Per-agent brief** — each workspace / track agent receives a scoped system prompt: "these files you own, these events you read, these hooks you stub with `TODO(…)` until the other track lands."
- **In-flight drift detection** — extends the reactive "same file, last 24h" primitive to watch for agents editing outside their assigned surface; flags immediately, not at merge time.
- **Merge-order planner** — after all agents complete, recommend integration order with rationale.
- **Auto-integration PR** — scaffold a cross-track integration test PR after the N track PRs land.

This is Designer's differentiating value at the project layer. Conductor, Crystal, and Claude Code Desktop are session-scoped — they coordinate *nothing* between parallel sessions, so users manually absorb the integration cost every time they fan out. The proactive layer is what turns "N parallel sessions" into "N coordinated teammates."

Phase 13.0 (pre-track scaffolding) executes this workflow by hand for the 13.D/E/F/G split. Phase 20 automates it.

---

## UX Model

### Four-tier attention model

| Tier | When | Behavior |
|---|---|---|
| Inline | User actively engaged with this agent | Rich auto-surface: streaming artifacts, collapsible chain-of-thought, tool-call clusters |
| Ambient | User in workspace, different tab | Badges, activity spine, optional live tray |
| Notify | User elsewhere, something matters | Inbox entries, workspace badges, OS notifications for urgent |
| Digest | User offline or returning | Batched, local-model-summarized recap |

Agents do not unilaterally open tabs. They produce artifacts and emit events; the frontend translates events into UI based on the user's current tier.

### Activity spine

A persistent hierarchical status column. Same primitive at different altitudes:

| Altitude | Each row shows |
|---|---|
| Project | Per workspace — aggregate status, active-agent count, attention flags |
| Workspace | Per agent/role — team lead, design-reviewer, test-runner |
| Agent | Per tool call or artifact — "editing `auth.ts`", "running tests" |
| Artifact | Raw content — diff, chain-of-thought, rendered preview |

Click to zoom in, back to zoom out. Local model maintains live one-line summaries per row.

State signals consistent across altitudes: active, idle, blocked, needs-you, errored.

### Interaction patterns

- **Streaming artifact preview** — inline in active chat, Claude-style.
- **Live tray** — expanded docked spine for focused watching.
- **Float-to-follow** — pin one agent's card while working elsewhere.
- **Smart digest** — home-tab slab on return: "Here's what happened."
- **Follow mode** — per-agent opt-in to auto-surface output.

### Open-app experience

Dia-style blank canvas with contextual suggestions. Each suggestion carries task + target (workspace + tab template). Populated from roadmap, recent activity, integrations.

### Autonomy defaults

**Suggest, do not act.** Per-project configurable for more proactive behavior (including scheduled-task queues). Trust is earned; the default respects that.

---

## Local Models as the Ops Layer

Not for code generation. Four roles:

1. **Audit** — live claim checking, spec completeness, off-rails detection. Absorbs LLM-Auditor.
2. **Context optimizer** — summarize, dedupe, package context for Claude efficiently.
3. **Pattern / learning** — Forge-style detection, proposes rules/skills/agents.
4. **Recap / reporting** — digests, live spine summaries, morning reports.

Zero setup. Inference runs in a separate process; never blocks the UI.

Why: token economics. Competitors routing every op through Claude cannot match this.

---

## Absorbed Tools

Three in-progress tools become opinionated layers:

- **Forge** → learning layer.
- **LLM-Auditor** → trust layer's first primitive.
- **Mini design system** → cohesion substrate for all AI-generated UI and the product itself.

Mostly invisible. Subtle surfacing confirms the system is optimizing ("Noticed a pattern — proposing a rule"), but names and internals stay behind the curtain.

---

## Safety and Security

- **Approval gates** enforced in Rust core, not frontend. Non-bypassable. Defaults: cost cap, merge, publish, deploy, prod-config touch.
- **Auditor-flagged items** may require human review before a completion claim is accepted.
- **Append-only audit log** — every agent action recorded, user-viewable.
- **Sandboxed HTML previews** — strict CSP, iframe sandbox. Agents can produce hostile HTML; never runs in a trust context.
- **Secrets in Keychain**.
- **Tauri allowlist** — frontend can only do what Rust explicitly exposes.
- **Signed and notarized** builds, no silent auto-update.

---

## Mobile Strategy

- Data layer is event-sourced and sync-ready from day one.
- Mobile client ships later (build step 10).
- Mobile = remote control for user's desktop Claude Code. Never cloud-hosted.
- Light editing only: review reports, redirect agents, approve/reject gates. Full parity is not a goal.

---

## Strategic Moat

The moat is **workflow, opinion, and trust** — not the model. This gets stronger as models improve.

Defensible territory:

1. Non-technical operator cockpit — Anthropic targets developers.
2. Multi-agent coordination primitives — project-level state, cross-workspace, conflict detection. Anthropic explicitly does not ship these.
3. Trust and safety infrastructure — not Anthropic's R&D focus.
4. Design and iteration surfaces — outside Anthropic's lane.

---

## Non-Goals

- Replace Claude Code with a custom runtime.
- Offer Anthropic login or subscription access in-app.
- Depend on Anthropic API credits as the business model.
- Recreate Figma-level vector design. Canvas belongs to Paper/Pencil; we own component-lab and prototype-browser surfaces.
- Hosted multi-tenant cloud agent service.
- Human-named agent personas.

---

## Open Questions

- Exact canonical path for non-core-docs project artifacts inside the user's own projects (Designer uses `core-docs/` for itself). Likely the same pattern per project.
- Depth of conflict-detection beyond v1 ("same file, last 24h"). Semantic overlap is a v2 investment.
- Swift ↔ Rust IPC protocol for the Foundation Models helper (JSON over stdio vs XPC).
- Multi-repo project model (if needed). Defer until a second-repo use case appears.
- Which tab-template presets to ship vs add later. Plan / Design / Build / Blank is the starting set.

---

## Decisions Log

Chronological record of architectural and product decisions. Replace the entry, not the history, when a decision changes.

| # | Decision | Why |
|---|---|---|
| 1 | Tauri over Electron | Better subprocess/PTY under load, much smaller footprint, stronger security defaults. Slower first-time dev loop accepted. |
| 2 | Rust core + TS/React frontend + Swift helper | Rust is right for orchestration and subprocess work. React reuses Monaco/Mermaid/markdown ecosystem. Swift helper unlocks Foundation Models without Swift-everything. |
| 3 | Local models for ops layer only | They cannot replace Claude for building but are good enough for audit, context optimization, patterns, recap — saving Claude tokens for creative work. |
| 4 | Non-technical operator as primary user | As AI automates more code, the defining skill moves to direction and judgment. Under-served audience; strategically defensible. |
| 5 | Project / Workspace / Tab nomenclature | PRs and Linear issues are too narrow; features span multiple PRs. Workspace matches the unit of work people actually plan at. |
| 6 | Manager-of-agents metaphor | Scales as the fleet grows. Names the user's role (direction) and agents' role (execution) without jargon. |
| 7 | Role-based agent identities, no human names | Human names become noise at scale. Roles compose and self-describe. |
| 8 | One Claude Code agent team per **track** (not per workspace) | Matches our bounded-work primitive (track) to Claude's single-cwd coordination primitive (agent team). Workspaces contain many tracks over their lifetime. Avoid rebuilding coordination. Supersedes the prior "one team per workspace" framing. |
| 9 | Abstract `Orchestrator` trait | Anthropic will iterate. Interface isolation lets us swap backends. |
| 10 | Cross-workspace coordination via project thread, not DMs | Keeps user at top of hierarchy. Auditable. No invented inter-agent protocol. |
| 11 | Tabs as views, not modes (amended 2026-04-24) | Plan / Design / Build as template-per-tab added cognitive overhead without payoff — users had to pick a mode before they could work. Phase 13.1 collapses the three into one continuous `WorkspaceThread` surface with inline typed artifact blocks. Additional tabs remain openable but they're lenses onto the same artifact pool (side thread, agent lens, split pane), not different modes. See Decisions 36–39. |
| 12 | Templates, not types (superseded by Decision 36) | Kept for history. 13.1 retires the template picker entirely — every new tab is a thread. |
| 13 | `@` references as the linking system | Explicit references give agents better context than screen adjacency. |
| 14 | Four-tier attention model | Rich where engaged, progressive summarization elsewhere. Respects scale. |
| 15 | Agents never open tabs unilaterally | Decouples agents from frontend state. IC-to-manager metaphor preserved. |
| 16 | Activity spine as core awareness primitive | Zoomable hierarchy. Same primitive at every altitude. |
| 17 | Project docs as `.md` in repo | Codebase becomes self-describing. Diff-friendly. Survives DB wipe. |
| 18 | Docs commit silently; no branch-per-tab | Avoids branch explosion. Keeps manager metaphor intact. |
| 19 | Default autonomy: suggest, do not act | Trust is earned. |
| 20 | Mobile: event-sourced from day one, client later | Data decisions are hardest to reverse; UI shipped second. |
| 21 | Mobile = remote control, never cloud-hosted Claude | Compliance invariant. |
| 22 | Approval gates in Rust core | Non-bypassable. Frontend compromise cannot bypass safety. |
| 23 | Sandbox HTML previews | Agents can produce hostile HTML. Strict CSP + iframe sandbox. |
| 24 | Absorb Forge / LLM-Auditor / Mini as invisible layers | Map directly to learning / trust / cohesion pillars. Subtle surfacing confirms optimization. |
| 25 | Prompt scaffolding: context injection yes; identity rewriting no | Claude is Claude. |
| 26 | Designer never touches Claude OAuth tokens | Anti-OpenClaw compliance invariant. Claude Code holds its own credentials. |
| 27 | Working name: Designer | Simple, evokes target user, easy to change later. |
| 28 | Core docs follow byamron/project-template | Consistent structure across projects. `core-docs/` for Designer's own docs; same pattern recommended for user projects. |
| 29 | Workspace is a persistent feature-level primitive, decoupled from git | Managers think in features, not PRs. A workspace survives many PRs; it holds the context, decisions, and conversation. As agents produce more per turn, a worktree/PR will be small relative to a feature's scope — the workspace must be the stable anchor above it. Reframes "workspace = worktree" from the pre-track model. |
| 30 | Track introduced as the git-bound unit below workspace | A track = one worktree + one branch + one agent team + one PR series. Tracks are ephemeral; workspaces persist across many tracks. Matches Claude Code's agent-teams primitive at the track level (single-cwd) and leaves room above for multi-track orchestration. |
| 31 | Workspace lead is a persistent Claude Code session; hybrid routing reserved as future token-optimization | v1 keeps the manager-level interface simple and rich: chat with the workspace is chat with a Claude session that reads context, orchestrates tracks, and handles manager-level decisions. A future phase may introduce selective escalation (local models for routine chat; Claude only for consequential decisions) as a token-cost optimization matching Decision 3. Reserved as Phase 19-or-later exploration, not v1. |
| 32 | Workspace forking reserved for future; event vocabulary allocated now | Forking = sibling workspace from a common ancestor for variant exploration. Orthogonal to multi-track. Not v1; adding `WorkspaceForked` / `WorkspacesReconciled` event types now keeps future implementation a zero-migration change. |
| 33 | Self-hosted GitHub Actions runner for live Claude integration tests | Mirrors the product's local-first architecture: tests run on user's Mac against user's Claude Code install with user's auth. No API-key CI path (would test a different code path than production); no service subscription (would invite OpenClaw-adjacent compliance risk). Compliance-clean and fidelity-matched. |
| 34 | Fleet-scale usage: rely on Anthropic's own signals; no Designer-imposed caps | Designer's workspace/track model encourages running ~10–12 concurrent tracks (Conductor-scale power-user norm) which is well within intended use for Max-tier subscriptions. Anthropic publishes 5-hour session limits (Pro ~40 msgs, Max 5x ~225, Max 20x ~900) and weekly compute-hour caps (Pro ~40–80 Sonnet hours, Max up to ~480), and Claude Code itself emits warning messages as capacity depletes. Designer surfaces those signals — a topbar usage chip (toggleable in settings, off by default) and ambient notices when approaching known thresholds — without building parallel tracking, tier detection, or concurrency caps. Conservative default: one active track per workspace; parallel tracks are opt-in (matches Decision 19). |
| 35 | Parallel-work coordination is a first-class project-level primitive | Session-scoped tools (Conductor, Crystal, Claude Code Desktop) coordinate nothing between parallel sessions; users absorb the integration cost manually. Designer's project layer owns proactive coordination: analyze contention *before* work starts, partition files and freeze contracts via a scaffold PR, emit per-agent briefs with scoped file ownership, detect drift in-flight (not at merge), and plan merge order. Manual v1 of this workflow is Phase 13.0 (the pre-track scaffold for 13.D/E/F/G); automation is Phase 20. Complements the existing reactive detection primitive (spec §"Cross-workspace coordination"). |
| 36 | Workspace thread is one continuous surface with typed artifact blocks | Every event an agent or user produces — messages, specs, code-change batches, PRs, approvals, reports, comments — lives as a typed block in a single scrollable thread. No more Plan/Design/Build split. Replaces "templates, not types" (Decision 12). Phase 13.1 ships the foundation; D/E/F/G/H emit into it. |
| 37 | Three-tier artifact presence: inline / pinned / on-demand | An artifact starts inline in the thread (where it was produced). The user can pin it to the workspace rail for persistent quick access. Everything else stays reachable via artifact search + the project-level timeline, but is not surfaced by default. Respects the "summarize by default, drill on demand" principle without hiding anything. |
| 38 | Block renderer registry is the UI contract tracks emit against | `registerBlockRenderer(kind, Component)` — tracks never touch UI code. They emit `ArtifactCreated { kind, payload }` events; the registry resolves the right renderer. New kinds land with a PR that adds the renderer alongside the emitter. Unknown kinds fall through to `GenericBlock` so replay never crashes. |
| 39 | Semantic summaries are written once, at write time | When an artifact is appended, `LocalOps::summarize_row` generates its summary and stores it on the event. The rail and collapsed-block views always read the stored summary; never regenerate on read. Per-track debounce coalesces bursts of edits into one summary call. Ships empty until Phase 13.F wires the local-model helper. |
