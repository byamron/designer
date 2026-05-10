# Designer — Open Tensions

> Things the language doesn't yet articulate, contradictions surfaced by the loop, places decisions were made arbitrarily. Each entry should name the question, not the answer. Resolved entries graduate to `decisions.md`.

## Format

```
### T-XXXX: [short headline]
**Surfaced:** YYYY-MM-DD via <feedback entry id> | excavation
**Surface:** <which feature exposed it>
**The tension:** <what the language is silent or contradictory on>
**Stakes:** <what gets worse if we don't resolve this>
**Status:** open | proposed-direction | ready-to-resolve
```

---

## Seeded from `chat-ui-audit.md` (Designer, 2026-04-30)

The audit fixed 14 bugs + 6 polish items + 6 review-pass corrections at the *defect* layer. The next layer up — what shipped fixes left unresolved at the **craft** layer — is what this loop has to surface. These are starter tensions, not closed.

### T-0001: What does "alive on engagement" feel like in the workspace thread, specifically?

**Surfaced:** 2026-05-04 (excavation, seeded from canonical principle 3 + audit B7 fix)
**Surface:** workspace thread
**The tension:** The audit added five thinking/streaming/tool-call states (B7). They're functionally correct. But the canonical principle says active surfaces should come *alive* — not just light up indicators. Is the current implementation expressive enough, or has the principle been satisfied at the indicator level and abandoned at the felt-experience level?
**Stakes:** Calm-by-default is easy; alive-on-engagement is the harder half. Without a sharper articulation, future surfaces will satisfy the indicator and miss the experience.
**Status:** open

### T-0002: When does a tool call deserve more than a single coalesced row?

**Surfaced:** 2026-05-04 (excavation, seeded from audit B5 fix)
**Refined:** 2026-05-04 via `feedback/2026-05-04-cycle-2-conversation-vs-operation.md` → `decisions.md` D-0003
**Status:** partially resolved — tool calls are operation-layer artifacts and default-collapse into a "N tool calls" header. The remaining open question is whether a long-running, critical, or signal-carrying tool call should *promote* to the conversation layer (e.g. a destructive write that the user should see). Reopen if a real surface needs it.

### T-0003: Asymmetry between user and agent — is bubble-vs-flat the right encoding?

**Surfaced:** 2026-05-04 (excavation, seeded from audit B4 fix)
**Resolved:** 2026-05-04 via `feedback/2026-05-04-cycle-1-chat-metaphor.md` → `decisions.md` D-0001
**Status:** resolved — bubble-for-user, flat-for-agent. The chat metaphor is load-bearing; B4's fix had it right.

### T-0004: Auto-scroll stickiness — UX is solved; the felt-experience question is open

**Surfaced:** 2026-05-04 (excavation, seeded from audit B6 fix)
**Surface:** workspace thread
**The tension:** B6's fix correctly handles scroll-stickiness (only auto-scroll if pinned to bottom). Mechanically right. But the lens of *flow continuity* asks something different: when a long agent response streams in, does the user feel anchored or yanked? Is there a moment where the new content emerges with weight versus simply appearing? The fix is the floor; the ceiling is unspoken.
**Stakes:** This is the kind of detail that separates "functional chat" from "the thing the manager opens to think with." Worth sharper articulation before generating alternatives.
**Status:** open

### T-0005: Where is hierarchy carried in the thread? Color, weight, indent, gutter, time?

**Surfaced:** 2026-05-04 (excavation, seeded from canonical axiom 16)
**Surface:** workspace thread
**The tension:** Axiom 16 says "hierarchy is color-before-weight-before-size." A continuous scroll of typed artifact blocks (messages, reports, code-changes, PRs, approvals) needs hierarchy that lets the user scan. Today: blocks are mostly the same body-15 weight-medium with subtle color shifts. Is the contrast strong enough? Is the rhythm carried by something other than color?
**Stakes:** A scrollable thread of N artifact types is the central UX. If the scan path is fuzzy, every other improvement is patching downstream.
**Status:** open

### T-0007: Designer-wide focus-state audit

**Surfaced:** 2026-05-05 via `feedback/2026-05-05-cycle-5-architectures-and-chrome.md` (chat-source: user explicitly named this Designer-wide)
**Surface:** all interactive elements across Designer (compose box, main tab, rail items, toggles, action buttons)
**The tension:** LP-0003 ("click never leaves a focus ring") was promoted as a craft principle, but the user explicitly stated the violation is present "throughout the designer app itself — on the compose box, main tab, and elsewhere." The principle is the rule; the audit is the implementation work that makes the product consistent with the rule.
**Stakes:** Per-button patches are brittle and will drift. The right resolution is a primitive-level fix in `packages/ui/` so every interactive element gets the correct behavior by construction (`:focus-visible` only, blur-on-mouseup where lingering focus serves no purpose). Without the primitive-level fix, every new interactive element is a chance to forget the rule.
**Status:** open — Designer-side implementation work. The principle is settled (LP-0003 promoted); the audit + fix is what closes the tension.
**Notes for future Claude:** when the audit runs, look for: bare `:focus` styles that should be `:focus-visible`; interactive elements missing `onMouseUp blur`; toggles that retain focus across keyboard activity from elsewhere. Also watch for the symptom from cycle 5: clicked-then-arrow-keyed elements showing stale focus rings.

### T-0010: How does the global approval inbox surface approvals while preserving context?

**Surfaced:** 2026-05-05 via session chat (implementation-level question downstream of D-0005)
**Surface:** chat thread + sidebar inbox + home page recent-approvals + (possibly) a dedicated inbox view
**Status:** open — depends on D-0005, decided 2026-05-05
**The tension:** D-0005 settled that approvals are project artifacts surfaced via global inbox. Open implementation questions:
- How does the chat-side rendering relate to the inbox-side rendering? Same card, different framing? Different cards entirely (chat shows full context, inbox shows summary)?
- Should approvals stay anchored to the prose that proposed them (Google Docs comment style) so the user can see *what* needs approval inline, while also appearing in the inbox for action? Or float at the latest position in chat? Or migrate from chat to inbox once new content arrives below them?
- What's the badge / notification model — a count on the cockpit's project strip? A dedicated inbox icon? A toast on creation?
- When acted on from the inbox, does the chat update reflect the resolution inline (the approval card collapses to a small "approved" trace), or is it just a state change visible only in the inbox?
**Stakes:** This is the daily-use pattern for the manager. Wrong choice and approvals either get missed (badge invisible / inbox hard to find) or feel disconnected from the work (acting in inbox without context).
**Notes for future Claude:** the roadmap spec apparently explored Google-Docs-comments-style anchoring. Pull that up when iterating. Cite GitHub's PR review pattern, email inbox model, and Linear's issue tracker when proposing variants.

### T-0011: How is the supersession chain on a report visualized?

**Surfaced:** 2026-05-05 via session chat (implementation-level question downstream of D-0006)
**Surface:** report block (in chat, on home, in any artifact view)
**Status:** open — depends on D-0006, decided 2026-05-05
**The tension:** D-0006 settled that reports are frozen snapshots with append-only supersession. Open implementation questions:
- How prominent is the "← previous version" affordance? An always-visible small chip? Hidden behind a chevron? A timestamp that becomes a hover-disclosure?
- Does the predecessor chain expand inline when opened, or open in an overlay / side panel?
- Is the relationship between predecessor and successor diff-able (what changed?) or just sequential (here are the versions)?
- Can a report have multiple successors (branched supersession) or only one (linear)? The single-successor model is simpler; multiple may be needed if the work itself branches.
- What triggers a new superseding report — agent decision? Code-change downstream that invalidates the prior claim? User-initiated re-summarization?
**Stakes:** Without a clear visual chain, the trust-through-legibility goal of D-0006 fails. The user must always be able to see, at a glance, "this is the current version" and easily reach "what changed since the last one."
**Notes for future Claude:** Wikipedia article history, git log, Linear "edited at" trails, Notion page history are all reference patterns. Each makes a different trade-off between always-visible-trail and out-of-the-way affordance.

### T-0008: Home page + roadmap feature

**Surfaced:** 2026-05-05 via session chat (user queued for future iteration)
**Surface:** home page + roadmap feature
**Status:** queued — awaiting cycle
**The tension:** This is a big feature that hasn't been fully designed yet. Will be early-stage iterations — the loop should expect more excavation / open-ended exploration than the chat surface needed (which had Designer's existing reference to anchor against). Likely to surface multiple new tensions about cross-surface navigation, primary-action prominence, time-anchored content (recent vs. upcoming), and hospitality on the entry surface (T-0006 will probably re-surface here in a different shape).
**Stakes:** Home is the first surface. Peak-end rule (foundations §2) makes it disproportionately load-bearing. Roadmap is where the manager's "thinking with Designer" is most visible.
**Notes for future Claude:**
- Treat as new excavation, not as a continuation of the chat surface.
- Reference materials in Designer source: check `~/Desktop/coding/designer/` for any roadmap-related specs (the cycle 1 ledger mentioned `roadmap-feature-spec.md`).
- Expect to generate 4–6 variants in the first cycle, more spread than the chat surface needed, since the design space hasn't been narrowed yet.

### T-0009: Loading microinteractions + Unicode loading animations + loading language

**Surfaced:** 2026-05-05 via session chat (user queued for future iteration)
**Surface:** any — loading is cross-cutting microinteraction work
**Status:** queued — awaiting cycle
**The tension:** Designer needs a coherent loading language: when something is loading, what does the surface communicate? How long does each register last (skeleton, spinner, ambient pulse, Unicode animation, optimistic update)? What's the personality (calm, energetic, witty)? How does loading distinguish from streaming (the agent is producing content) vs. waiting (the system is fetching)?
**Stakes:** Loading is where Doherty threshold (foundations §2) bites hardest. Below 400ms the user feels in flow; above it, they need feedback or they distract. Loading is also peak-end-rule-relevant — it's a moment the user feels acutely. Designer's "calm by default, alive on engagement" axiom (canonical principle 3) directly governs how loading animations express character.
**Notes for future Claude:**
- This is microinteraction craft — small surface, lots of room for uncommon-care-style depth on each lens (especially fidgetability, sound/motion/materiality, conceptual range → depth).
- Foundations to lean on: Doherty threshold, anticipation, follow-through, common fate, easing curves, peak-end rule.
- Unicode animation is a specific compositional choice — clever but constrained register. Worth one or two variants alongside more conventional approaches (skeleton, animated dots, progress bars) to test whether "monospace character animation" feels load-bearing or gimmicky.
- Loading language should distinguish: brief loads (<400ms), medium loads (400ms–2s), long loads (>2s), indeterminate loads (no progress info), and streaming output (content arriving). Each should have a register.

### T-0006: What does an empty workspace thread feel like?

**Surfaced:** 2026-05-04 (excavation, gap)
**Surface:** workspace thread
**The tension:** The audit didn't address empty states. The language says "calm by default, alive on engagement" but the calmest state — empty — is unarticulated. Is it a single line? An invitation? A skeleton hint? A quiet illustration? The hospitality lens will press hard here.
**Stakes:** First-impression surface. Currently almost certainly "blank canvas → user types into compose dock," which works but doesn't *welcome*.
**Status:** open
