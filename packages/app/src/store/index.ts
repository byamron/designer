// Minimal store. A tiny hook-based state container — no Zustand dep; our needs
// are narrow enough that 40 lines of code do the job.

import { useSyncExternalStore } from "react";

export type Listener<T> = (state: T) => void;

export interface Store<T> {
  get: () => T;
  set: (next: T | ((prev: T) => T)) => void;
  subscribe: (listener: Listener<T>) => () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<Listener<T>>();
  return {
    get: () => state,
    set(next) {
      const computed =
        typeof next === "function"
          ? (next as (prev: T) => T)(state)
          : next;
      if (Object.is(state, computed)) return;
      state = computed;
      for (const l of listeners) l(state);
    },
    subscribe(l) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}

export function useStore<T>(store: Store<T>): T;
export function useStore<T, U>(store: Store<T>, selector: (s: T) => U): U;
export function useStore<T, U = T>(
  store: Store<T>,
  selector?: (s: T) => U,
): U {
  const pick = selector ?? ((s: T) => s as unknown as U);
  return useSyncExternalStore(
    store.subscribe,
    () => pick(store.get()),
    () => pick(store.get()),
  );
}
