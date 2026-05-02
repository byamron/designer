import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

// Visual regression config — runs the React UI in a headless Chromium via
// Playwright and compares pixel diffs against committed baselines. Kept in
// a separate config so the default `npm run test` (jsdom) is unaffected.
//
// Baselines are committed only from Linux. macOS local runs render the
// screenshots but the pixel comparison is skipped (see compareScreenshot
// below) so devs can iterate on the test without committing host-specific
// baselines.

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

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^@designer\/ui\/styles\/(.*)$/,
        replacement: path.resolve(__dirname, "../ui/styles/$1"),
      },
      {
        find: "@designer/ui",
        replacement: path.resolve(__dirname, "../ui/src/index.ts"),
      },
      { find: "@", replacement: path.resolve(__dirname, "./src") },
    ],
  },
  test: {
    include: ["src/test/visual/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/visual/setup.ts"],
    browser: {
      enabled: true,
      provider: "playwright",
      name: "chromium",
      headless: true,
      screenshotFailures: false,
      // Vitest browser defaults to a 414×896 phone viewport; Designer is
      // a desktop app so we want a desktop-class surface for screenshots.
      // 1280×800 sits comfortably above the Tauri shell's
      // `min_inner_size: 960×640` (apps/desktop/src-tauri/src/main.rs)
      // while staying small enough that the rendered surface fits a
      // typical designer's review window. A min-size variant could be
      // added later if a layout regression at 960px ever ships.
      viewport: { width: 1280, height: 800 },
      // Redirect page.screenshot()'s on-disk side-effect into a tmp dir
      // (gitignored). The base64 payload is what feeds compareScreenshot;
      // the disk copy is unused but vitest writes it anyway. Without this,
      // every test run litters __screenshots__/<test-file>/ with cached
      // copies that drift out of sync with the canonical baselines.
      screenshotDirectory: "node_modules/.cache/vitest-visual-screenshots",
      providerOptions: {
        launch: {
          args: ["--lang=en-US"],
        },
        context: {
          locale: "en-US",
          timezoneId: "UTC",
          deviceScaleFactor: 1,
          reducedMotion: "reduce",
        },
      },
      commands: {
        compareScreenshot,
      },
    },
  },
});

const BASELINES_DIR = path.resolve(
  __dirname,
  "src/test/visual/__screenshots__",
);

async function compareScreenshot(
  _ctx: unknown,
  name: string,
  screenshotBase64: string,
  thresholdPercent: number,
): Promise<VisualCompareResult> {
  const update = process.env.UPDATE_VISUAL_BASELINES === "1";
  const isLinux = os.platform() === "linux";
  const file = path.join(BASELINES_DIR, name);
  const actualBuf = Buffer.from(screenshotBase64, "base64");

  if (update) {
    if (!isLinux) {
      // Allow non-Linux update for local iteration but warn loudly so
      // baselines never get committed from a developer's macOS box.
      console.warn(
        `[visual] writing baseline ${name} from non-Linux host — do NOT commit.`,
      );
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, actualBuf);
    return { status: "baseline_written" };
  }

  // Skip the diff on non-Linux hosts — fonts and Skia rasterization
  // differ enough between macOS and Linux that any committed baseline
  // (Linux-generated) would always read as "changed" on macOS. The CI
  // job is the source of truth.
  if (!isLinux) {
    return {
      status: "platform_skipped",
      message: `Pixel comparison skipped on ${os.platform()} — baselines are only checked on Linux.`,
    };
  }

  let baselineBuf: Buffer;
  try {
    baselineBuf = await fs.readFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        status: "baseline_missing",
        message: `Baseline missing: ${name}. Run 'npm run test:visual:update' on Linux to generate.`,
      };
    }
    throw err;
  }

  const baseline = PNG.sync.read(baselineBuf);
  const actual = PNG.sync.read(actualBuf);

  if (
    baseline.width !== actual.width ||
    baseline.height !== actual.height
  ) {
    return {
      status: "size_mismatch",
      baselineWidth: baseline.width,
      baselineHeight: baseline.height,
      actualWidth: actual.width,
      actualHeight: actual.height,
    };
  }

  const diff = new PNG({ width: baseline.width, height: baseline.height });
  const diffPixels = pixelmatch(
    baseline.data,
    actual.data,
    diff.data,
    baseline.width,
    baseline.height,
    { threshold: 0.1 },
  );
  const totalPixels = baseline.width * baseline.height;
  const diffPercent = (diffPixels / totalPixels) * 100;

  if (diffPercent > thresholdPercent) {
    const diffPath = file.replace(/\.png$/, ".diff.png");
    const actualPath = file.replace(/\.png$/, ".actual.png");
    await fs.writeFile(diffPath, PNG.sync.write(diff));
    await fs.writeFile(actualPath, actualBuf);
    return { status: "mismatch", diffPercent };
  }

  return { status: "matched", diffPercent };
}
