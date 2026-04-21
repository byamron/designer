// Vitest setup — polyfills and DOM bootstrap.

import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

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
