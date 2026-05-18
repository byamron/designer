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

// jsdom doesn't ship `ResizeObserver`. The chat-v2 scroll-stickiness
// path in WorkspaceThread subscribes to inner-content growth via RO
// (streaming deltas extend an open text block without changing any
// useLayoutEffect dep). The shim is a no-op observer with a static
// `instances` collection + a `__trigger()` test hook so a test can
// synthesize a resize without a real layout engine.
if (
  typeof window !== "undefined" &&
  typeof window.ResizeObserver !== "function"
) {
  class MockResizeObserver {
    static instances: MockResizeObserver[] = [];
    private cb: ResizeObserverCallback;
    targets: Element[] = [];
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
      MockResizeObserver.instances.push(this);
    }
    observe(el: Element) {
      this.targets.push(el);
    }
    unobserve(el: Element) {
      this.targets = this.targets.filter((t) => t !== el);
    }
    disconnect() {
      this.targets = [];
    }
    /** Test-only: fire the callback. Pass an empty entries list — the
     *  production callback in WorkspaceThread doesn't read entry
     *  payloads, only `stickRef.current`. */
    __trigger() {
      this.cb(
        [] as unknown as ResizeObserverEntry[],
        this as unknown as ResizeObserver,
      );
    }
  }
  (window as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    MockResizeObserver as unknown as typeof ResizeObserver;
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
