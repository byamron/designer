# Rationale: why this direction is right

Designer is positioned as **the interface for the human function in AI-built software** — a cockpit where humans hold the line on taste as building gets automated. The full positioning lives in `core-docs/vision.md`. This document is the **evidence base** supporting that positioning, with inline citations to the public discourse, research, and competitive signals that validate the bet.

**Read this with `critique.md` open in another tab.** Every argument below has a counter-argument worth weighing; this doc is the case *for*, that doc is the case *against*. The honest position holds both at once.

The case has six stacked arguments:

1. The shift is real and observable now — not a forecast.
2. The failure mode is changing as agents get better.
3. The competitive landscape leaves a category open.
4. The bet improves as models improve.
5. The moat is the interaction pattern, not the backend automation.
6. Independent discourse is converging on the same framing.

Each section ends with a *strength-of-evidence* note. Sources are cited inline and consolidated at the bottom.

---

## 1. The agent share of software work is going vertical, now

The agent-built shift is not a forecast — it is observable in current data:

- **Karpathy** (Nov 2025 → early 2026): his personal coding ratio inverted from 80/20 human/AI to 20/80 in a few weeks. His own framing: *"I'm basically programming in English now."* [(36Kr)](https://eu.36kr.com/en/p/3747726516601353) [(Karpathy on X)](https://x.com/karpathy/status/2004607146781278521)
- **Dario Amodei (Anthropic CEO)**: predicted AI will be writing 90% of code in software development projects within 3–6 months (interview, March 2026). [(dev.ua)](https://dev.ua/en/news/amodey-1741759671) [(Quasa)](https://quasa.io/media/dario-amodei-s-bold-forecast-ai-on-the-brink-of-revolutionizing-software-engineering)
- **Sam Altman (OpenAI CEO)**: by end of 2025, *"the world's best coder will be an artificial intelligence."*
- **GitHub** (early 2026): **51% of code committed was AI-generated or AI-assisted.** [(banani.co)](https://www.banani.co/blog/ai-design-to-code-tools)
- **Anthropic Economic Index** (Aug 2025 → Feb 2026): *"computer and mathematical tasks"* jumped +14% on the API platform and dropped −18% on Claude.ai. Work is migrating from interactive use to programmatic/agentic use — the agent share of inference is the growing share. [(Anthropic Economic Index, March 2026)](https://www.anthropic.com/research/economic-index-march-2026-report) [(BuiltIn)](https://builtin.com/articles/anthropic-economic-index-2026-ai-jobs-report)
- **Anthropic Economic Index** also documents a **"deskilling effect"**: AI disproportionately handles the *higher-skill* components of jobs, leaving simpler tasks for humans. Counter-intuitive but well-evidenced — implies the human's remaining work is increasingly the work that *requires* judgment, not the work that's left over. [(AI Automation Global summary)](https://aiautomationglobal.com/blog/anthropic-ai-labor-report-white-collar-jobs-2026)
- **Anthropic's June 15, 2026 billing change** split programmatic usage (Agent SDK, `claude -p`, Linear/Conductor/OpenClaw integrations) from interactive use, with the programmatic half newly metered. The split exists because the programmatic half grew large enough to threaten subscription economics — concrete confirmation that agent-driven inference is now a major share of model usage. [(Anthropic — Agent SDK Credit)](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- **Linear** (March 2026): ~75% of enterprise workspaces have at least one coding agent installed; agent-completed work has 5× over three months. [(Linear — Introducing Linear Agent)](https://linear.app/changelog/2026-03-24-introducing-linear-agent)
- **Cursor** ships background agents that land PRs while the user is asleep; **OpenAI Codex** runs as plan-included cloud at 100–600 tasks per 5-hour window for Pro users; **Lovable / v0 / Figma Make** produce working interfaces from briefs in minutes.
- **Industry roadmaps** (Agentplace, Capgemini, Gartner): 2026 = strategic agent placement; 2027 = multi-agent mastery; 2028–2029 = autonomous transition; 2030 = agent-native transformation. **90% of B2B buying agent-intermediated by 2028** representing $15T in transactions (Gartner). [(Agentplace — Future of AI Agents 2026–2030)](https://agentplace.io/blog/the-future-of-ai-agents-2026-2030-industry-predictions-and-roadmap)
- **Gartner**: 80% of software engineers will need to upskill in AI-assisted development tools by 2027. [(BuiltIn — AI Skills Gap)](https://builtin.com/articles/anthropic-economic-index-2026-ai-jobs-report)
- **Hiring data** (Q1 2025 → 2026): generative-AI engineer listings ↑7× in two years; ~6M AI jobs projected to be created in 2026 alone; AI-related job openings +25.2% YoY at $156,998 median salary.

**Strength of evidence: very strong.** This is the most heavily-validated claim in the rationale. Multiple independent data sources converge. The agent share of software work is observably going up; the question is no longer *whether* but *what surface humans use to remain accountable for what gets shipped.*

---

## 2. As agents get better, the failure mode shifts from *correctness* to *distinctiveness*

The current failure mode of AI-generated work is no longer bugs — it is *competent-but-generic output.* The phenomenon has a name and an academic literature:

- The broader discourse converged on **"AI slop"** as the term for polished-but-generic AI output. Specific recurring patterns have been catalogued: Inter or Roboto fonts everywhere, purple-on-white gradients, glassmorphism cards, identical icon-on-top feature grids, badge-above-hero layouts. [(Medium — The End of "AI Slop")](https://medium.com/@abhinav.dobhal/the-end-of-ai-slop-how-ui-ux-pro-max-is-solving-the-design-crisis-in-ai-generated-code-bbc23995f0e0) [(Gian Gallegos — How to Actually Design with AI Without Making Generic Garbage)](https://www.giangallegos.com/how-to-actually-design-with-ai-in-2026-without-making-generic-garbage/)
- **Academic validation**: arXiv paper *"Interrogating Design Homogenization in Web Vibe Coding"* (2603.13036) frames the problem as a research subject: *"AI systems are known for their tendency to reproduce dominant style conventions found in training data… outputs quickly converge onto a narrow set of generic, familiar visual themes regardless of diverse starting prompts."* [(arXiv 2603.13036)](https://arxiv.org/abs/2603.13036)
- **Cultural-stagnation framing** has reached general media: AI-induced cultural stagnation is documented as already happening, not speculation. [(Futurism)](https://futurism.com/artificial-intelligence/ai-cultural-stagnation) [(The Conversation)](https://theconversation.com/ai-induced-cultural-stagnation-is_no_longer-speculation-its-already-happening-272488)
- **Industry framing**: *"AI is pattern completion at scale — it remixes what's already out there"* (Adobe). *"AI design tools amplify whatever taste you already have — if you don't know what good design looks like, AI will just execute bad ideas really efficiently."* [(Adobe — AI in design)](https://www.adobe.com/express/learn/blog/ai-in-design-recommendations)
- **Mitigation literature** has converged on **"productive friction"** as the design principle for re-introducing human judgment into AI workflows. Specific patterns: *attempt-first defaults* (let the user form a position before AI proposal is revealed), *decision checkpoints* (force a one-line reason before high-stakes outputs). [(Martin Fowler — Patterns for Reducing Friction in AI-Assisted Development)](https://martinfowler.com/articles/reduce-friction-ai/) [(Hili — The Friction Paradox)](https://www.gethili.com/journal/the-friction-paradox-why-ai-efficiency-might-be-stifling-design-innovation)
- **The deskilling angle** sharpens this: Anthropic's Economic Index documents AI *taking the higher-skill components* of work, leaving simpler tasks for humans. Implication: humans are pushed *up* the skill stack into work that requires judgment, taste, and framing — exactly the work that doesn't converge to the mean. [(Anthropic Economic Index)](https://www.anthropic.com/research/economic-index-march-2026-report)

**Strength of evidence: strong, with one open question.** Convergence-to-mean is well-documented as a current phenomenon. The *temporal* claim (it gets *worse* as agents improve, so the value of off-mean human direction goes *up*) is more original to our framing — see `critique.md` for the counter-argument that better models might also get better at off-mean output.

---

## 3. The competitive landscape leaves a category structurally open

No incumbent in the current AI-tooling landscape can credibly take Designer's position because each has a structural reason not to:

- **Linear is a tracker.** Its identity is "the issue tracker for engineering teams." Becoming taste-driven would alienate the engineering teams that are its core market. Its agent-session API is for *coordinating delegated work*, not for *hosting design judgment.* [(Linear — Agents docs)](https://linear.app/docs/agents-in-linear)
- **Cursor is the AI editor for developers.** Its primary user reads diffs and writes code. Becoming designer-friendly would dilute the editor identity and confuse the buyer.
- **Figma is the design tool.** It owns the canvas. It does not run agents and would need to rebuild its architecture to do so. *"Designing UI using AI"* (Stitch) is a generation feature, not a cross-tool judgment cockpit. [(Google Blog — Stitch)](https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-ai-ui-design/)
- **GitHub** is the code-and-PR layer. PR comments are diff-anchored — they assume the reader reads code.
- **Conductor, Devin, Charlie, Factory, Warp** are agent-orchestration tools coded for developers. Their primary verb is "spawn agents on tasks." None serve "apply taste to what agents produced."
- **AI design-review tools** (Klay Studio Review, Canva Enterprise AI, Figma's AI design-review assistant) — a fast-growing category (71% of design-led companies investing by end of 2026) — assess finished designs against brand guidelines. They are *after-the-fact review applied to an artifact already produced*, not *capture-of-critique-as-propagating-signal.* Adjacent category, different mechanism. [(Klay Studio — Top 7 AI Design Review Tools)](https://www.theklaystudio.com/top-7-ai-design-review-tools-for-mid-to-large-creative-teams-in-2026/)
- **Spec-driven dev tools** (Augment Intent, Kiro by AWS, Tessl, GitHub Spec Kit) handle *technical-spec drift* — preserving schemas, contracts, behavior across implementation. They live one layer below Designer architecturally. They are *complementary infrastructure for the engineering half*, not competition for the taste half. (See `critique.md` for the open question of whether they expand upward.) [(Martin Fowler — Understanding Spec-Driven Development)](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)

**The slot is unoccupied not because no one noticed, but because the obvious players each have an existing user whose identity they would have to violate to take it.** This is the strongest kind of competitive geometry: structural, not accidental.

**Strength of evidence: strong on the incumbent analysis; medium on the structural-disincentive claim** (incumbents *could* in principle reorient — they just generally don't, because their existing users punish strategic drift).

---

## 4. The bet improves as models improve — three compounding reasons

Most AI-tooling categories get *less* valuable as models improve (autocomplete becomes obsolete when generation does the whole file; spec-writing tools become obsolete when models read intent from sketches; coordination tools become obsolete when agents coordinate themselves). The judgment layer gets *more* valuable for three compounding reasons:

**4.1 Throughput.** Better models = faster pipelines = more agent-produced output per unit time = more leakage surface = more value from a tool that hosts the human's judgment and propagates it back. Volume alone drives value up.

**4.2 Convergence to mean.** Per §2 above: as agent quality improves, the failure mode shifts from *correctness* (which linters and design systems increasingly subsume) to *distinctiveness* (which no automation can solve). The human's value-add shifts from *fixing mistakes* to *pushing the work off the mean toward something distinctive.* This is the only structural argument I've seen that *predicts* judgment-layer value going up with model improvement rather than down.

**4.3 Attention as the scarce resource.** As output throughput goes up, the human's attention does not scale. The bottleneck shifts from *what the human can do* to *where the human looks*. **Karpathy is explicit about this**: *"humans are the bottleneck in any AI domain with a clear, computable metric."* [(Winbuzzer summary of Karpathy)](https://winbuzzer.com/2026/03/23/karpathy-humans-bottleneck-ai-research-xcxwbn/) By inverse: in domains where metrics are *not* computable (taste, craft, distinctiveness, framing), humans remain load-bearing — and a tool that helps them apply attention efficiently in those domains becomes more valuable as throughput grows.

The arithmetic does not invert; it compounds across all three.

The **post-AGI literature** converges on a related framing: *"The distinction between intelligence and creativity — between solving well-posed problems and posing problems in the first place — is the fault line that AGI cracks open. Intelligence is about computation. Creativity is about framing. AGI handles computation, but framing remains stubbornly human."* [(Forward Future — Life After AGI)](https://www.forwardfuture.ai/p/scale-is-all-you-need-part-4-1-the-post-agi-world) [(Medium — After AGI, What Are Humans For?)](https://medium.com/@gp2030/after-agi-what-are-humans-for-07f125ffa7cb)

**Strength of evidence: strong on throughput and attention; medium-strong on convergence-to-mean as a temporal trend.** The post-AGI framing is the long-term bet.

---

## 5. The moat is the interaction pattern, not the backend automation

A competent builder with OpenClaw + APIs + an LLM could, in principle, build the *backend* half of the codification engine. This is not theoretical — **Osyle** is shipping it.

**Osyle** (osyle.com) explicitly positions itself as *"the Taste & Judgment Layer for AI."* Near-identical tagline language to Designer's. The product is a backend SDK with three components — *Context Conditioning Engine*, *Expression Modulation*, *Osyle SDK* — that conditions AI outputs at inference time using *curated datasets of aesthetic excellence.* ~50,000 early users claimed. [(Osyle)](https://osyle.com/)

**This is exactly the backend-shape the argument predicts and defends against.** Osyle has no interactive cockpit, no inbox, no item viewer, no codification-from-the-user's-own-redirections. It sells *average-of-experts* taste as a conditioning service that other products embed. Designer sells *the user's-specific* taste as a cockpit they use. **These are different products in the same conceptual category.**

**The defense is the interaction pattern.** A taste-agent backend without a cockpit produces noisy auto-codifications the user has to verify after the fact, scattered notifications the user has to chase, and silent drift the user only discovers when a codification feels wrong. A taste-agent backend *with* a generic cockpit (admin panel, Slack bot, email digest) loses the proactive-zoom property that lets a user oversee work without being asked to.

Designer's defense is the *cockpit-grade surface for giving taste in a system* — six native surfaces (inbox, item viewer frame, AI taste companion, codification engine + living docs, lightweight writing, integration adapters) designed together as one interaction pattern. **That's what a backend agent does not have, and what is hard to retrofit.**

The Osyle / Designer geometry is **complementary, not collisional**: Designer could in principle integrate Osyle (or future equivalents) as one model the AI taste companion calls, while keeping the user-specific codification layer above it. *The race is for the cockpit; the backend is table stakes.*

**Strength of evidence: strong on the abstract argument; medium on "interaction patterns are hard to retrofit"** — see `critique.md` for the case that Anthropic specifically *could* ship a cockpit if they decided to.

---

## 6. The structural frame: Designer is the next interface in a known lineage

Every major wave of automation creates a new interface category for the human function it doesn't replace:

| Automation wave | Interface for the surviving human function | Category-defining tools |
|---|---|---|
| Typewriters → digital writing | *Writing* | Word, Pages, Google Docs |
| Manual ledgers → digital calculation | *Calculating* | VisiCalc, Excel, Sheets |
| Machine code → higher-level programming | *Programming* | VS Code, JetBrains, Cursor |
| Hand drafting → digital design | *Designing* | Illustrator, Sketch, Figma |
| **AI-built software → ???** | ***Taste / judgment*** | *(unoccupied; Designer is the candidate)* |

Each interface in this lineage became dominant because the underlying automation made the corresponding human function *more* central, not less — and because no general-purpose tool could host the specific shape of that function. **The structural pattern repeats.**

**Independent discourse is converging on the same recognition.** Multiple writers and thinkers are naming the same category in 2026, often using nearly identical language:

- **"Taste Is the New Bottleneck: Design, Strategy, and Judgment in the Age of Agents and Vibe-Coding"** (Designative, Feb 2026) — direct article title matching Designer's framing. [(Designative)](https://www.designative.info/2026/02/01/taste-is-the-new-bottleneck-design-strategy-and-judgment-in-the-age-of-agents-and-vibe-coding/)
- **Karpathy** (extensive 2026 writing): names taste, eval design, system boundaries, agent orchestration, domain-specific feedback loops, and "knowing when the model is off the rails" as the *new scarcities*; code generation, boilerplate, repetitive setup as the *new abundance.* [(Karpathy — Sequoia Ascent 2026)](https://karpathy.bearblog.dev/sequoia-ascent-2026/) [(AI Agents Simplified — Karpathy synthesis)](https://aiagentssimplified.substack.com/p/from-vibe-coding-to-agentic-engineering)
- **"Generation is cheap; curation is valuable. AI can produce 100 concepts in the time it takes to sketch one. Your job is knowing which one is right. Taste is the differentiator."** [(MindStudio — Taste as a Durable AI Asset)](https://www.mindstudio.ai/blog/taste-as-durable-ai-asset)
- **"Vibe coding plus product judgment becomes 'AI Product Engineer.' Vibe coding plus design becomes 'Designer who ships code.'"** — direct validation of the Maya persona's role label. [(Medium — Vibe Coding Is Over)](https://medium.com/@ahmed.hafdi.contact/vibe-coding-is-over-what-comes-next-is-much-harder-9fe95b509850)
- **Squer.io has formally created the role of "Intent Engineer"** — *"AI agents amplify problems with vague requirements because while a human developer can walk over and ask for clarification, an AI agent cannot."* This is the exact problem Designer's brief + codification + companion surfaces are built for. [(Squer — Why We Created the Intent Engineer)](https://www.squer.io/blog/why-we-created-the-intent-engineer)
- **Productboard**: *"AI is changing how products are built but not why product judgment matters; if anything, it raises the stakes, as when shipping becomes easier, every decision carries more weight."* [(Productboard — Product Craft When AI Changes the Stakes)](https://www.productboard.com/blog/product-craft-when-ai-changes-the-stakes/)
- **UC Berkeley iSchool** is researching *"Aesthetic Taste and Its Limits: Breakdowns in Prompt-Mediated Design of User Interfaces"* (2026 project). [(UC Berkeley iSchool)](https://www.ischool.berkeley.edu/projects/2026/aesthetic-taste-and-its-limits-breakdowns-prompt-mediated-design-user-interfaces)
- **Adobe**: *"AI in design and content: Why taste is the true differentiator."* [(Adobe)](https://www.adobe.com/express/learn/blog/ai-in-design-recommendations)
- **Roland Berger** (consulting) has built **"TasteIndex"** — managing taste as an AI solution. [(Roland Berger)](https://www.rolandberger.com/en/Expertise/Solutions/Taste-Index.html)
- **Codified-docs-in-code is mainstream**: `AGENTS.md` became a Linux Foundation standard in December 2025 (jointly authored by Anthropic, OpenAI, Google, Sourcegraph, Cursor, Factory). Google Labs shipped **`DESIGN.md`** in April 2026 — *"design system specification readable by AI agents"* with YAML front-matter + Markdown rationale + a CLI validator. [(DEV — AGENTS.md, SKILL.md, DESIGN.md)](https://dev.to/aws-builders/agentsmd-skillmd-designmd-how-ai-instructions-split-into-three-layers-d0g) [(DESIGN.md spec)](https://designmd.app/what-is-design-md/) [(Linux Foundation AGENTS.md)](https://agents.md/)

**Strength of evidence: very strong on convergence.** Multiple independent sources, across academic, industry, and consulting domains, naming the same category in nearly identical language. Designer didn't invent this framing; we are one of multiple candidates to occupy the slot.

---

## Summary

| Argument | Strength | Open question (see critique.md) |
|---|---|---|
| 1. Agent share of work going vertical | Very strong | None significant |
| 2. Convergence to mean as failure mode | Strong | Whether trend amplifies with model quality (vs. better prompts solving it) |
| 3. Competitive geometry leaves category open | Strong | Whether incumbents (Anthropic) violate their own positioning to take it |
| 4. Bet improves with model improvement | Strong–medium | Whether attention prioritization is a *substantive* product capability or a thin layer |
| 5. Interaction pattern is the moat | Medium-strong | Whether interaction patterns are actually hard to retrofit for well-resourced players |
| 6. Independent discourse convergence | Very strong | Whether convergence is signal of category truth or signal of category crowding |

The arguments stack. Designer either occupies this interface category with a cockpit-grade implementation, or someone else does. The category is real, the demand is real, and the timing is right.

**The case for the direction is strong. The case for the *specifics* (six surfaces, codification distill, persona choices) is what `critique.md` interrogates.**

---

## Consolidated sources

Sources cited in this document, organized by argument:

### §1 — Agent share going vertical

- [Karpathy on AI Taking Over 80% of Code — 36Kr](https://eu.36kr.com/en/p/3747726516601353)
- [Karpathy on X (programmer post)](https://x.com/karpathy/status/2004607146781278521)
- [Amodei: AI will replace programmers within a year — dev.ua](https://dev.ua/en/news/amodey-1741759671)
- [Dario Amodei's Bold Forecast — Quasa](https://quasa.io/media/dario-amodei-s-bold-forecast-ai-on-the-brink-of-revolutionizing-software-engineering)
- [AI Design-to-Code Tools 2026 (51% GitHub stat) — Banani](https://www.banani.co/blog/ai-design-to-code-tools)
- [Anthropic Economic Index Report (March 2026)](https://www.anthropic.com/research/economic-index-march-2026-report)
- [Anthropic Economic Index Shows the AI Skills Gap Is Growing — BuiltIn](https://builtin.com/articles/anthropic-economic-index-2026-ai-jobs-report)
- [Anthropic Research: 75% of Programmer Tasks Now Done by AI — AI Automation Global](https://aiautomationglobal.com/blog/anthropic-ai-labor-report-white-collar-jobs-2026)
- [Anthropic — Agent SDK Credit](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- [Linear — Introducing Linear Agent](https://linear.app/changelog/2026-03-24-introducing-linear-agent)
- [Agentplace — Future of AI Agents 2026–2030](https://agentplace.io/blog/the-future-of-ai-agents-2026-2030-industry-predictions-and-roadmap)

### §2 — Convergence to mean

- [The End of "AI Slop" — Medium](https://medium.com/@abhinav.dobhal/the-end-of-ai-slop-how-ui-ux-pro-max-is-solving-the-design-crisis-in-ai-generated-code-bbc23995f0e0)
- [How to Actually Design with AI in 2026 (Without Making Generic Garbage) — Gian Gallegos](https://www.giangallegos.com/how-to-actually-design-with-ai-in-2026-without-making-generic-garbage/)
- [Interrogating Design Homogenization in Web Vibe Coding — arXiv](https://arxiv.org/abs/2603.13036)
- [AI Cultural Stagnation — Futurism](https://futurism.com/artificial-intelligence/ai-cultural-stagnation)
- [AI-induced cultural stagnation — The Conversation](https://theconversation.com/ai-induced-cultural-stagnation-is-no-longer-speculation-its-already-happening-272488)
- [AI in design: Why taste is the true differentiator — Adobe](https://www.adobe.com/express/learn/blog/ai-in-design-recommendations)
- [Patterns for Reducing Friction in AI-Assisted Development — Martin Fowler](https://martinfowler.com/articles/reduce-friction-ai/)
- [The Friction Paradox — Hili](https://www.gethili.com/journal/the-friction-paradox-why-ai-efficiency-might-be-stifling-design-innovation)

### §3 — Competitive geometry

- [Linear — Agents docs](https://linear.app/docs/agents-in-linear)
- [Google Blog — Stitch (Figma's AI UI tool)](https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-ai-ui-design/)
- [Klay Studio — Top 7 AI Design Review Tools 2026](https://www.theklaystudio.com/top-7-ai-design-review-tools-for-mid-to-large-creative-teams-in-2026/)
- [Martin Fowler — Understanding Spec-Driven Development (Kiro, spec-kit, Tessl)](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)
- [Augment Intent — product page](https://www.augmentcode.com/product/intent)

### §4 — Bet improves with model improvement

- [Karpathy: Humans Are the Bottleneck — Winbuzzer](https://winbuzzer.com/2026/03/23/karpathy-humans-bottleneck-ai-research-xcxwbn/)
- [Life After AGI — Forward Future](https://www.forwardfuture.ai/p/scale-is-all-you-need-part-4-1-the-post-agi-world)
- [After AGI, What Are Humans For? — Medium](https://medium.com/@gp2030/after-agi-what-are-humans-for-07f125ffa7cb)

### §5 — Moat is interaction pattern

- [Osyle — The Taste & Judgment Layer for AI](https://osyle.com/)

### §6 — Independent discourse convergence

- [Taste Is the New Bottleneck — Designative](https://www.designative.info/2026/02/01/taste-is-the-new-bottleneck-design-strategy-and-judgment-in-the-age-of-agents-and-vibe-coding/)
- [Karpathy — Sequoia Ascent 2026](https://karpathy.bearblog.dev/sequoia-ascent-2026/)
- [From Vibe Coding to Agentic Engineering — AI Agents Simplified](https://aiagentssimplified.substack.com/p/from-vibe-coding-to-agentic-engineering)
- [Taste as a Durable AI Asset — MindStudio](https://www.mindstudio.ai/blog/taste-as-durable-ai-asset)
- [Vibe Coding Is Over — Medium](https://medium.com/@ahmed.hafdi.contact/vibe-coding-is-over-what-comes-next-is-much-harder-9fe95b509850)
- [Why We Created the Intent Engineer — Squer.io](https://www.squer.io/blog/why-we-created-the-intent-engineer)
- [Why Product Judgment Matters More Than Velocity in the AI Era — Productboard](https://www.productboard.com/blog/product-craft-when-ai-changes-the-stakes/)
- [Aesthetic Taste and Its Limits — UC Berkeley iSchool](https://www.ischool.berkeley.edu/projects/2026/aesthetic-taste-and-its-limits-breakdowns-prompt-mediated-design-user-interfaces)
- [TasteIndex — Roland Berger](https://www.rolandberger.com/en/Expertise/Solutions/Taste-Index.html)
- [AGENTS.md, SKILL.md, DESIGN.md split — DEV](https://dev.to/aws-builders/agentsmd-skillmd-designmd-how-ai-instructions-split-into-three-layers-d0g)
- [DESIGN.md spec — Google Labs](https://designmd.app/what-is-design-md/)
- [AGENTS.md — Linux Foundation standard](https://agents.md/)
