import type { ReactNode } from "react";
import { Tooltip } from "./Tooltip";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  tooltip?: string;
  icon?: ReactNode;
}

/**
 * Two-to-N pill toggle. Replaces the hand-rolled VariantToggle (Panels/Palette)
 * and DensityToggle (Bounded/Open); both shipped as near-identical copies.
 */
export function SegmentedToggle<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (next: T) => void;
  options: SegmentedOption<T>[];
  ariaLabel: string;
}) {
  return (
    <div className="segmented-toggle" role="group" aria-label={ariaLabel}>
      {options.map((opt) => {
        const btn = (
          <button
            type="button"
            className="segmented-toggle__btn"
            aria-pressed={value === opt.value}
            onClick={() => onChange(opt.value)}
          >
            {opt.icon && <span aria-hidden="true">{opt.icon}</span>}
            <span>{opt.label}</span>
          </button>
        );
        return opt.tooltip ? (
          <Tooltip key={opt.value} label={opt.tooltip}>
            {btn}
          </Tooltip>
        ) : (
          <span key={opt.value}>{btn}</span>
        );
      })}
    </div>
  );
}
