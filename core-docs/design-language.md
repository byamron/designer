# Design Language

> Living documentation of Designer's design language. Source of truth for every token and axiom; all Mini skills read from this file. Produced by `elicit-design-language` on 2026-04-21 (greenfield mode); evolved through a shipped surface pass in 2026-04-22 (the "UI critique" round and its staff-review amendment).

Mini's scaffolding lives at `packages/ui/`. Fork-and-own tokens in `packages/ui/styles/tokens.css`; the structural CSS (`axioms.css`, `primitives.css`) tracks upstream Mini. See `packages/ui/MINI-VERSION.md` for the currently synced commit.

---

## Core Principles

Product-level principles that shape every axiom below. These outrank axioms when in conflict — an axiom that violates a principle is wrong, not the principle.

1. **Manager's cockpit, not developer's IDE.** Every surface must feel first-class to a clear thinker with domain expertise — not a simplified version of a tool built for engineers.
2. **Summarize by default, drill on demand.** Dense dashboards are a failure mode. Rich surfaces are earned; the default should fit at a glance.
3. **Calm by default, alive on engagement.** Ambient surfaces stay quiet. Active surfaces come alive with streaming content, previews, and chain-of-thought. The transition should feel deliberate.
4. **Subtle confirmation over explicit signals.** When the system is optimizing (Forge proposals, auditor checks, context dedup), surface it subtly — never interrupt.
5. **Trust through legibility.** The user should always know what agents are doing, what they have permission to do, and what happened while the user was away.
6. **Motion is mostly functional, with considered liveliness.** Movement communicates state change (active → idle, streaming → complete). It's also a design tool, so small, deliberate decorative touches are welcome where they make the product feel alive rather than inert. No gratuitous motion.

## Axioms

The top-level rules from which all tokens derive. Changing an axiom is a propagation event; see `pattern-log.md` for change rationale.

1. **Base line-height:** `1.4` — tight register; it's a tool, not a reading surface. Drives `--space-3` and the spacing scale.
2. **Density register:** `balanced` — leans tight. Summarize-by-default rules out airy; calm-by-default rules out aggressively tight. Adjacent-step ratio is ~2× in the Mini default spacing.
3. **Accent identity:** `monochrome` — Designer's **base palette** is black, white, and neutrals only, in the Notion/Linear register. No named accent color ships. Two *functional* intensities express emphasis instead: `calm` (the default, muted neutral-on-neutral) and `energized` (high-contrast, reserved for active/streaming/needs-you states). **Semantic colors are always available and always chromatic** — `--success-*` (green), `--warning-*` (amber), `--danger-*` (red, used for destructive actions too), `--info-*` (blue) come from Mini's fixed semantic scales and should be used whenever the color is carrying signal meaning (state, severity, outcome). "Monochrome" constrains the decorative/brand/accent layer, not the signal layer.
4. **Gray flavor:** `sand` — warm neutral. Reads as paper, not cream; a whisper of warmth on a black-and-white register. Swap via the Radix scale imports in `packages/ui/styles/tokens.css`.
5. **Motion personality:** `snappy` (with considered liveliness) — `--motion-quick` / `--motion-standard` dominate; decorative micro-motion is allowed where it reinforces "alive on engagement" without crossing into expressive/spring territory.
6. **Type system:** `sans + mono` — `Geist` (UI) and `Geist Mono` (code, diffs, identifiers, spec blocks). No serif. Font wiring is deferred to Phase 8; token stack falls back to system fonts until Geist is loaded.
7. **Type scale ratio:** `perfect-fourth 1.333` — balanced hierarchy. Tighter than golden, more defined than minor-third.
8. **Surface hierarchy depth:** `3` — `flat` / `raised` / `overlay`. Modals share the overlay tier; no separate modal elevation in the token layer. Re-evaluate after first surfaces ship if overlays and modals need to visually distinguish.
9. **Radius personality:** `soft, sharper side` — button = 6px base. Badge 3px / card 10px / modal 12px. Tool-appropriate — neither brittle (2–4) nor pillowy (14+). Modal dropped from 14 → 12 in the 2026-04-22 type re-tune so the overall shape language stays tighter alongside the denser 15px body.
10. **Focus style:** `ring-outside` — 2px outline offset 2px. Highest a11y default; reinforces "trust through legibility." For compose-style containers where the input is visually embedded, apply the ring to the *container* via `:focus-within` rather than the child input, using `box-shadow` at the same intensity.
11. **Spacing rhythm:** `3/4/5/6` — surfaces compose from four canonical steps. `--space-3` (8px) for inline gaps and row horizontal padding. `--space-4` (16px) for panel edge padding and group gap. `--space-5` (24px) for stacked content blocks and main content inset. `--space-6` (32px) for section breaks on home-style surfaces. `--space-1 / --space-2 / --space-7 / --space-8` are exceptions and should be justified in `pattern-log.md`. Documented at the top of `app.css`.
12. **Information architecture scope:** `project : workspace : tab`. **Home is project-level**, lives in the left sidebar, and shows state across every workspace in the project. **Tabs are workspace-level** (Plan, Design, Build, Blank); opening a workspace activates its first tab. There is no workspace-level "home tab" — the home view IS the project overview.
13. **Icon sizing:** three steps — `--icon-sm` (12px), `--icon-md` (14px), `--icon-lg` (16px). All inline SVGs use `currentColor` so color inherits from the surrounding text-color token. Strokes: `1.25` at sm/md, `1.5` at lg.
14. **Hit-target sizing:** two steps — `--target-sm` (26px) and `--target-md` (32px). Any icon-only button uses one of these as its outer hit box; the icon inside is one of the `--icon-*` steps. `md` is the default; `sm` is reserved for genuinely dense inline affordances (chip removers, inline-row controls). `sm` is 26px so a dense button sits 4px taller than a body row (22.5px at 15/1.5) rather than crowding flush against it. Anything smaller breaks tap accessibility.
15. **Text roles in app chrome:** three sizes, tight tool register — `caption` (**13px**, meta/labels/kbd), `body` (**15px**, default for every control/message/list-row/title-carried-by-weight), `h3` (**18px**, the one heading role — empty-state titles and the occasional surface anchor). `lead` sits at **15px** by default (collapsed to body) and is reserved as a knob to bump palette/quick-switcher inputs to a hero size if that pattern is ever wanted again. `h2` (32px) renders only on the onboarding hero, outside chrome. `h4` / `h1` / `display` exist as edge-surface reserves in tokens.css but are not referenced in shipped UI — using one in chrome requires a pattern-log entry. Size ratios are 1.15× (caption→body) and 1.20× (body→h3) — tighter than perfect-fourth; the register is Linear/Figma, not Notion. At this scale size alone cannot carry hierarchy; see axiom #16.
16. **Weight policy in chrome:** two weights, not four. `--weight-regular` (400) for body prose, input text, anywhere reading is the primary activity. `--weight-medium` (500) for UI labels, button text, titles-at-body-size, active-nav items — the workhorse weight for "this is a thing, not just text about a thing." `--weight-semibold` (600) is reserved for `h3` and for numeric-as-signal callouts (counter badges, metric readouts). `--weight-bold` (700) is not used in chrome; it's present for the `display` role should onboarding/hero surfaces need it. Rule of thumb: **hierarchy is carried by color before weight, and by weight before size.** A list of rows where each has `body-regular-foreground` is unscannable; rebuild it as `body-medium-foreground` (primary) + `caption-regular-muted` (secondary) and the scan-path appears without changing a size.

### Theme

Not a Mini axiom, but locked here because it affects every other decision:

- **Default:** system preference (`prefers-color-scheme`). Both light and dark are first-class.
- **Parity requirement:** no surface ships in one mode without working in the other.

## Depth Model

Three surface tiers, mapped to Designer's layout:

- **Navigation** (project strip, workspace sidebar) → `elevation-flat` / `layer-flat`
- **Content** (main view, tabs, activity spine) → `elevation-raised` / `layer-raised`
- **Float** (modals, OS notifications, live tray when pinned) → `elevation-overlay` / `layer-overlay`

Modal-specific elevation (`elevation-modal` in Mini tokens) exists for future use but is not currently in the tier map — modals borrow the `overlay` tier until we find a reason to distinguish.

## Tokens

Derived from axioms; authoritative values live in `packages/ui/styles/tokens.css`. This section names what exists — do not duplicate values here, they drift.

### Spacing
`--space-1` through `--space-8`. Base `--space-3 = 8px` (tight 1.4 × body). Canonical rhythm is `3/4/5/6` (axiom #11).

### Type
Role-named (`caption`, `body`, `lead`, `h4`, `h3`, `h2`, `h1`, `display`), each with `-size`, `-leading`, `-weight`, `-tracking`. Families: `--type-family-sans` (Geist stack), `--type-family-mono` (Geist Mono stack). Weights are abstract tokens (`--weight-regular` 400, `--weight-medium` 500, `--weight-semibold` 600, `--weight-bold` 700). *Do not write `--type-weight-*` — that prefix was a consumer-side typo that silently fell back to UA defaults. All consumers now reference `--weight-*`.*

### Color
- **Accents:** `--accent-1..12` + `--accent-a1..a12`. **Bound to `--gray-*` in `tokens.css`** — Designer is monochrome by policy (axiom #3). No chromatic Radix import. Do not introduce a chromatic accent without amending this document.
- **Neutrals:** `--gray-1..12` + `--gray-a1..a12`. Sourced from the `sand` Radix scale via an alias block in `:root`. The abstract `--gray-N` token name is stable; swap the underlying scale by changing the 4 imports + rewriting the alias block.
- **Semantics:** `--success-*`, `--warning-*`, `--danger-*`, `--info-*` (chromatic; from green, amber, red, blue). Never swapped.
- **Contrast foregrounds:** `--accent-contrast`, `--danger-contrast`.

### Radius
`--radius-none`, `--radius-badge` (3px), `--radius-button` (6px), `--radius-card` (10px), `--radius-modal` (14px), `--radius-pill`.

### Motion
Durations: `--motion-instant` (50ms), `--motion-quick` (120ms), `--motion-standard` (250ms), `--motion-emphasized` (400ms). Easings: `--ease-out-enter`, `--ease-in-exit`, `--ease-standard`. Composed: `--motion-enter`, `--motion-exit`, `--motion-interactive`. Optional spring: `--motion-spring-snappy`.

### Elevation
Shadows: `--elevation-flat`, `--elevation-raised`, `--elevation-overlay`, `--elevation-modal`. Layers: `--layer-flat`, `--layer-raised`, `--layer-overlay`, `--layer-modal`.

### Icon
`--icon-sm` (12px), `--icon-md` (14px), `--icon-lg` (16px). See axiom #13.

### Hit target
`--target-sm` (24px), `--target-md` (32px). See axiom #14. Consumed by the `.btn-icon--sm/md` archetype; prefer the component over reapplying sizes.

## Patterns

High-level design patterns Designer has explicitly chosen. Not axioms (they don't drive token values) but recurring decisions worth codifying.

- **Panels, not cards.** Inside a content surface, sections are titled blocks separated by whitespace and (when needed) a single hairline divider — not bordered rectangles stacked into a grid. No cards-within-cards. Card chrome is reserved for genuinely floating surfaces (modals, tray items, the compose dock). Rationale: borders compound visually across a dashboard; the dashboard starts shouting; nothing reads as the anchor.
- **Home is a project-level surface, not a tab.** Lives in the left sidebar under the project header; activating it deselects any workspace. Shows vision, near-term focus, active workspaces (with status icons), recent reports, needs-you, autonomy. A small "Project home" kicker above the lede tells first-time users what surface they're on.
- **Home may be a prompt, not a dashboard.** Variant B is palette-first (Dia-inspired): one centered input + 4–6 context-aware suggestions + a collapsed brief. Honors *summarize-by-default, drill-on-demand* more literally than a grid. Variant A (panels dashboard) and Variant B (palette) are switchable at runtime via an explicit toggle in the topbar. Treat variant switchability as an ongoing design tool: when two load-bearing directions both have merit, ship both behind a toggle and let real use decide rather than speculating.
- **Linear-style tabs.** Pill containers that render side-by-side inside the tabs bar. Active = raised background + thin border; inactive = transparent muted label. `flex: 0 1` with min/max widths so tabs grow to natural size and shrink proportionally when crowded (not equal-flex). Each tab has a template icon left + label + an `X` close affordance that becomes visible on hover/focus/active. Close also responds to middle-click and ⌘W.
- **Single "+ New" dropdown, not a button cluster.** One affordance that opens a menu of template options (Plan / Design / Build / Blank), each with its own icon + description. Keyboard: ⌘T toggles; click-outside or Escape closes.
- **Compose as dock, not card.** Multi-line chat input lives at the bottom of a tab via `TabLayout`'s `dock` slot. The dock itself has no panel chrome — the compose container (rounded, bordered) is the visual object, and it floats inside the tab body with matching max-width. Focus ring applies to the container via `:focus-within`, not the child textarea (which has `outline: none`). The footer row (model / effort / plan-mode toggle) sits inside the same container separated by a hairline; drag-over lights the border.
- **Activity spine rows are text, not pills.** No default background, no border. Rows are a two-column grid (`state-dot` + stacked `label` / `summary`). Depth is expressed via `padding-left: calc(var(--space-4) * depth)` and a `repeating-linear-gradient` background that draws hair-thin vertical rails at each ancestor's indent. The rails are decorative and non-interactive; the state-dot remains the primary signal.
- **Spine summary as dot + count, not text only.** The "2 active · 0 needs you · 0 errored" block becomes one inline-dot-plus-count per state, zero-states collapsed to nothing ("All quiet" appears when everything is zero). Colors come from the semantic scales (`--info-11` / `--warning-11` / `--danger-11` / `--success-11`).
- **Workspace status icons.** Workspace rows carry an optional `WorkspaceStatus` orthogonal to lifecycle (`state`). Seven glyphs, each colored from a semantic token: `idle` (muted outline), `in_progress` (info-11), `in_review` (warning-11), `pr_open` (ink), `pr_conflict` (danger-11), `pr_ready` (success-11), `pr_merged` (success-11). When `status` is set, it replaces the state-dot; when absent, state-dot shows.
- **Every interactive element has a concise tooltip — rendered by the `Tooltip` component, not the HTML `title` attribute.** Tooltips appear immediately on hover and on keyboard focus (no delay), render in a custom popover so they can't be clipped by overflow ancestors, and carry a separate `shortcut` slot for keyboard hints styled as a right-aligned `kbd`. The native `title` attribute still shows on some elements as a fallback, but new UI should reach for the `Tooltip` component. Copy stays tight — a short phrase, not a sentence.
- **Icon-only buttons go through `IconButton`, not hand-rolled markup.** The component enforces hit-target sizing (axiom #14), color inheritance, focus ring on the outer button, and a required tooltip label. Disabled buttons carry a tooltip that explains why (see *false affordances are a bug*).
- **Entire control is the focus target.** Selects and compose controls that look like a chip-shaped button must render the focus ring on the outer wrapper, not on the inner native element. The native `<select>` stays in the DOM for keyboard + screen-reader support but is positioned absolutely (opacity 0, fill the wrapper); `:focus-within` on the wrapper carries the ring. Applies to custom-styled `<details>`, `<label>+<input>` combinations, and anywhere a chip contains a native form control.
- **Chat asymmetry: user bubbles, agent on surface.** User messages render as right-aligned bubbles (surface-overlay background, hairline border, card radius, max-width 80%). Agent replies render directly on the surface — no bubble, no border, author label only. The asymmetry mirrors Claude/ChatGPT/Cursor and reinforces the visual register ("I said this" = contained; "the agent said this" = the page speaking back).
- **Keyboard shortcuts are declared in the tooltip, not a cheat sheet — and mirrored in a Help dialog.** ⌘K (quick switcher), ⌘T (new tab menu), ⌘W (close active tab), ⌘\ (toggle project strip), ⌘[ (toggle workspace sidebar), ⌘] (toggle activity spine), ⌘↵ (send compose), ⌘? (open Help), ↑↓↵ (navigate quick switcher), ← → (move between tabs when focused). Discoverability via `Tooltip.shortcut` on hover plus the Help dialog; the dialog is a mirror, not a source of truth.
- **Project strip carries a bottom utility cluster.** The bottom of the strip holds a Settings icon (opens the Settings dialog: Appearance, Account, Models, Preferences) and a Help icon (opens the Help dialog: question input, keyboard shortcuts, about). The strip does not contain a dedicated quick-switcher icon; ⌘K is the only affordance for it, because a visible icon for a keyboard-first power feature wasn't pulling weight.
- **Project strip squares carry a status dot, not a separate activity feed.** A tiny pulsing dot in the top-right corner of a project square indicates "something in this project is active / needs you." This replaces the previous global activity aggregation in the spine — the spine itself now scopes to the current project (or current workspace when one is selected), so the strip is the only surface where cross-project activity is visible.
- **Activity spine is project-scoped, not global.** When a workspace is active, the spine shows that workspace's rows and events; otherwise it shows the active project's rows. Cross-project activity is surfaced only as the strip status dot above. Summary copy: non-zero states render as dot + count; the all-zero fallback is "Nothing streaming" (not "All quiet" — the prior copy didn't explain what was quiet).
- **Sidebar and spine are togglable and carry drag-handle affordances.** Each pane has a hover-revealed edge handle (`.pane-toggle`, 4px wide, col-resize cursor) that will also anchor a drag-to-reorder pass when it lands. Collapsed panes render as a narrow `.pane-rail` with a single reveal IconButton. Keyboard: ⌘[ toggles the workspaces pane, ⌘] toggles the activity pane, ⌘\ toggles the projects strip. Persisted per install in localStorage.
- **Workspace name is carried by the sidebar, not the topbar.** The topbar on a workspace shows only the lifecycle dot + branch chip (caption-size monospace). On project home the topbar has no title at all — the Panels/Palette variant toggle is its only chrome. Rationale: the sidebar already anchors identity; the topbar repeating it was noise.
- **Tabs bar: the trailing `+` IS a tab.** The new-tab button lives inline as the last child of `.tabs-bar`, rendered as an `IconButton` that opens the template menu. No separate `New tab` text button in the topbar. Consistent vocabulary: these are **tabs**, not panels — code, docs, and copy all say "tab."
- **Palette densities — bounded vs open.** Variant B (Palette) has two runtime densities: `bounded` (prompt + suggestions share one rounded container, Dia-style) and `open` (items sit directly on the surface, no wrapping chrome). Density is a global preference — the toggle on the home palette also applies to any other surface using the `Palette` component.
- **Palette is the blank-tab surface too, not just home.** A blank workspace tab is a palette scoped to the workspace — same prompt, same suggestions layout, different copy ("Summarize the last N events in {workspace}", etc.). Two surfaces, one primitive (`packages/app/src/components/Palette.tsx`). Codifies the shape of "I don't know what I want yet; show me affordances in the current scope."
- **Workspace view has no topbar.** The tabs bar is the top row. Workspace identity (name + state + branch) lives in the sidebar; duplicating it at the top of the main content wastes a row and reads as a bullet point next to the tabs. Project-home view still has a minimal topbar for the Panels/Palette variant toggle.
- **Tabs bar is transparent; selection lives on the tab.** The container has no fill, no bottom separator. Selected state is carried by the individual tab (surface-overlay background, stronger border). This avoids the "active tab fades into the background" failure mode of hand-drawn tab strips.
- **Panes are resizable, not just togglable.** Each side pane (workspaces, activity) carries a `PaneResizer` at its non-content edge. Drag resizes; double-click resets to the default (256px); arrow keys ±16px with Shift bumping to ±48px; width clamped to `[180, 480]`. Persisted in localStorage. Collapse is a separate explicit affordance (IconButton in the pane header, ⌘[/⌘]) — conflating "close" with "drag to 0px" creates a UX cliff.
- **Compose metadata stays in the payload, not in the message body.** Model, effort, and plan-mode travel as `Message.meta` on the outgoing object. The visible chat body is exactly what the user typed — no bracketed config prefix, no model-receipt inside a bubble that's supposed to be human text.
- **Annotations are first-class objects, not one-way glyphs.** Every saved pin is a numbered button that opens a popover showing the note, author, and a Remove affordance. Draft popover supports Enter-to-save / Escape-to-cancel / Cancel button. Existing annotations must be re-readable without hover; a `title`-only surface would be invisible to touch users and to anyone reviewing the annotation list.
- **Icons live in `components/icons.tsx`, not inline in each file.** Every inline `<svg>` in a component is a candidate for extraction — the rule of three: on the third copy, move it. `IconX`, `IconPlus`, `IconBranch`, `IconChevronLeft/Right`, `IconCollapseLeft/Right` are shared. All use `currentColor` and a `size` prop matching `--icon-*`.
- **`SegmentedToggle` is the two-to-N pill chooser.** Used for Home variant (Panels/Palette) and Palette density (Bounded/Open). Any new two-to-N chooser goes through it — no hand-rolled `.variant-toggle__btn` copies.
- **`cx()` for classname composition, `persisted()` for localStorage.** Small `util/` helpers that prevent the third hand-rolled copy. Prefer them over new one-off implementations.
- **Pane resize: live updates, persist on release.** Drag-resizing writes to the store on every pointermove (via `setSidebarWidthLive` / `setSpineWidthLive`) but only writes to localStorage on pointer-up (`commitSidebarWidth` / `commitSpineWidth`). This is load-bearing: a per-pixel `localStorage.setItem` during drag serialized behind Safari's cross-tab lock and janked the interaction. New drag-persisted surfaces follow the same split.
- **Agents streaming is a first-class live state**, not a "loading" state. It has its own visual language — subtle pulse, token-distinguished row in the activity spine — and does not use any spinner/skeleton pattern.
- **Empty states are load-bearing.** Designer surfaces many blank canvases (new project, no workspaces, no tabs, all-quiet spine). They are not afterthoughts — each has intentional copy written for the manager's mental model, not generic UI jargon.
- **False affordances are a bug.** A button or input visible on the surface must do something today. If it's a stub, it ships either disabled (with a `Coming soon` title) or not at all. The mic button inside compose is the canonical example: it exists as a placeholder for Phase-13 dictation and is explicitly `disabled` until then.
- **Subtle optimization signals only.** Forge proposals, auditor pings, context-dedup events all announce themselves at a register below the user's current task — never as interrupting toasts.
- **Reduced-motion fallback is required, not optional.** Streaming content falls back to instant replace; subtle pulses fall back to static; any entrance animation falls back to instant.

## Evidence

Designer is no longer greenfield. Axioms 4, 10, 11, 12, and 13 were confirmed or added through a shipped surface pass in April 2026, informed by:

- A UI critique round comparing the initial build against Conductor, Dia, Notion, Linear, Cursor, Claude, and Slack. The critique produced the sand swap (mauve was decorative next to monochrome), panels-not-cards, linear-tabs, home-as-project, compose-as-dock, and the 3/4/5/6 spacing rhythm.
- A 16-annotation pass via Agentation that drove the close-X, status-icon, indent-rail, variant-toggle refinements, and the full tooltip coverage.
- A three-role staff review (UX / engineer / design engineer) that produced the IA scope axiom (#12), the icon-size token family (axiom #13 / #Tokens), the `--weight-*` token-name correction, and the container-level `:focus-within` focus pattern (refinement of axiom #10).

Axioms 1–3 and 5–9 remain from the initial elicitation.

## Review Checklist

Before considering any UI change complete:

- [ ] Uses Mini tokens — no hardcoded values (no arbitrary px / hex / ms / z-index)
- [ ] Uses `--weight-*` for font weights, never `--type-weight-*`
- [ ] Uses the `3/4/5/6` spacing rhythm unless explicitly justified
- [ ] Works in both light and dark mode
- [ ] Meets VoiceOver accessibility standards (focus-visible on every interactive target, keyboard path, contrast)
- [ ] Focus-visible ring-outside at 2px offset 2px — or, for compose-style containers, `:focus-within` box-shadow at equivalent weight
- [ ] Every interactive element has a concise `title` tooltip
- [ ] Animation respects `prefers-reduced-motion`
- [ ] Does not break calm-by-default behavior of ambient surfaces
- [ ] Maintains manager's-cockpit feel — not developer-IDE feel
- [ ] Semantic colors used for signal only (success/warning/danger/info) — not as decoration
- [ ] Monochrome policy respected — no chromatic **accent/brand** color introduced without an axiom amendment; semantic scales remain available and chromatic
- [ ] Home-is-project-level and workspace-tabs scopes respected (axiom #12)
- [ ] No false affordances — disabled buttons carry a `Coming soon` title or do not render
- [ ] SVG icons use `currentColor` and sizes from the `--icon-sm/md/lg` family

## Change log

Every amendment to axioms or tokens is logged here with date, author, and rationale. Minor token tweaks (one value change) belong in `pattern-log.md`; axiom changes belong here.

- `2026-04-21`: initial elicitation (greenfield). 10 axioms set from user interview + draft seeding.
- `2026-04-21`: axiom #4 amended. Gray flavor moved from `mauve` → `sand`. Motivation: mauve cast read as decorative next to the monochrome accent policy; sand gives a warm black-and-white register that aligns with the Notion/Linear/Dia references.
- `2026-04-22`: axiom #10 refined to cover compose-style containers (`:focus-within` on the container rather than the input).
- `2026-04-22`: axiom #11 added — spacing rhythm `3/4/5/6`. Codifies the canonical steps used after the spacing audit; `1/2/7/8` are now explicit exceptions.
- `2026-04-22`: axiom #12 added — IA scope (project : workspace : tab). Home moved from per-workspace to project-level; workspace tabs no longer include a Home.
- `2026-04-22`: axiom #13 added — icon sizing (`--icon-sm/md/lg` family). Codifies the 12/14/16px steps used by the SVG icons introduced in the shipped pass.
- `2026-04-22`: axiom #14 added — hit-target sizing (`--target-sm/md`). Motivated by the UX pass flagging 12px hit boxes on the sidebar add button. All icon-only buttons now flow through an `IconButton` component that enforces one of two sizes.
- `2026-04-22`: axiom #15 added — three text roles in app chrome (caption / body / h3). Motivated by the UX pass flagging "too many sizes fighting" in the topbar + tab header. Existing tokens are retained for edge surfaces (onboarding hero stays at h2); everyday UI is now body-driven with weight + color carrying hierarchy.
- `2026-04-22`: axiom #15 refined — body shrunk from 16px → 14px, h3 from 24px → 18px. Tighter tool register; closer to Linear/Figma. Leading adjustments: body 1.5 → 1.45, h3 1.25 → 1.3. Tracking for h3 -0.015em → -0.01em (the original tracking was tuned for 24px).
- `2026-04-22`: axiom #15 re-tuned live via TypeDevPanel — caption 12 → 13, body 14 → 15, lead 18 → 15 (collapsed to body). The 14/12 pair felt a hair too compressed at viewport inspection; one extra pixel on each opens the row rhythm without pushing into consumer-product register. Lead collapsing to body makes the palette/quick-switcher inputs sit in the body register by default — still a knob, but no longer a hero size out of the box.
- `2026-04-22`: cohesion pass on the rest of the token system after the type retune:
  - `--type-h4-size`, `--type-h1-size`, `--type-display-size` pruned (zero consumers — dead tokens).
  - `--type-*-weight` role-weight tokens pruned (dead indirection — consumers reference the `--weight-*` scale directly; the dev panel overrides there).
  - `--type-family-serif` pruned — unused; product is sans + mono by axiom #6.
  - `--motion-spring-weighted` pruned until a caller justifies it.
  - Axiom #14: `--target-sm` 24 → 26 so a dense hit target sits 4px taller than a body row (22.5px at 15/1.5) rather than crowding flush against it.
  - Axiom #9: modal radius 14 → 12 to keep a sharper tool register with the denser body; badge/button/card unchanged at 3/6/10.
  - Body leading 1.45 → 1.5 so the 15px body gets 22.5px rows — one pixel of extra air. `--type-lead-leading` tracks body since lead is collapsed to body.
  - `axioms.css` body rule switched from `--type-body-weight` (now-pruned) to `--weight-regular` directly.
- `2026-04-22`: axiom #16 added — weight policy. Regular + medium do almost all the work in chrome; semibold is reserved for h3 + numeric-as-signal callouts; bold is retired from chrome. Hierarchy precedence: color → weight → size. Motivated by the tight-scale refinement (axiom #15 at 14/18) — at this register size can't carry hierarchy alone.
