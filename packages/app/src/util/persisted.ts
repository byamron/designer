/**
 * Small localStorage wrapper — one pattern instead of four. Callers supply a
 * key, a default, and decode/encode fns. Returns `{ read, write }`; window
 * guard is handled here so consumers don't sprinkle `typeof window` checks.
 */
export interface Persisted<T> {
  read: () => T;
  write: (value: T) => void;
}

export function persisted<T>(
  key: string,
  fallback: T,
  decode: (raw: string) => T | undefined,
  encode: (value: T) => string = String,
): Persisted<T> {
  return {
    read() {
      if (typeof window === "undefined") return fallback;
      const raw = window.localStorage.getItem(key);
      if (raw == null) return fallback;
      const parsed = decode(raw);
      return parsed === undefined ? fallback : parsed;
    },
    write(value) {
      if (typeof window === "undefined") return;
      window.localStorage.setItem(key, encode(value));
    },
  };
}

export const stringDecoder = <T extends string>(allowed: readonly T[]) =>
  (raw: string): T | undefined =>
    (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined;

export const booleanDecoder = (raw: string): boolean | undefined => {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return undefined;
};

export const intDecoder =
  (clamp?: (n: number) => number) =>
  (raw: string): number | undefined => {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return undefined;
    return clamp ? clamp(n) : n;
  };
