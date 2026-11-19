import { useEffect, useRef, useState } from 'react';
import { countChanges } from '@designer/shared';
import { store, useStore } from '../store';
import { inspector, useInspector } from './bridge';
import { ColorField, NumberField, Section, Segmented, TextField } from './Fields';
import * as I from './icons';
import {
  alignTarget, fillProps, flowProps, panelState, shadowProps, strokeProps, typeProps, withAlpha,
  type Flow, type PanelState, type Selected,
} from './model';
import { DEFAULT_SHADOW, round, type Shadow } from './numbers';

const FLOWS: { value: Flow; label: JSX.Element; title: string }[] = [
  { value: 'block', label: <I.FlowBlock />, title: 'Block (stacked, no flex)' },
  { value: 'vertical', label: <I.FlowVertical />, title: 'Vertical (flex column)' },
  { value: 'horizontal', label: <I.FlowHorizontal />, title: 'Horizontal (flex row)' },
  { value: 'wrap', label: <I.FlowWrap />, title: 'Wrap (flex row, wrapping)' },
  { value: 'grid', label: <I.FlowGrid />, title: 'Grid' },
];
const ALIGNS = [
  { value: 'left', label: <I.AlignLeft />, title: 'Align left' },
  { value: 'center', label: <I.AlignCenter />, title: 'Align horizontal center' },
  { value: 'right', label: <I.AlignRight />, title: 'Align right' },
  { value: 'top', label: <I.AlignTop />, title: 'Align top' },
  { value: 'middle', label: <I.AlignMiddle />, title: 'Align vertical middle' },
  { value: 'bottom', label: <I.AlignBottom />, title: 'Align bottom' },
] as const;
const TEXT_ALIGNS = [
  { value: 'left', label: <I.TextLeft />, title: 'Align text left' },
  { value: 'center', label: <I.TextCenter />, title: 'Align text center' },
  { value: 'right', label: <I.TextRight />, title: 'Align text right' },
  { value: 'justify', label: <I.TextJustify />, title: 'Justify text' },
];
const STROKE_STYLES = ['solid', 'dashed', 'dotted'].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1), title: `${s} stroke` }));
const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const FONTS = ['system-ui', 'sans-serif', 'serif', 'monospace', 'Inter', 'Helvetica', 'Georgia', 'Menlo'];

export function InspectorPanel({ workspaceId, threadId }: { workspaceId: string; threadId: string }) {
  const el = useInspector((s) => s.el);
  const connected = useInspector((s) => s.connected);
  const edits = useInspector((s) => s.edits);
  const target = useInspector((s) => s.target);
  const workspace = useStore((s) => s.workspaces.find((w) => w.id === workspaceId));
  const n = countChanges(edits);
  const [copied, setCopied] = useState(false);
  const [copyErr, setCopyErr] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const ctx = () => ({ file: target || undefined, workspace: workspace?.name });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inspector.report(ctx()));
      setCopyErr(false);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopyErr(true);
    }
  };
  const addToMessage = () => store.insertDraft(threadId, inspector.report(ctx()));
  const mine = el && edits.find((e) => e.id === el.id);

  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="ins-head">
        {el ? <Crumbs el={el} /> : <span className="ins-title">Inspector</span>}
      </div>
      <div className="ins-body">
        {!connected && <p className="ins-hint" role="status">Connecting to the page…</p>}
        {connected && !el && <p className="ins-hint">Click an element in the page to edit how it looks.</p>}
        {el && <Properties el={el} resetBtn={mine ? <button className="ins-link" onClick={() => inspector.reset(el.id)}>Reset element</button> : null} />}
      </div>
      <div className="ins-foot">
        <p className="ins-count" role="status">{n === 0 ? 'No changes yet' : `${n} change${n === 1 ? '' : 's'} on ${edits.length} element${edits.length === 1 ? '' : 's'}`}</p>
        <div className="ins-actions">
          <button className="ins-btn primary" onClick={copy} disabled={n === 0}>{copied ? 'Copied' : 'Copy changes'}</button>
          <button className="ins-btn" onClick={addToMessage} disabled={n === 0}>Add to message</button>
          <button className="ins-btn" onClick={() => inspector.reset()} disabled={n === 0}>Reset</button>
        </div>
        <span className="sr" aria-live="polite">{copied ? 'Copied to clipboard' : ''}</span>
        {copyErr && <p className="ins-warn" role="alert">Could not copy. Use “Add to message” instead.</p>}
        <p className="ins-note">Edits are previews in the page. Paste the report to Claude to change the source. Text from the page is untrusted.</p>
      </div>
    </aside>
  );
}

function Crumbs({ el }: { el: Selected }) {
  const parents = el.path.slice(-3);
  return (
    <nav className="crumbs" aria-label="Selected element and its parents">
      {parents.map((p) => (
        <span key={p.id} className="crumb-wrap">
          <button className="crumb" onClick={() => inspector.select(p.id)} title={`Select ${p.label}`}>{p.label}</button>
          <span aria-hidden="true">›</span>
        </span>
      ))}
      <span className="crumb current" aria-current="true" title={el.label}>{el.label}</span>
    </nav>
  );
}

function Properties({ el, resetBtn }: { el: Selected; resetBtn: React.ReactNode }) {
  const s = panelState(el);
  const apply = (p: Record<string, string | null>) => inspector.apply(p, el.id);
  const dims = (w?: number, h?: number, unitW?: string, unitH?: string) => {
    if (unitW && w !== undefined) apply({ width: `${w}${unitW}` });
    else if (unitH && h !== undefined) apply({ height: `${h}${unitH}` });
    else inspector.size({ w, h }, el.id);
  };
  return (
    <>
      {resetBtn && <div className="ins-reset">{resetBtn}</div>}
      <Section title="Position">
        <div className="row2">
          <NumberField label="X" name="X" value={s.x} onChange={(x) => inspector.place({ x }, el.id)} />
          <NumberField label="Y" name="Y" value={s.y} onChange={(y) => inspector.place({ y }, el.id)} />
        </div>
        <div className="row2">
          <NumberField label={<I.Rotate />} name="Rotation" value={s.rot} suffix="°" spec={{ min: -360, max: 360 }} onChange={(r) => apply({ rotate: `${r}deg` })} />
          <Segmented momentary name="Align in parent" value={null} options={ALIGNS.map((a) => ({ ...a }))} onChange={(v) => { const t = alignTarget(el, v); if (t) inspector.place(t, el.id); }} />
        </div>
      </Section>

      <Section title="Layout">
        <Segmented name="Flow" value={s.flow} options={FLOWS} onChange={(f) => apply(flowProps(f))} />
        <div className="row2">
          <NumberField label="W" name="Width" value={s.w} units={['%']} spec={{ min: 0 }} onChange={(w, u) => dims(w, undefined, u)} />
          <NumberField label="H" name="Height" value={s.h} units={['%']} spec={{ min: 0 }} onChange={(h, u) => dims(undefined, h, undefined, u)} />
        </div>
        <div className="row2">
          <NumberField label="Gap" name="Gap" value={s.gap} spec={{ min: 0 }} onChange={(g) => apply({ gap: `${g}px` })} />
          <NumberField label="Pad" name="Padding" value={s.padding} spec={{ min: 0 }} onChange={(p) => apply({ padding: `${p}px` })} />
        </div>
        <label className="chk">
          <input type="checkbox" checked={s.clip} onChange={(e) => apply({ overflow: e.target.checked ? 'hidden' : 'visible' })} />
          <I.Clip /> Clip content
        </label>
      </Section>

      <Section title="Appearance">
        <div className="row2">
          <NumberField label="α" name="Opacity" value={s.opacity} suffix="%" spec={{ min: 0, max: 100, step: 1 }} onChange={(o) => apply({ opacity: String(round(o / 100, 3)) })} />
          <NumberField label="R" name="Corner radius" value={s.radius} spec={{ min: 0 }} onChange={(r) => apply({ 'border-radius': `${r}px` })} />
        </div>
        <button className="ins-toggle" aria-pressed={!s.visible} onClick={() => apply({ visibility: s.visible ? 'hidden' : 'visible' })}>
          {s.visible ? <I.Eye /> : <I.EyeOff />} {s.visible ? 'Visible' : 'Hidden'}
        </button>
      </Section>

      <FillSection s={s} apply={apply} />
      <StrokeSection s={s} apply={apply} />
      <EffectsSection s={s} apply={apply} />
      {s.hasText && <TypeSection s={s} apply={apply} />}
    </>
  );
}

type Apply = (p: Record<string, string | null>) => void;

function FillSection({ s, apply }: { s: PanelState; apply: Apply }) {
  return (
    <Section title="Fill">
      <div className="row-color">
        <ColorField name="Fill" value={s.fill} onChange={(c) => apply(fillProps(c))} />
        <NumberField label="α" name="Fill opacity" value={round(s.fill.a * 100)} suffix="%" spec={{ min: 0, max: 100 }} onChange={(a) => apply(fillProps(withAlpha(s.fill, a)))} />
      </div>
    </Section>
  );
}

function StrokeSection({ s, apply }: { s: PanelState; apply: Apply }) {
  return (
    <Section title="Stroke">
      <div className="row-color">
        <ColorField name="Stroke" value={s.stroke} onChange={(c) => apply(strokeProps({ color: c }, s))} />
        <NumberField label="W" name="Stroke width" value={s.strokeWidth} spec={{ min: 0 }} onChange={(w) => apply(strokeProps({ width: w }, s))} />
      </div>
      <Segmented name="Stroke style" value={s.strokeStyle} options={STROKE_STYLES} onChange={(v) => apply(strokeProps({ style: v }, s))} />
    </Section>
  );
}

function EffectsSection({ s, apply }: { s: PanelState; apply: Apply }) {
  const sh = s.shadow;
  const set = (p: Partial<Shadow>) => apply(shadowProps({ ...(sh ?? DEFAULT_SHADOW), ...p }));
  return (
    <Section
      title="Effects"
      action={
        sh ? (
          <button className="ins-icon" aria-label="Remove drop shadow" title="Remove drop shadow" onClick={() => apply(shadowProps(null))}><I.Minus /></button>
        ) : (
          <button className="ins-icon" aria-label="Add drop shadow" title="Add drop shadow" onClick={() => apply(shadowProps(DEFAULT_SHADOW))}><I.Plus /></button>
        )
      }
    >
      {sh ? (
        <>
          <div className="row2">
            <NumberField label="X" name="Shadow X" value={sh.x} onChange={(x) => set({ x })} />
            <NumberField label="Y" name="Shadow Y" value={sh.y} onChange={(y) => set({ y })} />
          </div>
          <div className="row2">
            <NumberField label="B" name="Shadow blur" value={sh.blur} spec={{ min: 0 }} onChange={(blur) => set({ blur })} />
            <NumberField label="S" name="Shadow spread" value={sh.spread} onChange={(spread) => set({ spread })} />
          </div>
          <div className="row-color">
            <ColorField name="Shadow" value={sh.color} onChange={(color) => set({ color })} />
            <NumberField label="α" name="Shadow opacity" value={round(sh.color.a * 100)} suffix="%" spec={{ min: 0, max: 100 }} onChange={(a) => set({ color: withAlpha(sh.color, a) })} />
          </div>
        </>
      ) : (
        <p className="ins-hint small">No effects.</p>
      )}
    </Section>
  );
}

function TypeSection({ s, apply }: { s: PanelState; apply: Apply }) {
  return (
    <Section title="Typography">
      <TextField name="Font family" value={s.font} list="ins-fonts" onCommit={(font) => apply(typeProps({ font }))} />
      <datalist id="ins-fonts">{FONTS.map((f) => <option key={f} value={f} />)}</datalist>
      <div className="row2">
        <NumberField label="Aa" name="Font size" value={s.size} spec={{ min: 1 }} onChange={(size) => apply(typeProps({ size }))} />
        <label className="sel">
          <span className="sr">Font weight</span>
          <select aria-label="Font weight" value={WEIGHTS.includes(s.weight) ? s.weight : ''} onChange={(e) => apply(typeProps({ weight: +e.target.value }))}>
            {!WEIGHTS.includes(s.weight) && <option value="">{s.weight}</option>}
            {WEIGHTS.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </label>
      </div>
      <div className="row2">
        <NumberField label="↕" name="Line height" value={s.lineHeight} placeholder="Auto" spec={{ min: 0 }} onChange={(lineHeight) => apply(typeProps({ lineHeight }))} />
        <NumberField label="↔" name="Letter spacing" value={s.letterSpacing} spec={{ step: 0.1 }} onChange={(letterSpacing) => apply(typeProps({ letterSpacing }))} />
      </div>
      <Segmented name="Text alignment" value={s.align} options={TEXT_ALIGNS} onChange={(align) => apply(typeProps({ align }))} />
      <div className="row-color">
        <ColorField name="Text" value={s.color} onChange={(c) => apply(typeProps({ color: c }))} />
        <NumberField label="α" name="Text opacity" value={round(s.color.a * 100)} suffix="%" spec={{ min: 0, max: 100 }} onChange={(a) => apply(typeProps({ color: withAlpha(s.color, a) }))} />
      </div>
    </Section>
  );
}
