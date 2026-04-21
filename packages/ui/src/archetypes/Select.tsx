import * as SelectPrimitive from "@radix-ui/react-select";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { cx } from "../primitives/tokens";

const Trigger = forwardRef<
  ElementRef<typeof SelectPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(function SelectTrigger({ className, children, ...props }, ref) {
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cx("mini-select__trigger", className)}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon className="mini-select__icon" />
    </SelectPrimitive.Trigger>
  );
});

const Content = forwardRef<
  ElementRef<typeof SelectPrimitive.Content>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(function SelectContent({ className, children, position = "popper", ...props }, ref) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        className={cx("mini-select__content", className)}
        position={position}
        {...props}
      >
        <SelectPrimitive.Viewport className="mini-select__viewport">
          {children}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});

const Item = forwardRef<
  ElementRef<typeof SelectPrimitive.Item>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(function SelectItem({ className, children, ...props }, ref) {
  return (
    <SelectPrimitive.Item
      ref={ref}
      className={cx("mini-select__item", className)}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="mini-select__item-indicator" />
    </SelectPrimitive.Item>
  );
});

const Label = forwardRef<
  ElementRef<typeof SelectPrimitive.Label>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(function SelectLabel({ className, ...props }, ref) {
  return (
    <SelectPrimitive.Label
      ref={ref}
      className={cx("mini-select__label", className)}
      {...props}
    />
  );
});

const Separator = forwardRef<
  ElementRef<typeof SelectPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(function SelectSeparator({ className, ...props }, ref) {
  return (
    <SelectPrimitive.Separator
      ref={ref}
      className={cx("mini-select__separator", className)}
      {...props}
    />
  );
});

export const Select = {
  Root: SelectPrimitive.Root,
  Value: SelectPrimitive.Value,
  Group: SelectPrimitive.Group,
  Trigger,
  Content,
  Item,
  Label,
  Separator,
};
