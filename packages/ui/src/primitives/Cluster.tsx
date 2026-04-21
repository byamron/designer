import type { CSSProperties, ElementType, ReactNode } from "react";
import {
  type PolymorphicProps,
  type SpaceToken,
  cx,
  vars,
} from "./tokens";

type Align = "start" | "center" | "end" | "baseline";
type Justify = "start" | "center" | "end" | "space-between";

type ClusterOwnProps = {
  /** Gap between children, both axes. */
  space?: SpaceToken;
  /** Cross-axis alignment of items on a row. */
  align?: Align;
  /** Main-axis distribution. */
  justify?: Justify;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

export type ClusterProps<T extends ElementType = "div"> = PolymorphicProps<
  T,
  ClusterOwnProps
>;

export function Cluster<T extends ElementType = "div">(props: ClusterProps<T>) {
  const { as, space, align, justify, className, style, children, ...rest } = props;
  const Element = (as ?? "div") as ElementType;

  const styleVars = vars({
    ...style,
    "--mini-cluster-space": space !== undefined ? `var(--space-${space})` : undefined,
    "--mini-cluster-align": align,
    "--mini-cluster-justify": justify,
  });

  return (
    <Element
      className={cx("mini-cluster", className)}
      style={styleVars}
      {...rest}
    >
      {children}
    </Element>
  );
}
