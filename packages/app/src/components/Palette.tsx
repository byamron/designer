import type { ReactNode } from "react";
import { Tooltip } from "./Tooltip";
import { SegmentedToggle } from "./SegmentedToggle";
import { setPaletteDensity, useAppState, type PaletteDensity } from "../store/app";

export interface PaletteSuggestion {
  id: string;
  icon: ReactNode;
  label: string;
  meta: string;
  shortcut?: string;
  onClick?: () => void;
}

/**
 * Palette primitive. One prompt + a list of context-aware suggestions.
 * Density (bounded / open) persists globally because the toggle is about
 * how the user reads a palette, not about a specific surface.
 */
export function Palette({
  placeholder,
  ariaLabel,
  suggestions,
  showDensityToggle = true,
}: {
  placeholder: string;
  ariaLabel: string;
  suggestions: PaletteSuggestion[];
  showDensityToggle?: boolean;
}) {
  const density = useAppState((s) => s.paletteDensity);
  return (
    <div className="palette">
      <div className="palette__stage">
        {showDensityToggle && (
          <div className="palette__stage-head">
            <SegmentedToggle<PaletteDensity>
              ariaLabel="Palette density"
              value={density}
              onChange={setPaletteDensity}
              options={PALETTE_DENSITY_OPTIONS}
            />
          </div>
        )}
        <div className="palette__surface" data-density={density}>
          <div className="palette__prompt">
            <input
              type="text"
              className="palette__input"
              placeholder={placeholder}
              aria-label={ariaLabel}
            />
          </div>
          <ul className="palette__suggestions" aria-label="Suggested next steps">
            {suggestions.map((s) => (
              <li key={s.id}>
                <Tooltip label={s.label} shortcut={s.shortcut}>
                  <button
                    type="button"
                    className="palette__suggestion"
                    onClick={s.onClick}
                  >
                    <span className="palette__suggestion-icon" aria-hidden="true">
                      {s.icon}
                    </span>
                    <span className="palette__suggestion-label">{s.label}</span>
                    <span className="palette__suggestion-meta">{s.meta}</span>
                  </button>
                </Tooltip>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

const PALETTE_DENSITY_OPTIONS = [
  { value: "bounded" as PaletteDensity, label: "Bounded", tooltip: "Bounded — prompt and suggestions share one container" },
  { value: "open" as PaletteDensity, label: "Open", tooltip: "Open — items on the surface, no container" },
];
