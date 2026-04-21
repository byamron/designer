import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { cx } from "../primitives/tokens";

const Root = forwardRef<
  ElementRef<typeof RadioGroupPrimitive.Root>,
  ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(function RadioGroupRoot({ className, ...props }, ref) {
  return (
    <RadioGroupPrimitive.Root
      ref={ref}
      className={cx("mini-radiogroup", className)}
      {...props}
    />
  );
});

const Item = forwardRef<
  ElementRef<typeof RadioGroupPrimitive.Item>,
  ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(function RadioGroupItem({ className, children, ...props }, ref) {
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      className={cx("mini-radiogroup__item", className)}
      {...props}
    >
      {children ?? (
        <RadioGroupPrimitive.Indicator className="mini-radiogroup__indicator" />
      )}
    </RadioGroupPrimitive.Item>
  );
});

const Indicator = forwardRef<
  ElementRef<typeof RadioGroupPrimitive.Indicator>,
  ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Indicator>
>(function RadioGroupIndicator({ className, ...props }, ref) {
  return (
    <RadioGroupPrimitive.Indicator
      ref={ref}
      className={cx("mini-radiogroup__indicator", className)}
      {...props}
    />
  );
});

export const RadioGroup = { Root, Item, Indicator };
