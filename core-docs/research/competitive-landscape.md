# Competitive landscape

A structured register of companies and tools in or adjacent to Designer's category. Maintained as a living doc — review at least quarterly, more often if new entrants appear.

**How to read each entry:**
- **What they do**: one-paragraph summary.
- **Designer's relationship**: *compete / integrate / watch / out-of-scope*.
- **What to monitor**: specific signals that would change Designer's posture toward this tool.

**Cross-references:**
- `rationale.md §3` for the competitive-geometry argument and `rationale.md §5` for the Osyle-defines-the-category note.
- `critique.md §1.3` for the spec-driven-development overlap risk, and `critique.md §2.4` for the integration-cooperation risk.
- ADR 0010 §3.10 for the *integrate-or-replicate* disposition table per primitive.

---

## Direct competitors

### Osyle — `osyle.com`

- **Positioning**: *"The Taste & Judgment Layer for AI."* Near-identical tagline language to Designer.
- **What they do**: backend SDK with three components — *Context Conditioning Engine*, *Expression Modulation*, *Osyle SDK* — that conditions AI outputs at inference time using curated datasets of aesthetic excellence. Targets individual creators, enterprises, and AI builders (the third group is most strategic — they want to be infrastructure other AI products embed). Claims ~50,000 early users.
- **Designer's relationship**: *complementary, with monitoring*. Different product shape (backend SDK vs. interactive cockpit; average-of-experts taste vs. user's-specific taste). See `rationale.md §5` for the full distinction. Possible future integration: Designer's AI taste companion could call Osyle as one model for general expert-taste conditioning, while Designer's codification engine handles the user-specific layer above.
- **What to monitor**:
  - Any move from backend SDK to a hosted cockpit / interactive surface. That would shift them from "complementary" to "direct collision."
  - Pricing and access changes that affect whether they're usable as an integration partner.
  - Funding announcements / public roadmap statements.
  - Whether their "expert-taste" model is good enough to be worth integrating (we'd want to evaluate output quality).

**Source**: [Osyle](https://osyle.com/)

---

## Adjacent — could expand into Designer's lane

### Augment Intent — `augmentcode.com/product/intent`

- **Positioning**: *"Build with Intent"* — spec-driven development app + agent orchestration. Multi-agent coordination platform for spec-aligned shipping.
- **What they do**: Coordinator agent reads codebase via their Context Engine, decomposes a spec into tasks with explicit dependencies, delegates to specialist agents in parallel. Three human gates: spec approval, task decomposition review, final diff review. Living spec; when requirements change mid-run, propagates to agents that haven't started yet.
- **Designer's relationship**: *adjacent, watch closely*. They own technical-spec-driven dev for engineering teams. Designer's codification primitive shares architectural shape (living markdown specs + human approval gates + agent propagation) but covers taste-spec, not technical-spec. Risk: they add `voice` / `principles` / `aesthetic` schema vocabulary and expand into Designer's lane.
- **What to monitor**:
  - Schema additions that touch voice/tone/principles/aesthetic concerns.
  - Their marketing language — if they start using "taste," "judgment," or "craft" prominently.
  - Their integration list — if they add Figma, Linear, design tools, that's a signal of upward expansion.
  - Customer use-case writeups that describe codifying non-technical preferences.

**Sources**: [Augment Intent product page](https://www.augmentcode.com/product/intent) · [Documentation](https://docs.augmentcode.com/intent/overview) · [Augment Code Intent Review — Awesome Agents](https://awesomeagents.ai/reviews/review-augment-code-intent/)

### Kiro — `kiro.dev` (AWS)

- **Positioning**: *"Bring engineering rigor to agentic development."* Agentic IDE with spec-driven development at the core. Replaced Amazon Q Developer.
- **What they do**: Spec-first IDE. Agent creates `.spec.md` files (markdown + YAML frontmatter), pauses for human review, builds against approved spec, updates spec with discoveries. Uses automated reasoning to validate requirements consistency and surface gaps as two-option questions to the user. Iterative throughout — users can refine requirements, update designs, reorder tasks, checkpoint progress.
- **Designer's relationship**: *adjacent, watch closely*. Same overlap risk as Intent. Additionally: Kiro is an IDE, so it's more directly competitive with Cursor than with Designer — but the *codification mechanism* is similar to Designer's. If Kiro's `.spec.md` files start carrying voice/principles content, the line blurs.
- **What to monitor**:
  - Same as Intent (schema expansion into taste vocabulary).
  - Specifically: if Kiro adds cross-tool integration (Linear pull, Figma view), that's a major shift toward Designer's hub posture.
  - AWS's level of investment — Kiro replaced Amazon Q Developer, so it's load-bearing for AWS's AI-coding strategy.

**Sources**: [Kiro homepage](https://kiro.dev/) · [Specs just got faster and smarter](https://kiro.dev/blog/faster-smarter-specs/) · [AWS Kiro Replaces Amazon Q Developer — byteiota](https://byteiota.com/aws-kiro-replaces-amazon-q-developer-spec-driven-ide/)

### Tessl — `tessl.io`

- **Positioning**: Spec-driven development framework + registry. *"Specs describe intent in structured, testable language; agents generate code to match them."*
- **What they do**: Specs as markdown files (`.spec.md`) with YAML frontmatter (name, description, target globs). Annotations `[@generate]` and `[@describe]` make the human/agent contract explicit. Agent pauses for review, builds against requirements, then updates specs with anything discovered during development. Bidirectional flow between spec and code.
- **Designer's relationship**: *adjacent, watch closely*. Same overlap risk. Tessl has explicit *registry* — a shared library of specs. If a "taste spec" or "voice spec" category appears in their registry, the overlap intensifies.
- **What to monitor**:
  - Registry additions — what categories of specs are accumulating community traction?
  - Any annotation vocabulary that touches subjective / taste concerns (currently their annotations are `[@generate]`, `[@describe]` — technical-spec-coded).
  - Marketing toward designers or product people specifically (currently engineering-coded).

**Sources**: [Tessl docs — Spec-Driven Development with Tessl](https://docs.tessl.io/use/spec-driven-development-with-tessl) · [Tessl — Spec-Driven Development 10 things you need to know](https://tessl.io/blog/spec-driven-development-10-things-you-need-to-know-about-specs/) · [Tessl Registry](https://tessl.io/registry/tessl-labs/spec-driven-development/1.0.5)

### GitHub Spec Kit — `github.com/github/spec-kit`

- **Positioning**: Open-source toolkit for spec-driven development. *"Specifications as source of truth; code as generated output that serves the specification."*
- **What they do**: Spec → Plan → Tasks → Implement workflow. YAML-defined multi-step resumable workflows with human review gates. Spec changes are systematic regenerations rather than manual rewrites — additive (clarifications, refinements) not destructive.
- **Designer's relationship**: *adjacent, watch closely*. Same overlap risk. Spec Kit is open-source, so the community could extend it in any direction — including taste-spec — even without GitHub's involvement.
- **What to monitor**:
  - Community contributions / extensions touching voice/principles/aesthetic concerns.
  - GitHub's own integration of Spec Kit into Copilot or other surfaces — if Copilot starts loading spec.md files as default context, the spec-driven pattern becomes the agent-context-default for a large user base.

**Sources**: [GitHub Spec Kit repo](https://github.com/github/spec-kit) · [Spec Kit documentation](https://github.github.com/spec-kit/) · [Spec-Driven Development Workflow — DeepWiki](https://deepwiki.com/github/spec-kit/5-spec-driven-development-workflow)

---

## Integration targets (Designer embeds, ingests, or pushes to)

### Figma — `figma.com`

- **Relationship**: *embed + push*. Item viewer frame embeds Figma frames via embed kit; native Figma comments work through; codifications could push as Figma comments via REST API.
- **v1 adapter scope**: read file metadata, embed view, read/write comments, observe state transitions.
- **Watch**: Figma's embed-kit ToS for commercial-use restrictions; Figma AI features that touch the judgment-layer category (Figma's AI design-review assistant is already adjacent).

### Linear — `linear.app`

- **Relationship**: *integrate (pull + push)*. Pulls issue state, comments, design-review labels, agent-session events into the inbox; pushes briefs as Linear issues and decision artifacts as Linear comments.
- **v1 adapter scope**: webhook subscription, REST API for issue/comment CRUD, agent-session API as one source.
- **Watch**: Linear's own roadmap on cross-tool features; their pricing and API limits.

### GitHub — `github.com`

- **Relationship**: *integrate (pull)*. Pulls PR events, comments, CI status, review requests into the inbox.
- **v1 adapter scope**: webhook subscription, GitHub Apps API.
- **Watch**: GitHub's expanding agent-orchestration features (Copilot agentic workflows, merge queue, stacked PRs) — most are complementary but worth tracking.

### Agentation — `agentation.com`

- **Relationship**: *embed*. Designer's item viewer frame embeds Agentation's annotation overlay over rendered artifacts.
- **v1 adapter scope**: embed kit access, annotation read/write API.
- **Watch**: business viability (small company; we depend on their continued operation); any positioning moves toward the judgment-layer category.

### Inflight — `inflight.co`

- **Relationship**: *integrate (pull)*. When someone configures an Inflight review for the user, it surfaces in Designer's inbox; the user reviews inside the embedded Inflight view; feedback comes back as codification signal.
- **v1 adapter scope**: deferred until project lead has tried Inflight in real use. See open question in ADR §Open Questions.
- **Watch**: Inflight's roadmap and whether they expand into proactive critique (which would move them from complementary to overlapping). Currently they are task-driven (someone invites you to review) and Designer is overseer-driven (you choose where to look). Different modes; complementary.

### Variant.com — `variant.com`

- **Relationship**: *embed*. Designer's item viewer frame embeds Variant's comparison view; Designer ingests variant sets and the user's curation actions as taste signals.
- **v1 adapter scope**: variant-set embed, selection/rejection event capture.
- **Watch**: pricing, embed-kit availability for commercial use, any move into a hub posture.

### Lovable, v0, Figma Make — generation tools

- **Relationship**: *embed + push*. Designer can route variant-generation requests through these; embed their output for review; push codifications back (e.g., voice file → Lovable system prompt).
- **v1 adapter scope**: usually one-shot generation per request; little ongoing state.
- **Watch**: which of these consolidates into the dominant generation tool; whether they add their own taste-codification features.

### Notion — `notion.so`

- **Relationship**: *integrate (push + light pull)*. Long briefs live in Notion; Designer's lightweight writing surface promotes to Notion on publish. Decision artifacts may live in Notion too.
- **v1 adapter scope**: Notion API for page create/update; database integration if briefs live in a Notion database.
- **Watch**: Notion's expanding AI features; potential conflict if Notion adds "AI taste capture" of its own.

---

## Runtime / orchestration tools (Designer integrates with as agent runtimes, but doesn't compete with directly)

### Cursor — `cursor.sh`

- **Relationship**: *integrate (runtime)*. Cursor's background agents are one of the agent runtimes Designer pulls judgment moments from and pushes codifications to.
- **Watch**: Cursor's pricing and API; whether they add cross-tool features (which would move them toward Designer's hub territory).

### Claude Code — Anthropic

- **Relationship**: *integrate (runtime)*. Designer's hybrid-mode (post-v1) can drive local Claude Code as one runtime among many.
- **Watch closely**: see `critique.md §2.6` for the Anthropic-specific defensibility analysis. Anthropic's roadmap is the single biggest external factor in Designer's strategic position. Watch quarterly for Claude.ai workspace features, Claude Code features, Skills marketplace, and any move toward cross-tool / cockpit / judgment-layer territory.

### Codex / OpenAI — `openai.com`

- **Relationship**: *integrate (runtime)*. Codex cloud is another runtime Designer integrates with.
- **Watch**: OpenAI's expanding cloud-agent capabilities; pricing changes; any explicit move into the cross-tool category (ChatGPT workspace agents are adjacent).

### OpenClaw — personal agent

- **Relationship**: *integrate (both source and propagation target)*. OpenClaw (and equivalents) are personal cross-tool agents the user already runs. Designer pulls overnight summaries, judgment-moment candidates from OpenClaw; pushes codifications so OpenClaw's cross-tool tasks incorporate the user's taste.
- **Watch**: whether personal-agent products consolidate; whether one of them adds a judgment-layer cockpit of its own.

---

## Adjacent — fast-growing category, not direct competition

### AI design-review tools

**Players**: Klay Studio Review, Canva Enterprise AI, Figma's AI design-review assistant, others.

- **What they do**: Assess a finished design against brand guidelines and emit feedback. After-the-fact review applied to an artifact already produced.
- **Designer's relationship**: *adjacent, complementary, integrate where useful*. Different category, different mechanism (review-tools-emit-feedback vs. Designer-codifies-and-propagates). Designer is upstream of review tools (capture critique signals from across all tools, codify the underlying stance, propagate back to influence future generation).
- **Market scale**: 71% of design-led companies investing in this category by end of 2026. 42% reduction in feedback cycles reported.
- **Watch**: whether any of them add cross-tool inbox features (which would move them toward Designer's hub posture). Currently they're scoped to their host platform (Klay inside Klay Studio, Canva AI inside Canva, etc.).

**Sources**: [Klay Studio — Top 7 AI Design Review Tools](https://www.theklaystudio.com/top-7-ai-design-review-tools-for-mid-to-large-creative-teams-in-2026/)

---

## Adjacent — different category, monitor for category-blur

### Agentic AI governance / oversight tools

**Players**: Lumenova, OneReach, Speeki, Arthur AI, others.

- **What they do**: Compliance and oversight tooling for agentic AI systems — accountability, audit logs, decision provenance, risk-proportionate oversight per EU AI Act Article 14 / NIST AI RMF requirements.
- **Designer's relationship**: *parallel category, watch*. Designer's cockpit is *architecturally* a human-oversight surface, but positioned consumer-first. If the compliance category matures and consolidates, B2B Designer could enter it; otherwise this is parallel.
- **Watch**: regulatory developments (EU AI Act enforcement, NIST AI RMF adoption); compliance tooling that expands into the design-judgment direction.

**Sources**: [The Agentic AI Governance Gap of Early 2026 — Lumenova](https://www.lumenova.ai/blog/agentic-ai-governance-gap/) · [Human-in-the-Loop: A 2026 Guide to AI Oversight — Strata](https://www.strata.io/blog/agentic-identity/practicing-the-human-in-the-loop/)

### Unified inbox tools (email + chat)

**Players**: Front, alfred_, Mailbird, ChatGPT workspace agents.

- **What they do**: Cross-channel inbox + AI triage for email and chat. Mature category.
- **Designer's relationship**: *out-of-scope, but pattern-precedent*. Designer's cross-tool inbox is the same shape but a different scope (AI-build-tool work, not email/chat). These tools confirm the cross-tool-inbox-with-AI-triage pattern works at scale; they're not direct competition.

**Sources**: [Best Unified Inbox for Teams in 2026 — this+that](https://www.thisandthat.chat/blog/best-unified-inbox-teams/)

---

## Out of scope (named here to be explicit)

- **IDEs**: Cursor, VS Code, JetBrains. Designer integrates with as runtimes; never competes on code editing.
- **Design canvases**: Figma, Subframe, Pencil. Designer integrates as embedded views; never builds its own canvas.
- **Hosted agent runtimes**: Devin, Charlie, Factory, Cyrus, Warp. Engineering-coded; different user category.

---

## Monitoring contract

Quarterly review of this doc:

1. Walk each entry. Has the company changed positioning, pricing, integration story?
2. Add any newly-discovered entrant.
3. For any entry whose **What to monitor** signal has fired, decide: does the change require a positioning response from Designer? If yes, propose an ADR amendment or roadmap change; capture rationale in `rationale.md` or `critique.md`.
4. Update the dates / states in this doc.

Update events that should trigger an off-cycle review:

- Any new product launch in the AI-coding or AI-design-tooling space that explicitly mentions "taste," "judgment," "craft," or "cockpit" in positioning.
- Any pricing or API access change from an integration target.
- Any acquisition or shutdown in this list.

---

## Last updated

2026-05-16. Initial creation from the May 2026 research conversations. Sources cited inline; consolidated bibliography in `rationale.md` and `critique.md`.
