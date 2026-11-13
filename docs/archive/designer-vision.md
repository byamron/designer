# Vision

> **The judgment layer for software built by agents.**

**Designer is the interface for the human function in AI-built software.** As building gets automated, the human's role narrows to a specific contribution: taste and judgment. Designer is the cockpit for that contribution — where humans hold the line on taste, preserve design intent through the increasing number of agent-to-agent handoffs, and codify judgment into the development process so each act compounds. As a result, the product still **feels human** — it carries the specific human's stake instead of drifting toward generic.

Four angles on one thing — *interface for the human function*, *preserve intent*, *facilitate judgment*, *feel human*. Whichever framing lands with a given reader, they all point at the same product: the place that gives humans the leverage they need when machines do the building.

Anyone who has used a lot of AI-generated software has felt how generic it can be — technically correct, emotionally absent, polished and forgettable. Designer is the layer that keeps that from happening to *your* product.

This document explains what that tagline means, why the direction is structurally undeniable, and how the product actually delivers on it. For the architectural decision behind this positioning, see `core-docs/architecture/adr/0010-intent-preservation-positioning.md`. For sequencing, see `core-docs/roadmap.md`. For specification detail, see `core-docs/architecture/spec.md`.

---

## 1. What it means

### The shift that is already happening

Software is increasingly being written by agents. Not in a hypothetical future — now. Cursor's background agents land PRs while the user is asleep. Codex runs cloud tasks at 100–600 per five-hour window for a Pro user. Linear reports 75% of its enterprise workspaces have at least one coding agent installed and that agent-completed work has 5× over three months. Anthropic split its billing on June 15, 2026 specifically to meter the programmatic / agent-driven half of Claude usage, which signals where the volume now lives. Lovable, v0, Figma Make, Subframe — each takes a brief and produces a working interface in minutes. The common pattern: a human supplies intent at the top; agents handle most or all of the execution underneath.

The change is not that agents got better at writing code (they did). The change is that *handoffs in the pipeline got cheaper*. Brief → spec → agent A → agent B → PR → merged → user used to require a human at every handoff. Now most handoffs run agent-to-agent. The pipeline gets faster. It also gets less faithful to the human's original intent.

### What gets lost when agents build

Not capability — agents are increasingly capable. Not speed — they are fast. What gets lost is **judgment**: the specific human capacity to know what good looks like and to make choices that reflect it.

Judgment shows up in many forms. It is the designer who looks at three approaches to an upgrade prompt and says *"none of these — we don't ask users to avoid losing things; we let them choose what to keep."* It is the founder who reads a generated onboarding flow and says *"this is technically correct and emotionally wrong; we're a tool people use, not a product they join."* It is the PM who declares *"our errors give the user their next move; they do not apologize,"* and means it across every screen, forever. Judgment is the act of evaluating, selecting, declaring intent, redirecting drift, encoding preference. It is the thing humans do with taste, experience, and stake in the outcome.

### Judgment is not correctness

A crucial distinction: judgment is about *what to build and how it should feel*, not about *whether it was built correctly.* Token consistency, component reuse, accessibility, code style, off-palette colors, spacing violations — these are correctness problems. They are solved automatically and well by design systems, linters, formatters, audit tools. Designer is not a worse version of those tools and does not try to be.

Judgment is the layer above correctness. It is the difference between an interface that *works* and an interface that *feels right.* It is the call that says *this is technically perfect and culturally wrong* — the loading state that's correctly implemented but apologetic when it should be neutral, the celebration animation that fires on a moment that should feel quiet, the copy that's grammatically clean and tonally hollow, the feature that's well-built and serving the wrong user. None of these get fixed by a linter. All of them get fixed by a human with taste, looking at the work and saying *"not this — that."*

Taste differentiates something that feels good from something that feels great. Designer is the layer for that distinction. The design system handles correctness; Designer handles direction.

Judgment is also what *cannot* be automated, because by definition it requires a human who knows what they want. The more capable agents become, the more central judgment becomes — the agents are no longer the bottleneck; the human's clarity of intent is.

### Why judgment leaks in an agent pipeline

Judgment lives in the human's head. The pipeline doesn't have a place to put it. Today, judgment is injected episodically — a comment on a PR, a redirection in a chat, a slack message that says "more like this." Each injection works locally. None of them stay. The next agent session starts fresh; the judgment has to be re-asserted. Over weeks, the product drifts toward generic — not because agents made bad choices, but because no choice the human made compounded into the next one.

This is the leakage problem. It gets worse as the pipeline gets more automated, because automation increases the ratio of agent-decisions to human-decisions per shipped unit. More agent throughput, same human throughput, lower judgment density per change. The product gets faster and less yours.

### The judgment layer

A *judgment layer* is the part of the software stack that is specifically about hosting and applying human judgment to AI-generated software. It is not an IDE (IDEs serve writing). It is not a tracker (trackers serve coordination). It is not a design tool (design tools serve creation). It sits above all of them. It is where the human goes to look at what the agents produced, react to it, redirect it, and codify the reaction so the next round of agent work incorporates the human's preference automatically.

Concretely, a judgment layer does five things:

1. **Routes the human's attention** to the moments that most need their judgment, across all the tools where agents are working.
2. **Hosts the act of judgment** — variant comparison, critique, decision, sign-off, declaration of intent — as first-class primitives, not afterthoughts.
3. **Codifies the judgment** into durable, machine-readable artifacts that future agents can read.
4. **Propagates the codification** back to every agent in the pipeline, so the next generation incorporates the preference automatically.
5. **Audits new work against the codification** and surfaces drift as judgment moments the human can act on.

That loop — route, judge, codify, propagate, audit — is the architecture of a judgment layer. It is what every Designer surface serves.

### Designer

Designer is the tool building this category. It is a local-first macOS application that sits above the user's existing pipeline — *whatever the user already uses*. Concretely, today, that pipeline includes some mix of: code-execution agents (Cursor, Claude Code, Codex), one-shot generation tools (Lovable, v0, Figma Make), design and tracking tools (Figma, Linear, GitHub, Notion), critique and curation surfaces (Agentation, Inflight, Variant), and personal cross-tool agents (OpenClaw and equivalents). The mix differs per user and shifts as the tool landscape evolves; Designer's job is to be the judgment layer over whatever that mix happens to be.

The primary user is **someone with taste whose job it is to shape and enforce craft in both form and function** — most naturally a designer, but the same role exists for founders, product people, and engineers whose value is *knowing what good looks like and ensuring shipped work reflects it.* Crucially, the modern version of this user is **AI-coding-fluent**: they may not write code from scratch, but they ship code daily via AI tools. They do not read diffs, write backend features from memory, or open terminals as a primary mode. They direct; AI executes.

The tagline is therefore literal. Designer is the layer above the software your agents build, where your judgment lives and compounds.

---

## 2. Why this is undeniable

The positioning is structurally defensible — not because it is a clever pivot, but because the underlying forces make it the right shape regardless of who builds it.

**The structural frame: Designer is the next interface in a lineage of human-function tools.** Every major wave of automation creates a new interface category for the human function it doesn't replace. Word processors were the interface for *writing* once typewriters became insufficient. Spreadsheets were the interface for *calculating* once manual ledgers couldn't keep up. IDEs were the interface for *programming* once machine code became too low-level. Design tools were the interface for *designing* once digital overtook hand drafting. **Designer is the equivalent for *taste and judgment* in the era of AI-built software.** Each interface in this lineage became dominant because the underlying automation made the corresponding human function *more* central, not less — and because no general-purpose tool could host the specific shape of that function. The bet is that the same pattern repeats here.

Five arguments why this specific wave produces this specific interface:

### 2.1 The agent-built shift is real, observable, and accelerating

This is not a forecast. It is a description of the present state of the developer-tools market in May 2026:

- **Cursor** ships background agents that land PRs while the user is away. Linear delegates to Cursor as a first-class integration.
- **OpenAI Codex** runs as a plan-included cloud agent at 100–600 tasks per five-hour window for Pro users.
- **Anthropic** split its billing on June 15, 2026 to meter the agent-SDK / `claude -p` / cloud-integration half of Claude usage separately from interactive use. The split exists because the programmatic half grew large enough to threaten subscription economics. The Zed team's estimate of the prior subsidy was 15–30×; Theo Browne's customer estimate was 25–40×. That is the volume of agent-driven inference that needed metering.
- **Linear** reports 75% of enterprise workspaces have at least one coding agent installed; agent-completed work has 5×'d in three months. Their Agent Session API treats agents as workspace members.
- **GitHub** shipped native stacked PRs in 2026 with `gh-stack` agent integration; combined with the native merge queue, agent-produced PRs serialize and rebase automatically.
- **One-shot generation tools** — Lovable, v0, Figma Make, Subframe — produce working UI from a brief. The trend is toward *more* of this, not less.

The pipeline is being built. The question is not whether agents will write more of the software; they already do. The question is what surface the human uses to remain accountable for what gets shipped.

Practitioner testimony reinforces the pattern. Andrej Karpathy frames the current era as one where humans *"still need to be in charge of aesthetics, judgment, taste, and oversight,"* while agent code-generation, boilerplate, and repetitive setup become abundant; the things that become *more* scarce are *"understanding, taste, eval design, security, system boundaries, agent orchestration, domain-specific feedback loops, and knowing when the model is off the rails."* By early 2026, an estimated **51% of code committed to GitHub was generated or substantially assisted by AI** — the agent share of the pipeline is no longer a forecast.

Reference: see the May 14, 2026 research synthesis (`.context/attachments/pasted_text_2026-05-14_23-22-08.txt` on the research-claude-scheduling-automation branch) for the full landscape and citations.

### 2.2 Intent leakage gets worse as automation grows

Every handoff in the pipeline is a place where intent gets approximately preserved. Each approximation is small. The compounding is large. With three human-mediated handoffs, the loss is bounded — the human is in the loop at each one. With ten agent-to-agent handoffs and one human-mediated handoff at the top, the loss compounds across every step the human did not see.

This is the inverse of most software-quality problems. Bug rates fall as tooling improves. Latency falls as infrastructure improves. Intent fidelity falls as automation increases — *because* the human's per-decision share of the work goes down. The faster the pipeline runs, the less of the human's judgment is in any given output.

A category that exists specifically to re-inject judgment at the leakage points gets more valuable exactly as the underlying capability gets better. This is the right kind of bet to make right now: it gets reinforced by the trend, not eroded by it.

### 2.3 The competitive geometry favors a new category

No existing tool can credibly take this position. Each of the obvious incumbents has a structural reason not to:

- **Linear is a tracker.** Its identity is "the issue tracker for engineering teams." Becoming taste-driven would alienate the engineering teams that are its core market. Its agent-session API is for coordinating delegated work, not for hosting design judgment. The two needs collide.
- **Cursor is the AI editor for developers.** Its primary user reads diffs and writes code. Becoming designer-friendly would dilute the editor identity and confuse the buyer.
- **Figma is the design tool.** It owns the canvas. It does not run agents and is not architected to. Becoming the judgment layer over agent-built software would require a different engine and a different user mental model.
- **GitHub** is the code-and-PR layer. PR comments are the closest thing to a critique surface, but PR comments are diff-anchored — they assume the reader is reading code, not looking at a rendered interface. The user is wrong.
- **Conductor, Devin, Charlie, Factory, Warp** are agent-orchestration tools coded for developers. Their primary verb is "spawn agents on tasks." None of them serve "apply taste to what agents produced."

The judgment layer is unoccupied territory. It is unoccupied not because no one noticed, but because the obvious players each have an existing user whose identity they would have to violate to take it. This is the most defensible kind of category gap: structural, not accidental.

### 2.4 The bet improves as models improve — three compounding reasons

Most AI-tooling categories get *less* valuable as models improve. Autocomplete becomes obsolete when generation does the whole file. Spec-writing tools become obsolete when the model can read intent from a sketch. Coordination tools become obsolete when agents can coordinate themselves.

The judgment layer gets *more* valuable, for three compounding reasons:

**Throughput.** Better models = faster pipelines = more agent-produced output per unit time = more leakage surface = more value from a tool that hosts the human's judgment and propagates it back. Volume alone drives value up.

**Convergence to mean.** As agent quality improves, the dominant failure mode shifts. Early agents failed at *correctness* — bugs, broken builds, wrong outputs. Capable agents fail at *distinctiveness* — they produce polished, on-spec, on-grid work that converges toward the average of the training distribution. The broader discourse has converged on a name for this: ***"AI slop."*** Researchers have catalogued specific recurring patterns in vibe-coded UIs (Inter or Roboto fonts everywhere, purple-on-white gradients, glassmorphism cards, identical icon-on-top feature grids, badge-above-hero layouts) — see *"Interrogating Design Homogenization in Web Vibe Coding"* (arXiv 2603.13036) for the academic treatment. Anyone who has shipped a feature built by a capable agent has felt this: the gradient is correct, the spacing is correct, the copy is grammatical, and the whole thing reads like every other consumer product on the internet. The human's value-add therefore shifts from *fixing mistakes* (a job linters and design systems increasingly subsume) to *pushing the work off the mean toward something distinctive* (a job no automation can do). That value goes *up* with model capability, not down — the better agents get at producing the average, the more valuable the human who keeps the product off-average becomes.

**Worth naming: docs-in-code already exist.** Many projects today maintain a `CLAUDE.md`, `AGENTS.md`, `design-system.md`, `voice.md`, or similar — instructions agents read at session start. These help, especially against correctness drift. They are insufficient against the convergence-to-mean problem for four reasons: they are written once and rarely updated (staleness); they capture only what the author thought to write down at the time (incompleteness); they are written in vocabulary that often doesn't capture fuzzy taste (translation loss); they are consumed flat (the agent reads all of them whether it's working on auth or onboarding). Designer's value-add at this layer is not the *concept* of codified docs — that exists, and is increasingly mainstream — but the *loop*: codifications emerge from the user's actual redirections (not write-once theoretical principles), evolve as taste sharpens, get pushed contextually to the agent that needs them, and surface drift as judgment moments. Without the loop, the docs rot. *The loop is the moat, not the docs themselves.*

**Attention as the scarce resource — and prioritization as the hard part.** As output throughput goes up, the human's attention does not scale. The bottleneck shifts from *what the human can do* to *where the human looks*. *We increasingly do not need to look closely at everything AI does, but we need to import judgment at the places that matter and ensure those decisions propagate.*

The obvious half of this is scarcity: a tool that surfaces the highest-leverage moments and stays out of the way for everything else becomes more valuable per unit of model improvement. The harder half is **prioritization itself**. *Knowing where to look* requires the system to have judgment about importance — a list of 50 items ranked by timestamp is barely better than 50 notifications scattered across five tools. The inbox has to weigh many signals (the codified taste — *this surface is high-craft because the user has redirected it repeatedly*; source metadata — *issue priority, PR scope, commenter identity*; engagement history — *the user always dismisses similar items / always engages with this category*; drift signals from the audit verb; time decay) and produce a ranked surface that *is itself an act of judgment*, not just sorting. The user can override and re-rank; the engine learns from those overrides. This is a substantive product capability that goes well beyond *show a feed.* Designer is the filter on attention; that filter's job gets bigger as the river gets wider, and *the quality of the filter is the product*.

The arithmetic does not invert; it compounds across all three.

### 2.5 The moat is the interaction pattern, not the backend automation

A competent builder with OpenClaw (or a similar agentic framework), API access to the user's tools (Linear, GitHub, Figma, Cursor), and an LLM could, in principle, build a *taste-agent backend* — something that subscribes to signals from those tools, runs pattern detection, drafts codification proposals, and writes markdown files to the user's repo. The plumbing — codification engine + integration adapters — is **not by itself defensible** against this competitor. Acknowledging this is important.

**What is defensible is the interaction pattern.** A taste-agent backend without a cockpit produces noisy auto-codifications the user has to verify after the fact, scattered notifications the user has to chase, and silent drift the user only discovers when a codification feels wrong. A taste-agent backend *with* a generic cockpit (an admin panel, a Slack bot, an email digest) loses the proactive-zoom property that makes the user able to oversee work without being asked to.

Designer's defense is the *cockpit-grade surface for giving taste in a system* — the inbox that surfaces what needs your judgment, the embedded viewer frame that loads the right tool for each moment, the companion that drafts and translates and proposes in context, the codification review surface that puts every promotion under human approval, the propagation flow that pushes context back where it matters. Six native surfaces, designed together as one interaction pattern. That is what a backend agent doesn't have, and what's hard to retrofit. Whoever ships the cockpit grade interaction wins; the backend is table stakes.

This is why the v1 narrowing draws the line where it does: Designer hosts *exactly* the surfaces that constitute the interaction pattern, and embeds everything else. Investing in best-in-class versions of those six surfaces — and resisting the urge to also build mediocre versions of variant comparison, annotation, design review, brief writing, brainstorming chat — is what makes the product defensible against the OpenClaw-backend competitor and against the incumbent tools alike.

**Named competitor making this exact bet:** **Osyle** (osyle.com) explicitly positions itself as *"the Taste & Judgment Layer for AI."* Near-identical tagline language. The product is a backend SDK with three components — *Context Conditioning Engine*, *Expression Modulation*, *Osyle SDK* — that conditions AI outputs at inference time using curated datasets of aesthetic excellence; ~50,000 early users claimed. **Crucially, Osyle is exactly the backend-shape this argument predicts and defends against.** It has no interactive cockpit, no inbox, no item viewer, no codification-from-the-user's-own-redirections. It sells the *average-of-experts* taste as a conditioning service that other products embed. Designer sells the *user's-specific* taste as a cockpit they use. *These are different products in the same conceptual category.* The tagline overlap matters for naming clarity — Designer's messaging needs to be unambiguous that we are *the cockpit*, Osyle is *the backend* — but the competitive geometry is complementary, not collisional: Designer could in principle integrate Osyle (or future equivalents) as one model the AI taste companion calls, while keeping the user-specific codification layer above it. The fact that Osyle exists and has shipping traction is the strongest external confirmation that this category is real and being built.

### Summary of the argument

The structural frame: each automation wave produces an interface for the human function it doesn't replace, and Designer is the next entry in that lineage. The supporting evidence: the trend is observably real (§2.1); the problem it creates compounds with the trend (§2.2); the competitive landscape of existing tools leaves the slot structurally open (§2.3); the value scales with model improvement (§2.4); and once the slot is occupied, the moat against a focused-competitor backend build is the interaction pattern itself, not the automation underneath (§2.5).

Designer either occupies this interface category with a cockpit-grade implementation or someone else does — but the category is real, the demand is real, and the moat is shippable. The OpenClaw competitor question (could someone build a taste-agent backend?) is the right question to ask and the wrong question to fear: a backend cannot, by definition, occupy the interface category, because interfaces are the part humans touch. The race is for the cockpit, and the cockpit is what Designer is.

---

## 3. How the product delivers

A day in the life of a designer using Designer. The narrative below shows the loop in action; the explicit primitive-to-moment map follows at the end.

### Setting

A founder shipping a SaaS analytics product. Agents work in three places: Cursor picks up tasks from Linear, occasional one-off variant generation runs through Lovable, local Claude Code drives some longer-running refactors. The codebase is on GitHub. A design system handles tokens, components, spacing, and accessibility automatically. Designer sits above all of it.

Designer does not replicate any of these tools. The founder uses Figma for design files, Agentation for canvas annotation, Inflight for review when they set it up, Linear for issues, the browser for live previews. **Designer is the hub** — it pulls everything together, embeds the best tool for each judgment moment inside its own surface, and codifies what the founder decides so the next round of agent work starts smarter.

The native Designer surfaces are deliberately few: the inbox, the embedded item viewer, the AI taste companion, the codification engine and its living docs, a lightweight in-context writing surface, and the integration settings. Everything else is embedded or passthrough. Building a worse version of Variant, Inflight, Agentation, Figma, or Notion would be the canonical scope-creep failure mode for this product; Designer refuses it.

### Morning — the inbox

The founder opens Designer. The first surface is the **inbox** — a ranked queue of judgment moments drawn from every connected source. Today:

1. A Cursor agent generated three variants of the upgrade-prompt copy overnight against a brief the founder wrote yesterday. The agent paused and asked for direction. The variants are renderable in Variant's comparison view.
2. A decision is pending on the export-format feature — two engineering agents proposed different shapes and posted to a Linear issue requesting a call.
3. A teammate left a comment on a Figma frame asking for sign-off on the new empty-state illustration.

The inbox does not show the full Linear queue or every PR or every agent log. It surfaces *judgment moments* — slices where the founder's taste is the highest-leverage input.

### Variant curation — in an embedded view

The founder clicks the first item. An embedded **Variant** view loads inside Designer's item viewer with the three upgrade prompts pre-comparison. They click through. Variant A is aggressive: *"Don't lose your data — upgrade now."* B is informational: *"Your trial expires in 3 days. Here's what you have."* C is celebratory: *"You've been getting value! Want to keep going?"*

They reject A and C, select B, and write a one-line redirect: *"Less 'trial expires' framing — about choosing to keep value, not avoiding loss."*

The **taste companion** appears in the side panel: *"This redirect is consistent with prior codifications (no loss-framing in upsells). Want to propagate it as a codification candidate? I can also draft the redirection to push back to the Cursor agent that generated this — would you like to review it?"*

The founder approves both. The companion drafts the redirection in the register the Cursor agent will respond to and pushes it through the integration adapter. The codification candidate enters the queue. The founder used Variant for what Variant is good at; Designer was the surrounding container that turned the moment into something that propagates.

### Brainstorming the export-format reframe — companion in chat mode

The founder clicks the second item. An embedded **Linear** view loads with the two engineering proposals. Reading them, the founder senses something is off and opens the companion in chat mode: *"Both proposals optimize for the developer's experience of generating the export. But the actual user is the accountant who receives it. Help me reframe."*

The companion asks a few clarifying questions and offers to sketch a quick mock of the export-as-it-arrives-in-the-accountant's-inbox (expressive tool — produces a wireframe in a side artifact). They iterate for five minutes.

When the founder has a position, they ask the companion to draft the decision artifact. The companion produces it with the brainstorm reasoning, the reframe, and the proposed direction. The founder edits and approves. The decision pushes back to both engineering agents through the Linear adapter as a comment on the issue; the codification candidate enters the queue.

This is the chat surface earning its keep: the companion had loaded context (the issue, the brief, the project's prior export-related decisions) that copy-pasting into Claude.ai would have required the founder to reassemble manually. The companion is better-than-elsewhere in this moment because of the loaded context, not because the chat interface is novel.

### Figma sign-off — embedded with native comments

The founder clicks the third item. An embedded **Figma** frame loads with the empty-state illustration and the teammate's comment thread. The founder reviews the illustration and types a reply directly in the embedded Figma comment field: *"Approved — but the smile feels too eager; quiet it down."*

The companion appears: *"Your reply suggests a voice principle: 'illustrations don't perform emotion at the user.' Want to propose this as a codification candidate?"* The founder approves.

Figma sees the comment as a native reply. The teammate gets a Figma notification — no behavior change for them. The codification candidate enters Designer's queue. Same act of judgment, same surface for the teammate (Figma), but Designer captured the signal for compounding.

### Mid-day — a brief, written in context

The founder writes a brief for the team-onboarding feature. They could write it in Notion (where briefs usually live), but they choose Designer's lightweight writing surface because the companion is present and the codified docs are loaded. They draft *"the onboarding should feel like joining a team that's already working, not like setting up a tool."*

The companion surfaces a tension with the codified principle *"we are a tool people use, not a product they join"* and asks whether the principle needs refinement or the brief should be reworded. The founder decides the principle needs refinement — team-formation moments are an exception. They note the refinement for the evening codification cycle.

When the brief is published, Designer pushes it to Linear as a new issue. The Cursor agent assigned to the issue starts its session with the brief, the voice file, recent decisions, and the principles all loaded automatically. The brief contains no implementation guidance — the design system handles those — only *intent*: what the experience should feel like, who it is for, what it must not become.

### Afternoon — live critique against staging

A prototype of the new error-handling flow is deployed to a staging URL. The founder opens an **embedded browser** inside Designer's item viewer pointed at staging, clicks through some intentional failures, and finds the experience apologetic where it should be neutral. They use the **embedded Agentation** overlay (running inside the same webview, layered over the live site) to annotate three places:

- The 503 page reads *"Oh no!"* → *"This sounds apologetic. Try: 'This isn't loading right now. Here's what you can do.'"*
- The retry button label is *"Try again"* → *"We're not trying; we're doing. Use 'Reload'."*
- The offline illustration is a sad cloud → *"We're not personifying our infrastructure as upset."*

The companion appears: *"These three annotations share a theme — the product's voice during failures. Want me to propose a single codification ('errors give the user their next move; they do not apologize or personify infrastructure as upset')?"* The founder approves. Each annotation routes back to the originating Cursor agent through the integration adapter; the codification candidate enters the queue.

The founder used Agentation, their familiar tool, in their familiar pattern. Designer was the container around it — and the part that turned the annotations into something that propagates.

### Evening — the codification cycle

The queue has accumulated four candidates through the day. The **distill** step runs (local model, no Claude credit consumed) and proposes promotions:

1. *Upsells do not use loss-framing. The user is choosing to keep value, not avoiding losing it.*
2. *Tool-vs-product principle refined: the product is a tool people use, but team-formation moments are an exception (people do join teams).*
3. *Illustrations don't perform emotion at the user.*
4. *Errors give the user their next move. They do not apologize or personify the product's infrastructure as upset.*

The founder reviews each in the codification surface. They approve #1 verbatim, sharpen #2 with an example, accept #3 and #4 with a cross-reference between the empty-state and error voice principles. The promotions land in `voice.md`, `principles.md`, and `tensions.md`. The propagation step pushes the updated docs to every connected agent runtime; the next round of agent work starts with these stances in context.

### What just happened, mapped to surfaces

| Moment | Designer-hosted | Embedded / passthrough |
|---|---|---|
| Opening the inbox | Inbox, integration adapters (pull side) | — |
| Variant curation | Item viewer frame, taste companion, codification capture, integration push | Variant (for the comparison view) |
| Export-format reframe | Item viewer frame, taste companion (chat mode), decision lifecycle, codification capture, integration push | Linear (for issue context) |
| Figma sign-off | Item viewer frame, taste companion, codification capture | Figma (with native comments) |
| Writing the brief | Lightweight writing surface, taste companion, integration push | (publishes to Linear) |
| Live critique | Item viewer frame, taste companion, integration push, codification capture | Embedded browser pointed at staging; Agentation overlay |
| Codification cycle | Codification docs editor, codification review surface, propagation | — |

Six Designer-hosted surfaces (inbox + item viewer frame, taste companion, codification engine + docs, lightweight writing, integration adapters, decision lifecycle). Six categories of embedded/passthrough (Variant for variant comparison, Agentation for annotation, Figma for design + comments, Linear/GitHub for tracking, browser for live URLs, Inflight for review when configured). Designer hosts the unique things and embeds the rest. The user never tabs out.

### The compounding payoff

The founder injected judgment five times. Three were in embedded tools they already use (Variant, Figma, Agentation). One was in Designer's lightweight writing surface. One was the synthetic codification cycle. Each injection became a permanent stance the agents inherit on their next session.

Tomorrow, the product feels a little more like the founder built it. Not generic. Not boilerplate. Theirs. The agents handled the implementation; Designer made sure the judgment survived the handoff.

That is what *"feels human"* means in practice: software built mostly by AI that still carries the specific human's taste, stance, and direction — because the judgment compounded into the codebase instead of evaporating between sessions.

None of the moments above were about correctness. The design system handled token consistency. The audit tools handled accessibility. The linters handled code style. Designer's job is the layer above all of that.

A note on interaction design: the cockpit deliberately introduces **productive friction** at the points where human judgment matters. Codification candidates do not auto-promote; the companion proposes but does not act; the inbox surfaces moments rather than auto-resolving them. This is intentional. The broader literature on AI-and-design (Martin Fowler's *Patterns for Reducing Friction in AI-Assisted Development*; the *Friction Paradox* discourse) has converged on the same principle — *as AI removes execution friction, designers must reintroduce the right kind of friction to keep judgment in the loop and prevent skill atrophy.* Designer's friction points are not bugs; they are the places where the human's contribution is actually applied. Two specific patterns worth borrowing: *attempt-first defaults* (let the user form a position before the AI proposal is revealed) and *decision checkpoints* (require a one-line reason before a high-stakes codification is promoted).

---

## 4. What Designer is not

To keep the positioning sharp, it is worth naming what Designer is explicitly not — both to avoid scope creep and to clarify the geometry against existing tools.

- **Not a tracker.** Linear, Jira, GitHub Projects, Notion, Asana exist and are good at what they do. Designer integrates with them, reads from them, pushes context to them. It does not replicate them.
- **Not an IDE.** Cursor and the user's editor of choice exist for code-writing. Designer does not host code editing; when an agent's work needs code editing, the agent does it in its own runtime.
- **Not a design tool.** Figma owns the design canvas. Subframe, Pencil, and similar tools own component creation. Designer renders and annotates artifacts those tools produce; it does not compete on creation.
- **Not an agent runtime.** The user's Claude Code, Cursor, Codex, and other agent runtimes execute the work. Designer does not impersonate, replace, or proxy them.
- **Not a generalist orchestration cockpit.** Conductor, Crystal, and similar tools serve developers running many parallel agent sessions. Designer serves a different user (the intent-holder) with a different verb cluster (judgment, not orchestration).
- **Not a linter, design-system enforcer, accessibility audit, or code-quality tool.** Token consistency, component reuse, a11y compliance, spacing violations, and code style are correctness problems solved automatically and well by existing tools (linters, design systems, audit tools, formatters). Designer is *above* correctness — it serves the layer where humans decide what to build and how it should feel, not whether the build is technically right. Trying to do both would make Designer a worse version of tools the user already has.
- **Not a structured-review surface like Inflight.** Inflight (and similar review tools) are excellent at receiving a critique invitation — someone configures a project for review, sends you a link, you give structured feedback in a tool built for that flow. That is *task-driven, reactive* mode. Designer's mode is the inverse: **proactive oversight.** The user opens Designer not because they were asked to review something, but because they want to see what is going on across their project — the inbox surfaces what *could* benefit from their attention, including things no one flagged. They scan, zoom in on what catches their eye, give judgment when they see something worth judging, and move on. *Overseer-driven, not task-driven.* The two modes are complementary; when someone configures an Inflight review for the user, the invitation surfaces in Designer's inbox (Inflight adapter pulls it), the user reviews inside the embedded Inflight view, and Designer captures the feedback as codification signal. Inflight handles the structured-review flow it is good at; Designer handles the oversight-and-codification flow that no other tool covers.
- **Not an AI design-review tool** (Klay Studio Review, Canva Enterprise AI, Figma's AI design-review assistant). Those tools assess a finished design against brand guidelines and emit feedback — they are *after-the-fact review applied to an artifact already produced.* They are a fast-growing category (~71% of design-led companies were investing in them by end of 2026 per industry reporting) and they do their job well. Designer is a different category: it captures critique signals from across the user's tools, codifies the underlying stance, and propagates it back so the *next* round of agent work incorporates the user's taste. *Review-tools-emit-feedback; Designer-codifies-and-propagates.* Adjacent, complementary, not the same product.

The negative-space is the moat. Designer is sharp precisely because it does not try to be these other things.

---

## 5. Where this lives in the project documentation

| Document | Role |
|---|---|
| `core-docs/vision.md` (this file) | Living positioning. What gets read first. |
| `core-docs/architecture/adr/0010-intent-preservation-positioning.md` | The decision record behind this positioning. Immutable. |
| `core-docs/architecture/spec.md` | Architecture, UX model, decisions log, hard invariants. |
| `core-docs/roadmap.md` | Sequencing — phases, arcs, Build/Harden cadence. |
| `CLAUDE.md` | The working contract for anyone (human or agent) contributing to the codebase. |

When this vision evolves — when a new strategic conversation sharpens or amends the positioning — this document is updated in place. The ADR remains as the historical decision record. If the change is large enough to warrant its own decision, a new ADR is added and this document is updated to reflect the resulting state.
