import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { clamp, commitLength, fmtNum, nudge, parseHexInput, parseLength, scrub, toHex6, type NumberSpec, type Rgba } from './numbers';

/**
 * A number with a scrubbable label: drag the label sideways to change it (Shift = 10x, Alt = 0.1x), arrow keys step
 * (Shift = 10x), Enter commits, Escape puts back what it was. Every change is live: `onChange` runs as you go.
 * A typed unit (e.g. `50%`) is passed through as `unit` when `units` allows it.
 */
export function NumberField({
  label, name, value, onChange, spec, suffix, units, placeholder, wide,
}: {
  label: ReactNode;
  name: string; // accessible name, e.g. "X"
  value: number | null | 'mixed';
  onChange: (n: number, unit?: string) => void;
  spec?: NumberSpec;
  suffix?: string;
  units?: string[];
  placeholder?: string;
  wide?: boolean;
}) {
  const shown = value === 'mixed' ? '' : value === null ? '' : fmtNum(value);
  const [text, setText] = useState(shown);
  const editing = useRef(false);
  const origin = useRef<number | null>(null);
  const num = typeof value === 'number' ? value : 0;
  useEffect(() => { if (!editing.current) setText(shown); }, [shown]);

  const emit = (n: number, unit?: string) => {
    const v = clamp(n, spec?.min, spec?.max);
    setText(fmtNum(v) + (unit && unit !== 'px' ? unit : ''));
    onChange(v, unit);
  };
  const commit = () => {
    editing.current = false;
    if (text.trim() === shown) return; // focused and left without typing: not an edit (tabbing must not dirty the page)
    const p = parseLength(text);
    if (!p) return setText(shown);
    if (p.unit && p.unit !== 'px' && !units?.includes(p.unit)) return setText(shown);
    emit(p.n, p.unit && p.unit !== 'px' ? p.unit : undefined);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      editing.current = false;
      if (origin.current !== null && origin.current !== num) onChange(origin.current);
      setText(shown);
      origin.current = null;
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const p = parseLength(text);
      emit(nudge(p ? p.n : num, e.key === 'ArrowUp' ? 1 : -1, spec, e.shiftKey));
    }
  };

  const scrubbing = useRef<{ x: number; start: number } | null>(null);
  const down = (e: RPointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubbing.current = { x: e.clientX, start: num };
    origin.current = num;
  };
  const move = (e: RPointerEvent<HTMLSpanElement>) => {
    const s = scrubbing.current;
    if (!s) return;
    emit(scrub(s.start, e.clientX - s.x, spec, { shift: e.shiftKey, alt: e.altKey }));
  };
  const up = () => { scrubbing.current = null; origin.current = null; };

  return (
    <label className={`nf${wide ? ' wide' : ''}`}>
      <span className="nf-label" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-hidden="true" title={`Drag to change ${name}`}>{label}</span>
      <input
        value={text}
        inputMode="decimal"
        aria-label={name}
        placeholder={value === 'mixed' ? 'Mixed' : placeholder}
        spellCheck={false}
        onFocus={(e) => { editing.current = true; origin.current = num; e.currentTarget.select(); }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { if (editing.current) commit(); origin.current = null; }}
        onKeyDown={onKey}
      />
      {suffix && <span className="nf-suffix" aria-hidden="true">{suffix}</span>}
    </label>
  );
}

/** Native colour picker plus a hex field. Alpha is kept (and shown by the caller as its own opacity field). */
export function ColorField({ name, value, onChange }: { name: string; value: Rgba; onChange: (c: Rgba) => void }) {
  const hex = toHex6(value);
  const keep = value.a === 0 ? 1 : value.a; // choosing a colour for a transparent fill should make it visible
  const [text, setText] = useState(hex.slice(1).toUpperCase());
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setText(hex.slice(1).toUpperCase()); }, [hex]);
  const commit = () => {
    editing.current = false;
    if (text.trim().replace(/^#/, '').toUpperCase() === hex.slice(1).toUpperCase()) return; // untouched: a transparent fill must not turn black just from tabbing through
    const c = parseHexInput(text, keep);
    if (!c) return setText(hex.slice(1).toUpperCase());
    onChange(c);
  };
  return (
    <span className="cf">
      <input type="color" className="cf-swatch" aria-label={`${name} color`} value={hex} onChange={(e) => { const c = parseHexInput(e.target.value, keep); if (c) onChange(c); }} />
      <span className="cf-hash" aria-hidden="true">#</span>
      <input
        className="cf-hex"
        aria-label={`${name} hex`}
        value={text}
        spellCheck={false}
        onFocus={(e) => { editing.current = true; e.currentTarget.select(); }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => editing.current && commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); editing.current = false; setText(hex.slice(1).toUpperCase()); }
        }}
      />
    </span>
  );
}

/** A row of mutually exclusive options. Arrow keys move between them (roving tab stop). */
export function Segmented<T extends string>({ name, value, options, onChange, momentary }: { name: string; value: T | null; options: { value: T; label: ReactNode; title: string }[]; onChange: (v: T) => void; /** Buttons that act once (align) instead of choosing a state. */ momentary?: boolean }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  const key = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const j = (i + d + options.length) % options.length;
    refs.current[j]?.focus();
    if (!momentary) onChange(options[j].value);
  };
  return (
    <div className="seg" role={momentary ? 'group' : 'radiogroup'} aria-label={name}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => { refs.current[i] = el; }}
          role={momentary ? undefined : 'radio'}
          aria-checked={momentary ? undefined : o.value === value}
          aria-label={o.title}
          title={o.title}
          tabIndex={momentary || i === idx ? 0 : -1}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => key(e, i)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TextField({ name, value, onCommit, list }: { name: string; value: string; onCommit: (v: string) => void; list?: string }) {
  const [text, setText] = useState(value);
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setText(value); }, [value]);
  const commit = () => {
    editing.current = false;
    if (text.trim() && text !== value) onCommit(text.trim());
    else setText(value);
  };
  return (
    <input
      className="tf"
      aria-label={name}
      value={text}
      list={list}
      spellCheck={false}
      onFocus={(e) => { editing.current = true; e.currentTarget.select(); }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => editing.current && commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); editing.current = false; setText(value); }
      }}
    />
  );
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  const id = useId();
  return (
    <section className="ins-sec" aria-labelledby={id}>
      <h3 id={id}>{title}{action}</h3>
      {children}
    </section>
  );
}

export { commitLength };
