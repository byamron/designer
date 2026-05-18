# Foundations — established UX, visual design, and interaction principles

> Reference document. The principles below come from cognitive science, HCI research, and interaction design literature. They are *not* this project's invented rules — they're the established vocabulary the field uses. We cite them so taste-loop work doesn't accidentally re-invent named ideas, and so deviations are *deliberate*, not naive.
>
> **How to use:**
> - **Before promoting** a project-specific principle (LP-XXXX in `projects/<name>/language.md`), check whether it echoes a foundation here. If it does, cite the foundation in the LP entry rather than presenting it as novel.
> - **Cite during critique.** When a feedback ledger entry surfaces a finding that maps to a foundation, name it ("this is the proximity principle"). Naming makes the read sharper and the rule transferable.
> - **Challenge when warranted.** Foundations are defaults, not commandments. If a specific surface or product context makes a foundation wrong here, document the deviation with reasoning. Cite the foundation, then explain why it doesn't apply.
>
> **What this document is not:** it isn't a comprehensive textbook, and it isn't a rigid checklist. It's a working vocabulary — enough coverage to recognize patterns when they appear, with each entry sharp enough to be actionable in design and critique work.

---

## Table of contents

1. [Gestalt principles of perception](#1-gestalt-principles-of-perception)
2. [UX laws & cognitive heuristics](#2-ux-laws--cognitive-heuristics)
3. [Visual design fundamentals](#3-visual-design-fundamentals)
4. [Interaction & affordance (Norman)](#4-interaction--affordance-norman)
5. [Accessibility foundations](#5-accessibility-foundations)
6. [Motion & time](#6-motion--time)
7. [Cognitive load & decision](#7-cognitive-load--decision)
8. [When to break a principle](#8-when-to-break-a-principle)

---

## 1. Gestalt principles of perception

Gestalt psychology (Wertheimer, Köhler, Koffka, early 20th century) describes how the human visual system groups elements into wholes. They are perceptual *defaults* — things the eye does whether the designer intends them or not. Designers either work with them or fight them.

### Proximity
Elements that are spatially close are perceived as related. This is why grouping a button next to its target indicator (e.g., a "Show" toggle beside +/− stats) reads as a unit, while separating them across rows reads as unrelated. Proximity is the cheapest grouping tool — it requires no chrome, just whitespace control.

**When to apply:** any time you want elements to read as a group. Form labels with their inputs. Stats with the toggle that reveals their detail. Action buttons with the artifact they act on.

**Common failure:** distributing related elements across columns or rows because they "feel like they belong in different sections," when the user actually treats them as a single decision.

### Similarity
Elements that share visual attributes (color, shape, size, weight) are perceived as related, even when distant. This is how typographic hierarchy works: every h2 looks the same, so the reader recognizes them as the same kind of thing.

**When to apply:** establishing patterns (all primary buttons look the same), creating scannable lists (all rows render alike), encoding role (warning chips share a fill, success chips share another).

**Common failure:** using arbitrary visual differences for elements that *aren't* meaningfully different. Decorative variation reads as semantic variation, then confuses.

### Closure
The eye completes incomplete shapes. A circle with a missing 30° arc still reads as a circle. This is why a few well-placed dots can imply a grid, or three lines an icon.

**When to apply:** minimal iconography, implied containers (hairlines that bound an area without a full box), economical visual structures.

**Common failure:** relying on closure where the user can't actually infer the shape — gaps too large, alignments too loose, the perceived form falls apart.

### Continuity
The eye prefers smooth, continuous paths over sharp breaks. Items along a line, an arc, or a consistent rhythm read as belonging together. This is why aligning items to a baseline grid feels coherent and breaking that alignment feels jarring.

**When to apply:** alignment, vertical rhythm, the flow of a scrollable surface (each row's left edge on the same axis), connection of conceptually related elements.

**Common failure:** misaligning small elements ("close enough"), creating visible jaggedness that competes with the content.

### Common fate
Elements that move together are perceived as related. This generalizes to any shared change — color shift, fade, transform — happening simultaneously.

**When to apply:** state transitions where multiple elements should read as one event (a row's expand affecting its chevron + its content + its hover state). Animation choreography that bundles related transforms.

**Common failure:** animating things separately when they're part of the same conceptual change — reads as two events instead of one, costing flow continuity.

### Figure / ground
The eye separates content (figure) from context (ground). Strong contrast and isolation make figure-ground separation easy; competing intensities force the eye to work.

**When to apply:** any time you need the user to focus on one thing — a primary action, a focused panel, a modal. The figure should be unambiguous.

**Common failure:** competing surfaces that fight for figure status — a dialog over a busy background, a primary button in a row of equally-styled secondaries.

### Prägnanz (good form / simplicity)
The eye prefers the simplest stable interpretation of any visual. Given ambiguity, it picks the explanation with the fewest parts. This is the "less is more" principle in formal terms.

**When to apply:** every time you're tempted to add decoration. Each element added increases the parts the eye has to resolve. The simplest form that still communicates is almost always the right answer.

**Common failure:** adding elements "for clarity" that actually compound the part-count and reduce clarity — disclaimers, status badges, icons that restate the label, etc.

---

## 2. UX laws & cognitive heuristics

Named heuristics from research literature. They're empirical observations, not laws of nature — they describe typical user behavior with characteristic ranges.

### Fitts's Law
The time to acquire a target depends on its size and distance from the starting point: `T = a + b·log₂(D/W + 1)`. Bigger targets are faster to hit; closer targets are faster to hit; both effects are logarithmic, so doubling target width buys diminishing returns.

**Implications:**
- Primary actions should be large and close to the user's pointer trail.
- Edges and corners are infinite-size targets (the cursor can't go past them) — Mac's menu bar at the top, browsers' close buttons in screen corners.
- Touch targets ≥44×44pt (iOS) or 48dp (Android) — both calibrated to fingertip Fitts considerations.

### Hick's Law
Decision time grows with the logarithm of the number of choices: `T = b·log₂(n+1)`. Adding options increases decision time, but logarithmically — so 8 options aren't 8× slower than 1.

**Implications:**
- Reduce choices at decision points (homepage, primary nav). Group, hide-by-default, progressively disclose.
- Don't reflexively cut to 3 options if 8 grouped options actually serve the user better — log scale matters.
- Hick's Law fights with Tesler's Law: complexity has to live somewhere. Pushing it out of the visible UI means it lives in the user's head.

### Jakob's Law
Users spend most of their time on other sites/apps. Their expectations are shaped by the patterns those products use. Conform to those expectations unless deviation has a strong, specific reason.

**Implications:**
- Chat looks like chat (bubbles, flat agent voice). Diff colorization is red/green. Disclosure uses chevrons. Streaming uses cursors. Re-inventing these costs the user familiarity for no gain.
- This is the foundation of LP-0002 ("Conventional patterns over invented ones") in the Designer language.
- Deviation is allowed when the existing convention is *bad* (rare) or when the surface is genuinely novel (also rare).

### Miller's Law (7±2)
Working memory holds about 7 (±2) items. Often misapplied as "menus should have 7 items max" — Miller's actual finding was about chunks held in short-term memory during a task, not about UI element counts.

**Useful framing:** chunk content into groupings of ~5–9. Don't expect users to hold a long sequence of states or steps in mind without external scaffolding.

**Common failure:** citing Miller as a hard cap on visible items (it isn't); or, conversely, ignoring working-memory limits when designing multi-step flows.

### Tesler's Law (Conservation of Complexity)
Every system has an irreducible amount of complexity. The question isn't whether to expose it but where: in the UI (designer-side), in the user's head (user-side), or in the code (engineer-side).

**Implications:**
- "Simplifying the UI" by hiding complexity often pushes it onto users (they have to remember, infer, or guess).
- Sometimes the right move is to *expose* complexity in the UI because the alternative is worse — settings panels, advanced modes.
- The taste decision is usually about *who* should bear the complexity, not whether it can be eliminated.

### Doherty Threshold
Productivity rises sharply when system response is faster than ~400ms. Below that threshold, users feel "in flow" with the system; above it, they wait, distract, lose context.

**Implications:**
- Optimistic updates (commit before server confirms).
- Skeleton states for slow loads.
- Streaming responses (the agent appears to be responding, even before it's "done").
- Microinteractions and acknowledgment animations that absorb a few hundred milliseconds without feeling like waiting.

### Aesthetic-Usability Effect
Aesthetically pleasing interfaces are perceived as more usable, even when underlying usability is held constant. Good aesthetics buys forgiveness for minor usability friction.

**Implications:**
- Craft compounds. Polish is not optional — it's a usability multiplier.
- This is the *Uncommon Care* thesis distilled: a well-crafted surface earns trust the user extends to functionality they haven't even tested yet.
- Caveat: aesthetic-usability doesn't fix actually-broken UX. It buys margin, not impunity.

### Peak-End Rule
People judge an experience by the most intense moment (the peak — positive or negative) and the end, not the average. Long flows that end badly feel bad overall; brief friction in the middle of a great experience is forgotten.

**Implications:**
- Invest disproportionately in the start, peak moments, and the end of any user journey.
- Empty states, error states, completion states — these are peak-end candidates and deserve crafted treatment.
- Don't try to evenly distribute polish; concentrate it where memory will land.

### Goal-Gradient Effect
Motivation increases as the goal approaches. Progress indicators, "almost done" cues, and pre-filled state (a punch card with one stamp already added) all leverage this.

**Implications:**
- Multi-step flows benefit from explicit progress.
- Onboarding can give users an initial "win" so they enter the goal-gradient territory immediately.

### Serial Position Effect
Items at the start (primacy) and end (recency) of a list are remembered better than items in the middle.

**Implications:**
- Most-important items go first or last. The middle is soft.
- Long lists need scannable structure (groups, hairlines) so the middle has its own primacy/recency at a smaller scale.

### Von Restorff (isolation) Effect
The item that breaks pattern is remembered. Visual difference equals salience.

**Implications:**
- Primary actions can be the only colored button in a row of grays. The contrast does the work; no extra label needed.
- Use the isolation effect deliberately — and rarely. Multiple "isolated" items cancel each other out, since none breaks the pattern when they're all variations.

### Zeigarnik Effect
Unfinished tasks occupy mental space; completed tasks don't. People remember interrupted work more than completed work.

**Implications:**
- Persistent indicators of unfinished state (badges, "draft" labels, unread counts) leverage Zeigarnik to bring users back.
- Don't over-do it — too many open Zeigarnik loops feel like nagging instead of helpful state.

### Postel's Law (in UX context)
"Be conservative in what you do, liberal in what you accept." Originally a networking principle; in UX it means input should be tolerant (multiple formats, typo-friendly, generous parsing) while output should be precise (one canonical form, predictable behavior).

**Implications:**
- Search and command palettes should accept fuzzy matches, abbreviations, multiple keywords.
- Status displays should be precise and unambiguous — never "approximately."
- Especially relevant for AI surfaces: input is liberal (natural language); output should be precise (structured artifacts, clear states).

---

## 3. Visual design fundamentals

### Hierarchy
The order in which elements are perceived. Established through size, weight, color, position, and isolation. Strong hierarchy = the eye knows where to start.

**Carriers, in rough strength order:**
1. Position (top vs bottom, left vs right in left-to-right reading)
2. Size (larger = first)
3. Color contrast (high contrast = first)
4. Weight (bold = first)
5. Isolation / whitespace (an isolated item rises)

**Designer's axiom 16** is "color before weight before size" for the workspace thread — this is a *project-specific* override of the typical hierarchy stack, prioritizing color (functional accent) over weight changes. Most products go weight-first; Designer's calm-and-focused identity prefers color shifts.

### Alignment
Every element should be on a shared reference line — a grid column, a baseline, a left edge. Alignment is invisible when it works and screams when it doesn't.

**Common failures:**
- "Optical" alignments that aren't actually aligned (the eye notices).
- Mixed reference lines within a single visual unit (some left-aligned, some center-aligned).
- Aligning to content edges rather than typographic features (cap-height, x-height, baseline).

### Contrast
The difference between elements that the eye uses to discriminate. Encompasses color, value, weight, scale, and direction.

**Functional contrast** (information): a primary button must be unambiguously different from secondary buttons; an active row must be distinguishable from inactive rows.

**Aesthetic contrast** (interest): contrast at the layout level (a wide block followed by a narrow one), at the type level (a small caption next to a large headline) generates visual rhythm.

**WCAG** sets minimums: 4.5:1 for body text, 3:1 for large text and UI components. These are floors, not aspirations.

### Repetition
Reusing visual elements — colors, type styles, spacing values — establishes consistency and reduces cognitive load. Tokens are repetition encoded as a system.

**Common failure:** introducing one-off variations ("this one needs to be slightly different") that erode the system without strong reason.

### White space (negative space)
The space between elements is itself a design element. It carries grouping (proximity), priority (isolated elements rise), and pacing (dense vs airy reading rhythm).

**Common failure:** treating whitespace as wasted space and crowding elements together. "Dense" doesn't mean "no breathing room" — it means "every element earns its space."

### Balance
Visual weight distribution. Symmetric balance feels formal and stable; asymmetric balance feels dynamic. Both can be correct depending on the surface's emotional register.

### Rhythm
Repetition with variation produces rhythm — alternation, gradation, or progression. Vertical rhythm in typography (consistent line-height + spacing) is the most common application; layout rhythm (varying block sizes that pattern) is the next.

### Color theory in interfaces
Three-channel framing (hue / saturation / value) maps to design intent:
- **Hue** carries category (success vs danger, brand identity, semantic role).
- **Saturation** carries energy (calm pastels vs energized brights). Lowering saturation pushes color toward neutral.
- **Value** (lightness) carries hierarchy and surface depth (lighter = recedes, darker = comes forward — though this depends on the background).

Modern token systems (Radix, Tailwind) expose 12-step scales per hue precisely so designers can pick the right *value* without re-mixing colors.

### Typography
Vertical rhythm: a baseline grid where line-heights are consistent multiples of a unit. Body 1.5× line-height is the universal default for readable prose.

Type scale: a geometric ratio (1.125 minor second, 1.25 major third, 1.333 perfect fourth, 1.5 perfect fifth) progresses sizes in a way the eye reads as systematic.

Optical sizing: at body size, looser tracking; at display size, tighter tracking. Modern variable fonts handle this automatically.

---

## 4. Interaction & affordance (Norman)

Don Norman, *The Design of Everyday Things*, codifies these.

### Affordance
The *perceived* possible actions of an object. A button affords pressing because it looks pressable. A handle affords pulling. A sharp edge affords cutting. Affordances are read instantly, before any label.

**Implications:**
- Visual affordances should match available actions — anything that looks tappable should be tappable; anything that looks decorative should not be.
- Affordance is perceptual; it's separate from the *actual* action set. A flat label that's actually clickable has poor affordance.

### Signifier
The visible cue that suggests an affordance. A button's shadow, color, hover state — these are signifiers. Affordance is what's *possible*; signifier is what *suggests* it.

### Feedback
Every action must produce a perceptible response. Click → state change. Type → cursor advances. Submit → loading or result.

**No-feedback is the worst failure mode in interaction design.** The user's mental model is "did anything happen? did I do it right? should I try again?" Lack of feedback creates anxiety and double-clicks (which create their own bugs).

**Latency matters** (see Doherty Threshold). Feedback under 100ms feels instant; 100–400ms feels responsive; >400ms requires explicit feedback (spinner, skeleton, optimistic update).

### Direct manipulation
Controls that act on objects, not on representations of them. Drag the thing itself to move it. Click the thing to select it. Resize via its corner handles.

Direct manipulation feels like the interface is "real." It's the opposite of menu-driven indirection ("File → Move → Choose destination → OK").

### Discoverability
The user can find the action they need by looking. Hidden affordances (long-press menus, keyboard shortcuts, swipe gestures) are powerful but undiscoverable — they need a discoverability path (labels, tooltips, onboarding, hints).

### Reversibility / undo
Every action should be reversible, ideally with an explicit undo. The user should be able to explore without fear of breaking things.

**Soft delete > hard delete.** Always.

### Consistency
Same things look the same; different things look different. Internal consistency (within this product) is more important than external consistency (matching every other product) — but external consistency is the default assumption (Jakob's Law).

### Constraints
Limit the set of possible actions to make the right one obvious. Disabled buttons, grayed-out options, single-choice radios — these are constraints that simplify the user's decision.

### Mappings
The relationship between control and effect. A volume slider that moves up to increase volume is well-mapped; one that moves left has poor mapping. Real-world spatial mappings are the strongest (turn left → look left, push up → move up).

### Visibility (state and action)
The user should be able to see, at any moment:
- What state the system is in (am I logged in? is this saved? what's selected?)
- What actions are available (which buttons are clickable, which menus exist).

Hidden state and hidden actions force the user to remember instead of recognize.

---

## 5. Accessibility foundations

WCAG 2.1 organizes accessibility into four pillars: **Perceivable, Operable, Understandable, Robust** (POUR).

### Perceivable
- **Text contrast** ≥ 4.5:1 for body, 3:1 for large text and UI components.
- **Don't encode meaning by color alone.** Pair color with text, icon, or pattern. (Red border on an error field also has a text "required" label.)
- **Alt text** on images and icons that carry information.

### Operable
- **Keyboard accessible.** Every interaction reachable without a mouse.
- **Focus visible** when keyboard-navigated. Focus *invisible* on click is the modern best practice (use `:focus-visible`, not `:focus`).
- **Touch targets** ≥ 44×44pt (Apple HIG) or 48dp (Material).
- **Skip links** to bypass repeated navigation when keyboard-driving.
- **No keyboard traps.** Tab and Shift+Tab should always be able to leave a region.

### Understandable
- **Predictable** behavior. Same controls do the same thing across the product.
- **Clear labels.** Avoid jargon, ambiguity, or "click here."
- **Error prevention and recovery.** Confirmations for destructive actions; clear error messages with actionable fixes.

### Robust
- **Semantic HTML.** Headings as headings, buttons as buttons, links as links.
- **ARIA when semantics aren't enough** — but ARIA is a last resort, not a substitute for native HTML.
- **Tested with assistive tech.** Screen readers, keyboard, reduced-motion preferences.

### Specific patterns worth knowing
- **Listbox pattern** (`role="listbox"` + `aria-activedescendant`): for lists where each item swaps a panel (variant rails, tabs). DOM focus stays on the container; items have `aria-selected`. Avoids the focus-vs-active stacking problem of roving tabindex.
- **Roving tabindex pattern**: for grids, toolbars, and other widgets where individual items are the unit of action. Arrow keys move DOM focus; tab leaves the widget.
- **Reduced motion**: respect `prefers-reduced-motion: reduce`. Disable or tone down decorative animations.
- **High contrast / forced colors**: design states should still differentiate when colors are remapped by the OS.

---

## 6. Motion & time

Motion design borrows vocabulary from animation (Disney's 12 principles, simplified for interface).

### Anticipation
Slight pre-motion that telegraphs the main action — a button briefly compresses before springing into a pressed state. Helps the user predict the system's behavior.

### Follow-through and overshoot
Motion that continues slightly past the target before settling. Communicates physicality and elasticity. Used sparingly on interactive surfaces; can feel toy-like if overdone.

### Easing curves
- **Linear**: feels mechanical; rare in good UI.
- **Ease-out**: starts fast, ends slow. Appropriate for "incoming" motion (an element arriving).
- **Ease-in**: starts slow, ends fast. Appropriate for "outgoing" motion (an element leaving).
- **Ease-in-out**: smooth on both sides. Appropriate for state transitions of persistent elements.

### Staggering
Multiple elements moving with small offsets create a coherent group transition without simultaneity. List items appearing 30–50ms apart read as a single graceful event.

### Duration ranges
- **<100ms**: micro-feedback (button press confirmation). The user shouldn't see a separate animation — it's just "the button reacts."
- **100–300ms**: most interface transitions. Long enough to read, short enough not to wait.
- **300–500ms**: meaningful transitions (entering a new view, dialog appearing). The user notices the motion as a moment.
- **>500ms**: should be rare. Used for emphasis, celebration, or transitions across major contexts.

### Functional vs decorative motion
- **Functional motion** communicates state change, spatial relationships, causality. The user uses the motion to track what happened.
- **Decorative motion** establishes character — playful springs, considered hovers, ambient pulses. Decorative motion must earn its place; ambient motion that the user can't turn off becomes noise.

Designer's axiom 5 ("snappy with considered liveliness") sits at the boundary: motion is mostly functional, with deliberate decorative touches at peak moments.

---

## 7. Cognitive load & decision

### Recognition over recall
Users recognize options faster than they recall them. Visible options beat memorized commands for most users. Power users who memorize keyboard shortcuts are exceptions, and they still benefit from the recognition path being available as a learning ramp.

### Progressive disclosure
Show only what's needed for the current step. Reveal complexity in layers: defaults visible, advanced options hidden behind explicit affordance, expert features in dedicated views.

**Cycle 4's D-0003** (conversation visible, operation collapsed) is progressive disclosure applied to the chat surface.

### Default values
Defaults are powerful: most users don't change them. Choose defaults that serve the median user; let outliers customize.

**Powerful corollary**: a poorly-chosen default that "users can change" effectively means the wrong behavior is the universal behavior.

### Choice architecture
The order, prominence, and grouping of options shapes user behavior even when all options are technically equal. Defaults, framing, and visual prominence all bias choice.

**This carries ethical weight.** Choice architecture used to nudge users toward outcomes they wouldn't independently choose is "dark patterns." The taste-loop critic should flag these when they appear in any project's surfaces.

### The Three-Slider Problem (referenced by uncommon-care)
When three or more parameters are exposed as separate controls and they interact non-orthogonally (changing one affects the meaning of others), the user can't form a model of the space. Collapse to one richer control with a wide range, or hide the dependency in defaults.

### Recognition vs comprehension
Recognition (knowing something is "the active item") is faster than comprehension (reading a label that says "active"). Visual encoding (color, size, position) supports recognition; text labels support comprehension. The best surfaces give users both — the label is there if needed, but recognition usually suffices.

---

## 8. When to break a principle

Foundations are defaults, not commandments. Deviations are legitimate when:

1. **The convention is bad.** Some established patterns are bad and should be improved (autoplay video with sound, popups on entry, dark patterns of every kind). Cite the convention, explain why it's bad, propose better.

2. **The product context overrides.** A power-user creative tool may legitimately violate Hick's Law (expose many controls at once) because the user's workflow demands density. A children's app may legitimately violate aesthetic-usability minimums in favor of playfulness. The override needs to be deliberate and reasoned.

3. **Two foundations conflict.** Tesler's Law vs Hick's Law. Aesthetic-Usability vs Reduction. Direct Manipulation vs Discoverability. When foundations conflict, the designer chooses based on which serves the surface's specific job. Document the choice.

4. **The convention is not yet established.** New patterns (AI surfaces, voice interfaces, spatial computing) lack settled conventions. Inventing here is necessary; cite what you're carrying over from adjacent conventions and where you're departing.

**The rule is:** name the foundation, explain why deviating, and capture the reasoning. A deviation without a written reason becomes inheritable confusion six months from now. A deviation with a written reason becomes vocabulary.

---

## Sources & further reading

- Wertheimer, "Untersuchungen zur Lehre von der Gestalt" (1923) — the original Gestalt paper.
- Norman, *The Design of Everyday Things* (rev. 2013) — affordance, signifier, mapping, feedback.
- Tognazzini, "First Principles of Interaction Design" — extensive HCI principle list.
- Lidwell, Holden, Butler, *Universal Principles of Design* — broad reference, well-illustrated.
- Krug, *Don't Make Me Think* — practical applications.
- WCAG 2.1 specification — accessibility, definitive.
- Apple HIG and Material Design guidelines — platform-specific applications of foundations.
- Laws of UX (lawsofux.com) — concise summaries with citations to source research.
- Refactoring UI (Adam Wathan) — visual design fundamentals applied to interface design.
- Disney's 12 principles of animation, simplified for UI by various motion designers.

This document is intentionally concise; for any single principle, follow the citations to the source literature when depth is needed for a specific decision.
