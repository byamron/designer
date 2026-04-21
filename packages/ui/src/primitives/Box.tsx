import type { CSSProperties, ElementType, ReactNode } from "react";
import {
  type Color,
  type ElevationToken,
  type PolymorphicProps,
  type RadiusToken,
  type SpaceToken,
  cx,
  resolveColor,
  vars,
} from "./tokens";

type BoxOwnProps = {
  padding?: SpaceToken;
  paddingX?: SpaceToken;
  paddingY?: SpaceToken;
  radius?: RadiusToken;
  background?: Color;
  border?: Color;
  elevation?: ElevationToken;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

export type BoxProps<T extends ElementType = "div"> = PolymorphicProps<
  T,
  BoxOwnProps
>;

export function Box<T extends ElementType = "div">(props: BoxProps<T>) {
  const {
    as,
    padding,
    paddingX,
    paddingY,
    radius,
    background,
    border,
    elevation,
    className,
    style,
    children,
    ...rest
  } = props;

  const Element = (as ?? "div") as ElementType;

  const styleVars = vars({
    ...style,
    "--mini-box-padding": padding !== undefined ? `var(--space-${padding})` : undefined,
    "--mini-box-padding-x": paddingX !== undefined ? `var(--space-${paddingX})` : undefined,
    "--mini-box-padding-y": paddingY !== undefined ? `var(--space-${paddingY})` : undefined,
    "--mini-box-radius": radius ? `var(--radius-${radius})` : undefined,
    "--mini-box-background": resolveColor(background),
    "--mini-box-border-color": resolveColor(border),
    "--mini-box-elevation": elevation ? `var(--elevation-${elevation})` : undefined,
  });

  return (
    <Element
      className={cx("mini-box", border && "mini-box--bordered", className)}
      style={styleVars}
      {...rest}
    >
      {children}
    </Element>
  );
}
