---
name: generate-ui
description: Primary entry point for any UI generation, modification, or structural UI change. Use when the user asks to build, create, generate, add, modify, extend, refactor, or redesign any UI — pages, components, layouts, screens, forms, panels, dialogs, or visual surfaces. Runs the canonical Mini pipeline inline: check component reuse, read design language, compose with primitives and archetypes, enforce tokens, audit a11y, update manifest and generation-log.
---

# generate-ui

**Purpose:** Any UI-producing request routes through this skill. It is the primary L2 enforcement entry point per plan §7.7 / §8.6. A single firing does the work of the full Mini pipeline without requiring the user to chain skills manually.

## When this skill fires

Should fire on generation and modification verbs applied to UI:
- "generate a new <component>"
- "build a <page/panel/layout/screen>"
- "create a <form/dialog/menu>"
- "add a <settings dropdown / header bar / notification panel>"
- "modify the <component> to <change>"
- "extend <component> with a <variant>"
- "refactor <page> to <new shape>"
- "redesign the <surface>"

Should NOT fire on:
- Audit/check verbs: "audit", "check", "verify", "lint", "enforce" — those belong to `audit-a11y`, `enforce-tokens`, `check-component-reuse`.
- Language-level work: "elicit", "initialize Mini", "update tokens", "propagate a change" — `elicit-design-language`, `propagate-language-update`.

**Disjointness rule (plan §13.6):** `generate-ui` owns generation verbs; individual skills own audit verbs. No overlap.

## Procedure

Run inline. Do not delegate to sibling skills — this skill *is* the pipeline per plan §7.7.

### Step 1 — Check component reuse

Read `core-docs/component-manifest.json`. For the requested UI:

1. **Native archetype first.** If the requested surface matches a platform-native archetype (Dialog, Menu, Popover, Tooltip, Tabs, etc. — see `core/archetypes.md`), use the Mini archetype wrapper (`web/archetypes/<name>.tsx` or Swift equivalent). Do not custom-build.
2. **Existing component next.** Grep the manifest for components with matching purpose. Prefer extending an existing component (new prop/variant) over creating a new one.
3. **Generate new** only if steps 1 and 2 don't fit.

If choosing option 3, explain briefly why the existing options didn't fit. Log in `pattern-log.md` if the choice was non-obvious.

### Step 2 — Read the design language

Open `core-docs/design-language.md`. Load:
- Axioms (all 10).
- Token inventory.
- Approved patterns section.

Do not skim. Every token reference in the generated code must come from this file or trace back to a token defined in `web/tokens.css`.

### Step 3 — Compose with primitives and archetypes

Build the UI using:
- **Primitives** (`web/primitives/`) for layout: Box, Stack, Cluster, Sidebar, Center, Container, Frame, Overlay.
- **Archetypes** (`web/archetypes/`) for interaction: Button, Dialog, Menu, Popover, Tooltip, Select, Tabs, Accordion, Toast, Checkbox, Radio, Toggle.
- **Project components** from the manifest for composed surfaces.

Every visible property (padding, radius, color, elevation, motion) resolves to a token. No hex, no literal px outside primitive internals, no raw ms.

### Step 4 — Enforce tokens (inline invariant check)

Run the invariant script on the changed files:

```
node tools/invariants/check.mjs <changed-files-dir> --md
```

Capture the markdown output; it becomes the `invariants` line in the generation-log entry (step 6).

If any invariant fails, fix the violation in the generated code and re-run. Do not ship with failing invariants. If a fix requires a new token (e.g., "this deviation is legitimate — we need a new `space-0` value for hairlines"), stop and suggest invoking `elicit-design-language` in amendment mode instead of silently adding the value.

### Step 5 — Audit a11y (inline checks)

Verify on every interactive element:

- Focus-visible style is present (CSS class or `:focus-visible` rule).
- Keyboard path: every click handler has an equivalent keyboard path (or the element is a native `<button>` / `<a>`).
- ARIA correctness per the archetype contract (`core/archetypes.md`): required attributes, roles, states.
- Color-encoded state has a secondary signal (text, icon, position).
- Motion respects reduced-motion (via the axiom in `axioms.css`, which collapses to instant).

This is the inline version of `audit-a11y`. For deep checks (contrast iteration across accent × mode, full keyboard walkthrough) explicitly invoke `audit-a11y` as a follow-up.

### Step 6 — Update manifest and generation-log

**Manifest:** For every new or modified component, update `core-docs/component-manifest.json`:
- Add a new entry for new components with `status: managed`, populated per `templates/component-manifest.schema.json`.
- Update `last_updated`, `tokens_referenced`, `primitives_used`, `archetypes_used`, `props`, `variants` on modified components.

**Generation log:** Append an entry to `core-docs/generation-log.md`:

```markdown
## <ISO-timestamp> — generate-ui
- prompt: "<user prompt verbatim>"
- trigger: generate-ui (primary)
- archetype-reused: <name or 'none'>
- components-reused: [<names>]
- components-new: [<names>]
- primitives: [<names>]
- tokens: [<names>]
- invariants: <N/M pass; include violations if any>
- deviations: <list or 'none'>
- feedback: pending
```

The `feedback` field is filled in on the next user turn (accepted / rejected / change-requested).

### Step 7 — Report

Summarize to the user:
- What was generated or modified (file paths).
- Which components were reused vs. new.
- Invariant result.
- Anything flagged (a11y concern, missing token, ambiguous choice).
- What the user should check manually (focus visibility in dark mode, motion at reduced-motion preference, etc.).

## Failure modes

- **No design-language yet.** Stop; tell user to run `elicit-design-language` first. Don't generate against a missing language.
- **Invariant fails and no legitimate token exists.** Stop; tell user the deviation pattern. Options: (a) amend language via `elicit-design-language`, (b) rework the generation to avoid the deviation, (c) accept the deviation and log it explicitly in `pattern-log.md` + `generation-log.md` with `deviations:`.
- **Requested surface genuinely needs a new archetype.** Not covered by current archetype set. Flag for language amendment (may also mean core/archetypes.md needs to grow — that's a Mini version bump, not a project change).
- **Request is ambiguous.** Ask clarifying questions *before* generating. Do not guess.
