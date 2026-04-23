import { useCallback, useEffect, useMemo, useState } from "react";
import { IconButton } from "../components/IconButton";
import { IconX } from "../components/icons";

/**
 * Dev-only floating panel for tuning type tokens (size + weight) in real
 * time. Writes overrides as CSS custom properties on `:root` and persists
 * the whole set in localStorage so a reload keeps your last exploration.
 *
 * Only mounted when `import.meta.env.MODE === "development"` (see App.tsx).
 */

type SizeKey = "caption" | "body" | "lead" | "h3" | "h2";

type WeightKey = "regular" | "medium" | "semibold" | "bold";

interface SizeEntry {
  key: SizeKey;
  label: string;
  token: string;        // --type-{key}-size
  min: number;
  max: number;
  default: number;      // px
  note: string;
}

interface WeightEntry {
  key: WeightKey;
  label: string;
  token: string;        // --weight-{key}
  default: number;
}

// Only roles that actually render in shipped UI. h4 / h1 / display exist
// in tokens.css as edge-surface reserves but aren't referenced anywhere,
// so exposing them here would be dead knobs.
const SIZES: SizeEntry[] = [
  { key: "caption", label: "caption", token: "--type-caption-size", min: 10, max: 16, default: 13, note: "meta · labels · kbd · branch chip" },
  { key: "body", label: "body", token: "--type-body-size", min: 12, max: 18, default: 15, note: "default — controls · messages · list rows · titles" },
  { key: "lead", label: "lead", token: "--type-lead-size", min: 12, max: 22, default: 15, note: "palette prompt · ⌘K input" },
  { key: "h3", label: "h3", token: "--type-h3-size", min: 16, max: 28, default: 18, note: "empty-state titles" },
  { key: "h2", label: "h2", token: "--type-h2-size", min: 20, max: 40, default: 32, note: "onboarding hero (out of chrome)" },
];

const WEIGHTS: WeightEntry[] = [
  { key: "regular", label: "regular", token: "--weight-regular", default: 400 },
  { key: "medium", label: "medium", token: "--weight-medium", default: 500 },
  { key: "semibold", label: "semibold", token: "--weight-semibold", default: 600 },
  { key: "bold", label: "bold", token: "--weight-bold", default: 700 },
];

const STORAGE_KEY = "designer.dev.typeOverrides";

interface Overrides {
  sizes: Partial<Record<SizeKey, number>>;
  weights: Partial<Record<WeightKey, number>>;
}

function readStored(): Overrides {
  if (typeof window === "undefined") return { sizes: {}, weights: {} };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { sizes: {}, weights: {} };
    const parsed = JSON.parse(raw);
    return {
      sizes: parsed.sizes ?? {},
      weights: parsed.weights ?? {},
    };
  } catch {
    return { sizes: {}, weights: {} };
  }
}

function writeStored(o: Overrides) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(o));
}

function applyToDom(sizes: Partial<Record<SizeKey, number>>, weights: Partial<Record<WeightKey, number>>) {
  const root = document.documentElement;
  for (const s of SIZES) {
    const v = sizes[s.key];
    if (v == null) root.style.removeProperty(s.token);
    else root.style.setProperty(s.token, `${v}px`);
  }
  for (const w of WEIGHTS) {
    const v = weights[w.key];
    if (v == null) root.style.removeProperty(w.token);
    else root.style.setProperty(w.token, String(v));
  }
}

export function TypeDevPanel() {
  const [open, setOpen] = useState(false);
  const initial = useMemo(readStored, []);
  const [sizes, setSizes] = useState(initial.sizes);
  const [weights, setWeights] = useState(initial.weights);

  useEffect(() => {
    applyToDom(sizes, weights);
  }, [sizes, weights]);

  useEffect(() => {
    writeStored({ sizes, weights });
  }, [sizes, weights]);

  const setSize = useCallback((k: SizeKey, v: number | null) => {
    setSizes((prev) => {
      const next = { ...prev };
      if (v == null) delete next[k];
      else next[k] = v;
      return next;
    });
  }, []);

  const setWeight = useCallback((k: WeightKey, v: number | null) => {
    setWeights((prev) => {
      const next = { ...prev };
      if (v == null) delete next[k];
      else next[k] = v;
      return next;
    });
  }, []);

  const resetAll = useCallback(() => {
    setSizes({});
    setWeights({});
  }, []);

  const dirtyCount =
    Object.keys(sizes).length + Object.keys(weights).length;

  if (!open) {
    return (
      <button
        type="button"
        className="type-dev__fab"
        aria-label="Open type dev panel"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">Aa</span>
        {dirtyCount > 0 && <span className="type-dev__fab-badge">{dirtyCount}</span>}
      </button>
    );
  }

  return (
    <aside className="type-dev" aria-label="Type dev panel">
      <header className="type-dev__head">
        <strong className="type-dev__title">Type</strong>
        <div className="type-dev__head-actions">
          <button
            type="button"
            className="type-dev__reset"
            onClick={resetAll}
            disabled={dirtyCount === 0}
          >
            Reset
          </button>
          <IconButton size="sm" label="Close" onClick={() => setOpen(false)}>
            <IconX size={10} />
          </IconButton>
        </div>
      </header>

      <section className="type-dev__section" aria-label="Sizes">
        <span className="type-dev__section-label">Sizes (px)</span>
        {SIZES.map((s) => (
          <SizeControl
            key={s.key}
            entry={s}
            value={sizes[s.key] ?? s.default}
            dirty={sizes[s.key] !== undefined}
            onChange={(v) => setSize(s.key, v)}
          />
        ))}
      </section>

      <section className="type-dev__section" aria-label="Weights">
        <span className="type-dev__section-label">Weights</span>
        {WEIGHTS.map((w) => (
          <WeightControl
            key={w.key}
            entry={w}
            value={weights[w.key] ?? w.default}
            dirty={weights[w.key] !== undefined}
            onChange={(v) => setWeight(w.key, v)}
          />
        ))}
      </section>

      <footer className="type-dev__foot">
        <span className="type-dev__hint">Dev only · persists locally</span>
      </footer>
    </aside>
  );
}

function SizeControl({
  entry,
  value,
  dirty,
  onChange,
}: {
  entry: SizeEntry;
  value: number;
  dirty: boolean;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="type-dev__row-group" data-dirty={dirty || undefined}>
      <label className="type-dev__row">
        <span className="type-dev__row-label">{entry.label}</span>
        <span className="type-dev__row-value">{value}</span>
        <input
          type="range"
          min={entry.min}
          max={entry.max}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="type-dev__slider"
          aria-label={`${entry.label} size`}
        />
        <button
          type="button"
          className="type-dev__clear"
          onClick={() => onChange(null)}
          disabled={!dirty}
          aria-label={`Reset ${entry.label} size`}
        >
          ⟲
        </button>
      </label>
      <span className="type-dev__row-note">{entry.note}</span>
    </div>
  );
}

function WeightControl({
  entry,
  value,
  dirty,
  onChange,
}: {
  entry: WeightEntry;
  value: number;
  dirty: boolean;
  onChange: (v: number | null) => void;
}) {
  return (
    <label className="type-dev__row" data-dirty={dirty || undefined}>
      <span className="type-dev__row-label">{entry.label}</span>
      <span className="type-dev__row-value">{value}</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="type-dev__select"
        aria-label={`${entry.label} weight`}
      >
        {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
      <button
        type="button"
        className="type-dev__clear"
        onClick={() => onChange(null)}
        disabled={!dirty}
        aria-label={`Reset ${entry.label} weight`}
      >
        ⟲
      </button>
    </label>
  );
}
