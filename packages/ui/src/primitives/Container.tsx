import type { CSSProperties, ElementType, ReactNode } from "react";
import {
  type PolymorphicProps,
  type SpaceToken,
  cx,
  vars,
} from "./tokens";

type ContainerOwnProps = {
  /** Max inline size of the layout bounds. Any CSS length. */
  maxWidth?: string;
  /** Inline padding (page gutter). */
  paddingX?: SpaceToken;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

export type ContainerProps<T extends ElementType = "div"> = PolymorphicProps<
  T,
  ContainerOwnProps
>;

export function Container<T extends ElementType = "div">(
  props: ContainerProps<T>,
) {
  const { as, maxWidth, paddingX, className, style, children, ...rest } = props;
  const Element = (as ?? "div") as ElementType;

  const styleVars = vars({
    ...style,
    "--mini-container-max-width": maxWidth,
    "--mini-container-padding-x":
      paddingX !== undefined ? `var(--space-${paddingX})` : undefined,
  });

  return (
    <Element
      className={cx("mini-container", className)}
      style={styleVars}
      {...rest}
    >
      {children}
    </Element>
  );
}
