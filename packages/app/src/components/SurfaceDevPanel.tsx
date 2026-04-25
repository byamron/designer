import { useEffect, useState } from "react";
import { Sliders } from "lucide-react";
import { Tooltip } from "./Tooltip";
import { SegmentedToggle } from "./SegmentedToggle";
import { persisted, intDecoder, stringDecoder } from "../util/persisted";

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

/** Tab corner-radius variants — quick A/B test for harmony between the
 *  tabs and the main tab container without editing CSS. Each preset
 *  drives both the symmetric slider value and (for Folder) a separate
 *  bottom radius. "Custom" is what the user lands on when they drag
 *  the slider away from a preset. */
const TAB_RADIUS_VARIANTS = ["soft", "concentric", "folder", "match", "custom"] as const;
type TabRadiusVariant = (typeof TAB_RADIUS_VARIANTS)[number];

interface VariantConfig {
  /** Symmetric value (drives both top + bottom unless `bottom` is set). */
  value: number;
  /** When set, decouples the bottom corner from `value` — Folder style. */
  bottom?: number;
}

const VARIANT_CONFIG: Record<Exclude<TabRadiusVariant, "custom">, VariantConfig> = {
  soft: { value: 12 },
  concentric: { value: 18 }, // --radius-surface (24) − --surface-tab-gap (6)
  folder: { value: 14, bottom: 6 },
  match: { value: 24 }, // = --radius-surface
};

const tabRadiusVariantStore = persisted<TabRadiusVariant>(
  "designer.dev.tabRadiusVariant",
  "soft",
  stringDecoder(TAB_RADIUS_VARIANTS),
);

const tabRadiusValueStore = persisted<number>(
  "designer.dev.tabRadiusValue",
  12,
  intDecoder((n) => Math.max(0, Math.min(32, n))),
);

interface SurfaceVars {
  composeMix: number;
  mainTabSand: number;
  surfaceSand: number;
  tabOpacity: number;
  borderStrength: number;
  shadowIntensity: number;
  tabRadiusVariant: TabRadiusVariant;
  tabRadiusValue: number;
}

function applyCssVars(v: SurfaceVars): void {
  const root = document.documentElement;
  root.style.setProperty("--dev-compose-mix", `${v.composeMix}%`);
  root.style.setProperty("--dev-main-tab-sand", `${v.mainTabSand}%`);
  root.style.setProperty("--dev-surface-sand", `${v.surfaceSand}%`);
  root.style.setProperty("--dev-tab-opacity", `${v.tabOpacity}%`);
  root.style.setProperty("--dev-border-strength", `${v.borderStrength}%`);
  root.style.setProperty("--dev-shadow-intensity", `${v.shadowIntensity}%`);
  // Tab radius: Folder is the only asymmetric variant; everything else
  // mirrors top to bottom from the slider value.
  const top = v.tabRadiusValue;
  const bottom =
    v.tabRadiusVariant === "folder"
      ? VARIANT_CONFIG.folder.bottom ?? top
      : top;
  root.style.setProperty("--dev-tab-radius-top", `${top}px`);
  root.style.setProperty("--dev-tab-radius-bottom", `${bottom}px`);
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
  const [tabRadiusVariant, setTabRadiusVariant] = useState<TabRadiusVariant>(
    () => tabRadiusVariantStore.read(),
  );
  const [tabRadiusValue, setTabRadiusValue] = useState<number>(() =>
    tabRadiusValueStore.read(),
  );

  useEffect(() => {
    applyCssVars({
      composeMix,
      mainTabSand,
      surfaceSand,
      tabOpacity,
      borderStrength,
      shadowIntensity,
      tabRadiusVariant,
      tabRadiusValue,
    });
  }, [
    composeMix,
    mainTabSand,
    surfaceSand,
    tabOpacity,
    borderStrength,
    shadowIntensity,
    tabRadiusVariant,
    tabRadiusValue,
  ]);

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

  const onTabRadiusVariant = (variant: TabRadiusVariant) => {
    setTabRadiusVariant(variant);
    tabRadiusVariantStore.write(variant);
    if (variant !== "custom") {
      const next = VARIANT_CONFIG[variant].value;
      setTabRadiusValue(next);
      tabRadiusValueStore.write(next);
    }
  };

  const onTabRadiusValue = (v: number) => {
    setTabRadiusValue(v);
    tabRadiusValueStore.write(v);
    // Dragging the slider deselects the named preset — the user is
    // dialing in their own value. Folder stays Folder so the asymmetric
    // bottom-corner stays in effect; the symmetric value is what
    // they're tweaking.
    if (tabRadiusVariant !== "custom" && tabRadiusVariant !== "folder") {
      setTabRadiusVariant("custom");
      tabRadiusVariantStore.write("custom");
    }
  };

  const onReset = () => {
    onComposeMix(20);
    onMainTabSand(5);
    onSurfaceSand(80);
    onTabOpacity(70);
    onBorderStrength(10);
    onShadowIntensity(50);
    onTabRadiusVariant("soft");
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
          <div className="surface-dev-panel__row">
            <label className="surface-dev-panel__label" htmlFor="surface-dev-tab-radius">
              Tab corners
              <span className="surface-dev-panel__value">
                {tabRadiusVariant === "folder"
                  ? `${tabRadiusValue} / ${VARIANT_CONFIG.folder.bottom}px`
                  : `${tabRadiusValue}px`}
              </span>
            </label>
            <SegmentedToggle<TabRadiusVariant>
              ariaLabel="Tab corner radius variant"
              value={tabRadiusVariant}
              onChange={onTabRadiusVariant}
              options={[
                { value: "soft", label: "Soft", tooltip: "12px — small soft card" },
                { value: "concentric", label: "Concentric", tooltip: "18px — surface − tab gap" },
                { value: "folder", label: "Folder", tooltip: "14 / 6 asymmetric" },
                { value: "match", label: "Match", tooltip: "24px — same as main tab" },
                { value: "custom", label: "Custom", tooltip: "Drag the slider" },
              ]}
            />
            <input
              id="surface-dev-tab-radius"
              type="range"
              min={0}
              max={32}
              value={tabRadiusValue}
              onChange={(e) => onTabRadiusValue(Number(e.target.value))}
              aria-valuetext={`${tabRadiusValue} pixels — symmetric tab corner radius${tabRadiusVariant === "folder" ? "; bottom corner stays at 6px" : ""}`}
            />
            <span className="surface-dev-panel__hint">
              {tabRadiusVariant === "folder"
                ? "top rounded, bottom flat"
                : "0 ← square → 32 pill"}
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
