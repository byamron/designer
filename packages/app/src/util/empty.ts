// Stable empty values. useSyncExternalStore compares snapshots with Object.is;
// returning a fresh `[]` or `{}` each render creates render loops. Using
// frozen module-level constants gives stable identity.

export const EMPTY_ARRAY: readonly never[] = Object.freeze([]) as readonly never[];
export const EMPTY_OBJECT: Readonly<Record<string, never>> = Object.freeze({});

export function emptyArray<T>(): T[] {
  return EMPTY_ARRAY as unknown as T[];
}
