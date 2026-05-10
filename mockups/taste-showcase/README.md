# Designer — Showcase

Runnable preview app for variants under taste-loop critique. Each variant is a self-contained React component that renders the workspace thread (or another Designer surface) as a Mini-built composition.

## Running

```bash
cd projects/designer/showcase
pnpm install   # or npm install
pnpm dev
```

The app loads Mini's CSS from `../../../web/` via the `@mini/*` alias (see `vite.config.ts`). Variants import Mini primitives and archetypes via `@mini/primitives` and `@mini/archetypes`.

## Adding a variant

1. Create `src/variants/<slug>.tsx` exporting a default React component
2. Register it in `src/variants/index.ts` with an `id`, `headline`, and the component
3. The rail auto-lists it; click to view

## Conventions

- One variant = one specific bet. "Variant A pushes fidgetability, variant B pushes flow continuity, variant C reduces" — not "variant A is my best guess." If there's only one viable direction, build one variant; otherwise build the bets.
- Variants reference the same content. Different craft choices, same surface, same data shape.
- Reference captures live at `../references/`. Compare visually before claiming a variant feels right.
- Never inline raw values. Tokens via Mini, always. If Mini can't express something, log it to `core-docs/mini-gaps.md` and use the closest-available token; don't paper over the gap with a hex literal.
