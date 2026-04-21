import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { cx } from "../primitives/tokens";

const Content = forwardRef<
  ElementRef<typeof TooltipPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(function TooltipContent({ className, sideOffset = 6, ...props }, ref) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        className={cx("mini-tooltip__content", className)}
        sideOffset={sideOffset}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
});

const Arrow = forwardRef<
  ElementRef<typeof TooltipPrimitive.Arrow>,
  ComponentPropsWithoutRef<typeof TooltipPrimitive.Arrow>
>(function TooltipArrow({ className, ...props }, ref) {
  return (
    <TooltipPrimitive.Arrow
      ref={ref}
      className={cx("mini-tooltip__arrow", className)}
      {...props}
    />
  );
});

export const Tooltip = {
  Provider: TooltipPrimitive.Provider,
  Root: TooltipPrimitive.Root,
  Trigger: TooltipPrimitive.Trigger,
  Content,
  Arrow,
};
