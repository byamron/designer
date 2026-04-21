<!-- mini:start -->
## Mini Design System

This project uses Mini. UI tasks follow the procedure below.

### Information map

| Concern | Source of truth |
|---|---|
| Design tokens and axioms | `core-docs/design-language.md` |
| Component catalog | `core-docs/component-manifest.json` |
| Decision rationale | `core-docs/pattern-log.md` |
| Generation log | `core-docs/generation-log.md` |
| Skills (runtime) | `.claude/skills/` |
| Core contracts (reference) | `docs/core-reference/` |

### Procedure for UI tasks

Before writing or editing UI code:

1. Check `core-docs/component-manifest.json`. Prefer in order: platform-native archetype (Radix on web, native on Swift) → extend an existing component → generate new.
2. Read `core-docs/design-language.md` for tokens and axioms. Reference tokens, never arbitrary values.
3. Compose using core primitives (Box, Stack, Cluster, Sidebar, Center, Container, Frame; Overlay on web only).
4. After generation: verify no arbitrary px / hex / ms / z-index values remain. Run `node tools/invariants/check.mjs <changed files>` if available.
5. For interactive output: verify focus-visible, keyboard path, contrast across accent × mode, `prefers-reduced-motion`, no animate-in-tree anti-pattern.
6. Update `core-docs/component-manifest.json` for new or modified components.
7. Append an entry to `core-docs/generation-log.md` (schema in that file's header).
8. Log non-obvious decisions to `core-docs/pattern-log.md`.

### Skills

Mini's skills live at `.claude/skills/` and fire on matching user intents. Primary entry for UI tasks is `generate-ui`. If a skill doesn't fire when expected, follow the procedure above manually.
<!-- mini:end -->
