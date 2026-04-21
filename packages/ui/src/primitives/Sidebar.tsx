import type { CSSProperties, ElementType, ReactNode } from "react";
import {
  type PolymorphicProps,
  type SpaceToken,
  cx,
  vars,
} from "./tokens";

type SidebarOwnProps = {
  /** Which side the sidebar sits on. */
  side?: "start" | "end";
  /** Fixed inline size of the sidebar. */
  sidebarWidth?: string;
  /** Minimum inline size of the content before layout collapses to a stack. */
  contentMin?: string;
  /** Gap between sidebar and content. */
  space?: SpaceToken;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

export type SidebarProps<T extends ElementType = "div"> = PolymorphicProps<
  T,
  SidebarOwnProps
>;

export function Sidebar<T extends ElementType = "div">(props: SidebarProps<T>) {
  const {
    as,
    side = "start",
    sidebarWidth,
    contentMin,
    space,
    className,
    style,
    children,
    ...rest
  } = props;
  const Element = (as ?? "div") as ElementType;

  const styleVars = vars({
    ...style,
    "--mini-sidebar-width": sidebarWidth,
    "--mini-sidebar-content-min": contentMin,
    "--mini-sidebar-space": space !== undefined ? `var(--space-${space})` : undefined,
  });

  return (
    <Element
      className={cx("mini-sidebar", className)}
      style={styleVars}
      data-side={side}
      {...rest}
    >
      {children}
    </Element>
  );
}
