// Visual regression matcher — applies a theme + accent, waits for the
// surface to settle (fonts loaded, layout flushed, no in-flight scheduled
// callbacks), then takes a screenshot via Playwright and compares it
// against the committed baseline.
//
// Threshold defaults to 0.5% of total pixels — tight enough to catch
// real regressions, loose enough to absorb sub-pixel anti-aliasing drift
// between Playwright runs on the same Linux host.

import { expect } from "vitest";
import { commands, page } from "@vitest/browser/context";

export interface VisualCompareResult {
  status:
    | "matched"
    | "mismatch"
    | "baseline_written"
    | "baseline_missing"
    | "platform_skipped"
    | "size_mismatch";
  diffPercent?: number;
  baselineWidth?: number;
  baselineHeight?: number;
  actualWidth?: number;
  actualHeight?: number;
  message?: string;
}

declare module "@vitest/browser/context" {
  interface BrowserCommands {
    compareScreenshot: (
      name: string,
      screenshotBase64: string,
      thresholdPercent: number,
    ) => Promise<VisualCompareResult>;
  }
}

export type Theme = "light" | "dark";

export interface ScreenshotOptions {
  /** Variant key — appended to the base name. e.g. "collapsed", "wide". */
  variant?: string;
  /** Maximum allowed pixel-diff percent. Default 0.5. */
  thresholdPercent?: number;
  /** Override the html `data-accent` attribute. Designer is monochrome by
   *  policy (axiom #3) so this is only meaningful when a future variant
   *  is introduced — left as an extension hook. */
  accent?: string | null;
  /** CSS selector clipped to a sub-region of the viewport. When omitted
   *  the entire viewport is captured. */
  clipSelector?: string;
}

/** Apply a theme to the document root the same way the production
 *  bootstrap does (see packages/app/index.html and src/theme/index.ts). */
export function applyTheme(theme: Theme, accent?: string | null) {
  const root = document.documentElement;
  root.classList.remove("light-theme", "dark-theme", "light", "dark");
  root.classList.add(theme === "dark" ? "dark-theme" : "light-theme");
  root.setAttribute("data-theme", theme);
  root.style.colorScheme = theme;
  if (accent) {
    root.setAttribute("data-accent", accent);
  } else {
    root.removeAttribute("data-accent");
  }
}

/** Wait for fonts and a couple of animation frames so layout has settled
 *  before the screenshot. document.fonts.ready resolves once every face
 *  declared in CSS has loaded; the rAF pair flushes layout/paint and
 *  any post-mount React effects that scheduled a frame. */
export async function settle() {
  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready;
  }
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
}

export async function matchScreenshot(
  baseName: string,
  options: ScreenshotOptions = {},
) {
  const { variant, thresholdPercent = 0.5, clipSelector } = options;
  await settle();

  const fileName = variant
    ? `${baseName}--${variant}.png`
    : `${baseName}.png`;

  let clip: { x: number; y: number; width: number; height: number } | undefined;
  if (clipSelector) {
    const el = document.querySelector(clipSelector) as HTMLElement | null;
    if (!el) throw new Error(`clipSelector did not match: ${clipSelector}`);
    const rect = el.getBoundingClientRect();
    clip = {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  // Vitest browser: `{ base64: true }` returns `{ path, base64 }`. The path
  // is on disk under the test file's __screenshots__ dir; we don't need it
  // because the server command writes the canonical baseline directly.
  const screenshot = await page.screenshot({ base64: true });
  const base64 =
    typeof screenshot === "string"
      ? screenshot
      : (screenshot as { base64?: string }).base64 ?? "";
  if (!base64) {
    throw new Error("page.screenshot() returned no base64 payload");
  }
  // clipSelector is currently informational — vitest's screenshot API
  // doesn't expose a clip rect. Reserved for a future locator-scoped
  // capture; for now the entire viewport is the source of truth.
  void clip;

  const result = await commands.compareScreenshot(
    fileName,
    base64,
    thresholdPercent,
  );

  switch (result.status) {
    case "matched":
    case "baseline_written":
    case "platform_skipped":
      return;
    case "baseline_missing":
      throw new Error(
        result.message ??
          `No baseline for ${fileName}. Generate one on Linux ` +
            `(font rendering differs between platforms): run ` +
            `'npm run test:visual:update' there, or trigger the ` +
            `'regenerate-visual-baselines' GitHub Actions workflow.`,
      );
    case "size_mismatch":
      expect.fail(
        `Screenshot size differs from baseline for ${fileName}: ` +
          `baseline ${result.baselineWidth}x${result.baselineHeight}, ` +
          `actual ${result.actualWidth}x${result.actualHeight}`,
      );
      return;
    case "mismatch":
      expect.fail(
        `Screenshot differs from baseline for ${fileName}: ` +
          `${(result.diffPercent ?? 0).toFixed(3)}% pixels changed ` +
          `(threshold ${thresholdPercent}%)`,
      );
      return;
  }
}
