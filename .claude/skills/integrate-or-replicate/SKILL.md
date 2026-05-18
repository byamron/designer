---
name: integrate-or-replicate
description: Determine whether a proposed Designer feature, surface, or capability should be (a) integrated from an existing tool the user already uses, (b) hosted in Designer because no existing tool does the job well, or (c) treated as a deliberate displacement bid against an existing tool. Use whenever planning any new Designer surface, integration adapter, or product capability that overlaps with an existing tool in the user's stack — at roadmap-planning time and at PR-planning time. Enforces ADR 0010 §3.10's principle that *Designer hosts only what no existing tool does well; everything else integrates rather than replicates.* Prevents the canonical scope-creep failure mode of shipping a worse version of Variant, Inflight, Agentation, Figma, Notion, Linear, or any other tool the user already uses.
---

# integrate-or-replicate

**Purpose:** Prevent Designer from shipping worse versions of tools the user already uses. Enforce the *hub-with-embedded-best-in-class-tools* architecture from ADR 0010 §3.10 at decision time, not as an after-the-fact correction. Make every build-vs-integrate-vs-displace call explicit, evidence-based, and recorded.

The principle this skill enforces, in one sentence: **Designer's value is what no existing tool can do (cross-tool attention routing + taste codification + the loaded-context companion); everything else should be integrated, not replicated.**

## When this skill fires

Fires when planning or proposing:

- A new Designer-hosted surface (anywhere — roadmap, spec, ADR, PR plan).
- A new integration adapter (which tool? for what jobs? what's the value-add?).
- A capability that touches an established tool category (annotation, design canvas, variant comparison, structured review, brief writing, chat-with-AI, screencast, screenshot diff, etc.).
- A "let's just build a small X in Designer" idea that overlaps with an existing tool.
- A user request that *could* be satisfied by integrating with a tool the user already uses.
- A discovery JTBD that surfaces a job a tool already partially serves.

Also fires at higher altitude:

- **Before adding any phase or arc to the active roadmap** (CLAUDE.md §How to Work item 9).
- **Before writing requirements** in the build-cycle Plan step (CLAUDE.md §How to Work item 8.1).

Should NOT fire on:

- UI-component decisions inside a Designer-hosted surface (use `check-component-reuse` instead — that's about *components*, this is about *surfaces*).
- Token / styling decisions (use `enforce-tokens`).
- Pure backend infrastructure with no user-visible surface (event-log internals, IPC plumbing, etc.).
- Strategy / vision-level questions about what Designer *is* (that's `vision.md` + ADRs).

## Inputs

The skill needs:

1. **The proposed capability** — what's being considered. A surface name, a feature description, a user job, or a sentence-level proposal is enough.
2. **The user persona(s) the capability serves** — read `core-docs/research/personas.md` to ground the analysis. If JTBD work exists (`core-docs/research/jtbd.md`), reference it too.
3. **The user's current tool stack** — derive from the persona tool lists. If proposing a capability for a persona not yet documented, name the assumption explicitly.

## Procedure

### Step 1 — Name the capability precisely

Before evaluating, sharpen what's being proposed:

- What user-facing thing is being considered?
- What user *job* does it serve? (Cite a JTBD if available; otherwise paraphrase the job.)
- Which persona(s) need it most? (Cite `personas.md`.)
- Is this a *primary* surface (the user goes here on purpose) or a *secondary* surface (it appears as part of another flow)?

Vague proposals are the failure mode this step prevents. *"Let's add a way to review designs"* is not specific enough to evaluate; *"surface a queue of Figma comments waiting for Maya's sign-off, with the frame embedded for context"* is.

### Step 2 — Inventory existing tools that serve the same or adjacent jobs

Use `core-docs/research/personas.md` as the starting inventory of tools in the personas' stacks. Also consider tools likely to enter the stack within the next 12 months (Inflight, Variant, Lovable, v0, Figma Make, OpenClaw and equivalents, new entrants).

For each candidate tool:

- **What job does it do for the persona today?** (One sentence.)
- **Does it serve the proposed capability's job directly, partially, or adjacently?**
- **Does the persona currently use this tool for this job?** (If yes, displacement is harder. If no, integration may not solve the user's actual problem.)

Output: a short table of candidate tools with their fit.

### Step 3 — Evaluate the gap (or lack of one)

For each candidate from step 2, evaluate whether there is a real gap Designer would fill:

- **Does the existing tool serve the job well for the persona?** If yes, the bar for Designer hosting is very high.
- **Where does the existing tool fall short specifically?** (Not "it's not in Designer" — that's circular. *What* about the existing tool's design or scope fails the persona?)
- **Would Designer's version be meaningfully better, or just nominally different?** Nominally-different is the most common failure mode of replication.
- **If meaningfully better: where does the leverage come from?** Three legitimate sources:
  - Loaded *cross-tool* context the existing tool can't have (e.g., the codifications, the cross-tool inbox state).
  - A primitive the existing tool's architecture can't offer (e.g., attention routing across tools, taste-aware proposals).
  - A workflow seam that requires Designer's hub posture (e.g., turning critique-in-tool-X into codification-applicable-to-tool-Y).

If none of those three apply, Designer hosting this is replication, not value-add. Recommend integration.

### Step 4 — Recommend (use this decision tree)

Recommend in this order. The default for ambiguous cases is the *more integrated* option, not the more hosted one.

1. **Integrate (passthrough).** The existing tool serves the job well. Designer surfaces the *signals* it produces (events, notifications, completed artifacts) into the inbox or codification queue. The user does the job inside the existing tool; Designer never opens its own UI for this. *Example:* a Linear issue with the `needs-design-review` label surfaces as a judgment moment; clicking it opens Linear (in browser or native app); Designer captures the review state when it changes.

2. **Integrate (embed).** The existing tool serves the job well, and the value of *not tabbing out* is high enough to embed its view inside Designer's item viewer frame. Adapter captures the user's actions inside the embed as taste signals. *Example:* an Agentation annotation surface for a screenshot, embedded inside Designer's item viewer with native Agentation interactions intact.

3. **Hosted-light.** Existing tools serve the job *partially*. Designer hosts a *minimal* surface specifically scoped to the cross-tool context — intentionally inferior to the dedicated tool in features that aren't load-bearing for Designer's loop. *Example:* a lightweight brief-writing surface inside Designer that promotes to Notion on publish; the loaded codifications are the reason to write here, but you'd never use this for a 50-page spec.

4. **Hosted (full).** No existing tool serves the job, *or* the job specifically requires the loaded cross-tool taste context that only Designer can offer. Build it in Designer. **Required justification:** name the gap from step 3 and the leverage source from step 3 explicitly.

5. **Displacement bid.** Designer intentionally tries to replace an existing tool with a better version. **Rare; requires sign-off via a dedicated ADR.** Required justification:
   - Why is the existing tool inadequate? (Be specific; "it's not in Designer" is not a reason.)
   - What does Designer's better version offer that the existing tool architecturally cannot?
   - What is the migration story for users currently on the existing tool?
   - What is the engineering cost vs. the value of integration?
   - Is the win big enough to justify entering an established category?
   Default answer to most displacement proposals: *no, integrate instead*.

### Step 5 — Document the call

The recommendation goes in the artifact that proposed the capability:

- For a roadmap phase: a *Disposition* sub-field per the format used in ADR 0010 §3.10.
- For an ADR: a *Disposition and rationale* section.
- For a PR plan: a *Build vs. integrate* note in the plan doc.
- For a spec section: an inline note matching the ADR 0010 §3.10 table format.

Include in the recommendation:
- Tools considered (from step 2).
- Why each was insufficient (if hosted) or sufficient (if integrated).
- Recommendation per the decision tree.
- Open questions or assumptions.
- For displacement bids: link to the ADR.

### Step 6 — Do not write code or implementation specs

This skill is diagnostic. It produces a recommendation, not a feature spec. Implementation begins in the actual build step *after* this recommendation is recorded and accepted.

## Outputs

- A markdown report with: the proposed capability (step 1), the existing-tool inventory (step 2 table), the gap evaluation (step 3), the recommendation (step 4), and the documentation snippet (step 5).
- A draft snippet for the artifact that proposed the capability (roadmap entry / ADR section / spec note / PR plan note).
- **No file writes** unless the user explicitly asks for the report to be saved as a doc — usually the recommendation goes into the existing artifact, not a new one.

## What "good" looks like

A good integrate-or-replicate report:

- Names *specific* tools (not "design tools" — *Figma, Subframe, Pencil*).
- Cites *specific* persona pains (not "users want X" — *Maya redirects the same upsell framing three times; agents converge to the mean in the upsell category*).
- Recommends the *most integrated* option that solves the job, not the most ambitious.
- Treats displacement as a category-level decision requiring an ADR, not a feature-level decision.
- Is short. A paragraph per step, not pages. The output is a recommendation, not a thesis.

## Failure modes this skill prevents

- **Replication creep**: shipping a worse Variant / Inflight / Agentation / Figma comments / Notion brief surface because it's "easier to integrate inside our app."
- **Missed integration**: building a hosted surface for a job an existing tool already does well, then later realizing the user prefers the existing tool and the hosted surface becomes dead code.
- **Implicit displacement bids**: replicating an existing tool's job without ever asking "wait, are we trying to displace this tool? if so, why?"
- **Vague recommendations**: "We should probably build this" with no recorded reasoning, so the call is impossible to revisit when the trade-offs change.

## Related skills

- `check-component-reuse` — the component-level analog (reuse / extend / build) for UI components inside a Designer-hosted surface. This skill is the *surface-level* version.
- `enforce-tokens` — for token usage decisions.
- `staff-review` — should reference this skill's output when reviewing PRs that add new surfaces.
- `generate-ui` — internally invokes `check-component-reuse`; this skill operates one altitude up.
