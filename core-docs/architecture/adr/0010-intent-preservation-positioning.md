# ADR 0010 — Intent preservation as Designer's positioning

**Status:** proposed
**Date:** 2026-05-15
**Deciders:** user, after a multi-turn strategic conversation triggered by external research on agent-automation trends (May 14, 2026 research synthesis on the `research-claude-scheduling-automation` branch)
**Supersedes:** none directly. Sharpens or reverses several entries in `spec.md` §Decisions Log (enumerated in §6 below). Builds on ADR 0008 (chat pass-through) and ADR 0009 (trustworthy shipping).

## Context

Designer's prior framing was *"a cockpit for orchestrating AI-managed product work."* That framing scoped the product around **orchestration** — running agents, coordinating tracks, managing parallel work, wrapping the user's local Claude Code as the runtime. Most architectural decisions in `spec.md` (workspace/track/team primitives, parallel-work coordination, workspace lead as Claude session, "Claude Code is the runtime") follow from that orchestration framing.

Two forces pushed against it during May 2026:

1. **The market is filling in the orchestration layer fast.** Linear's agent-session API + delegation model + 75% workspace adoption among enterprise users; Cursor background agents; Codex cloud-included; GitHub native stacked PRs + merge queue; Devin / Charlie / Factory / Cyrus on the agent-runtime side. Anthropic's June 15, 2026 billing change splits programmatic from interactive use, signaling that "wrap Claude Code in a cockpit" is becoming a commodity layer with strong incumbents.

2. **The orchestration framing under-served the actual user.** Every multi-agent orchestrator on the market — Cursor, Conductor, Devin, Linear's delegation flow — assumes the human eventually reads diffs, terminal output, repo trees. The interventions available to a non-engineer are coded for engineers: tickets, statuses, branches, PR comments. None give a designer / PM / founder primitives for *applying taste*: variant comparison, pixel-anchored annotation, plan approval at design-direction altitude, declaration of intent as a first-class artifact. The unserved verb is **"redirect with craft."**

A multi-turn discussion (May 15, 2026) converged on a sharper positioning that resolves both pressures: as agents automate more of the software-creation pipeline, the human's role narrows but intensifies — they hold the line on *intent*. Without a tool, intent leaks at every handoff (brief → spec → agent A → agent B → PR → merged code → user). Each step approximates; the gaps compound; the product drifts toward generic. **More automation = more intent-leakage surface.** A tool whose explicit purpose is to re-inject intent at the leakage points is a coherent category, defensible against incumbents who can't take this position without alienating their existing users (Linear can't become taste-driven; Cursor can't become designer-friendly).

This ADR codifies the new positioning, the user role and verbs that follow from it, the primitives required to support those verbs, and the architecture posture (router-first, evolving to hybrid). It enumerates the prior decisions it sharpens or reverses, and sets up the roadmap rewrite as a derivation from this document rather than a separate rethink.

## Decision

Six coupled changes:

1. **A new mission framing** — replacing the "cockpit for orchestrating AI-managed product work" line at the top of `spec.md` with the intent-preservation framing in §1 below.
2. **A sharpened user role and verb set** — §2 below; updates `spec.md` §Vision and CLAUDE.md §Product Principles.
3. **Nine first-class primitives** — §3 below; some new, some sharpening of existing concepts.
4. **A router-first architecture posture** with a defined evolution path to hybrid — §4 below.
5. **A visual layer commitment** scoped explicitly as *viewer / composer / annotator*, not creator — §5 below.
6. **Explicit reversals and sharpenings** of prior decisions in `spec.md` §Decisions Log — §6 below.

What this ADR does **not** do: rewrite the active roadmap, redesign individual surfaces, or amend ADR 0001 (Claude runtime primitive — see §6 for the nuanced relationship), ADR 0002 (frozen-contract event vocabulary — preserved), ADR 0008 (chat pass-through — preserved), or ADR 0009 (Build/Harden alternation, parking-lot mechanism, golden-path verification — preserved). The roadmap rewrite is downstream work that derives from this document; §7 sets the principles that govern it.

### 1. The mission

> **Designer is the judgment layer for software built by agents.**
>
> As agents take on more of the execution, the human's role narrows but intensifies: they hold the line on intent. Designer is where human designers, founders, and PMs impart taste and preserve design intent through the increasingly automated software-creation pipeline — where intent is *articulated, declared, **codified**, distributed, observed for drift, and re-injected when drift is detected.* Every Designer surface serves one of those six steps. **Codification is the durable middle:** it turns every act of human judgment from an episodic re-injection into a permanent guardrail that propagates forever.

This framing is user-facing (it names the why), falsifiable (intent either is or isn't preserved in shipped surfaces), and model-improvement-resistant (better agents → more leakage volume → more value from a tool that re-injects intent).

The prior mission line in `spec.md` (*"a cockpit for a new kind of product worker… orchestrates a team of AI agents to take ideas from intent to shipped product"*) is replaced by this framing.

### 2. The user role and verbs

The user is an **intent-holder**: a clear thinker with domain expertise (designer, PM, founder, full-stack builder with taste) whose leverage is *not* in writing code or coordinating engineers but in *knowing what good looks like and ensuring shipped work matches.*

Their verbs, in the rough order of frequency under this positioning:

- **Variant generation** — asking for many alternatives to a design or implementation question.
- **Curation** — selecting from variants; rejecting; requesting more; blending.
- **Critique** — pixel-, region-, or span-anchored feedback on artifacts; voice or text.
- **Commenting on ideas and directions** — broader, less-anchored feedback at the conceptual level.
- **Making design decisions** — declaring "we go this way" with reasoning, durably.
- **Declaring intent** — upstream briefs and direction-setting before agents execute.
- **Writing** — durable prose: declarations, briefs, manager-voice summaries, decisions.
- **Brainstorming** — exploratory dialogue with an AI partner, *including* generative output (diagrams, wireframes, prototypes, edits/remixes of existing artifacts) when a sketch makes the point clearer than words.
- **Evaluating taste** — judgment moment by judgment moment; the per-item act of "is this good."

Notably absent from this list: managing agents, running parallel tracks, monitoring fleets, reviewing diffs, coordinating PRs, scheduling work, assigning issues. Those live in the input-source tools (Linear, GitHub, Cursor, Codex, the user's local Claude Code). Designer does not compete on any of them.

CLAUDE.md §Product Principles' *"Manager, not engineer"* tightens to *"Intent-holder, not orchestrator."* Both framings agree the user isn't a developer; the new framing is sharper about what they *do.*

### 3. Primitives

Nine primitives carry the verbs. Some are new; some sharpen concepts that exist diffusely in the current spec.

1. **Judgment moment / attention item.** Source-agnostic first-class artifact representing "this needs your judgment now." Has a type (variant ready for curation, plan awaiting sign-off, decision pending declaration, critique queued on an artifact, drift detected against intent), a source (Linear / GitHub / local agent / Designer-detected), an urgency-importance signal, a link back to source-of-work, and a state machine (open → engaged → decided / dismissed). Generalizes Decision #65 (approvals as project artifacts in a global inbox) to all judgment categories. The router's currency.

    **The inbox is a prioritization engine, not just a queue.** Multiple signals feed importance ranking: the codified taste (this surface is high-craft because the user has redirected it repeatedly; this is low-stakes because it's tested and on a non-craft surface), source metadata (issue priority, PR scope, commenter identity), the user's engagement history (dismissed similar items in the past; engaged with this category recently), drift signals from the audit verb (§3.9), and time decay (how long has this been pending). The user can override and re-rank; the engine learns from those overrides. Prioritization is a substantive product capability — *the quality of the filter is the product* — not just sorting. A passive list ranked by timestamp would be barely better than the scattered-notifications-across-five-tools status quo it replaces.

2. **Variant set.** N artifacts presented as siblings, with curation actions (select, reject, blend, request-more, redirect-with-feedback). Renderable proxy required: visual for UI work, text/diff for prose, summary for code. Outputs flow into decisions, critiques, or back to the source as redirection signal.

3. **Decision artifact.** First-class declaration with lifecycle and supersession (matches the pattern from Decision #66 for reports). The user's "we go this way" gets a durable home with reasoning, links to the variants/critiques/conversations that informed it, and an automatic supersession chain when reversed. Today's `spec.md` Decisions Log is the manual paper version of this primitive; the in-app version makes it operable.

4. **Critique artifact.** Pixel-, region-, span-, file-, or whole-artifact-anchored comment. Text and voice. Routes back to source-of-work as redirection signal. Agentation (currently vendored from the Mini taste-loop) is the prototype primitive; this lifts it from internal-tool to user-product.

5. **Brief / declaration of intent.** Upstream prose artifact that anchors a body of work. The thing the user writes *first*, before agents go off. Distinct from a Decision (briefs declare *what to make*; decisions declare *which way to make it after exploration*).

6. **Writing surface.** Durable, codified prose. The manager's voice. Distinct from chat. Today's prose lives mostly in repo `.md` files and chat threads; this primitive gives it an in-app first-class home that knows about briefs, decisions, and other artifacts.

7. **AI taste companion.** A Designer-native agent that lives *in context* — on a judgment moment, a codification doc, an embedded artifact view, a brief in progress — and helps the user act efficiently. **The moat is the loaded taste context, not the chat interface.** What makes the companion better-than-general-chat in any given moment is what it has at hand: the project's codifications, the source-tool state, the user's recent judgment history, the artifact in front of them, the relationships between this item and prior codifications. ChatGPT can do general thinking better; this companion does *this-project, this-moment* thinking better. Pattern follows Linear's agent model — context-bound by default, action-capable, the chat is incidental and the context is the value.

    Capabilities by context:
    - On a **judgment moment**: draft the redirection; show related codifications; suggest the action.
    - On an **embedded artifact view**: critique drafting; translate the user's annotation into the right register for each downstream tool; propose codification candidates from the annotation's underlying premise.
    - On a **codification doc**: sharpen a principle; propose refinements based on recent activity; surface tensions with other docs.
    - On a **brief in progress**: draft opening; pressure-test framing; surface alignment or tension with prior codifications.
    - **Global mode** (used rarely, but available): *"what should I codify from this week"*; brainstorm a direction from scratch.

    **Expressive tools, never executive.** The companion can draft, sketch, edit codification docs, and propose drafts of redirections to push downstream. It does not directly mutate the user's product code, make git commits, deploy, or modify the user's dev environment — those live with the user's coding agents in the user's coding tools.

    **Significantly-better-than-elsewhere gate.** For each contextual entry, the design question is: *is using Designer's companion here meaningfully better than copy-pasting into Claude.ai with the context*? If yes (because the context is rich and lives natively in Designer), ship the chat entry. If no, don't add the surface. Chat interfaces are not moats; loaded context is.

    Local model where adequate; hosted model when the thinking is harder.

    *Subsumes what an earlier version of this ADR called "brainstorming surface" — same expressive-vs-executive line, but reframed around context-anchored entries rather than a standalone surface.*

    **Future option (post-v1):** the companion could call an external backend taste-conditioning service — **Osyle** (osyle.com) is the most concrete example today; equivalents will appear — for general expert-taste conditioning, while Designer's own codification engine handles the *user-specific* layer above it. This is a possible architecture, not a v1 commitment, but it is worth flagging so the companion's tool catalog is designed with *external-model-call capability* from day one. The integrate-or-replicate principle from §3.10 applies here too: when the backend taste-conditioning space matures, defer to the best-in-class provider rather than building our own.

8. **Source-tool integration layer.** Plugin-shaped adapters for Linear, GitHub, Cursor, Codex, and (in the hybrid future, §4) local Claude Code. **Bidirectional** (see §4.D): each adapter *pulls* source-side state into the router as judgment moments, and *pushes* codified taste (§3.9) back to the source so external generation incorporates it. Router-mode v1 ships 1–2 adapters; hybrid-mode adds the local-Claude-Code adapter as one source among many.

9. **Taste codification artifact.** Living, scoped, evolving, supersedable documentation of the user's preferences — design language, voice, decisions, tensions, per-component conventions. **Without this primitive, critique evaporates. With it, critique compounds.** Sourced from the user's accumulated critiques (§3.4), decisions (§3.3), curation choices on variant sets (§3.2), and redirections inside brainstorm sessions (§3.7). Synthesized by local models running the *drain → distill → propose → propagate → audit* loop:

    - **Drain** — capture raw signal (automatic, after each cycle of work).
    - **Distill** — local model synthesizes recurring patterns into proposed codification updates.
    - **Propose** — distilled patterns enter the router as judgment moments; user approves, edits, or rejects per the autonomy gradient (Decision #19).
    - **Propagate** — approved codification pushes to dependents: agent system prompts on next session, source-tool integrations (so external generators see current taste), in-app surfaces that enforce or display it. The bidirectional integration layer (§3.8 / §4.D) is the propagation channel.
    - **Audit** — given current codification, observe recent and in-flight work for *taste drift* (work that diverges from codified stance, not work that violates correctness rules). Surface divergences as attention calls in the router — *"the recent error messages sound apologetic; the voice file says we don't apologize. Wanted to flag."* Not enforcement. The human decides whether the work needs redirecting or the codification needs refining. Closes the loop the other direction: codification flows downstream into generation; taste drift flows upstream into the attention queue. **Correctness drift (token violations, accessibility issues, code style) is out of scope — that is the design system's, linter's, and audit tool's job, and they do it well.** **Notably, this verb is largely *unoccupied territory* in the broader market.** Spec-driven dev tools (Augment Intent, GitHub Spec Kit) audit against *technical* specs — schemas, contracts, behavior — and ship in CI. AI design-review tools (Klay Studio Review, Canva Enterprise AI, Figma's review assistant) assess a finished design against brand guidelines. Neither audits *in-flight work against the user's codified taste* and surfaces the result as a judgment moment in a cross-tool inbox. That is the gap Designer occupies at this verb.

    Lives in the user's repo as `.md` files (Decisions #17, #28) focused on the taste layer: `voice.md` (how the product sounds), `principles.md` (what it stands for and refuses), `decisions.md` (strategic calls), `tensions.md` (places where principles conflict and require case-by-case judgment). The user's existing design system (Mini, Material, Shadcn, custom) lives separately and continues to handle tokens, components, and correctness. Scopes: **project-level** in v1; **org-level** (cross-product brand) and **personal-level** (this designer's preferences across projects) are scope-axis additions for later. Temporal pattern: freeze-and-supersede (Decision #66).

    **Note: codified-docs-in-code already exist broadly** — `CLAUDE.md`, `AGENTS.md` (a Linux Foundation standard since December 2025, jointly authored by Anthropic, OpenAI, Google, Sourcegraph, Cursor, and Factory), and most recently Google Labs' `DESIGN.md` (April 2026; YAML front-matter for design tokens + Markdown rationale + a CLI validator: `npx @google/design.md lint`). The docs-in-code pattern is no longer niche; it is the emerging mainstream of AI-assisted development, splitting into formal layers (AGENTS.md for project context, SKILL.md for capabilities, DESIGN.md for design tokens + rationale). Designer's value is not the *concept* of repo-stored codifications (that's increasingly mainstream) but the *loop*: codifications emerge from actual redirections rather than write-once authoring, get refined as taste sharpens rather than going stale, propagate contextually to the relevant agent rather than being read flat at session start, and surface drift as judgment moments rather than sitting as static reference. *Without the loop, codification docs rot.* The loop — not the docs — is the moat at this primitive.

    **This primitive already exists in working form** as the Mini taste-loop skills (`drain-feedback`, `distill-feedback`, `propagate-language-update`) currently used internally for Designer's own dogfood. The v1 build cost is exposing the loop as a user-facing product capability scoped to the user's project, not inventing it. This is rare for positioning shifts of this magnitude and significantly de-risks the arc.

These primitives cluster:

- **Front-of-loop** (figuring out what you want): brief, writing.
- **Generative middle** (exploring options): variant set.
- **Act of loop** (judging what's been generated): critique, decision.
- **Meta-layer** (routing attention): judgment moment.
- **Compounding layer** (turning episodic acts into durable preferences): taste codification.
- **Cross-cutting partner** (present in every context, gated by the better-than-elsewhere test): AI taste companion.
- **Plumbing**: source-tool integration layer.

### 3.10 v1 disposition: hosted, embedded, passthrough, cut

A later strategic conversation (May 16, 2026) sharpened the v1 scope by drawing a hard line: **Designer hosts only what no existing tool does well; everything else integrates rather than replicates.** Building a worse version of Variant, Inflight, Agentation, Figma, or Notion would be the canonical scope-creep failure mode for this product. The disposition per primitive:

| Primitive | v1 disposition | Notes |
|---|---|---|
| Judgment moment / attention item (§3.1) | **Hosted** | The cross-tool inbox is uniquely Designer's lane. No existing tool does cross-tool attention routing across a heterogeneous AI-build pipeline. |
| Variant set (§3.2) | **Embedded** (Variant.com, Lovable, v0, Cursor) | Designer ingests variant sets and the user's curation actions as taste signal; comparison happens in the source tool's view embedded inside Designer's item viewer frame. |
| Decision artifact (§3.3) | **Hosted-light** | Decision lifecycle and supersession live in Designer; the actual text may be authored with companion help. |
| Critique artifact (§3.4) | **Embedded** (Agentation, Inflight, Figma comments, PR comments) | Designer ingests critique signals from where the user already critiques. Annotation tools are not Designer's lane; replicating them would be a worse version of mature tools. |
| Brief / declaration of intent (§3.5) | **Embedded or hosted-light** | Long briefs live in Notion / Linear / Google Docs (integrated); a lightweight in-app surface for short briefs that already have context in Designer and that promote into an external issue on publish. |
| Writing surface (§3.6) | **Hosted-light** | A minimal in-app writing surface paired with the companion; major doc work happens in the user's writing tool. |
| AI taste companion (§3.7) | **Hosted** | Designer-native. The cross-tool, taste-loaded context is the moat; no other tool can host this. |
| Source-tool integration layer (§3.8) | **Hosted (plumbing)** | v1 ships with Agentation, Figma, Linear, GitHub adapters; Variant, Inflight, Cursor, Lovable in the second wave. |
| Taste codification artifact (§3.9) | **Hosted** | The codification engine + living docs editor + propagation engine. The compounding-leverage core; uniquely Designer's lane. Already exists in working form as Mini's taste-loop. |
| Designer Noticed (was Phase 21.A / 26 portfolio) | **Cut from v1** | Forge (the user's Claude Code plugin) is the working version of workflow-pattern detection on session transcripts. Designer-as-router doesn't host the transcripts Designer Noticed would need; replicating Forge's capability without its data source would be vestigial. Reconsider only if Designer ever hosts work surfaces (prototyping) where session-pattern analysis would apply. |

**Six Designer-hosted surfaces in v1:** inbox + item viewer frame (§3.1), decision lifecycle (§3.3), lightweight writing (§3.5/§3.6), AI taste companion (§3.7), integration adapters (§3.8), codification engine + docs (§3.9).

**Embedded views** (browser webview, Agentation, Figma, Variant, Inflight when configured) load inside Designer's item viewer frame. The user works in the best tool for each judgment moment without leaving Designer. The viewer frame is a *thin Designer-hosted shell around third-party content*, not a re-implementation of those tools.

**The reshape from "broad cockpit" to "narrow hub with embedded best-in-class tools"** is the strategic narrowing that made v1 shippable. Earlier drafts of this ADR (May 15, 2026) described a wider primitive set with most primitives hosted in Designer; the conversation continuation on May 16 narrowed to this disposition after a pushback that the broader scope would produce ten mediocre tools instead of one excellent one. This narrowing aligns with ADR 0009's trustworthy-shipping principle: ship the focused core at high quality; expand only with evidence.

**The expand-later path stays open.** A primitive currently marked *Embedded* or *Hosted-light* can move to *Hosted* in a later phase if (a) the integrated tool turns out to be a poor fit for the codification capture flow, (b) the user signal is strong enough that the broader integration ecosystem hurts more than it helps, or (c) a specific gap in the integration list demands a Designer-hosted fallback. Same trigger discipline as ADR 0009's parking lot.

### 4. Architecture posture: router-first, hybrid-evolution

Designer is repositioned from "wraps the user's local Claude Code as the runtime" to **"routes the user's attention across many source tools and hosts the judgment they apply."**

#### 4.A Router-first (v1)

In router-mode, Designer is downstream of where work happens. Source adapters ingest from Linear (issue states, design-review labels, PR review requests), GitHub (PRs, comments, commits), Cursor / Codex / agent runtimes (job state, generated artifacts), and any other configured source. Each adapter emits judgment-moment events into a unified router. The user reacts via the primitives in §3.

Designer **does not drive agent execution in router-mode.** The orchestration substrate (Track / agent-team / workspace-lead-as-Claude-session / parallel-work coordination) is preserved in the codebase but quarantined behind a hidden flag — it stays load-bearing for tests and the future hybrid mode, but is not the user-visible default. This follows ADR 0009 §3's "hidden but emitting" pattern (proven by the Designer-Noticed detectors).

One small embedded execution capability is allowed in router-mode: a **variant-generation entry point** ("generate variants for me") that calls a model directly (Claude, Codex, Foundation Models — whichever has the right cost/quality for the request) and lands the output in the variant-set primitive. This is *not* a Track-shaped agent team; it is a one-shot generator. It exists so first-time users have a working loop before they configure source integrations.

#### 4.B Hybrid evolution (later)

Once router-mode validates the positioning and ships, **"local Claude Code" becomes one source adapter among many** in the integration layer. The Track / agent-team / workspace-lead primitives come back from quarantine. Power users who want one tool can drive everything from Designer; router-only users keep their workflow unchanged.

Four v1 decisions protect this evolution:

1. **Judgment-moment primitive is source-agnostic from day one.** A "variant set ready for curation" looks the same whether it came from Lovable, a Cursor agent, or local Claude Code.
2. **Source adapters are plugin-shaped.** Adding "local Claude Code" later is a source-adapter PR, not a re-architecture.
3. **Existing Rust orchestration core is quarantined, not deleted.** Hidden behind a flag; CI keeps it green (the Phase 24I integration harness is the floor).
4. **Event-sourced data layer stays as-is.** Events from external sources or events from local subprocess all flow through the same store.

The risk: if the local-orchestration code goes stale during router-mode's tenure, hybrid-mode is harder than it looks. Mitigation: Phase 24I and successor integration harnesses keep the orchestration path under test even when no user-visible surface exercises it.

#### 4.C Network traffic invariant — amended

The `spec.md` §"Hard invariants" line *"Designer emits zero network traffic of its own"* was a proxy for the real principle. Source-tool adapters, embedded previews, hosted variant-generation calls, and Figma frame embeds all involve network traffic that is **legitimate and user-attributable**. The invariant sharpens to:

> **Designer emits no network traffic that exfiltrates user data and makes no silent network calls.** All Designer-originated network activity is to user-configured sources (Linear / GitHub / chosen agent runtime), user-invoked embeds (Figma frame, hosted preview), or the explicitly-consented updater and crash-report endpoints. Every network-traffic source is user-visible in Settings and individually toggleable.

The intent of the original invariant (no telemetry, no silent egress, no surprise) is preserved; the proxy ("zero network traffic") is replaced.

#### 4.D Source-tool integration layer is bidirectional

§3.8 framed source adapters as ingesting state from external tools. They also push context *back*. Each adapter is bidirectional:

- **Pull:** ingest source-side state (issue status, generated artifacts, PR comments, review requests) → emit judgment-moment events into the router (§3.1).
- **Push:** propagate codified taste (§3.9) to the source so external generation incorporates it. When Designer routes variant generation to Lovable, Lovable should see the user's `design-language.md`. When it routes to Cursor, Cursor reads it. When the source is local Claude Code (hybrid-mode), the project files are already on disk and read at session start.

The push side is where Designer's *unique* value to the source tool lives. Other tools can ingest signals; only Designer hosts the codification primitive that makes the pushes valuable. This is also the answer to *what makes a Designer source-adapter integration valuable to the source tool*: Designer pushes high-quality context to the source so the source's generation is better. The source benefits; the user benefits; Designer becomes infrastructure other tools want to integrate with rather than a competitor they want to block.

### 5. The visual layer — one Designer-hosted frame, everything else embedded

The verbs in §2 require Designer to render things, not just talk about them. Today's Designer is largely text surfaces (chat, canvas-of-text-rows, reports, settings). Under the new positioning, the visual capability becomes a first-class layer — but per the §3.10 disposition, **the only Designer-hosted visual primitive is the *item viewer frame*: a thin sandboxed shell that embeds the right third-party tool for each judgment moment.** Earlier drafts of this ADR (May 15, 2026) listed nine in-Designer visual primitives; the §3.10 narrowing collapsed all but the frame into embeds. See §3.10 for the rationale and ADR 0009 §1 for the trustworthy-shipping principle behind shipping the focused core.

**Scope:** Designer's visual capability is *the frame that hosts other tools*, not the rendering of artifacts itself. Designer does not build a variant board (Variant does that); does not build an annotation overlay (Agentation does that); does not build a design viewer (Figma does that). The frame loads the right embedded tool per item type and captures the user's actions in it as taste signals.

The visual primitives, with v1 disposition:

1. **Item viewer frame** *(hosted)* — the sandboxed Designer-side surface that hosts whichever third-party view a judgment moment requires. The substrate is the spec's existing sandboxed-iframe capability (Decision #23: strict CSP + iframe sandbox).
2. **Browser webview** *(embedded — the frame embeds it)* — for live URLs, staging deploys, dev-server previews. Tauri's WebView is the engine.
3. **Variant comparison view** *(embedded — Variant / Lovable / v0 / Cursor)* — Designer loads the source tool's comparison view; never builds its own grid.
4. **Annotation overlay** *(embedded — Agentation, Markup.io, or whatever the user prefers)* — runs inside the same webview as the underlying artifact.
5. **Design-file view** *(embedded — Figma frames)* — Figma's embed kit; native Figma comments work through.
6. **Visual diff for code-deployed UI** *(embedded — GitHub previews, dedicated tools)* — Designer routes to the existing previewer.
7. **Demo / screencast viewer** *(embedded — Loom, native HTML5 video, etc.)* — out of scope as a Designer-hosted surface.
8. **Project surface map** *(not in v1)* — a Designer-hosted live board of all the user's screens was on the wider primitive list; deferred until the inbox + codification loop validate and demonstrate a real gap that this surface would fill.
9. **Wireframe / sketch surface** *(in companion, not standalone)* — when the user needs to sketch a point, the AI taste companion's expressive tools handle it; no standalone in-Designer wireframing surface. Matches the user's own framing: *"MAYBE creating some artifacts will be necessary, but probably less than commenting on many generated artifacts."*

**Architectural pieces Designer ships** to make the embedded-frame model work:

- A **unified viewer-frame contract** so any embedded surface (HTML, image, video, URL, Figma embed, Agentation overlay, Variant view) loads through the same Designer-side shell and surfaces taste signals back to the codification queue uniformly.
- A **media / artifact cache** for blobs (screenshots, exported prototypes, captured webview frames) — file-blobs in the workspace cache with hashes in SQLite.
- A **dev-server-proxy capability** for embedding the user's running app (one of the most common embed targets).
- **External-tool embed adapters** (Figma oEmbed, Agentation embed API, Variant comparison view, etc.) — slim wrappers per source tool.

These are *infrastructure that lets the frame embed best-in-class tools*, not Designer-built equivalents of those tools.

#### 5.A Honest scope: UI-touching work first

The visual primitives are sharp for **UI / web / mobile work** — there's a rendered artifact at the end. They are weaker for **non-UI work** (database migrations, queue refactors, infrastructure changes, data pipelines). Possible proxies for non-UI changes (plain-language behavior summary, system architecture diagram, before-and-after trace examples, spec-compliance summary against the brief) all exist but none is as sharp as "look at the rendered screen."

Designer's v1 strength is therefore **UI-touching work**, with non-UI work served by weaker proxies. This is an honest positioning, not a bug. The dogfood user (you, building Designer) lives mostly in the UI-touching part of the work; the broader user category (designers, PMs, founders) ships features, not migrations.

### 6. Explicit reversals and sharpenings of prior decisions

This ADR sharpens or reverses the following entries in `spec.md` §Decisions Log. Each is named so the change is recoverable; the original entries remain in the log per the "replace the entry, not the history" rule.

| # | Title | Change | Why |
|---|---|---|---|
| 4 | Non-technical operator as primary user | **Sharpens** to "intent-holder, not orchestrator." | The original was right about the user; this names what they *do.* |
| 8 | One Claude Code agent team per **track** | **Quarantined.** Still true *when* Designer drives Claude Code locally; not the structural backbone in router-mode. | Local execution becomes one source adapter among many. |
| 21 | Mobile = remote control of desktop Claude | **Reframes** to "mobile = handheld attention router + judgment surface." Not a remote control of a runtime; a portable surface for the verbs in §2. | Router framing makes the runtime not the right thing to remote-control; the user wants to triage and judge from anywhere. |
| 26 | Designer never touches Claude OAuth tokens | **Preserved unchanged.** Compliance invariant; orthogonal to positioning. | OAuth handling is a contract, not a strategic choice. |
| 27 | Working name: Designer | **Preserved.** Name still evokes the target user (intent-holder). | If anything, the new positioning makes the name *more* fitting. |
| 31 | Workspace lead is a persistent Claude Code session | **Demoted.** The workspace lead is one *mode* of one surface (the brainstorm/drive chat surface) rather than the structural anchor of the workspace. Workspace-as-feature stays; workspace-as-conversation-with-a-Claude-session is no longer the primary register. | Chat-as-management-interface is engineer-coded; the manager's primary register is the queue of judgment moments + the surfaces under each. |
| 34 | Fleet-scale usage: rely on Anthropic signals; no Designer-imposed caps | **Preserved.** Surface area shrinks (Designer is no longer the primary executor of Claude Code work in router-mode), but the principle holds in hybrid-mode. | No reason to invent caps Anthropic doesn't already provide signals for. |
| 35 | Parallel-work coordination as project-level primitive | **Quarantined.** The proactive parallel-coordination layer (Phase 20, contention analysis, scaffold generation, per-agent briefs, drift detection, merge-order planning) was sized for the swarm-of-tracks engineer-cockpit case. The new user typically runs few concurrent surfaces; coordination is not their pain. The capability stays in the codebase for hybrid-mode power users; it is not v1. | Linear / Conductor / GitHub merge queue territory; not Designer's wedge. |
| 50 | Linear / Notion / Jira / Asana / GitHub Projects integration cut from v1 | **Reversed.** External-tracker integration is now load-bearing — Designer's source adapters in §3.8. The original "interop ≠ moat" rationale was based on the assumption that Designer's canvas would *replace* the tracker as source of truth. Under router-positioning, Designer *complements* the tracker by hosting the judgment that the tracker can't host. Two-source-of-truth confusion is resolved by Designer reading from the tracker, not writing back as authority. | Decision #50's premise no longer applies. |
| 65 | Approvals as project artifacts in a global inbox | **Generalized.** Approvals are one type of judgment moment (§3.1); the global-inbox pattern is the router. The decision was directionally right; the positioning makes it the central pattern, not an approval-specific one. | The same primitive serves all judgment categories. |
| 66 | Reports as frozen snapshots with append-only supersession | **Generalized.** The freeze-and-supersede pattern applies to decision artifacts (§3.3) and likely to briefs (§3.5) as well. | Same shape, multiple primitives. |

ADR-level relationships:

- **ADR 0001 (Claude runtime primitive):** Sharpens. Claude Code remains the *interactive runtime when Designer drives execution*, but execution is no longer the structural anchor. ADR 0001's invariants (no Anthropic auth, no proxy, no Agent SDK as customer-facing runtime) are preserved unchanged.
- **ADR 0002 (frozen-contract additive-only event vocabulary):** Preserved. The new primitives add events; they don't break existing ones.
- **ADR 0008 (chat pass-through):** Preserved. When Designer drives Claude Code (hybrid-mode), pass-through holds.
- **ADR 0009 (trustworthy shipping; Build/Harden alternation; parking lot):** Preserved. The roadmap rewrite this ADR enables follows the same alternation and parking-lot discipline.

CLAUDE.md updates (out of scope for this ADR's text but called for):

- §Product Principles add a sixth entry: **"Intent preservation is the mission."** Replaces or sits alongside "Manager, not engineer" depending on framing-pass.
- §What This Is one-liner replaced with the §1 mission framing.

### 7. What this implies for the roadmap (high level)

The full roadmap rewrite is downstream work. This ADR sets the principles that govern it:

**Holds (kept and likely sharpened):** Mini design system + token enforcement (25H). Phase 16 (signed build), 26H (demo gate). Phase 22.A roadmap canvas + 22.I shipping history (now showing work from *all* sources, not just local Tracks). Phase 22.B Recent Reports (curation register matters more under intent-preservation). Local models for ops layer (Decision #3). Approval gates in Rust core (Decision #22). Repo-as-source-of-truth (Decision #17).

**Promoted from parking-lot to load-bearing:** Phase 22.E (attention column → becomes the central router surface, not a side-of-Home affordance). Phase 15.H (inline commenting → becomes the critique primitive). Annotation-as-product (currently internal-only via the vendored taste-loop).

**Reshaped, not killed:** Phase 25 (inline approvals → shifts from approve-a-file-write to approve-a-design-direction / select-a-variant / sign-off-a-plan; same phase slot, manager-altitude content).

**Cut from v1 (see §3.10):** Phase 26 (Designer Noticed). Forge — the user's Claude Code plugin — is the working version of workflow-pattern detection on session transcripts. Designer-as-router doesn't host the transcripts Designer Noticed would need; replicating Forge's capability without its data source would ship vestigial. Reconsider only if Designer hosts work surfaces (e.g., prototyping) where session-pattern analysis would apply.

**Likely cut or substantially shrunk:** Phase 19 (workspace scales up — multi-track UX, fork/reconcile mechanics — engineer-cockpit feature). Phase 20 (parallel-work coordination — Linear / Conductor territory). Phase 22.N / N.1 (merge queue — GitHub merge-queue territory).

**New phase families that don't exist on the active roadmap:** Source-tool integration layer (Linear adapter at minimum for v1; GitHub adapter close behind). Variant-set primitive + side-by-side curation surface. Decision artifact (first-class lifecycle + supersession). Brief / writing-surface as first-class in-app primitives. Visual layer foundation (prototype viewer, variant board, annotation overlay) — likely a multi-phase build.

**Sequencing principle:** The new primitives interlock — most don't ship usefully without the others. The roadmap rewrite should think in **arcs** (a coherent set of phases that together unlock one verb-loop), not isolated phases. Build/Harden alternation (ADR 0009) still applies within each arc.

**Taste-codification arc is load-bearing and probably comes early.** §3.9 is the compounding-leverage piece — without it, every other primitive produces episodic value (one critique fixes one drift, one decision settles one question, one curation picks one variant). With it, every act of judgment compounds into durable preference that propagates forever. Because the underlying skills already exist (Mini taste-loop: `drain-feedback`, `distill-feedback`, `propagate-language-update`), the v1 build cost is exposing the loop as user-facing rather than inventing it. **A thin viewer + working codification loop probably ships more value than a rich viewer with no codification** — so this arc likely precedes much of the visual layer in priority within the rewrite.

The roadmap rewrite is the next session's work, governed by this ADR.

## Consequences

**Positive:**

- Sharpens the value proposition into a category none of the incumbents can credibly take. Linear can't become taste-driven without alienating engineering teams. Cursor can't become designer-friendly without diluting "the AI editor for developers." Figma can't run agents. The competitive geometry favors Designer holding this position.
- Resolves the architectural pressure from Anthropic's June 15 billing change. Designer's direct dependency on Claude Code shrinks (one source among many in router-mode), so pricing churn at any one runtime hurts less.
- Aligns the product with the user's actual dogfood pattern (the user is exactly an intent-holder building a product, not a developer running an agent fleet).
- Gives the team a stable reference document so future strategic conversations don't have to re-derive the framing from scratch.
- The most strategically important new primitive (§3.9 taste codification — the compounding-leverage piece that turns episodic critique into durable preference) **already exists in working form** as Designer's internal Mini taste-loop infrastructure. The v1 build cost is exposing the loop as a user-facing product capability scoped to the user's project, not inventing it. This is rare for positioning shifts of this magnitude.

**Negative / risks:**

- The router-only v1 surface area is large (8 new or substantially-reshaped primitives + a visual layer + integration adapters). This is a multi-phase undertaking; the roadmap rewrite needs to sequence it carefully so each Build phase ships a usable slice.
- Without local agent execution as a default, first-time users without configured integrations have a weaker out-of-the-box experience. The §4.A "small embedded variant-generation" capability mitigates this but doesn't fully resolve it.
- The visual layer is real engineering work (sandboxed iframes, dev-server proxying, embed adapters, blob storage). Substrate exists in the spec (Decision #23) but the surfaces don't.
- The dogfood loop currently uses local Claude Code execution heavily. Router-mode means *you* would route some dogfood through other tools (Linear-delegated agents, Cursor) to validate the router. That's a real cost on top of the build cost.
- This ADR makes a positioning bet that depends on a category (intent-holders managing AI work who aren't developers) that exists but is smaller than the generalist orchestrator market on paper. The bet is that this niche is unserved AND high-leverage AND the right wedge — defensible given the dogfood evidence and competitive geometry, but a bet nonetheless.

**Open questions deliberately left for future ADRs / sessions:**

1. **Roadmap rewrite.** Phase numbering, sequencing, arcs, parking-lot adjustments. Next session.
2. **Mobile spec under router-positioning.** Decision #21's reframe (handheld attention router + judgment surface) needs its own design pass when mobile becomes active (currently parked).
3. **Pricing / cost ceiling for the embedded variant-generation capability.** §4.A introduces a small Designer-side execution path. Cost model unspecified.
4. **Source-adapter trust model.** Each adapter holds credentials for a third-party tool. Where do those live (Keychain per Decision currently), what's the granted-scope model, what's the revocation flow?
5. **Hybrid-mode reactivation criteria.** When does it become time to bring the orchestration substrate out of quarantine? Trigger TBD; probably analogous to the parking-lot triggers in ADR 0009 (friction-driven primary + time-based fallback).
6. **Non-UI work proxy strategy.** §5.A names the gap; the actual proxy primitives (behavior summary, architecture diagram, trace examples) are not specified.
7. **Brainstorming-surface tool catalog.** §3.7 names the expressive-vs-executive line; the specific expressive tools (which diagram engine, which wireframe primitive, which prototype runner, which fetch adapters) are not specified.
8. **Codification scope axis.** §3.9 names project-level scope as v1; org-level (cross-product brand) and personal-level (this designer's preferences across all projects) are scope-axis additions for later. Architecture should keep the door open (scope as a field on each codification artifact from day one), but the UX and conflict-resolution semantics across scopes are unspecified.
9. **Codification synthesis quality bar.** §3.9's distill step proposes promotions from raw signal to durable preference. The synthesis is non-trivial — going from N specific critiques ("too much padding here", "this color doesn't fit") to a generalizable principle ("we prefer dense layouts; we use neutral/cool tones") requires real LLM work. Quality bar, false-positive cost, and what happens when the user repeatedly rejects a proposal (does the loop learn to stop suggesting that pattern?) are all unspecified.

These are real open questions, not handwaving. Resolving them is downstream work that this ADR enables but does not pre-decide.
