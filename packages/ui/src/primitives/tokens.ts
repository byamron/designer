import type {
  CSSProperties,
  ComponentPropsWithoutRef,
  ElementType,
} from "react";

/* ============================================================
   Token types — the blessed values for primitive props.

   Closed unions (no escape hatch) for scales that should never
   take arbitrary values: Space, Radius, Elevation, Layer.

   Permissive union (Color) for color props, where gradients,
   color-mix(), and custom CSS vars are legitimate escape hatches.
   ============================================================ */

export type SpaceToken = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type RadiusToken =
  | "none"
  | "badge"
  | "button"
  | "card"
  | "modal"
  | "pill";

export type ElevationToken = "flat" | "raised" | "overlay" | "modal";

/** Z-index layer. Paired 1:1 with ElevationToken. */
export type LayerToken = "flat" | "raised" | "overlay" | "modal";

type ScaleStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
type AlphaStep = `a${ScaleStep}`;
export type ColorScale =
  | "accent"
  | "gray"
  | "success"
  | "warning"
  | "danger"
  | "info";

/** Closed union over all blessed color tokens, e.g. "accent-9", "gray-a4". */
export type ColorToken = `${ColorScale}-${ScaleStep | AlphaStep}`;

/**
 * Permissive color union. Autocompletes to ColorToken but accepts any string
 * for escape-hatch cases (gradients, color-mix(), custom vars).
 * The (string & {}) trick preserves literal autocomplete in TS.
 */
export type Color = ColorToken | (string & {});

/* ============================================================
   Polymorphic prop helper.
   Lets primitive components take an `as` prop and inherit the
   native element's props without collisions.
   ============================================================ */

export type PolymorphicProps<T extends ElementType, P> = P & { as?: T } & Omit<
  ComponentPropsWithoutRef<T>,
  keyof P | "as"
>;

/* ============================================================
   Internal helpers.
   Inlined here to avoid cross-file churn when copying primitives.
   ============================================================ */

/** Concat truthy classes with a space. */
export function cx(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(" ");
}

const COLOR_TOKEN_RE =
  /^(accent|gray|success|warning|danger|info)-(a?(?:[1-9]|1[0-2]))$/;

/** Convert a Color to a CSS value. Tokens → `var(--<token>)`, raw → passthrough. */
export function resolveColor(c: Color | undefined): string | undefined {
  if (c === undefined) return undefined;
  return COLOR_TOKEN_RE.test(c) ? `var(--${c})` : c;
}

/**
 * Convenience: build a style object with only the defined CSS-var entries.
 * Skips undefined values so they inherit from the base CSS rather than
 * override with `undefined`.
 */
export function vars(
  entries: Record<string, string | number | undefined>,
): CSSProperties {
  const out: Record<string, string | number> = {};
  for (const key in entries) {
    const v = entries[key];
    if (v !== undefined) out[key] = v;
  }
  return out as CSSProperties;
}
