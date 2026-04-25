import {
  ChevronLeft,
  ChevronRight,
  GitBranch,
  PanelLeftClose,
  PanelRightClose,
  Plus,
  X,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

/**
 * Shared icon wrappers around Lucide. Every inline SVG that appeared three
 * or more times lives here; one-offs can import from `lucide-react`
 * directly in the consumer file and pass `size` / `strokeWidth` inline.
 *
 * Defaults follow axiom #13: 12/14/16px size, 1.25 stroke at sm/md, 1.5
 * at lg. `currentColor` is inherited from Lucide. Everything is
 * aria-hidden by default — icons are decoration on top of a labeled
 * button; labels travel via Tooltip / aria-label.
 */

export type IconSize = 10 | 12 | 14 | 16;

interface WrapProps {
  size?: IconSize;
  strokeWidth?: number;
}

function strokeFor(size: IconSize): number {
  return size >= 16 ? 1.5 : 1.25;
}

function wrap(Icon: LucideIcon, defaultSize: IconSize) {
  return function Wrapped({ size = defaultSize, strokeWidth, ...rest }: WrapProps & Omit<LucideProps, keyof WrapProps>) {
    return (
      <Icon
        size={size}
        strokeWidth={strokeWidth ?? strokeFor(size)}
        aria-hidden="true"
        {...rest}
      />
    );
  };
}

export const IconX = wrap(X, 10);
export const IconPlus = wrap(Plus, 16);
export const IconBranch = wrap(GitBranch, 12);
export const IconChevronLeft = wrap(ChevronLeft, 16);
export const IconChevronRight = wrap(ChevronRight, 16);
export const IconCollapseLeft = wrap(PanelLeftClose, 16);
export const IconCollapseRight = wrap(PanelRightClose, 16);
