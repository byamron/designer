import type { CSSProperties, ElementType, ReactNode } from "react";
import { type PolymorphicProps, cx, vars } from "./tokens";

type FrameOwnProps = {
  /** Aspect ratio as `w/h`, e.g. "16/9" or "1/1". Mutually exclusive with `height`. */
  ratio?: string;
  /** Fixed block size. Any CSS length. Mutually exclusive with `ratio`. */
  height?: string;
  /** How replaced-content children (img/video) scale to fill. */
  fit?: "contain" | "cover";
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

export type FrameProps<T extends ElementType = "div"> = PolymorphicProps<
  T,
  FrameOwnProps
>;

export function Frame<T extends ElementType = "div">(props: FrameProps<T>) {
  const { as, ratio, height, fit, className, style, children, ...rest } = props;
  const Element = (as ?? "div") as ElementType;

  const styleVars = vars({
    ...style,
    "--mini-frame-ratio": ratio,
    "--mini-frame-height": height,
    "--mini-frame-fit": fit,
  });

  return (
    <Element
      className={cx("mini-frame", className)}
      style={styleVars}
      data-mode={ratio ? "ratio" : height ? "height" : undefined}
      {...rest}
    >
      {children}
    </Element>
  );
}
