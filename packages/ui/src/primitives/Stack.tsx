import type { CSSProperties, ElementType, ReactNode } from "react";
import {
  type PolymorphicProps,
  type SpaceToken,
  cx,
  vars,
} from "./tokens";

type Align = "start" | "center" | "end" | "stretch";

type StackOwnProps = {
  /** Gap between children. */
  space?: SpaceToken;
  /** Cross-axis alignment. */
  align?: Align;
  /**
   * Insert an auto spacer after the child at this 1-based index,
   * pushing subsequent children to the end of the container.
   * Useful for header/body/footer patterns. Max supported: 10.
   */
  split?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

export type StackProps<T extends ElementType = "div"> = PolymorphicProps<
  T,
  StackOwnProps
>;

export function Stack<T extends ElementType = "div">(props: StackProps<T>) {
  const { as, space, align, split, className, style, children, ...rest } = props;
  const Element = (as ?? "div") as ElementType;

  const styleVars = vars({
    ...style,
    "--mini-stack-space": space !== undefined ? `var(--space-${space})` : undefined,
    "--mini-stack-align": align,
  });

  return (
    <Element
      className={cx("mini-stack", className)}
      style={styleVars}
      data-split={split}
      {...rest}
    >
      {children}
    </Element>
  );
}
