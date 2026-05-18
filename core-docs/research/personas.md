# Personas

Three personas covering Designer's primary user category. **Maya** is primary — a solo designer who founded a consumer app, closest to the dogfood pattern and the sharpest test of the product. **Jordan** and **Sam** are secondary — they stretch the category along two axes (team scale; non-designer background) without diluting the primary direction.

If you're skimming: read Maya. The others sharpen edges; Maya is the user we are building for.

A note on the trend the personas account for: **agents are getting better, fast.** The failure mode is shifting from "buggy and obviously wrong" to "polished, on-spec, and quietly generic." When the average competent output becomes the agent baseline, the human's value-add shifts from *correctness* to *direction* — from "fix the mistakes" to "push the work off the mean toward something distinctive." Every persona below feels this pressure. It is the central long-term problem Designer is being built to solve.

---

## Maya — solo designer who founded a consumer app *(primary)*

*Role label in the 2026 discourse: **"designer who ships code."** A designer-trained operator who directs AI tools daily and ships product without writing code from scratch. The role is being named explicitly in industry writing — *"vibe coding plus design becomes 'Designer who ships code'"* (Karpathy-adjacent discourse, mid-2026). The pattern is recognized; the cockpit for it is not yet built.*

### Context

- 32, lives in Brooklyn. Solo founder of a consumer mobile-and-web app — a daily-reflection / personal-narrative product in a category where *feel* is the entire product (think: the kind of app where if it feels cold or generic, users churn in week one).
- ~14 months in. ~3,000 active users; recently started charging $4/month.
- Background: senior product designer at consumer startups for 6 years (a meditation app, then a smaller consumer-health startup), then left to build her own thing.
- Solo founder; occasionally hires a contract engineer or contract motion designer for specific projects.

### Tools she uses today

- **Figma** — lives here for design.
- **Notion** — briefs, decisions, personal weekly review.
- **Cursor** — primary code editor. She uses it daily.
- **Claude Code** (local, in her terminal) — for longer refactors and sessions where she wants to drive the agent step-by-step.
- **OpenClaw** (personal agent) — runs across her tools to do cross-cutting tasks: *"summarize this week's customer feedback and write up the patterns,"* *"check yesterday's PR descriptions and tell me which ones touched the onboarding flow,"* *"draft a release note from the last three merged PRs."*
- **Lovable / v0 / Figma Make** — for one-shot variant generation when she's thinking about a new feature shape and wants quick alternatives without setting up an agent task.
- **Linear** — issues, but lightly. Her project lives more in Notion + GitHub than in Linear.
- **GitHub** — code lives here. She reads PR descriptions; rarely reads diffs.
- **Browser + her own iPhone** — for previewing the live product. She uses her phone every day as a real user.

### Coding ability

Knows what code does. Can read most of it. **Cannot write a backend feature from scratch.** Doesn't know SwiftUI syntax cold; couldn't tell you the difference between a `useEffect` dependency and a `useMemo` dependency without looking it up. **Ships code daily via AI tools.** The AI tools handle the syntax; she makes the calls. The phrase she'd use: *"I direct, AI executes."* This is the contemporary builder pattern, not the old senior-engineer-with-AI-assist pattern.

### What her day looks like today (without Designer)

Mornings: open OpenClaw's overnight summary (what shipped, what's flagged, what's in customer feedback). Tab through Linear and GitHub to see PRs the Cursor agents landed overnight — a list of maybe 15 things, each ranked by timestamp, none of them telling her which actually deserve her attention vs. which are routine. She has to scan and decide. Pick up her phone, open the app, scroll. Most of what shipped is fine. Some of it is *technically fine, emotionally wrong*. The 30-second-streak celebration that fires on Day 2 — not us, we don't celebrate streaks. The gradient on the new "Reflect" screen — too saturated, too brand-y, our product is quieter. The copy on the empty state — too eager.

She comments in PR descriptions. She redirects the relevant Cursor agent: *"This celebration animation is too much. Remove it. We don't celebrate streaks — we don't gamify anything. The product is quiet."* The agent fixes it. Two weeks later, a different agent on a different feature ships a different celebration animation in a different place, and she has to type the same kind of redirect again.

Mid-morning: into Figma to look at what her contract motion designer sent over, or to draft a new screen herself. Afternoons: respond to customer email, work on the brief for the next feature, watch a few of her users use the app via Hotjar replays. Evenings: more product time if she's feeling it. By bedtime she's spent more attention on review-as-correction than she wanted to, and her brief for the new feature is still half-written.

### Her core pain — in her own voice

> *"The agents are good now. Too good. They produce stuff that's technically right and totally generic — gradient hero, springy motion, gamified streak, copy with exclamation marks. That isn't my product. My product is quiet. And I find myself fighting the agents toward quiet, over and over, because nothing remembers what quiet means. I want my judgment to stick. I want next month's agents to start from where I left off, not from the average of the internet."*

### What she cares about most

- **Her product feeling distinctive.** Not "not bad" — *not average*. The competitive game in consumer-app land is increasingly won and lost on emotional register, not feature parity. The agent baseline is the *average* of the consumer-app internet; her product has to be deliberately off-baseline.
- **Innovation in approach** — not just polished execution of patterns everyone else uses, but genuinely different choices (anti-gamification in a category where everyone else gamifies; quiet motion in a category that springs; copy with no exclamation marks in a category that yells).
- **Attention going where it matters.** She doesn't need to see every PR. She needs to see the moments where her judgment changes the product's character.
- **Judgment compounding.** Her redirects need to stick across sessions, across features, across months.
- **Walking away for a day** without the product drifting back toward the mean.

### What she does NOT care about

- **Code-level review.** Agents handle correctness; linters handle style.
- **Tracking every agent action.** She wants the moments that need her, not the operational view.
- **Replicating Figma, Notion, Cursor, or OpenClaw inside Designer.** She likes those tools. She wants them to *cohere*, not be replaced.
- **A new tool with a 10-page user manual.** Time-to-value bar is hours, not weeks. If she can't feel the leverage in the first week, the tool gets uninstalled.

### Where Designer fits in her stack

The hub above everything. The thing that:

1. Watches her redirections (away from defaults, toward her aesthetic) and codifies them so future agents inherit her direction-of-judgment.
2. Tells her *where* in the river of agent output her attention is most valuable, so she doesn't waste attention on the rest. Attention is her scarcest resource and it's about to get scarcer as agent throughput goes up.
3. Pushes her codified taste back to every agent in her stack (Cursor, Claude Code, Codex, OpenClaw, Lovable when she uses it) so the next round of work starts from her, not from the mean.

The single most resonant phrase for Maya from the vision doc: *"the product still feels like the founder built it."* That is what she is buying. The phrase she'd use to describe what she wants Designer to do: *"keep me off the mean."*

---

## Jordan — design lead at a consumer startup *(secondary)*

*Role label in the 2026 discourse: **"senior designer in the AI-velocity era."** A design lead whose leverage problem is keeping product distinctiveness coherent as agent throughput dominates her team's velocity. The discourse (Productboard, Reforge, design-leadership writing) is converging on the framing that product judgment matters *more* as execution becomes cheap, not less — Jordan is the canonical case.*

### Context

- 36, design lead at a 70-person Series A consumer startup (think: a creator-tools platform, or a youth-focused fintech, or a niche consumer-health product — pick the category that makes the dynamics most concrete).
- Team: 5 designers + 14 engineers + a growing fleet of AI agents (mostly Cursor for engineering, some Codex, Lovable for marketing-site experiments).
- 8 years in product design, mostly consumer.
- Reports to the CEO; partners with the VP Product and Head of Engineering.

### Tools she uses today

- **Figma** — primary tool, lives here most of the day.
- **Inflight** — when teammates set up structured design reviews for her to give feedback on.
- **Linear** — issues, but she doesn't drive heavy use.
- **Slack** — team comms.
- **OpenClaw** — personal automation: runs her weekly review, summarizes the team's customer-feedback channel, drafts agendas, watches for incidents in her product surfaces.
- **Cursor** — when she pairs with an engineer.
- **Loom** — async walkthroughs.

### Coding ability

Light. Can fix a small CSS bug in Cursor. Cannot ship a new feature solo. Doesn't try to. Her contribution is design + judgment, not code. **She does not read PR diffs**, ever; she reads PR descriptions and views the deployed result.

### What her day looks like today (without Designer)

Mornings: OpenClaw summary, Slack catch-up, scan Linear for design-review-tagged issues, open Figma to review what her designers and the engineering team shipped overnight. Mid-day: design crits with her team, partner with eng on a few specific features, leadership meetings. Afternoons: deeper design work or strategy time, mixed with more crits and ad-hoc reviews.

Less hands-on agent-oversight than Maya because she has a team — but the team's velocity is increasingly dominated by AI throughput, and she is increasingly the bottleneck on *"is this design-correct and on-brand?"* Her design language doc, written 9 months ago, has not been meaningfully updated in 6 months even though her thinking has evolved a lot in that time.

### Her core pain — in her own voice

> *"The features that ship feel a little less like our product every quarter. Not bad — competent, clean, on-grid. Just less... us. Twelve engineers and a fleet of agents producing competent work means we're slowly converging to mean-of-category, and I'm the only one whose job is to push against that. I can't be in every PR. I need a way to push my judgment into the system itself, so it pushes back even when I'm not in the room."*

### What she cares about most

- **The product staying distinctive at scale.** The bigger the team gets and the more agent output flows through, the harder it is to maintain a coherent aesthetic — and her job is to maintain it.
- **Her time leverage.** She should be giving judgment, not reviewing every artifact. The amplification ratio (one act of judgment → N agents inheriting it) is her key metric.
- **Codifying recurring direction-calls** so they propagate to both her designers and the agents.
- **Her designers growing in judgment** — the codified docs become a teaching artifact for the team, not just an input for the agents.

### What she does NOT care about

- **Per-PR review.** Her team and the existing code-review process handle that.
- **Direct agent orchestration.** Engineers and the AI tools handle that layer.
- A tool that requires her to **read code**.

### Where Designer fits in her stack

Same hub-above-everything posture as Maya. The emphasis difference: the codification docs serve a *dual audience* — agents (who inherit them as context) and her designers (who read them as a living style/voice/principles doc). The codification engine is therefore even more central for Jordan than for Maya; it's the only piece of her job that scales.

The single most resonant phrase for Jordan: *"judgment that compounds."* The leverage she needs is the difference between "give the same feedback 12 times this quarter" and "codify it once and it propagates to 12 features."

---

## Sam — indie maker who launched a consumer product, non-designer background *(secondary)*

*Role label in the 2026 discourse: **"vibe-coding founder"** or **"AI product engineer."** A taste-led builder who ships via AI tools daily and whose judgment is the product's distinctiveness. *"Vibe coding plus product judgment becomes 'AI Product Engineer.'"* The discourse names the role; the market under-serves it.*

### Context

- 29, indie maker who built and launched a consumer app solo. Product: a small-group social app for friends to share daily updates — monetized via subscription, deliberately anti-engagement-hack (no streaks, no notifications-as-default, no leaderboards). ~6 months in, ~800 users.
- Background: ex-engineer at a couple of consumer startups (front-end heavy). Strong product instincts. **Taste-led but not formally design-trained** — figured out his eye through years of reading, looking, and shipping.
- Solo, no employees, uses AI agents heavily across his whole stack.

### Tools he uses today

- **Cursor** — primary editor.
- **Claude Code** (local) — longer sessions.
- **Codex** — for specific kinds of refactoring tasks.
- **OpenClaw** — personal agent. Runs his weekly review, monitors usage analytics, summarizes customer messages, drafts release notes, watches for anomalies. He uses OpenClaw the most heavily of the three personas — he doesn't have a team, so OpenClaw fills the team-of-one gap.
- **Lovable / v0** — for one-shot variant generation.
- **Linear** — light use, mostly notes for himself.
- **Figma** — views, comments, occasionally drafts simple wireframes.
- **Notion** — occasional, mostly for longer-form thinking.

### Coding ability

Strong. He's an ex-engineer; can read and write code fluently. But he ships almost everything via AI tools because it's faster and the AI is good enough. The AI does the typing; he does the thinking. **Reads code more than the other two personas; still doesn't review diffs as a primary mode** — even with his background, the agent throughput is too high to keep up that way.

### What his day looks like today (without Designer)

Mornings: OpenClaw summary of overnight activity, user messages, analytics anomalies. Tab through Linear, scan a few PRs the agents landed. Open the app, use it briefly as a user. Most of what shipped is fine, some of it is wrong-in-a-way-he-can't-immediately-articulate.

Mid-day: focused product work, often in Cursor with Claude. He directs the agent through a feature with strong taste calls along the way — *"no, smaller padding here,"* *"the copy on this empty state should be three words, not a sentence,"* *"the animation should be linear, not springy."* The calls work in the moment. They don't survive into next week's work, when a different agent in a different feature reverts to the default.

Evenings: customer messages, sometimes more product work, sometimes off.

### His core pain — in his own voice

> *"I can tell when a feature feels wrong. I just can't always explain why. The agents are getting better at building — competent, fast, on-spec — but they default to the patterns everyone else uses, and my product is supposed to NOT do those. I keep redirecting toward 'slower, quieter, warmer' and the redirects don't stick. I need a tool that watches me make taste calls and turns them into something the agents can read next time. Bonus points if it can articulate them better than I can."*

### What he cares about most

- **The product keeping its distinctive vibe** as agents do more of the building.
- **Attention prioritization** — knowing where to look in a high-throughput stack.
- **Capturing fuzzy taste calls** in a form agents can actually use. He doesn't have the design vocabulary to write *"avoid the celebration register; favor neutral acknowledgment"* — he says *"don't do that"* and points at an example. He needs the codification engine to do the articulating work.
- **Not spending his evenings rewriting agent output.**

### What he does NOT care about

- **Most of what professional designers care about** (formal design system, tokens, axioms) — though he benefits from them existing.
- **Team workflows.**
- **Detailed review of every artifact.**

### Where Designer fits in his stack

Hub above his stack, with two specific emphases:
- The **AI taste companion** is especially valuable for him — it translates *"this feels wrong"* into a codifiable, articulable principle. For Maya the companion drafts; for Sam the companion *articulates* (puts fuzzy taste into words he couldn't easily produce himself).
- The **codification engine** turns his point-and-grunt taste calls into structured stances that agents can read. Without Designer he has the taste but no system for transmitting it; with Designer his fuzzy taste becomes structured, propagated, durable.

The single most resonant phrase for Sam: *"keeps the product distinctive even when I'm not in the room."* He's a solo maker; his attention is finite; the product has to stay his even when he's asleep.

---

## Cross-persona observations

Reading the three together exposes a few patterns that should shape product decisions:

1. **The failure mode they all fear is convergence to mean, not bugs.** Agents are *getting better*. None of the three personas describe the current pain as "the agents make mistakes." They describe it as "the agents make competent, polished, generic work." The long-term threat to their product is being polished into average. Designer's value-add is therefore *off-the-mean direction*, not *fix-the-mistakes*. This is a fundamentally different product than "AI quality assurance."

2. **They all share the compounding problem — even when they've tried docs-in-code.** All three describe a version of *"my judgment doesn't stick; I repeat myself."* Notably, Maya and Jordan both maintain *some* form of design-docs-in-code today (a `CLAUDE.md`, a design-system file, a voice doc) and it doesn't fully solve the problem: the docs go stale, the docs capture only what the author thought to write down at the time, and agents read the docs flat rather than contextually. The compounding pain isn't *"we don't have docs"* — it's *"the loop from taste call → codification → propagation → audit doesn't exist, so the docs we have rot and the taste we apply doesn't stick."* **The codification primitive is the most universal value-add across the three, and the value is in the loop, not in the concept of repo-stored codification docs (which is increasingly mainstream).**

3. **The shape of a *judgment moment* differs per persona.** Maya's are *craft-level* (this copy, this animation, this empty-state feel). Jordan's are *consistency-and-distinctiveness-level* (this surface diverges from the codified aesthetic). Sam's are *fuzzy-articulation-level* (this feels wrong; help me say why). The inbox and viewer frame need to be polymorphic about what counts as a judgment moment — not hard-coded to one altitude or one shape.

4. **Their integration adapter priorities differ; the *intersection* is small.** Maya needs Figma + Cursor + Claude Code + OpenClaw + Lovable + Linear + GitHub. Jordan needs Figma + Inflight + Linear + Slack + OpenClaw. Sam needs Cursor + Claude Code + Codex + OpenClaw + Linear + Figma. The intersection is roughly *Figma + Linear + OpenClaw + at least one code-execution adapter (Cursor or Claude Code)*. v1 must serve the union over time; the priority ordering should weight by Maya (primary) but include OpenClaw as a near-universal adapter for personas in this AI-coding-first era.

5. **None of them describe their pain as "I need to orchestrate agents better."** That phrasing — which the prior framing of Designer leaned on — is engineer-coded and doesn't match how any of them think. They describe pain as *drift*, *repetition*, *convergence-to-mean*, *fuzzy-taste-lost-in-translation*, *attention-spread-thin*. That is the language the product surfaces should use.

6. **All three are AI-coding-fluent.** None of them write code from scratch as a primary activity. Maya can read; Jordan barely reads; Sam reads fluently but doesn't review. **Designer must not require code reading as a primary verb.** Diff-level surfaces should be the exception, not the rule; rendered surfaces, prose, and visual diffs are the primary register.

7. **Attention is the scarce resource — and prioritization is the hard part.** As agents produce more output per unit time, the human's attention does not scale. All three personas are already feeling the attention squeeze. But the harder half is *knowing where to look*: a list of 50 items sorted by timestamp is barely better than 50 notifications scattered across five tools. The system has to have *judgment about importance* — which item, if missed, would most damage the product? Which is on a surface this user has codified as high-craft? Which is the kind of thing they always end up redirecting? Designer's value scales with how well it answers *"where is your attention worth the most right now?"* — and that requires the inbox to be a **prioritization engine** that learns from the user's codified taste and engagement history, not just a feed. The quality of the filter is the product.

8. **Personal agents (OpenClaw) are already in the stack.** All three personas use a personal agent. This means Designer needs to interoperate with personal agents — both as a *source* (OpenClaw summarizes overnight activity and emits judgment-moment candidates to Designer) and as a *destination* (Designer's codifications inform OpenClaw's cross-tool tasks). Personal agents are not a future concern; they're a present-day adapter requirement.

## Open questions

- **Is Maya specific enough?** She's modeled on the dogfood pattern. If too specific, v1 ends up overfitted to one person's exact tool stack. If too generic, she stops being a useful forcing function. The fact that the cross-persona observations show all three sharing the core pains suggests she's specific without being narrow — but worth pressure-testing as JTBD work continues.
- **Is three personas the right scope?** Candidate fourth personas: an *agency designer / contractor* who works on multiple clients' products with even more tool diversity; an *engineering leader* who oversees AI-built work from the eng side (very different lens than PM); a *product / brand / marketing person* who manages the non-product surfaces (landing pages, email, etc.). Defer until JTBD reveals whether the existing three cover the job space.
- **Should we name anti-personas explicitly?** Useful to name who Designer is explicitly *not* for. Candidates: a developer who wants an AI IDE (Cursor's user); a product team using Linear + agents but with no taste-holder role (Linear's user); a designer working solo without AI agents in the loop (Figma's user); a hobbyist with no shipping pressure (Lovable's user). Could go in a sidebar here or fold into the *What Designer is not* section of vision.md.
- **The "distinctiveness" criterion is fuzzier than "correctness."** A linter knows when a token is off; no automated check knows when an empty state is too eager. The codification engine has to produce stances that *humans* can act on, even if they can't be auto-enforced. JTBD work should sharpen exactly what kind of stances count and how they're applied at agent-context-load time.
