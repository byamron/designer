import * as DialogPrimitive from "@radix-ui/react-dialog";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { cx } from "../primitives/tokens";

const Overlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function DialogOverlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cx("mini-dialog__overlay", className)}
      {...props}
    />
  );
});

const Content = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(function DialogContent({ className, children, ...props }, ref) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cx("mini-dialog__content", className)}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

const Title = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function DialogTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cx("mini-dialog__title", className)}
      {...props}
    />
  );
});

const Description = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DialogDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cx("mini-dialog__description", className)}
      {...props}
    />
  );
});

export const Dialog = {
  Root: DialogPrimitive.Root,
  Trigger: DialogPrimitive.Trigger,
  Close: DialogPrimitive.Close,
  Portal: DialogPrimitive.Portal,
  Overlay,
  Content,
  Title,
  Description,
};
