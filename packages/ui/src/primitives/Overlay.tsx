import type { CSSProperties, ElementType, ReactNode } from "react";
import {
  type LayerToken,
  type PolymorphicProps,
  cx,
  vars,
} from "./tokens";

type Anchor =
  | "top-left"
  | "top"
  | "top-right"
  | "right"
  | "bottom-right"
  | "bottom"
  | "bottom-left"
  | "left"
  | "center";

type OverlayOwnProps = {
  /** Position within the nearest positioned ancestor. Defaults to "top-left". */
  anchor?: Anchor;
  /** Inline-axis offset from the anchor. Any CSS length. */
  offsetX?: string;
  /** Block-axis offset from the anchor. Any CSS length. */
  offsetY?: string;
  /** Paired with elevation. Defaults to "overlay". */
  layer?: LayerToken;
  /** Whether the overlay captures pointer events. */
  pointerEvents?: "auto" | "none";
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

export type OverlayProps<T extends ElementType = "div"> = PolymorphicProps<
  T,
  OverlayOwnProps
>;

/**
 * Absolute-positioned floating element. Assumes a positioned ancestor;
 * consumers are responsible for `position: relative` on the container.
 * Web-only; SwiftUI uses ZStack natively.
 */
export function Overlay<T extends ElementType = "div">(props: OverlayProps<T>) {
  const {
    as,
    anchor = "top-left",
    offsetX,
    offsetY,
    layer = "overlay",
    pointerEvents,
    className,
    style,
    children,
    ...rest
  } = props;
  const Element = (as ?? "div") as ElementType;

  const styleVars = vars({
    ...style,
    "--mini-overlay-offset-x": offsetX,
    "--mini-overlay-offset-y": offsetY,
    "--mini-overlay-layer": `var(--layer-${layer})`,
    "--mini-overlay-pointer-events": pointerEvents,
  });

  return (
    <Element
      className={cx("mini-overlay", className)}
      style={styleVars}
      data-anchor={anchor}
      {...rest}
    >
      {children}
    </Element>
  );
}
