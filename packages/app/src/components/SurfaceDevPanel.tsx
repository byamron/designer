import { useEffect, useState } from "react";
import { Sliders } from "lucide-react";
import { Tooltip } from "./Tooltip";
import { persisted, intDecoder } from "../util/persisted";

/**
 * SurfaceDevPanel — floating bottom-right panel that exposes two knobs
 * used to dial in the content surface color register.
 *
 *   1. composeMix (0–100): linear blend between --color-surface-flat
 *      ("main tab color", where compose sits today) and
 *      --color-content-surface. 0 = today's default; higher values push
 *      the compose toward the surface fill.
 *
 *   2. surfaceSand (0–100): blend between two anchors — a bright anchor
 *      (white in light, sand-dark-3 in dark) and a sandier anchor
 *      (sand-3 in light, sand-dark-1 in dark). 50 is the default so the
 *      slider travels equally "whiter" and "sandier" from today.
 *
 * Both values persist to localStorage and apply as CSS vars on :root so
 * the rest of the app's tokens cascade normally. Dev-only — only mounted
 * when `import.meta.env.MODE === "development"` (see App.tsx).
 *
 * Hotkey: ⌘. (or Ctrl+.) toggles open/close.
 */

const composeMixStore = persisted<number>(
  "designer.dev.composeMix",
  0,
  intDecoder((n) => Math.max(0, Math.min(100, n))),
);

const surfaceSandStore = persisted<number>(
  "designer.dev.surfaceSand",
  50,
  intDecoder((n) => Math.max(0, Math.min(100, n))),
);

function applyCssVars(composeMix: number, surfaceSand: number): void {
  const root = document.documentElement;
  root.style.setProperty("--dev-compose-mix", `${composeMix}%`);
  root.style.setProperty("--dev-surface-sand", `${surfaceSand}%`);
}

export function SurfaceDevPanel() {
  const [open, setOpen] = useState(false);
  const [composeMix, setComposeMix] = useState<number>(() => composeMixStore.read());
  const [surfaceSand, setSurfaceSand] = useState<number>(() => surfaceSandStore.read());

  useEffect(() => {
    applyCssVars(composeMix, surfaceSand);
  }, [composeMix, surfaceSand]);

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

  const onSurfaceSand = (value: number) => {
    setSurfaceSand(value);
    surfaceSandStore.write(value);
  };

  const onReset = () => {
    onComposeMix(0);
    onSurfaceSand(50);
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
              aria-valuetext={`${composeMix} percent — 0 is the muted main-tab fill, 100 matches the content surface`}
            />
            <span className="surface-dev-panel__hint">
              tab color → surface color
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
