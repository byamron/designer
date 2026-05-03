// Vitest setup — polyfills and DOM bootstrap.

import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

// jsdom doesn't ship `window.matchMedia`. Theme bootstrap, motion-aware
// components (FrictionWidget close flow, etc.) call it on mount, so a
// missing implementation crashes the render with a TypeError. Stub a
// minimal MediaQueryList that always reports "doesn't match" — the
// dark-mode and reduced-motion paths get their non-default behaviour
// only when the OS preference is set, which test runs don't simulate.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// crypto.randomUUID polyfill for jsdom environments that lack it.
if (!("randomUUID" in globalThis.crypto)) {
  // @ts-expect-error augment
  globalThis.crypto.randomUUID = () =>
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
}
