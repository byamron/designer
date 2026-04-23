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
      let raw: string | null;
      try {
        // localStorage.getItem can throw under strict sandboxes (file://
        // origins, Safari private mode, iframe same-origin violations).
        raw = window.localStorage.getItem(key);
      } catch {
        return fallback;
      }
      if (raw == null) return fallback;
      const parsed = decode(raw);
      return parsed === undefined ? fallback : parsed;
    },
    write(value) {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(key, encode(value));
      } catch {
        // Quota exceeded or sandbox restriction — drop silently. The
        // in-memory store still has the latest value; persistence is a
        // best-effort optimization, not a correctness requirement.
      }
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
