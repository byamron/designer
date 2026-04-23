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

### FB-0014: Workspace is a persistent feature-level primitive, decoupled from git
**Date:** 2026-04-21
**Source:** user direction

**What was said:** During Phase 12.A planning, the user pushed back on "one workspace = one worktree = one PR" as the workspace model. Verbatim: *"I don't really accept that 1 workspace needs to be one worktree — i use this in conductor and as a non engineer, it's limiting for me because i don't think in terms of PRs. I often want to continue working in a workspace after the first PR because that workspace has my context for that feature, and feature iteration often includes multiple PRs. if i was working with a team of people, their work would not all fit into one PR. As agents get more powerful, one PR/worktree will be tiny in the grand scheme of things."*

**Synthesized rule:** The workspace is a persistent, feature-level primitive that holds context, decisions, chat history, and attention state across many PRs. It must not be coupled to any git artifact. A new primitive — **track** — sits below it and owns the git-bound state (one worktree + one branch + one agent team + one PR series per track). A workspace contains many tracks over its lifetime, sequential or parallel. The user never has to think in branches or worktrees; those surface as status details only on drill-in. This is a structural product differentiator — the manager's abstraction level above git, above sessions, above Claude's agent-teams primitive. Codified in spec Decisions 29–32 and Phase 18.

**Applies to:** architecture, data model, ux, agent orchestration, product differentiation

### FB-0013: Test infrastructure must match the product's local-first architecture
**Date:** 2026-04-21
**Source:** user correction

**What was said:** When Claude ("assistant") proposed an `ANTHROPIC_API_KEY` + `--bare` mode path for CI live-integration tests, the user rejected it: *"the proper approach is not API or openclaw model — it's conductor. this is supposed to be a wrapper on top of claude code that enables you to log into an existing subscription locally, connect it to our app, and run claude code through our UI."*

**Synthesized rule:** CI that exercises real Claude integration must use the same code path the user uses in production — user's installed Claude Code, user's OAuth-from-keychain, user's subscription. No API-key CI path (tests a different auth path than production). No service-account subscription on a cloud runner (OpenClaw-adjacent compliance risk). The correct primitive is a **self-hosted GitHub Actions runner on the user's own Mac**; workflows run locally with real `claude`, real keychain, real auth. Codified in spec Decision 33.

**Applies to:** testing, ci, compliance, architecture

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
