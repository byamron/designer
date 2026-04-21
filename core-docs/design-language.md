# Design Language

Source of truth for Designer's visual design and interaction rules. Every UI change must comply with this document. If a pattern isn't documented here and it should be, add it.

Status: **scaffolded**. The product is pre-implementation; detailed tokens, type scale, and component guidelines will be populated as the first surfaces are built. Mini design system is the intended substrate (see `/Users/benyamron/Desktop/coding/mini-design-system`).

---

## Core Principles

1. **Manager's cockpit, not developer's IDE.** Every surface must feel first-class to a clear thinker with domain expertise — not a simplified version of a tool built for engineers.
2. **Summarize by default, drill on demand.** Dense dashboards are a failure mode. Rich surfaces are earned; the default should fit at a glance.
3. **Calm by default, alive on engagement.** Ambient surfaces stay quiet. Active surfaces come alive with streaming content, previews, and chain-of-thought. The transition should feel deliberate.
4. **Subtle confirmation over explicit signals.** When the system is optimizing (Forge proposals, auditor checks, context dedup), surface it subtly — never interrupt.
5. **Trust through legibility.** The user should always know what agents are doing, what they have permission to do, and what happened while the user was away.
6. **Motion is functional.** Movement communicates state change (active → idle, streaming → complete). Decorative motion is not used.

## Typography

To be populated. Mini design system type scale is the starting point (`core/tokens.md` and `web/tokens.css` in the mini-design-system repo).

| Style | Size | Weight | Line Height | Use |
|-------|------|--------|-------------|-----|
| TBD | | | | |

**Typeface:** TBD. Mini's default is the starting point.

## Color System

To be populated from Mini tokens. Multi-accent support is a Mini feature and will propagate here. Semantic tokens (not raw hex) at all times.

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| TBD | | | |

Directional guidance: dark-theme default, light-theme parity required before shipping any surface.

## Spacing

Mini spacing scale: `--space-1` through `--space-8`, base `--space-3`. Apply directly; do not invent new values.

## Corner Radius

Mini role-named radii: `--radius-badge`, `--radius-button`, `--radius-card`, `--radius-modal`, `--radius-pill`. Apply by role; do not hardcode values.

## Depth Model

To be populated. Mini elevation tokens (`--elevation-flat`, `--elevation-raised`, `--elevation-overlay`, `--elevation-modal`) are the starting point. Designer's three-pane layout suggests a three-layer baseline:

- **Navigation** (project strip, workspace sidebar): flat
- **Content** (main view, tabs, spine): raised
- **Float** (modals, OS notifications, live tray when pinned): overlay / modal

## Component Guidelines

Populated as patterns emerge.

### Buttons
TBD. Start from Mini's button primitive.

### Cards
TBD. Start from Mini's Box primitive with `radius="card"`, `elevation="raised"`.

### Empty States
TBD. Designer has many empty-state surfaces (new project, new workspace, blank canvas); this section is load-bearing when those ship.

### Loading States
TBD. Special case: agents streaming is not a "loading" state — it is a first-class live state with its own visual language.

### Activity Spine
Core awareness primitive. Consistent row shape across altitudes (project / workspace / agent / artifact). State signals: active (subtle pulse), idle (muted), blocked (accent + tooltip), needs-you (notification dot), errored (warning color). Detailed spec to land with first implementation.

## Animation

- **Duration:** TBD. Start from Mini's composed motion tokens (`--motion-enter`, `--motion-exit`, `--motion-interactive`).
- **Easing:** TBD.
- **Reduced motion:** every interaction has a reduced-motion fallback. Streaming content falls back to instant replace; subtle pulses fall back to static.

## Review Checklist

Before considering any UI change complete:

- [ ] Uses Mini tokens — no hardcoded values
- [ ] Works in both light and dark mode
- [ ] Meets VoiceOver accessibility standards
- [ ] Follows spacing, type, and radius scales
- [ ] Animation respects reduced-motion
- [ ] Does not break calm-by-default behavior of ambient surfaces
- [ ] Maintains manager's-cockpit feel — not developer-IDE feel
