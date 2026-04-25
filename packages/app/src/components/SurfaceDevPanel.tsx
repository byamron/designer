import { useEffect, useState } from "react";
import { Sliders } from "lucide-react";
import { Tooltip } from "./Tooltip";
import { persisted, intDecoder } from "../util/persisted";

/**
 * SurfaceDevPanel — floating bottom-right panel exposing five knobs that
 * each control a distinct layer of the surface register.
 *
 *   1. Compose fill   — `--dev-compose-mix` (0–100%). 0 = matches the
 *      main-tab container; 100 = matches the parent background.
 *   2. Main tab fill  — `--dev-main-tab-sand` (0–100%). 0 = pure white;
 *      100 = sandiest.
 *   3. Surface sand   — `--dev-surface-sand` (0–100%). 0 = brighter
 *      parent; 100 = sandier parent.
 *   4. Tab opacity    — `--dev-tab-opacity` (0–100%). Controls the
 *      unselected-tab fill alpha (and, transitively, its border alpha).
 *   5. Border intensity — `--dev-border-strength` (0–100%). Modulates
 *      the alpha of the border applied to the main tab container, the
 *      selected tab, and the unselected tabs (for the unselected, the
 *      effective alpha is strength × tab-opacity).
 *
 * All five persist to localStorage and apply as CSS vars on :root so
 * the rest of the token cascade flows through. Dev-only.
 *
 * Hotkey: ⌘. (or Ctrl+.) toggles open/close.
 */

const composeMixStore = persisted<number>(
  "designer.dev.composeMix",
  24,
  intDecoder((n) => Math.max(0, Math.min(100, n))),
);

const mainTabSandStore = persisted<number>(
  "designer.dev.mainTabSand",
  5,
  intDecoder((n) => Math.max(0, Math.min(100, n))),
);

const surfaceSandStore = persisted<number>(
  "designer.dev.surfaceSand",
  80,
  intDecoder((n) => Math.max(0, Math.min(100, n))),
);

const tabOpacityStore = persisted<number>(
  "designer.dev.tabOpacity",
  90,
  intDecoder((n) => Math.max(0, Math.min(100, n))),
);

const borderStrengthStore = persisted<number>(
  "designer.dev.borderStrength",
  100,
  intDecoder((n) => Math.max(0, Math.min(100, n))),
);

interface SurfaceVars {
  composeMix: number;
  mainTabSand: number;
  surfaceSand: number;
  tabOpacity: number;
  borderStrength: number;
}

function applyCssVars(v: SurfaceVars): void {
  const root = document.documentElement;
  root.style.setProperty("--dev-compose-mix", `${v.composeMix}%`);
  root.style.setProperty("--dev-main-tab-sand", `${v.mainTabSand}%`);
  root.style.setProperty("--dev-surface-sand", `${v.surfaceSand}%`);
  root.style.setProperty("--dev-tab-opacity", `${v.tabOpacity}%`);
  root.style.setProperty("--dev-border-strength", `${v.borderStrength}%`);
}

export function SurfaceDevPanel() {
  const [open, setOpen] = useState(false);
  const [composeMix, setComposeMix] = useState<number>(() => composeMixStore.read());
  const [mainTabSand, setMainTabSand] = useState<number>(() => mainTabSandStore.read());
  const [surfaceSand, setSurfaceSand] = useState<number>(() => surfaceSandStore.read());
  const [tabOpacity, setTabOpacity] = useState<number>(() => tabOpacityStore.read());
  const [borderStrength, setBorderStrength] = useState<number>(() =>
    borderStrengthStore.read(),
  );

  useEffect(() => {
    applyCssVars({ composeMix, mainTabSand, surfaceSand, tabOpacity, borderStrength });
  }, [composeMix, mainTabSand, surfaceSand, tabOpacity, borderStrength]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onComposeMix = (value: number) => {
    setComposeMix(value);
    composeMixStore.write(value);
  };

  const onMainTabSand = (value: number) => {
    setMainTabSand(value);
    mainTabSandStore.write(value);
  };

  const onSurfaceSand = (value: number) => {
    setSurfaceSand(value);
    surfaceSandStore.write(value);
  };

  const onTabOpacity = (value: number) => {
    setTabOpacity(value);
    tabOpacityStore.write(value);
  };

  const onBorderStrength = (value: number) => {
    setBorderStrength(value);
    borderStrengthStore.write(value);
  };

  const onReset = () => {
    onComposeMix(24);
    onMainTabSand(5);
    onSurfaceSand(80);
    onTabOpacity(90);
    onBorderStrength(100);
  };

  return (
    <div className="surface-dev-panel" data-open={open}>
      <Tooltip label="Surface dev panel" shortcut="⌘.">
        <button
          type="button"
          className="surface-dev-panel__handle"
          aria-expanded={open}
          aria-controls="surface-dev-panel-body"
          onClick={() => setOpen((o) => !o)}
        >
          <Sliders size={14} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </Tooltip>
      {open && (
        <div
          id="surface-dev-panel-body"
          className="surface-dev-panel__body"
          role="group"
          aria-label="Surface dev controls"
        >
          <div className="surface-dev-panel__row">
            <label className="surface-dev-panel__label" htmlFor="surface-dev-compose-mix">
              Compose fill
              <span className="surface-dev-panel__value">{composeMix}%</span>
            </label>
            <input
              id="surface-dev-compose-mix"
              type="range"
              min={0}
              max={100}
              value={composeMix}
              onChange={(e) => onComposeMix(Number(e.target.value))}
              aria-valuetext={`${composeMix} percent — 0 matches the main-tab fill, 100 matches the parent surface`}
            />
            <span className="surface-dev-panel__hint">
              tab fill ← default → surface fill
            </span>
          </div>
          <div className="surface-dev-panel__row">
            <label className="surface-dev-panel__label" htmlFor="surface-dev-main-tab-sand">
              Main tab fill
              <span className="surface-dev-panel__value">{mainTabSand}%</span>
            </label>
            <input
              id="surface-dev-main-tab-sand"
              type="range"
              min={0}
              max={100}
              value={mainTabSand}
              onChange={(e) => onMainTabSand(Number(e.target.value))}
              aria-valuetext={`${mainTabSand} percent — 0 is pure white, 100 is sandiest`}
            />
            <span className="surface-dev-panel__hint">
              white ← default → sandier
            </span>
          </div>
          <div className="surface-dev-panel__row">
            <label className="surface-dev-panel__label" htmlFor="surface-dev-surface-sand">
              Surface sand
              <span className="surface-dev-panel__value">{surfaceSand}%</span>
            </label>
            <input
              id="surface-dev-surface-sand"
              type="range"
              min={0}
              max={100}
              value={surfaceSand}
              onChange={(e) => onSurfaceSand(Number(e.target.value))}
              aria-valuetext={`${surfaceSand} percent — 0 is bright, 100 is sandiest`}
            />
            <span className="surface-dev-panel__hint">
              brighter ← default midpoint → sandier
            </span>
          </div>
          <div className="surface-dev-panel__row">
            <label className="surface-dev-panel__label" htmlFor="surface-dev-tab-opacity">
              Tab opacity
              <span className="surface-dev-panel__value">{tabOpacity}%</span>
            </label>
            <input
              id="surface-dev-tab-opacity"
              type="range"
              min={0}
              max={100}
              value={tabOpacity}
              onChange={(e) => onTabOpacity(Number(e.target.value))}
              aria-valuetext={`${tabOpacity} percent — alpha applied to unselected tab fill and border`}
            />
            <span className="surface-dev-panel__hint">
              transparent ← default → opaque
            </span>
          </div>
          <div className="surface-dev-panel__row">
            <label className="surface-dev-panel__label" htmlFor="surface-dev-border-strength">
              Border intensity
              <span className="surface-dev-panel__value">{borderStrength}%</span>
            </label>
            <input
              id="surface-dev-border-strength"
              type="range"
              min={0}
              max={100}
              value={borderStrength}
              onChange={(e) => onBorderStrength(Number(e.target.value))}
              aria-valuetext={`${borderStrength} percent — main tab + selected tab border alpha; unselected tabs get strength × tab-opacity`}
            />
            <span className="surface-dev-panel__hint">
              none ← softer → full
            </span>
          </div>
          <button
            type="button"
            className="surface-dev-panel__reset"
            onClick={onReset}
          >
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  );
}
