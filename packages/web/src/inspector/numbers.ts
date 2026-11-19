// Pure helpers for the inspector's fields: parsing and formatting lengths and colours, scrub maths and shadows.
// No DOM or React in here so it can be unit-tested directly.

export interface Length {
  n: number;
  unit: string; // 'px' | '%' | 'em' | 'rem' | 'deg' | '' ...
}

/** "12px" -> {12,'px'}, "50%" -> {50,'%'}, "8" -> {8,''} (bare numbers mean the field's default unit). null if not a number. */
export function parseLength(s: string): Length | null {
  const m = /^\s*(-?(?:\d+\.?\d*|\.\d+))\s*(px|%|em|rem|vh|vw|deg|pt|ch)?\s*$/i.exec(s);
  return m ? { n: parseFloat(m[1]), unit: (m[2] ?? '').toLowerCase() } : null;
}

export const round = (n: number, places = 1) => {
  const f = 10 ** places;
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? 0 : r;
};

/** A number for display in a field: at most one decimal, no trailing zero. */
export const fmtNum = (n: number) => String(round(n));

/** Computed value ("12.5px", "normal", "auto") -> a number, or null when it is not numeric. */
export function numOf(v: string | undefined): number | null {
  if (v === undefined) return null;
  const p = parseLength(v);
  return p ? p.n : null;
}

/**
 * Turn what the user typed into a CSS value. Bare numbers get `unit`; an explicit unit wins.
 * Returns null for input that is not a number so the field can revert.
 */
export function commitLength(input: string, unit = 'px'): string | null {
  const p = parseLength(input);
  if (!p) return null;
  return `${round(p.n, 3)}${p.unit || unit}`;
}

export interface NumberSpec {
  min?: number;
  max?: number;
  step?: number; // keyboard step (default 1)
  /** Pixels of drag per `step` while scrubbing (default 1 px per step; Shift = 10x, Alt = 0.1x). */
  sens?: number;
}

export const clamp = (n: number, min = -Infinity, max = Infinity) => Math.min(max, Math.max(min, n));

/** Value after dragging the label `dx` pixels. Shift speeds it up 10x, Alt slows it 10x. */
export function scrub(start: number, dx: number, spec: NumberSpec = {}, mods: { shift?: boolean; alt?: boolean } = {}): number {
  const step = spec.step ?? 1;
  const mult = mods.shift ? 10 : mods.alt ? 0.1 : 1;
  const v = start + Math.round(dx / (spec.sens ?? 1)) * step * mult;
  return round(clamp(v, spec.min, spec.max), 3);
}

/** Value after an arrow key. Shift = 10x. */
export function nudge(value: number, dir: 1 | -1, spec: NumberSpec = {}, shift = false): number {
  const step = (spec.step ?? 1) * (shift ? 10 : 1);
  return round(clamp(value + dir * step, spec.min, spec.max), 3);
}

// ---------- colour ----------
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number; // 0..1
}

const h2 = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');

/** "#rgb", "#rrggbb", "#rrggbbaa", "rgb()", "rgba()", "transparent" -> Rgba. null when not a colour. */
export function parseColor(s: string | undefined): Rgba | null {
  if (!s) return null;
  const v = s.trim().toLowerCase();
  if (v === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  let m = /^#([0-9a-f]{3,4})$/.exec(v);
  if (m) {
    const [r, g, b, a = 'f'] = m[1].split('');
    return { r: parseInt(r + r, 16), g: parseInt(g + g, 16), b: parseInt(b + b, 16), a: parseInt(a + a, 16) / 255 };
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(v);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1], g: +m[2], b: +m[3], a: clamp(a, 0, 1) };
  }
  return null;
}

/** #rrggbb (alpha ignored) for the native colour input and the hex field. */
export const toHex6 = (c: Rgba) => `#${h2(c.r)}${h2(c.g)}${h2(c.b)}`;

/** A CSS colour for the page: opaque colours as #rrggbb, translucent ones as rgba(). */
export function toCss(c: Rgba): string {
  return c.a >= 1 ? toHex6(c) : `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${round(c.a, 3)})`;
}

/** What the user typed in the hex field -> Rgba (keeps `keepAlpha` when the text has no alpha). */
export function parseHexInput(input: string, keepAlpha = 1): Rgba | null {
  const t = input.trim();
  const c = parseColor(t.startsWith('#') || !/^[0-9a-f]{3,8}$/i.test(t) ? t : `#${t}`);
  if (!c) return null;
  const hasAlpha = /^#?([0-9a-f]{4}|[0-9a-f]{8})$/i.test(t) || /^rgba|^transparent/i.test(t);
  return hasAlpha ? c : { ...c, a: keepAlpha };
}

// ---------- shadow ----------
export interface Shadow {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: Rgba;
}
export const DEFAULT_SHADOW: Shadow = { x: 0, y: 4, blur: 8, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.25 } };

/** First shadow of a computed `box-shadow` ("rgba(0, 0, 0, 0.25) 0px 4px 8px 0px"), or null for none/inset. */
export function parseShadow(v: string | undefined): Shadow | null {
  if (!v || v === 'none') return null;
  const color = /rgba?\([^)]*\)|#[0-9a-f]{3,8}\b/i.exec(v);
  const rest = color ? v.replace(color[0], ' ') : v;
  if (/\binset\b/.test(rest)) return null;
  const nums = rest.split(/[\s,]+/).filter((t) => /^-?[\d.]+(px)?$/.test(t)).map((t) => parseFloat(t));
  if (nums.length < 2) return null;
  const [x, y, blur = 0, spread = 0] = nums;
  return { x, y, blur, spread, color: (color && parseColor(color[0])) || { r: 0, g: 0, b: 0, a: 1 } };
}

export function formatShadow(s: Shadow): string {
  return `${toCss(s.color)} ${round(s.x, 2)}px ${round(s.y, 2)}px ${round(s.blur, 2)}px ${round(s.spread, 2)}px`;
}
