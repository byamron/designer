# Critique: what's fragile, what's risky, what to validate

This is the **risk register and counter-argument record** for Designer's strategic direction. Read this alongside `rationale.md` — each concern below is something I'd want resolved (or explicitly accepted as a known risk) before committing significant engineering time to the rewrite.

The point of this doc is not to disagree for the sake of disagreement. It is to **make every fragile claim visible** so the team can either validate it, accept it as a known risk, or reshape the direction in response to it. A strategy that survives this critique is more bulletproof than one that doesn't have to.

Tiers indicate severity of the risk to the overall direction:

- **Tier 1**: existential — if this is wrong, the direction is wrong.
- **Tier 2**: significant — affects scope, sequencing, or specific bets but not the overall direction.
- **Tier 3**: worth tracking — not load-bearing now, could become so.

Each concern names a *validation task*: a specific, cheap-to-do investigation that would either resolve or sharpen the concern.

---

## Tier 1 — most serious

### 1.1 The user IS the dogfood. The personas are at-risk of being a sample of one with name changes.

**The concern.** Maya in `core-docs/research/personas.md` is the project lead, lightly disguised. Jordan and Sam are theoretical projections of *"what Maya would be if she were on a team"* or *"what Maya would be if she weren't a trained designer."* Without validation from non-dogfood users, the entire persona basis could be elegant elaboration of one person's frustration pattern.

Every claim about cross-persona patterns ("they all share the compounding problem," "they all feel the attention squeeze," "they all describe the convergence-to-mean failure mode") is currently *one user reporting their own pain and extrapolating.*

**Why this matters.** Every strategic refinement we've done sits on top of the persona work. If the personas don't generalize, *the strategic refinement doesn't generalize either.* This is the foundational risk, not a peripheral one.

**Counter-argument.** The discourse-convergence evidence in `rationale.md §6` provides *some* external validation — multiple writers and researchers are naming the same problem space the personas describe. But discourse-convergence is not the same as user-validation. A pain that's in the discourse is not necessarily the *dominant* pain for any one user; it's just a pain that *some* users feel.

**Validation task.** Have 3+ conversations with people who fit the secondary personas — not formal interviews, just 30-minute calls. Specifically:
- A designer-founder of a non-SaaS consumer app (Maya analog, not Maya).
- A design lead at a 50–100-person company with active AI agent use (Jordan analog).
- An AI-coding-fluent indie maker with strong product instincts but not formal design training (Sam analog).
Ask each: *what is the actual hardest part of working with AI agents this week?* If they describe convergence-to-mean and judgment-not-sticking, the personas are validated. If they describe something else (bug rate, cost overruns, integration breakage, agent confusion on edge cases, lack of capable agents at all), the direction needs reshaping.

**What would change my confidence:** even one of the three describing pain in different terms than the personas suggest would meaningfully lower confidence. Three describing it the same way would meaningfully raise it.

---

### 1.2 The codification engine's distill step is the load-bearing hard problem, and we've assumed it's solved.

**The concern.** The drain → distill → propose → propagate loop has one genuinely hard piece in the middle: **taking N specific redirections and generalizing them into a usable principle.** The user says *"this celebration feels wrong"* three times across different features. The distill step needs to produce something like *"empty states do not celebrate — use the next action instead."*

That generalization step is:
- An open ML / prompt-engineering problem — it is not robustly solved by current models.
- Highly sensitive to false positives — a bad codification propagates to all agents and degrades all future output. The cost of getting this wrong is high.
- Hard to evaluate — there is no objective ground truth for "this codification is right."
- Per ADR Decision #3, run by *local models first* — which means we're using *weaker* models for the hardest part of the loop.

**Why this matters.** If distill produces noise, the whole "compounding judgment" claim collapses. The user's redirections accumulate but don't generalize into useful stances. Without working distill, codification docs *get worse over time* (noise accumulates), not better.

**Counter-argument from `rationale.md`.** *"The primitive already exists in working form"* as the Mini taste-loop. **This claim is overstated.** The Mini taste-loop works for *one user* (the project lead) doing *careful manual curation.* The skill files (`drain-feedback`, `distill-feedback`, `propagate-language-update`) document the *human procedure*; the auto-loop is unbuilt. *Saying "exists in working form" implies the engineering is mostly done; it is not.*

**Validation task.** Prototype the distill step:
- Pull 30–50 real redirection examples from the project lead's own GitHub PR history, Linear comments, Figma threads.
- Run a local model (Foundation Models / MLX) and Claude on each, with the explicit task: *"from these N specific critiques, propose a generalizable principle for the project's voice/principles/decisions docs."*
- Evaluate the output against a held-out set of 5–10 examples where the project lead has *already* manually codified the principle (the existing `design-language.md`, `feedback.md` entries).
- Track: how often is the proposed principle (a) useful and correct, (b) directionally right but needs editing, (c) wrong or misleading?

**What would change my confidence:**
- If the local model produces usable output >60% of the time and the failure cases are *clearly worse-than-nothing* rather than *confusingly wrong*, the risk is manageable.
- If output is usable <40% of the time, **the codification engine is not v1-shippable** and the entire strategy needs to either (a) lean on Claude (cost implications), (b) lean on heavier human curation (UX implications), or (c) defer codification as a manual-only primitive in v1.
- If Claude does meaningfully better than the local model, the architecture needs to revisit Decision #3 for this specific step.

**Estimated effort:** 1–2 days of focused work.

---

### 1.3 Spec-drift tools handle living specs better than acknowledged. The overlap with Designer's codification primitive is larger than the rationale claims.

**The concern.** Recent research on Augment Intent, Kiro (AWS), Tessl, and GitHub Spec Kit reveals these tools handle mid-flight spec changes well:

- **Intent (Augment)**: living spec; when requirements change mid-run, propagates to agents that haven't started tasks yet. Three human gates (spec approval, task decomposition, final diff). [(Augment Intent docs)](https://docs.augmentcode.com/intent/overview)
- **Kiro (AWS)**: explicitly iterative. *"Users aren't locked into initial decisions — they can refine requirements, update designs, reorder tasks, and checkpoint progress throughout the workflow."* Uses automated reasoning to validate requirements consistency and surface gaps as two-option questions. [(Kiro — Specs just got faster and smarter)](https://kiro.dev/blog/faster-smarter-specs/)
- **Tessl**: agent pauses for review, builds against documented requirements, **then updates specs with anything discovered during development.** Bidirectional. Specs are markdown files (`.spec.md`) with YAML frontmatter. Annotations like `[@generate]` and `[@describe]` make the human/agent contract explicit. [(Tessl — Spec-Driven Development with Tessl)](https://docs.tessl.io/use/spec-driven-development-with-tessl)
- **GitHub Spec Kit**: *"SDD transforms requirement changes from obstacles into normal workflow. Pivots become systematic regenerations rather than manual rewrites. Changes are additive (clarifications, refinements) rather than destructive."* Workflows are YAML-defined, multi-step, resumable, with explicit human review gates. [(GitHub Spec Kit)](https://github.com/github/spec-kit) [(Spec-Driven Development Workflow — DeepWiki)](https://deepwiki.com/github/spec-kit/5-spec-driven-development-workflow)

**This is substantially closer to Designer's codification primitive than the previous research report acknowledged.** All four use markdown files in the repo as source of truth, have human approval gates, treat specs/codifications as *living artifacts*, and propagate changes to agents.

**Why this matters.** The distinction the positioning draws — *technical-spec* (their lane) vs. *taste-spec* (Designer's lane) — is real but architecturally soft. Three follow-on risks:
- **They could expand upward.** A `voice` or `principles` schema convention in Tessl or Kiro could happen any quarter. They have engineering teams full-time on spec primitives.
- **Users may not separate the concerns.** *"My agents should remember what I told them"* is one job, not two, in the user's head. If Kiro lets them codify both technical and taste preferences in `.spec.md` files, the user may not seek out a separate tool for the taste half.
- **These tools have funding, IDEs (Kiro is an IDE), developer adoption, and brand presence.** Designer is starting from scratch on the interaction side and rebuilding part of what they already have on the codification side.
- **Two-source-of-truth confusion.** If a user runs Kiro for spec-driven dev *and* Designer for taste codification, they have two sets of repo `.md` files that don't necessarily speak the same schema or render the same way. The user has to mentally federate them.

**Validation tasks:**
1. **Close read of one user's actual Kiro or Tessl flow** (via case studies, demos, or trying it ourselves). Looking specifically for: do they want taste-shaped intent that those tools don't support? Or is technical-spec scope genuinely enough for what they're trying to do?
2. **Articulate one specific feature in Designer that Tessl/Kiro architecturally cannot do**, not just *don't do today*. Candidate: cross-tool propagation — Tessl/Kiro are IDE-bound, while Designer pulls from Linear, Figma, etc. and pushes codifications back. If this is the differentiator, it needs to be load-bearing in v1 and emphasized in vision.md.
3. **Monitor quarterly**: watch the changelogs of Kiro, Tessl, Spec Kit, and Intent for any new schema vocabulary that touches voice/principles/tone/aesthetic concerns. Add to `competitive-landscape.md`.

**What would change my confidence:** if cross-tool propagation turns out to be a clean structural differentiator that none of the spec-driven tools can match without abandoning their IDE-bound architecture, the risk drops to Tier 2. If users in close-reads describe wanting to codify *taste* and being unable to, the risk drops further. If the close-reads reveal users are satisfied with technical-spec scope and don't articulate a taste-codification need, the risk increases and the positioning may need to sharpen what the "taste" half specifically does that no spec-driven tool will do.

---

## Tier 2 — significant but not existential

### 2.1 The "convergence to mean gets worse as models improve" argument may not survive contact with reality

**The concern.** The rationale's §4.2 claim is original to our framing — that *as agents get better, the convergence-to-mean problem amplifies, so the value of off-mean human direction goes up.* There is a real counter-argument:

**As models get better at following intent, the bottleneck shifts from *fighting agent defaults* to *describing what you want clearly.*** Karpathy's *"I'm basically programming in English now"* suggests the bottleneck is *brief-quality / intent-articulation*, not *post-hoc redirection.* If that's right:
- Designer's value should be loaded into **brief-writing surfaces** (helping the user articulate intent up-front clearly), not codification (capturing redirection patterns post-hoc).
- The convergence problem might *diminish* as model + user prompts improve, not amplify.
- The "compounding judgment" mechanism Designer is built around becomes less central; the "elicit intent well the first time" mechanism becomes more central.

**Why this matters.** The product surface shape would be meaningfully different under the *"intent elicitation is the bottleneck"* framing than under the *"redirection capture is the bottleneck"* framing. Both can be true, but the dominant one matters for what to build first.

**Why we leaned the way we did.** The framing is also a frustration the project lead has felt personally. That makes it suspiciously available as an explanation — see Tier 1 §1.1.

**Counter-counter-argument from `rationale.md`.** The arXiv design-homogenization paper, the "AI slop" discourse, and the cultural-stagnation literature all suggest the convergence problem is *current and worsening*, not improving. The deskilling effect documented by Anthropic's Economic Index suggests the human role is moving up the skill stack into work where convergence matters most.

**Validation task.** In the persona-validation conversations from Tier 1 §1.1, ask explicitly: *"is your pain more about (a) agents converging to defaults you have to fight, or (b) struggling to describe what you want clearly enough that the agent gets it right the first time?"* Listen for which framing lands.

**What would change my confidence:**
- If validation conversations name (a) consistently: convergence framing holds; codification is the right central bet.
- If they name (b) consistently: intent-elicitation framing wins; the v1 should re-weight toward brief-writing and the codification engine becomes secondary.
- If they split or describe it as both: the product needs to address both, and the sequencing matters more than the choice.

---

### 2.2 Six native surfaces is more than v1-shippable for current engineering capacity

**The concern.** ADR §3.10's v1 disposition names six Designer-hosted surfaces:
1. Inbox (cross-tool attention router + prioritization engine)
2. Item viewer frame (sandboxed embedding for many tool types)
3. AI taste companion (LLM integration, prompt eng, eval suite, cost management)
4. Codification engine + living docs (drain → distill → propose → propagate; see Tier 1 §1.2)
5. Lightweight in-context writing surface
6. Source-tool integration adapters (one per source — Linear, GitHub, Figma, Agentation at minimum)

**Each is a real product.** Engineering capacity is one person (the project lead) plus occasional contractors. Phase 24 took months. **The honest v1 cut may need to be even narrower than the six surfaces.**

**Why this matters.** Shipping a thin/broken version of six surfaces is worse than shipping a polished version of three. The Quality Bar in `CLAUDE.md` is explicit: trustworthy shipping (ADR 0009) requires *every shipped surface works end-to-end without seams, stubs, or false affordances.* Six surfaces × that quality bar = ambitious.

**Counter-argument.** Several of the six surfaces are *thin* — the lightweight writing surface and integration settings are deliberately small. The item viewer frame is mostly a sandboxed webview wrapper. So the *real* heavy lifts are: inbox + companion + codification engine + initial integration adapters. Maybe ~3.5 substantive surfaces, which is more manageable.

**Validation task.** Do an honest engineering estimate per surface with confidence intervals — not a wish-cast but a sober estimate from prior phase velocities. Specifically:
- Inbox + prioritization engine: estimate weeks.
- Item viewer frame: estimate weeks.
- AI taste companion: estimate weeks (the LLM-app shape is the biggest unknown).
- Codification engine: contingent on Tier 1 §1.2 distill prototype; if that works, estimate weeks; if not, this surface defers.
- Lightweight writing: estimate weeks.
- First 2 integration adapters (Linear + Figma, probably): estimate weeks each.

If the total exceeds ~6 months of focused work, **the v1 scope is wrong** and needs further narrowing. Three native surfaces (inbox + codification + one adapter) might be the actual honest v1.

**What would change my confidence:** an estimate that adds up to ~6 months keeps the current scope plausible. An estimate that adds up to ~12+ months means we should choose 3 surfaces and defer the rest.

---

### 2.3 The AI taste companion is the most product-shaped surface and the least specified

**The concern.** ADR §3.7 describes the companion as: lives in context, has expressive tools, calls local model or hosted model, knows the user's codifications, drafts redirections, translates critique, proposes codifications.

What is NOT specified:
- Which model(s)?
- What context loading strategy? (Codifications + source-tool state + judgment history + artifact + related codifications per query is potentially thousands of tokens.)
- What tools specifically, with API contracts?
- What eval suite?
- What cost ceiling?
- What failure mode handling? (Bad companion suggestions could push users toward bad codifications.)

**Why this matters.** This is an LLM application that requires real engineering — model choice, prompt design, eval suite, cost management, latency optimization. We've described it as "obvious to build" but it is not obvious; the LLM-application engineering discipline is real and the field is full of products that ship before this engineering is done and get poor results.

**Counter-argument.** Plenty of LLM-app products have shipped with reasonable quality (Cursor, Linear's agent, Cowork, etc.). The patterns are not mysterious. But each took meaningful engineering investment.

**Validation task.** Write a one-pager spec for the companion that names:
- Default model choice (likely Claude — but specify which tier and why)
- Context-load strategy (what loads when; what context window we target; what we trim)
- Tool catalog (what functions the companion can call; concrete API surface)
- Cost estimate per typical interaction
- Eval approach (what counts as a good companion response; how we measure)
- v1 failure mode handling (what happens when companion suggests a bad codification; how the user catches it)

**What would change my confidence:** if the one-pager exists and the cost-per-interaction is reasonable (sub-cent for routine; sub-$0.05 for complex), v1 is plausible. If costs add up to dollars-per-interaction or the eval question has no answer, the companion is a *post-v1* surface and v1 ships without it.

---

### 2.4 Integration with external tools depends on cooperation that may not be granted

**The concern.** Designer's value depends on integrating with Variant.com, Inflight, Agentation, Figma, Linear, and others. Each integration depends on:
- API access (some have it; some don't; some restrict commercial use).
- Auth flows (each different; each a UX surface to design).
- Webhook reliability (Linear's are good; smaller tools may not be).
- Embedded-use permission (Figma's embed kit has restrictions; some tools forbid embedded use in commercial products).

**None of these tools have a stake in Designer's success.** As Designer becomes meaningful, some may close access.

**Precedents:**
- **Anthropic banned OpenClaw** from drawing on subscription pools (April 2026). [(VentureBeat — Anthropic reinstates with a catch)](https://venturebeat.com/technology/anthropic-reinstates-openclaw-and-third-party-agent-usage-on-claude-subscriptions-with-a-catch)
- Twitter closed its API (2023).
- Reddit limited API access (2023), forcing third-party clients (Apollo) to shut down.
- Many B2B SaaS tools restrict embedded use in competing products.

**Why this matters.** If Figma restricts embedded use in cockpit-style products, the item viewer frame for Figma collapses. If Anthropic adds restrictions on Claude Code subprocess integration, the hybrid-mode bet weakens. If Linear changes its agent-session API terms, the Linear adapter degrades.

**Counter-argument.** Most tools want adoption, and Designer's integration helps the user use them *more*, not less. Figma's embed kit was built to encourage integration. Linear actively encourages third-party agents. The hostile-API precedents (Twitter, Reddit) are platform-monopoly moves; the tools we're integrating with don't have the same incentive.

**Validation tasks:**
- For each v1 adapter target (Linear, GitHub, Figma, Agentation, Cursor): explicit ToS / API review confirming Designer's intended use is supported.
- For each: identify a *fallback degradation* — what happens if access is restricted? (e.g., if Figma embed kit becomes restricted, can we degrade to comment-only via REST API?)
- Track the integration-friendliness of each in `competitive-landscape.md`.

**What would change my confidence:** if all v1 adapters confirm supported commercial use and reliable webhook/API access, risk is manageable. If two or more have restrictions, the integration layer needs reshape (maybe more passthrough, less embed).

---

### 2.5 The Phase-24-was-just-shipped problem

**The concern.** The user's daily-driver right now is the chat surface from Phase 24 (chat pass-through with stream-json projection). The new positioning *demotes* this surface — chat-as-workspace-lead-session is no longer the structural anchor; it becomes one mode of the AI taste companion. The Designer-Noticed detector portfolio (Phase 21.A / 26) is cut from v1 entirely.

**Even the dogfood user (the project lead) faces real adoption friction during transition:**
- The surfaces they use today are partially hidden under the new positioning.
- The new surfaces (inbox, viewer frame, companion, codification engine) don't yet exist.
- During the rewrite, the user has no daily-driver — they're either using a degraded current product or testing partial new surfaces.

**Why this matters.** Affects the architecture decision (iterate vs. start over). If we quarantine Phase 24 chat, the dogfood user loses their primary workflow for months. If we don't quarantine, the new surfaces conflict visually with old surfaces and the positioning is muddied.

**Counter-argument.** ADR 0010 §4 already specifies *quarantine, not delete* — the orchestration substrate stays load-bearing for tests but hidden in user UX. The transition can be feature-flagged: old surfaces stay available behind a flag while new surfaces become default.

**Validation task.** Write a concrete *transition plan*:
- Which surfaces ship first? (Probably inbox + integration with one source.)
- When does the new inbox become the default home tab?
- What happens to Phase 24 chat during transition? (Stays as a workspace tab? Becomes the companion's "drive mode"? Both?)
- What's the rollback plan if the new surfaces are net-negative for the dogfood user?

**What would change my confidence:** a transition plan that keeps the user productive throughout, with realistic estimates of when each new surface becomes usable, makes the risk manageable. Absence of such a plan means we're betting on a long blind period.

---

### 2.6 "Interaction pattern is the moat" is more fragile than rationale claims

**The concern.** The rationale's §5 argument depends on interaction patterns being *hard to retrofit* for incumbents. This is true for some players (Linear, Cursor, Figma — each would have to violate their existing user identity), but it is **not** true for:

- **Anthropic specifically.** They have product chops (Claude Code is well-designed), capital, distribution, and direct relationships with the agent runtimes Designer integrates. They could ship a Claude Workspace with cross-tool integration and a polished cockpit. The "Anthropic doesn't have design chops" assumption is wrong; the "Anthropic won't ship a cockpit" assumption is questionable.
- **Net-new entrants** with no legacy to violate. The "first to ship the cockpit" advantage is real but finite — a well-resourced new entrant could match in 6–12 months.
- **Osyle expanding.** Osyle has 50K early users and presumably investment runway. They could ship a cockpit on top of their existing backend. The "they stay backend forever" assumption is convenient.

**Why this matters.** The defensibility argument for the moat is one of the load-bearing strategic claims. If it's weaker than stated, then *speed-to-market* and *structural differentiators* (multi-runtime + local-first + repo-first) carry more of the weight than the *interaction pattern* itself.

**Where Anthropic specifically is structurally disinclined to invest** (these are Designer's real defensible territory):
- **Multi-runtime / tool-agnostic positioning** — Anthropic sells Claude tokens; a cockpit that treats Claude as one of many violates their economic model.
- **Local-first / privacy-first architecture** — Anthropic is cloud-first by nature; local-first conflicts with their data flywheel.
- **Repo-as-source-of-truth** — Anthropic's instinct is cloud state (Files, Projects, Memory); repo-first is a developer-tools instinct, not theirs.
- **Non-developer UX for taste-holders specifically** — Claude Code targets developers; Claude.ai targets generalists; designer-founders specifically would require a different design team.
- **Integration with direct competitors** — Anthropic won't natively integrate Cursor / Codex / Lovable as first-class peers.

**Counter-argument.** The structural-disinclination arguments above are real. Combined, they make a defensible position *against Anthropic*. But each individually is finite — Anthropic could add local-first mode, multi-runtime support, etc. The defense is structural-stacking, not any single feature.

**Validation tasks:**
- Drop the "interaction patterns are hard to retrofit" framing from primary positioning; lean instead on the *combined structural differentiators* (multi-runtime + local-first + repo-first + cross-tool + taste-holder UX) as the moat.
- Monitor Claude.ai and Claude Code feature additions quarterly for any signal that Anthropic is moving toward judgment-layer territory.
- Make a deliberate decision: if Anthropic shipped a "Claude Workspace" with cross-tool integration in 12 months, what would Designer's response be? Document the contingency.

**What would change my confidence:** if Anthropic ships a directly-competitive feature in the next 12 months, the risk realizes. If they don't (and their roadmap signals indicate they're focused on Claude Code + Claude.ai improvements), the structural-disincentive argument holds for the relevant window.

---

## Tier 3 — worth tracking

### 3.1 The "Mini taste-loop already exists in working form" claim is overstated

**The concern.** The Mini taste-loop works for one user (the project lead) with careful manual curation. The auto-distill loop is unbuilt. Scaling from "one user with discipline" to "N users with auto-distill" is a real engineering project, not a near-done implementation.

**Why this matters.** This claim shows up in ADR 0010 §3.9 and `rationale.md` as evidence that the codification primitive is "ready." It's not. It's a working *human procedure*; not a working *automated system*.

**Validation task.** Edit ADR §3.9 and rationale.md §6 to be more precise: *"The drain/distill/propagate skills exist as documented procedures and a working human workflow. The automated loop is the unbuilt part of the codification primitive."*

This is small; do it now.

---

### 3.2 No monetization story

**The concern.** Local-first + open integrations + user-owned codifications + free local models = no obvious SaaS lock-in. Possible models: paid app, paid sync (when mobile lands), paid integrations, team tier, enterprise compliance tier. None obvious.

**Why this matters.** v1 acceptable without; v2 must address. Without a model, runway becomes the constraint.

**Validation task.** A separate strategy session on monetization, post-v1. Not urgent now.

---

### 3.3 The integrate-or-replicate skill is necessary but not sufficient

**The concern.** A workflow checkpoint that *might* be invoked before every roadmap addition can be *skipped*. The skill exists and the CLAUDE.md item 9 names the policy, but enforcement depends on remembering to invoke it.

**Validation task.** Track in retros: did the integrate-or-replicate skill actually fire for every roadmap addition this quarter? If not, the policy isn't operational.

---

### 3.4 The compliance / B2B angle is unaddressed

**The concern.** EU AI Act Article 14 and NIST AI Risk Management Framework require *demonstrable human oversight* for high-risk AI systems. Designer's cockpit (cross-tool inbox + audit-against-codified-stance + propagation flow) is *architecturally* the kind of surface these frameworks require. We've positioned consumer; the path to enterprise is unspecified.

**Counter-argument from `rationale.md`.** The consumer positioning is sharper and Maya is the canonical user. The B2B angle is a possible future, not a current focus.

**Validation task.** When v1 ships, decide explicitly: do we pursue the B2B / compliance angle, or stay consumer-focused? Not deciding is a decision.

---

### 3.5 The "Builder" vocabulary shift

**The concern.** The title *"Engineer"* is being replaced by *"Builder"* in much of the AI-tools discourse. [(SF Standard)](https://sfstandard.com/2026/03/05/engineer-2025-ai-land-everyone-s-builder-now/) Designer's persona language uses "designer who ships code," "AI product engineer," "vibe-coding founder." "Builder" might land better as the umbrella term.

**Validation task.** Minor terminology consideration for future messaging passes. Not urgent.

---

### 3.6 We've been doing strategic positioning for many turns

**The concern (meta).** The strategic-positioning conversation has run ~30 turns. The vision.md, ADR, personas, and now research dirs are all rich and getting richer. **At some point analysis paralysis is itself a risk.** Marginal returns on strategic refinement are diminishing while the cost of not committing to architecture and roadmap is increasing.

**Validation task.** Set a hard deadline: after the Tier 1 validation tasks (§1.1 persona conversations + §1.2 distill prototype + §1.3 spec-driven tool deep read) are complete, **commit to the architecture decision** (iterate vs. start over) and **start the roadmap rewrite** within one week, whether or not all open questions are resolved.

---

## Two structural concerns worth holding separately

These don't fit cleanly into tiers because they're meta-claims about the framing itself.

### A. Designer may be solving the wrong shape of the problem

**Two framings of the same observation:**

- **Framing 1 (Designer's current):** *"Agents converge to the mean; humans must redirect them; the redirections evaporate; we need to codify so they compound."*
- **Framing 2 (counter):** *"Agents are getting better at following instructions; the bottleneck is the human's upfront articulation of intent; we need a tool that helps the human articulate fast and well."*

Framing 1 says: build a codification engine.
Framing 2 says: build a writing-and-brief surface with intent-elicitation help.

These are different products. Designer's v1 leans heavily on Framing 1. **The Framing 2 version is closer to what Squer.io's Intent Engineer role does** — taking human fuzzy intent and structuring it into agent-executable specs.

**Both could be true.** But betting heavily on Framing 1 without testing Framing 2 is a real bet. *The persona-validation work in Tier 1 §1.1 should explicitly test which framing lands.*

### B. The "humans-as-bottleneck-where-metrics-are-computable" claim has a corollary

Karpathy's framing: *"humans are the bottleneck in any AI domain with a clear, computable metric."* Designer's defense relies on the inverse — taste/craft/distinctiveness has no computable metric, so humans remain load-bearing.

**The corollary we haven't sat with:** in domains where humans are the bottleneck, *AI-augmented humans become the bottleneck-reducer.* Designer's job is to make humans faster at applying taste. **But if a better Anthropic model just absorbs taste-application into the agent ("I'll write your codification for you, just approve"), the bottleneck-relief shifts from "Designer makes you faster" to "the agent does it for you."**

This is the same risk as the Osyle backend competitor (§5 of rationale) — but applied to the *cockpit* half. We've defended against the backend competitor by pointing at the cockpit. The question we haven't asked: can the agent *also* absorb the cockpit half?

**Possible defense:** the cockpit is fundamentally *the human's surface* — even if an agent can propose codifications, the human has to *evaluate* them, and that evaluation needs a surface. So the cockpit's role becomes "approve / edit / reject" rather than "do the work yourself." This is still defensible but it's a different product: thinner, more accept/reject, less generative.

**Validation task.** A thought experiment: if Claude could *write* a codification draft from raw redirection logs perfectly, what would Designer still need to do? If the answer is "just provide a place to approve," the product is much thinner than we've described. If the answer includes *"present in the right context, route to the right judgment moment, integrate with the user's other tools, preserve the human's agency throughout"* — the cockpit role remains substantial.

---

## Summary: what to do before more strategic work

In rough priority:

1. **Tier 1 §1.1: Persona validation conversations.** 3+ calls, 30 minutes each. Cheapest, highest-information move available.
2. **Tier 1 §1.2: Distill step prototype.** 1–2 days of focused engineering work. Resolves the load-bearing technical risk.
3. **Tier 1 §1.3: Close-read of Kiro or Tessl in actual use.** A few hours. Resolves the spec-driven tool overlap risk.
4. **Tier 2 §2.2: Engineering estimate for the 6 surfaces.** Half a day. Resolves the v1-scope-realistic question.
5. **Tier 2 §2.3: One-pager spec for the AI taste companion.** Half a day. Resolves the most product-shaped open question.
6. **Decide explicitly** which Framing — codification (Framing 1) or intent elicitation (Framing 2) — is the *primary* v1 bet. Both can be built eventually; one has to be first.
7. **Make the architecture decision** (iterate vs. start over) and **start the roadmap rewrite** within one week of completing 1–5.

Total time investment for 1–5: roughly 1–2 weeks. Compared to building wrong for 6+ months, this is a cheap diligence pass.

---

## Confidence summary

What I'm confident about (>80%):
- Taste/judgment as a layer above AI-built work is a real category. Discourse, research, and competitor existence all confirm.
- Cross-tool attention routing is unoccupied territory.
- The user category (AI-coding-fluent taste-holders) is real and growing.
- Structural differentiators against Anthropic exist (multi-runtime, local-first, repo-first, taste-holder UX, cross-tool propagation).

What I'm meaningfully less confident about (40–70%):
- The convergence-to-mean framing being the dominant pain (vs. intent-elicitation pain).
- The codification engine's distill step being shippable in v1.
- The persona space being big enough to matter commercially.
- Six native surfaces being achievable in one focused build cycle.
- The "interaction pattern is the moat" claim against Anthropic specifically.

What I'm not confident about (<40%):
- The detailed v1 disposition holding up under real implementation.
- Mid-flight pivots not being needed if the first version of inbox + companion + codification engine lands and doesn't immediately resonate.
- Designer being defensible against Tessl/Kiro/Intent expanding into taste-spec territory.

---

## Sources

### Spec-driven development tools (Tier 1 §1.3)

- [Augment Intent — product page](https://www.augmentcode.com/product/intent)
- [Augment Intent — documentation overview](https://docs.augmentcode.com/intent/overview)
- [Augment Code Intent Review: Orchestration Over Code — Awesome Agents](https://awesomeagents.ai/reviews/review-augment-code-intent/)
- [Kiro — Specs just got faster and smarter](https://kiro.dev/blog/faster-smarter-specs/)
- [Kiro — Bring engineering rigor to agentic development](https://kiro.dev/)
- [Tessl — Spec-Driven Development with Tessl docs](https://docs.tessl.io/use/spec-driven-development-with-tessl)
- [Tessl — 10 things you need to know about specs](https://tessl.io/blog/spec-driven-development-10-things-you-need-to-know-about-specs/)
- [GitHub Spec Kit](https://github.com/github/spec-kit)
- [GitHub Spec Kit Documentation](https://github.github.com/spec-kit/)
- [Spec-Driven Development Workflow — DeepWiki](https://deepwiki.com/github/spec-kit/5-spec-driven-development-workflow)
- [Understanding Spec-Driven-Development: Kiro, spec-kit, Tessl — Martin Fowler](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)

### Anthropic / runtime competitors (Tier 2 §2.4, §2.6)

- [Anthropic reinstates OpenClaw and third-party usage (with a catch) — VentureBeat](https://venturebeat.com/technology/anthropic-reinstates-openclaw-and-third-party-agent-usage-on-claude-subscriptions-with-a-catch)
- [Anthropic Economic Index Reports](https://www.anthropic.com/economic-index)
- [Anthropic Agent SDK Credit](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)

### Human oversight under load (Tier 3 §3.4)

- [Human Oversight Under Load in the Age of AI Agents — Medium](https://medium.com/@maxdolphin/human-oversight-under-load-in-the-age-of-ai-agents-e943b6e6720d)
- [The Agentic AI Governance Gap of Early 2026 — Lumenova](https://www.lumenova.ai/blog/agentic-ai-governance-gap/)
- [Agentic AI's governance challenges under the EU AI Act 2026](https://www.artificialintelligence-news.com/news/agentic-ais-governance-challenges-under-the-eu-ai-act-in-2026/)
- [Human-in-the-Loop: A 2026 Guide to AI Oversight — Strata](https://www.strata.io/blog/agentic-identity/practicing-the-human-in-the-loop/)
- [State of AI Agent Security 2026 — Gravitee](https://www.gravitee.io/blog/state-of-ai-agent-security-2026-report-when-adoption-outpaces-control)

### Discourse and emerging vocabulary (Tier 3 §3.5)

- ["Engineer" is so 2025. In AI land, everyone's a "builder" now — SF Standard](https://sfstandard.com/2026/03/05/engineer-2025-ai-land-everyone-s-builder-now/)
- [Why We Created the Intent Engineer — Squer.io](https://www.squer.io/blog/why-we-created-the-intent-engineer)

### Convergence and post-AGI framing (Structural Concern B)

- [Karpathy: Humans Are the Bottleneck — Winbuzzer](https://winbuzzer.com/2026/03/23/karpathy-humans-bottleneck-ai-research-xcxwbn/)
- [Life After AGI — Forward Future](https://www.forwardfuture.ai/p/scale-is-all-you-need-part-4-1-the-post-agi-world)
