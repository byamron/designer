import * as ToastPrimitive from "@radix-ui/react-toast";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { cx } from "../primitives/tokens";

const Viewport = forwardRef<
  ElementRef<typeof ToastPrimitive.Viewport>,
  ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(function ToastViewport({ className, ...props }, ref) {
  return (
    <ToastPrimitive.Viewport
      ref={ref}
      className={cx("mini-toast__viewport", className)}
      {...props}
    />
  );
});

const Root = forwardRef<
  ElementRef<typeof ToastPrimitive.Root>,
  ComponentPropsWithoutRef<typeof ToastPrimitive.Root>
>(function ToastRoot({ className, ...props }, ref) {
  return (
    <ToastPrimitive.Root
      ref={ref}
      className={cx("mini-toast__root", className)}
      {...props}
    />
  );
});

const Title = forwardRef<
  ElementRef<typeof ToastPrimitive.Title>,
  ComponentPropsWithoutRef<typeof ToastPrimitive.Title>
>(function ToastTitle({ className, ...props }, ref) {
  return (
    <ToastPrimitive.Title
      ref={ref}
      className={cx("mini-toast__title", className)}
      {...props}
    />
  );
});

const Description = forwardRef<
  ElementRef<typeof ToastPrimitive.Description>,
  ComponentPropsWithoutRef<typeof ToastPrimitive.Description>
>(function ToastDescription({ className, ...props }, ref) {
  return (
    <ToastPrimitive.Description
      ref={ref}
      className={cx("mini-toast__description", className)}
      {...props}
    />
  );
});

const Action = forwardRef<
  ElementRef<typeof ToastPrimitive.Action>,
  ComponentPropsWithoutRef<typeof ToastPrimitive.Action>
>(function ToastAction({ className, ...props }, ref) {
  return (
    <ToastPrimitive.Action
      ref={ref}
      className={cx("mini-toast__action", className)}
      {...props}
    />
  );
});

const Close = forwardRef<
  ElementRef<typeof ToastPrimitive.Close>,
  ComponentPropsWithoutRef<typeof ToastPrimitive.Close>
>(function ToastClose({ className, ...props }, ref) {
  return (
    <ToastPrimitive.Close
      ref={ref}
      className={cx("mini-toast__close", className)}
      {...props}
    />
  );
});

export const Toast = {
  Provider: ToastPrimitive.Provider,
  Viewport,
  Root,
  Title,
  Description,
  Action,
  Close,
};
