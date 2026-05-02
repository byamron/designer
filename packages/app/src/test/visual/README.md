# Visual regression tests

Three screens covered: Home (`HomeTabA`), workspace thread (`WorkspaceThread`),
approval inbox (`WorkspaceThread` seeded with stacked `ApprovalBlock` cards).
Light + dark modes, plus one structural variant on Home.

## Running

| Command                              | What it does                                    |
| ------------------------------------ | ----------------------------------------------- |
| `npm run test:visual`                | Compare screenshots against committed baselines |
| `npm run test:visual:update`         | Regenerate baselines (Linux only — see below)   |

The default `npm run test` (jsdom) does **not** include these — they live
under a separate Vitest config (`vitest.visual.config.ts`).

## Determinism

- **Renderer:** Vitest browser mode + Playwright Chromium (headless).
- **Viewport:** 1280 × 800, `deviceScaleFactor: 1`.
- **Locale / TZ:** `en-US` / `UTC`.
- **Time:** `Date.now()` is pinned to `2026-05-01T12:00:00Z` for the entire
  run so relative timestamps in fixtures render the same string every time.
- **Animations / transitions / caret blink:** disabled via injected CSS.
- **Fonts:** Geist + Geist Mono are bundled via `@fontsource/*` and loaded
  before the first screenshot (`document.fonts.ready`).
- **Pixel-diff threshold:** 0.5% of total pixels (configurable per call).

## Baselines are Linux-only

Skia / fontconfig render text differently on macOS, Linux, and Windows.
Baselines committed under `__screenshots__/` are generated on
`ubuntu-latest` (the same image CI runs on). On any other platform the
matcher takes the screenshot but **skips** the comparison — local macOS
runs will pass even when the surface has shifted, so don't rely on them
to catch regressions.

## Bootstrapping baselines

The first PR for any new visual test won't have baselines on disk. Two ways
to populate them:

1. **Recommended — GitHub-side** (no Linux box needed):
   ```sh
   gh workflow run regenerate-visual-baselines.yml -f branch=<your-branch>
   ```
   The workflow runs `npm run test:visual:update` on ubuntu-latest and
   pushes a `chore: regenerate visual regression baselines` commit
   directly to your branch — no artifact download / manual commit step
   needed. Pull the new commit (`git pull`) before continuing local work.

2. **Local Linux box / Docker:**
   ```sh
   npm run test:visual:update
   git add packages/app/src/test/visual/__screenshots__
   git commit -m "chore: regenerate visual regression baselines"
   ```

After regeneration, the `visual-regression` CI job (`.github/workflows/ci.yml`)
will start enforcing pixel diffs.

## When a test fails

CI uploads `*.actual.png` and `*.diff.png` next to each mismatched baseline
as a `visual-diffs` artifact. Download from the failed run, eyeball the
diff, and either:

- Fix the regression and re-run, or
- Accept the new look: re-run `regenerate-visual-baselines` and merge.
