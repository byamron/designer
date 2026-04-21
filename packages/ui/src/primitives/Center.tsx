import type { CSSProperties, ElementType, ReactNode } from "react";
import { type PolymorphicProps, cx, vars } from "./tokens";

type ReadingWidth = "narrow" | "regular" | "wide";

const READING_WIDTHS: Record<ReadingWidth, string> = {
  narrow: "45ch",
  regular: "60ch",
  wide: "80ch",
};

type CenterOwnProps = {
  /**
   * Max inline size. Accepts a reading-width keyword or any CSS length.
   * Defaults to "regular" (60ch).
   */
  maxWidth?: ReadingWidth | (string & {});
  /** Also centers text inside the container. */
  text?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

export type CenterProps<T extends ElementType = "div"> = PolymorphicProps<
  T,
  CenterOwnProps
>;

export function Center<T extends ElementType = "div">(props: CenterProps<T>) {
  const { as, maxWidth, text, className, style, children, ...rest } = props;
  const Element = (as ?? "div") as ElementType;

  const resolvedMax =
    maxWidth !== undefined && maxWidth in READING_WIDTHS
      ? READING_WIDTHS[maxWidth as ReadingWidth]
      : maxWidth;

  const styleVars = vars({
    ...style,
    "--mini-center-max-width": resolvedMax,
  });

  return (
    <Element
      className={cx("mini-center", text && "mini-center--text", className)}
      style={styleVars}
      {...rest}
    >
      {children}
    </Element>
  );
}
