import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { cx } from "../primitives/tokens";

const CheckboxRoot = forwardRef<
  ElementRef<typeof CheckboxPrimitive.Root>,
  ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(function CheckboxRoot({ className, children, ...props }, ref) {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cx("mini-checkbox", className)}
      {...props}
    >
      {children ?? (
        <CheckboxPrimitive.Indicator className="mini-checkbox__indicator" />
      )}
    </CheckboxPrimitive.Root>
  );
});

const CheckboxIndicator = forwardRef<
  ElementRef<typeof CheckboxPrimitive.Indicator>,
  ComponentPropsWithoutRef<typeof CheckboxPrimitive.Indicator>
>(function CheckboxIndicator({ className, ...props }, ref) {
  return (
    <CheckboxPrimitive.Indicator
      ref={ref}
      className={cx("mini-checkbox__indicator", className)}
      {...props}
    />
  );
});

export const Checkbox = Object.assign(CheckboxRoot, {
  Indicator: CheckboxIndicator,
});
