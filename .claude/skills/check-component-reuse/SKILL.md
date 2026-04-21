---
name: check-component-reuse
description: Determine whether a UI surface can be built with an existing component, a platform-native archetype, or needs a new component. Use when the user asks what components exist, whether a piece of UI should reuse something, or for an inventory of what's available. This skill is also invoked internally by generate-ui step 1, but has a legitimate standalone use for reference queries.
---

# check-component-reuse

**Purpose:** Prevent duplicate components and steer new work toward platform-native archetypes or existing code. See plan §8.2.

## When this skill fires

Should fire on audit/reference queries about components:
- "What components do we have for <purpose>?"
- "Is there an existing component for <thing>?"
- "Should I reuse X or build new?"
- "List the components in this project."
- "Does the manifest have a <kind> already?"

Should NOT fire on generation requests ("build a…", "generate…", "create…") — those are `generate-ui`, which internally calls this skill's logic as step 1.

## Procedure

### Step 0 — Prefer platform-native archetype (amendment #4)

Before anything else, check whether the surface matches a platform-native archetype:

- **Web:** Dialog, Menu, Popover, Tooltip, Tabs, Accordion, Toast, Checkbox, Radio, Select, Toggle, Button. See `core/archetypes.md` and `web/archetypes/`.
- **Swift:** Sheet, Menu, Popover, Alert, DisclosureGroup, Picker, Toggle, Button.

If so: the answer is the archetype wrapper. No new component needed. Return this with the correct Radix/SwiftUI delegation path.

### Step 1 — Search the manifest

Read `core-docs/component-manifest.json`. For each component:
- Compare `purpose` field against the user's stated need (semantic match, not just string match).
- Surface any component whose purpose overlaps.

For each candidate, report:
- `name`, `path`, `purpose`, `status`, `native_wrapped`.
- Props, variants, tokens referenced.
- Whether the user's need fits as-is, fits with a new variant, or is out of scope.

### Step 2 — Recommend

Recommend in this order:
1. **Use native archetype** (step 0 found a match).
2. **Reuse existing as-is** (manifest found an exact-fit component).
3. **Extend existing with a new variant or prop** (manifest found a close fit).
4. **Generate new** (no fit found).

If recommending 4, explain why 1–3 were rejected. The default answer for ambiguous cases is "extend, not generate" — duplicate components are the failure mode Mini exists to prevent.

### Step 3 — Do not write code

This skill is diagnostic. It does not generate UI. If the user's follow-up is "OK, build it", the next step is `generate-ui`, not this skill.

## Outputs

- Markdown report with recommendation and evidence.
- No file writes.

## Failure modes

- **No manifest.** Project hasn't run `elicit-design-language` yet. Tell user to initialize first.
- **Stale manifest.** Component files exist that aren't in the manifest. Surface as a warning; suggest running `elicit-design-language` in archaeology mode to reconcile.
- **Ambiguous purpose field.** Manifest entries with vague purpose strings can't be matched reliably. Flag specific entries for the user to refine.
