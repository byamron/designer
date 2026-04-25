import { useEffect, useState } from "react";
import { Sliders } from "lucide-react";
import { Tooltip } from "./Tooltip";
import { persisted, intDecoder } from "../util/persisted";

/**
 * SurfaceDevPanel — floating bottom-right panel exposing six knobs that
 * each control a distinct layer of the surface register.
 *
 *   1. Compose fill     — `--dev-compose-mix`. 0 = matches main-tab,
 *      100 = matches parent surface.
 *   2. Main tab fill    — `--dev-main-tab-sand`. 0 = pure white,
 *      100 = sandiest.
 *   3. Surface sand     — `--dev-surface-sand`. 0 = brighter parent,
 *      100 = sandier parent.
 *   4. Tab opacity      — `--dev-tab-opacity`. Unselected-tab fill +
 *      border alpha.
 *   5. Border intensity — `--dev-border-strength`. Main + selected
 *      tab border alpha; unselected = strength × tab-opacity.
 *   6. Shadow intensity — `--dev-shadow-intensity`. Main tab + selected
 *      tab shadow strength. Unselected tabs never have a shadow.
 *
 * All six persist to localStorage and apply as CSS vars on :root so
 * the rest of the token cascade flows through. Dev-only.
 *
 * Hotkey: ⌘. (or Ctrl+.) toggles open/close.
 */

const composeMixStore = persisted<number>(
  "designer.dev.composeMix",
  20,
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
  70,
  intDecoder((n) => Math.max(0, Math.min(100, n))),
);

const borderStrengthStore = persisted<number>(
  "designer.dev.borderStrength",
  10,
  intDecoder((n) => Math.max(0, Math.min(100, n))),
);

const shadowIntensityStore = persisted<number>(
  "designer.dev.shadowIntensity",
  50,
  intDecoder((n) => Math.max(0, Math.min(100, n))),
);

interface SurfaceVars {
  composeMix: number;
  mainTabSand: number;
  surfaceSand: number;
  tabOpacity: number;
  borderStrength: number;
  shadowIntensity: number;
}

function applyCssVars(v: SurfaceVars): void {
  const root = document.documentElement;
  root.style.setProperty("--dev-compose-mix", `${v.composeMix}%`);
  root.style.setProperty("--dev-main-tab-sand", `${v.mainTabSand}%`);
  root.style.setProperty("--dev-surface-sand", `${v.surfaceSand}%`);
  root.style.setProperty("--dev-tab-opacity", `${v.tabOpacity}%`);
  root.style.setProperty("--dev-border-strength", `${v.borderStrength}%`);
  root.style.setProperty("--dev-shadow-intensity", `${v.shadowIntensity}%`);
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
  const [shadowIntensity, setShadowIntensity] = useState<number>(() =>
    shadowIntensityStore.read(),
  );

  useEffect(() => {
    applyCssVars({
      composeMix,
      mainTabSand,
      surfaceSand,
      tabOpacity,
      borderStrength,
      shadowIntensity,
    });
  }, [composeMix, mainTabSand, surfaceSand, tabOpacity, borderStrength, shadowIntensity]);

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

  const onComposeMix = (v: number) => {
    setComposeMix(v);
    composeMixStore.write(v);
  };
  const onMainTabSand = (v: number) => {
    setMainTabSand(v);
    mainTabSandStore.write(v);
  };
  const onSurfaceSand = (v: number) => {
    setSurfaceSand(v);
    surfaceSandStore.write(v);
  };
  const onTabOpacity = (v: number) => {
    setTabOpacity(v);
    tabOpacityStore.write(v);
  };
  const onBorderStrength = (v: number) => {
    setBorderStrength(v);
    borderStrengthStore.write(v);
  };
  const onShadowIntensity = (v: number) => {
    setShadowIntensity(v);
    shadowIntensityStore.write(v);
  };

  const onReset = () => {
    onComposeMix(20);
    onMainTabSand(5);
    onSurfaceSand(80);
    onTabOpacity(70);
    onBorderStrength(10);
    onShadowIntensity(50);
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
              aria-valuetext={`${composeMix} percent — 0 matches main-tab fill, 100 matches parent surface`}
            />
            <span className="surface-dev-panel__hint">tab fill ← default → surface fill</span>
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
            <span className="surface-dev-panel__hint">white ← default → sandier</span>
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
            <span className="surface-dev-panel__hint">brighter ← default midpoint → sandier</span>
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
            <span className="surface-dev-panel__hint">transparent ← default → opaque</span>
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
              aria-valuetext={`${borderStrength} percent — main + selected tab border alpha; unselected = strength × tab-opacity`}
            />
            <span className="surface-dev-panel__hint">none ← softer → full</span>
          </div>
          <div className="surface-dev-panel__row">
            <label className="surface-dev-panel__label" htmlFor="surface-dev-shadow-intensity">
              Shadow intensity
              <span className="surface-dev-panel__value">{shadowIntensity}%</span>
            </label>
            <input
              id="surface-dev-shadow-intensity"
              type="range"
              min={0}
              max={100}
              value={shadowIntensity}
              onChange={(e) => onShadowIntensity(Number(e.target.value))}
              aria-valuetext={`${shadowIntensity} percent — drop shadow on the main tab + selected tab. Unselected tabs are flat.`}
            />
            <span className="surface-dev-panel__hint">flat ← softer → full</span>
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
