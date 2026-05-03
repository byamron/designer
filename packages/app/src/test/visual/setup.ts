// Visual regression test setup. Runs in the browser via @vitest/browser.
//
// Pins the bits that would otherwise jitter between hosts:
//   - Font: Geist + Geist Mono bundled, loaded synchronously before any test.
//   - Time: Date.now() returns a fixed instant; relative timestamps are stable.
//   - Animations: globally disabled so screenshots aren't mid-transition.
//   - Caret blink: disabled — focused inputs would otherwise blink mid-frame.

import "@fontsource/geist/100.css";
import "@fontsource/geist/200.css";
import "@fontsource/geist/300.css";
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import "@fontsource/geist/700.css";
import "@fontsource/geist/800.css";
import "@fontsource/geist/900.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-mono/600.css";
import "@fontsource/geist-mono/700.css";

import "@designer/ui/styles/tokens.css";
import "@designer/ui/styles/axioms.css";
import "@designer/ui/styles/primitives.css";
import "@designer/ui/styles/archetypes.css";
import "../../styles/app.css";

import { afterEach, beforeAll } from "vitest";
import { cleanup } from "@testing-library/react";
import { FIXED_NOW_ISO, FIXED_NOW_MS } from "./fixtures";
import { dataStore } from "../../store/data";

// Note on `animation-duration: 0s` + `animation-iteration-count: 1`:
// animations still run, but in one zero-length tick — they jump to their
// final keyframe and stop. Correct for fade-in / slide-in patterns whose
// end state is the desired baseline. Wrong for animations that *cycle*
// through visually distinct keyframes (a pulse that's larger at 50%);
// those would lock at the end frame, which may not represent the
// canonical look. Designer's chrome today is pulse-and-stop, so this is
// safe — but worth knowing if a future component adds a multi-keyframe
// animation that holds an intermediate state.
//
// `caret-color: transparent` suppresses the input caret to avoid
// mid-blink jitter. Designer's monochrome policy (axiom #3) means no
// input uses caret color to encode signal; revisit if that ever changes.
//
// `.thread__activity` is hidden because it's a transient state — present
// during "submitting" / "stuck" phases. The synthetic-send pattern in
// workspace-thread.test.tsx + approval-inbox.test.tsx leaves the thread
// in `submitting` for the duration of the test (no fresh agent artifact
// lands to clear it). Hiding the chrome keeps the diff focused on the
// thread surface itself rather than a transient indicator.
const ANIMATION_KILL = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    caret-color: transparent !important;
    scroll-behavior: auto !important;
  }
  /* Hide host scrollbars — the screenshot is the entire viewport, and
     scrollbar widgets are platform-rendered (different on macOS vs. Linux
     vs. Windows). Keep scroll behavior, just don't paint the gutter. */
  ::-webkit-scrollbar { display: none !important; }
  /* Suppress transient activity indicators — see header note. */
  .thread__activity { display: none !important; }
`;

const RealDate = Date;

// FixedDate pins the *no-arg* constructor (`new Date()`) and `Date.now()`.
// `new Date(timestamp)` and `new Date(year, month, ...)` still construct a
// real Date with the supplied args — so fixtures that need a specific
// instant must use `FIXED_NOW_MS` and offset helpers (see fixtures.ts),
// not raw timestamps. This matches what production code does in
// `formatRelativeTime` (reads `Date.now()` for the reference clock).
class FixedDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) {
      super(FIXED_NOW_MS);
      return;
    }
    // @ts-expect-error — forwarding variadic Date constructor args
    super(...args);
  }
  static now() {
    return FIXED_NOW_MS;
  }
}

beforeAll(() => {
  // Fixed clock — so `formatRelativeTime` and any `new Date()` calls in
  // render produce the same strings every run.
  globalThis.Date = FixedDate as DateConstructor;

  const style = document.createElement("style");
  style.id = "visual-regression-overrides";
  style.textContent = ANIMATION_KILL;
  document.head.appendChild(style);

  // Pin viewport metrics. Playwright's context viewport setting is
  // authoritative, but mounted React effects sometimes read these directly
  // — keeping the document.documentElement size predictable matters for
  // any layout that branches on width.
  document.documentElement.style.width = "1280px";
  document.documentElement.style.height = "800px";
  document.documentElement.style.margin = "0";
  document.body.style.margin = "0";
  document.body.style.minHeight = "800px";
});

afterEach(() => {
  cleanup();
  // Reset theme between tests so a dark-mode test doesn't bleed into the
  // next case.
  const root = document.documentElement;
  root.classList.remove("dark-theme", "light-theme", "dark", "light");
  root.removeAttribute("data-theme");
  root.removeAttribute("data-accent");
  // `createVisualIpcClient` (fixtures.ts) writes a `Working` slice into
  // `dataStore.activity` so the dock row renders in workspace-thread
  // baselines. Without an explicit reset that slice survives into the
  // next test (the store is module-scoped). Clear it here so any
  // future "idle" baseline sees an empty activity map and tests that
  // don't seed don't pick up a phantom Working row.
  dataStore.set((s) => ({ ...s, activity: {} }));
});

export { FIXED_NOW_ISO };
