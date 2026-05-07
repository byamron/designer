// Phase 24 (ADR 0008) — feature-flag store. Centralized so the
// renderer + activity-indicator can subscribe to flag changes
// (Settings flips a flag → consumers re-render). Replaces the
// previous per-component `useEffect → setState` pattern, which
// captured the value at mount time and never refreshed.
//
// Boot sequence: `App.tsx` calls `bootFlags()` alongside `bootData()`.
// SettingsPage writes flags through `setFlag()` instead of
// `client.setFeatureFlag()` directly so cross-component consumers
// see the new value on the same frame.
//
// Tests can prime via `flagsStore.set({ flags: { ... } })` without
// going through IPC.

import { useEffect } from "react";
import { createStore, useStore } from "./index";
import { ipcClient } from "../ipc/client";
import type { FeatureFlags } from "../ipc/client";

export interface FlagsState {
  /** `null` until `bootFlags()` resolves. Components reading via
   *  `useFlag()` get `false` for unloaded flags — equivalent to the
   *  default-OFF semantics on the Rust side. */
  flags: FeatureFlags | null;
  /** True once `bootFlags()` has resolved at least once. Lets the
   *  renderer distinguish "flag is OFF" from "haven't loaded yet" if
   *  it ever needs to. */
  loaded: boolean;
}

export const flagsStore = createStore<FlagsState>({
  flags: null,
  loaded: false,
});

export const useFlagsState = <U,>(selector: (s: FlagsState) => U) =>
  useStore(flagsStore, selector);

/** Refresh the flag map from the Rust side. Idempotent; safe to call
 *  on every app mount and after settings writes. */
export async function bootFlags(): Promise<FeatureFlags> {
  const flags = await ipcClient().getFeatureFlags();
  flagsStore.set({ flags, loaded: true });
  return flags;
}

/** Write through to Settings and update the store atomically. Returns
 *  the post-write `FeatureFlags` so callers that want the canonical
 *  shape (e.g. SettingsPage's local toggle UI) can use the resolved
 *  value rather than optimistically assuming the write succeeded. */
export async function setFlag<K extends keyof FeatureFlags>(
  name: K,
  enabled: boolean,
): Promise<FeatureFlags> {
  const flags = await ipcClient().setFeatureFlag(name, enabled);
  flagsStore.set({ flags, loaded: true });
  return flags;
}

/** Hook: read a single flag with `false` default while flags are
 *  loading. Most consumers only care about one flag. */
export function useFlag<K extends keyof FeatureFlags>(name: K): boolean {
  return useFlagsState((s) => Boolean(s.flags?.[name]));
}

/** Hook: ensure flags are loaded once per mount tree. Safe to call
 *  from multiple components — `bootFlags()` is idempotent and the
 *  early-return on `loaded` keeps it cheap. */
export function useEnsureFlagsLoaded(): boolean {
  const loaded = useFlagsState((s) => s.loaded);
  useEffect(() => {
    if (!loaded) {
      bootFlags().catch((err) => {
        // Failure here means the IPC roundtrip rejected — log and
        // leave the store in `loaded: false` so a retry can fire on
        // a later mount. Components keep rendering with all flags
        // OFF, which is the correct production-safe default.
        // eslint-disable-next-line no-console
        console.warn("flags: bootFlags failed", err);
      });
    }
  }, [loaded]);
  return loaded;
}
