// The panel's view of a selected element: what the page agent sends (`selected`), and how each panel control
// turns into style properties for the agent's `apply`. Pure, so it is unit-tested without a browser.
import { fmtNum, numOf, parseColor, parseShadow, round, toCss, toHex6, type Rgba, type Shadow, formatShadow } from './numbers';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Selected {
  id: string;
  tag: string;
  label: string;
  selector: string;
  text: string;
  html: string;
  path: { id: string; label: string }[];
  rect: Box; // page coordinates (bounding box, includes rotation)
  size?: { w: number; h: number }; // layout size, ignores rotation
  parent: Box | null;
  style: Record<string, string>; // computed values of the agent's PROPS
  move: { x: number; y: number }; // current translate
  rot: number;
  hasText: boolean;
  childCount: number;
}
export type Props = Record<string, string | null>;

export type Flow = 'block' | 'vertical' | 'horizontal' | 'wrap' | 'grid';

export interface PanelState {
  id: string;
  label: string;
  tag: string;
  path: Selected['path'];
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  flow: Flow;
  gap: number;
  padding: number | 'mixed';
  clip: boolean;
  opacity: number; // 0..100
  radius: number;
  visible: boolean;
  fill: Rgba;
  strokeWidth: number;
  strokeStyle: string;
  stroke: Rgba;
  shadow: Shadow | null;
  hasText: boolean;
  font: string;
  size: number;
  weight: number;
  lineHeight: number | null; // px, null = normal
  letterSpacing: number;
  align: string;
  color: Rgba;
}

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

export function flowOf(s: Record<string, string>): Flow {
  const d = s['display'] ?? '';
  if (/grid/.test(d)) return 'grid';
  if (/flex/.test(d)) {
    if (s['flex-wrap'] && s['flex-wrap'] !== 'nowrap') return 'wrap';
    return /column/.test(s['flex-direction'] ?? '') ? 'vertical' : 'horizontal';
  }
  return 'block';
}

export function panelState(el: Selected): PanelState {
  const s = el.style;
  const pad = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'].map((p) => numOf(s[p]) ?? 0);
  return {
    id: el.id,
    label: el.label,
    tag: el.tag,
    path: el.path,
    x: round(el.rect.x),
    y: round(el.rect.y),
    w: round(el.size?.w ?? el.rect.w),
    h: round(el.size?.h ?? el.rect.h),
    rot: round(el.rot),
    flow: flowOf(s),
    gap: numOf((s['gap'] ?? '').split(' ')[0]) ?? 0,
    padding: pad.every((p) => p === pad[0]) ? round(pad[0]) : 'mixed',
    clip: !!s['overflow'] && !/^visible/.test(s['overflow']),
    opacity: round((numOf(s['opacity']) ?? 1) * 100),
    radius: numOf((s['border-radius'] ?? '').split(' ')[0]) ?? 0,
    visible: s['visibility'] !== 'hidden',
    fill: parseColor(s['background-color']) ?? { ...BLACK, a: 0 },
    strokeWidth: numOf(s['border-top-width']) ?? 0,
    strokeStyle: s['border-top-style'] || 'none',
    stroke: parseColor(s['border-top-color']) ?? BLACK,
    shadow: parseShadow(s['box-shadow']),
    hasText: el.hasText,
    font: firstFont(s['font-family']),
    size: numOf(s['font-size']) ?? 16,
    weight: numOf(s['font-weight']) ?? 400,
    lineHeight: numOf(s['line-height']),
    letterSpacing: numOf(s['letter-spacing']) ?? 0,
    align: /^(left|right|center|justify)$/.test(s['text-align'] ?? '') ? s['text-align'] : /^(start)$/.test(s['text-align'] ?? '') ? 'left' : s['text-align'] === 'end' ? 'right' : 'left',
    color: parseColor(s['color']) ?? BLACK,
  };
}

export function firstFont(v: string | undefined): string {
  return (v ?? '').split(',')[0].trim().replace(/^["']|["']$/g, '');
}

const px = (n: number) => `${round(n, 3)}px`;

// ---------- controls -> properties ----------
export type Align = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
/** Where an element goes (page coordinates, per axis) to sit at an edge or the centre of its parent. */
export function alignTarget(el: Selected, how: Align): { x?: number; y?: number } | null {
  const p = el.parent;
  if (!p) return null;
  // `place` moves the bounding box, so align by it (a rotated element is aligned by its visible extent)
  const { w, h } = el.rect;
  switch (how) {
    case 'left': return { x: p.x };
    case 'center': return { x: p.x + (p.w - w) / 2 };
    case 'right': return { x: p.x + p.w - w };
    case 'top': return { y: p.y };
    case 'middle': return { y: p.y + (p.h - h) / 2 };
    case 'bottom': return { y: p.y + p.h - h };
  }
}

export function flowProps(flow: Flow): Props {
  switch (flow) {
    case 'block': return { display: 'block' };
    case 'vertical': return { display: 'flex', 'flex-direction': 'column', 'flex-wrap': 'nowrap' };
    case 'horizontal': return { display: 'flex', 'flex-direction': 'row', 'flex-wrap': 'nowrap' };
    case 'wrap': return { display: 'flex', 'flex-direction': 'row', 'flex-wrap': 'wrap' };
    case 'grid': return { display: 'grid' };
  }
}

/** Fill opacity edits the alpha of the background colour. */
export const withAlpha = (c: Rgba, percent: number): Rgba => ({ ...c, a: Math.min(1, Math.max(0, percent / 100)) });

export const fillProps = (c: Rgba): Props => ({ 'background-color': toCss(c) });

export function strokeProps(st: { width?: number; style?: string; color?: Rgba }, cur: PanelState): Props {
  const out: Props = {};
  if (st.width !== undefined) {
    out['border-width'] = px(st.width);
    // a width on a border that has no style would draw nothing
    if (st.width > 0 && cur.strokeStyle === 'none' && st.style === undefined) out['border-style'] = 'solid';
  }
  if (st.style !== undefined) out['border-style'] = st.style;
  if (st.color) out['border-color'] = toCss(st.color);
  return out;
}

export const shadowProps = (s: Shadow | null): Props => ({ 'box-shadow': s ? formatShadow(s) : 'none' });

/** Typography values are numbers in the panel; line-height 0 means "normal". */
export function typeProps(t: { font?: string; size?: number; weight?: number; lineHeight?: number | null; letterSpacing?: number; align?: string; color?: Rgba }): Props {
  const out: Props = {};
  if (t.font !== undefined) out['font-family'] = /[\s,]/.test(t.font) && !/^["']/.test(t.font) ? `"${t.font}"` : t.font;
  if (t.size !== undefined) out['font-size'] = px(t.size);
  if (t.weight !== undefined) out['font-weight'] = String(Math.round(t.weight));
  if (t.lineHeight !== undefined) out['line-height'] = t.lineHeight ? px(t.lineHeight) : 'normal';
  if (t.letterSpacing !== undefined) out['letter-spacing'] = px(t.letterSpacing);
  if (t.align !== undefined) out['text-align'] = t.align;
  if (t.color) out['color'] = toCss(t.color);
  return out;
}

export const hexOf = (c: Rgba) => toHex6(c);
export { fmtNum };
