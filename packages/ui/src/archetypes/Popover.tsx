import * as PopoverPrimitive from "@radix-ui/react-popover";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { cx } from "../primitives/tokens";

const Content = forwardRef<
  ElementRef<typeof PopoverPrimitive.Content>,
  ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(function PopoverContent({ className, sideOffset = 8, ...props }, ref) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        className={cx("mini-popover__content", className)}
        sideOffset={sideOffset}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});

const Arrow = forwardRef<
  ElementRef<typeof PopoverPrimitive.Arrow>,
  ComponentPropsWithoutRef<typeof PopoverPrimitive.Arrow>
>(function PopoverArrow({ className, ...props }, ref) {
  return (
    <PopoverPrimitive.Arrow
      ref={ref}
      className={cx("mini-popover__arrow", className)}
      {...props}
    />
  );
});

export const Popover = {
  Root: PopoverPrimitive.Root,
  Trigger: PopoverPrimitive.Trigger,
  Anchor: PopoverPrimitive.Anchor,
  Close: PopoverPrimitive.Close,
  Content,
  Arrow,
};
