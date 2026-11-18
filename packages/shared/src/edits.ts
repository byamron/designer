// Visual edits made in the inspector, and the plain-text report that is pasted back to the agent.

export interface EditChange {
  prop: string;
  from: string;
  to: string;
}
export interface EditEntry {
  id: string;
  label: string; // e.g. `button.cta`
  selector: string;
  text: string;
  html: string; // outer HTML, truncated
  changes: EditChange[];
}

const COLOR_PROPS = /color$|^fill$|^stroke$/;

function hex2(n: number) {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

/** rgb()/rgba() -> #rrggbb / #rrggbbaa. Anything else is returned untouched. */
export function colorToHex(v: string): string {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(v.trim());
  if (!m) return v;
  const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  if (a === 0 && /^rgba\(\s*0\s*,\s*0\s*,\s*0/.test(v)) return 'transparent';
  return `#${hex2(+m[1])}${hex2(+m[2])}${hex2(+m[3])}${a < 1 ? hex2(a * 255) : ''}`;
}

/** Replace every rgb()/rgba() inside a value (box-shadow, border, ...) with hex. */
function prettyValue(prop: string, v: string): string {
  if (COLOR_PROPS.test(prop) || /shadow|border$|outline$/.test(prop)) return v.replace(/rgba?\([^)]*\)/gi, (c) => colorToHex(c));
  return v;
}

const num = (s: string) => parseFloat(s) || 0;

function describeMove(to: string): string {
  const [x = '0px', y = '0px'] = to.trim().split(/\s+/);
  const dx = num(x);
  const dy = num(y);
  const parts = [];
  if (dx) parts.push(`${Math.abs(dx)}px ${dx > 0 ? 'right' : 'left'}`);
  if (dy) parts.push(`${Math.abs(dy)}px ${dy > 0 ? 'down' : 'up'}`);
  return parts.length ? `moved ${parts.join(', ')} from its laid-out position (translate: ${to})` : 'back at its laid-out position';
}

function line(c: EditChange): string {
  if (c.prop === 'translate') return `- position: ${describeMove(c.to)}`;
  if (c.prop === 'rotate') return `- rotation: ${c.from === 'none' ? '0deg' : c.from} → ${c.to}`;
  if (c.prop === 'visibility') return `- visibility: ${c.from} → ${c.to}`;
  return `- ${c.prop}: ${prettyValue(c.prop, c.from)} → ${prettyValue(c.prop, c.to)}`;
}

export interface ReportContext {
  file?: string;
  workspace?: string;
}

/** The text copied from the inspector: what to change, where, and how to apply it. */
export function buildEditsReport(edits: EditEntry[], ctx: ReportContext = {}): string {
  const live = edits.filter((e) => e.changes.length);
  if (!live.length) return '';
  const n = live.reduce((s, e) => s + e.changes.length, 0);
  const out: string[] = [];
  out.push(`Visual edits from the Designer inspector: ${n} change${n === 1 ? '' : 's'} on ${live.length} element${live.length === 1 ? '' : 's'}.`);
  if (ctx.file) out.push(`Previewed file: ${ctx.file}${ctx.workspace ? ` (workspace: ${ctx.workspace})` : ''}`);
  out.push(
    'Please update the source so these elements look like this. Edit the real styles (CSS, classes, tokens or components) following how this project already styles things; do not paste inline styles unless that is the convention. "from" is how the element rendered before my edit, "to" is what I want.',
  );
  live.forEach((e, i) => {
    out.push('');
    out.push(`${i + 1}. ${e.label}${e.text ? `  "${e.text.length > 60 ? e.text.slice(0, 57) + '…' : e.text}"` : ''}`);
    out.push(`   Selector: ${e.selector}`);
    if (e.html) out.push(`   HTML: ${e.html}`);
    out.push('   Changes:');
    for (const c of e.changes) out.push('   ' + line(c));
  });
  return out.join('\n');
}

export const countChanges = (edits: EditEntry[]) => edits.reduce((s, e) => s + e.changes.length, 0);
