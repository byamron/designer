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
