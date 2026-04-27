import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Tooltip } from "./Tooltip";
import { cx } from "../util/cx";

type Size = "sm" | "md";

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  label: string;
  shortcut?: string;
  size?: Size;
  pressed?: boolean;
  children: ReactNode;
}

/**
 * IconButton — the single icon-only button archetype.
 * - `md` (default): 32×32 hit target. Primary topbar / compose / sidebar icons.
 * - `sm`: 24×24 hit target. Dense inline affordances (chip removers,
 *   inline-row controls). Below this, tap accessibility breaks down — do not
 *   introduce smaller sizes without amending axiom #14.
 *
 * Tooltip is always shown on hover / focus. `aria-pressed` renders only when
 * `pressed` is explicitly set — a non-toggle button with `aria-pressed="false"`
 * reads wrong to AT.
 */
export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  { label, shortcut, size = "md", pressed, children, className, ...rest },
  ref,
) {
  const classes = cx("btn-icon", `btn-icon--${size}`, className);
  return (
    <Tooltip label={label} shortcut={shortcut} disabled={rest.disabled}>
      <button
        {...rest}
        ref={ref}
        type={rest.type ?? "button"}
        className={classes}
        data-component="IconButton"
        aria-label={label}
        {...(pressed !== undefined ? { "aria-pressed": pressed } : {})}
      >
        {children}
      </button>
    </Tooltip>
  );
});
