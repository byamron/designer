/**
 * Shared icon set. Each icon consumes `currentColor` and is sized to an
 * `--icon-*` token (12/14/16) via its viewBox scale. Stroke width follows
 * axiom #13: 1.25 at sm/md, 1.5 at lg.
 *
 * Prefer importing from here over inlining SVG in a component; three copies
 * of the same close-X across the tree is the reason this module exists.
 */

interface SvgProps {
  size?: 10 | 12 | 14 | 16;
  strokeWidth?: number;
}

function Svg({
  size = 12,
  strokeWidth = 1.25,
  children,
  viewBox,
}: SvgProps & { children: React.ReactNode; viewBox: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function IconX(props: SvgProps) {
  const s = props.size ?? 10;
  const sw = props.strokeWidth ?? 1.5;
  const end = s - 2;
  return (
    <Svg {...props} size={s} strokeWidth={sw} viewBox={`0 0 ${s} ${s}`}>
      <path d={`M2 2l${end - 2} ${end - 2}`} />
      <path d={`M${end} 2l-${end - 2} ${end - 2}`} />
    </Svg>
  );
}

export function IconPlus(props: SvgProps) {
  const s = props.size ?? 12;
  return (
    <Svg {...props} size={s} viewBox={`0 0 ${s} ${s}`}>
      <path d={`M${s / 2} 2v${s - 4}`} />
      <path d={`M2 ${s / 2}h${s - 4}`} />
    </Svg>
  );
}

export function IconBranch(props: SvgProps) {
  return (
    <Svg {...props} size={props.size ?? 12} viewBox="0 0 12 12">
      <circle cx="3.5" cy="2.5" r="1" />
      <circle cx="3.5" cy="9.5" r="1" />
      <circle cx="8.5" cy="6" r="1" />
      <path d="M3.5 3.5v5" />
      <path d="M3.5 6h4" />
    </Svg>
  );
}

export function IconChevronRight(props: SvgProps) {
  return (
    <Svg {...props} size={props.size ?? 12} viewBox="0 0 12 12">
      <path d="M4 3l3 3-3 3" />
      <path d="M8 3v6" />
    </Svg>
  );
}

export function IconChevronLeft(props: SvgProps) {
  return (
    <Svg {...props} size={props.size ?? 12} viewBox="0 0 12 12">
      <path d="M8 3l-3 3 3 3" />
      <path d="M4 3v6" />
    </Svg>
  );
}

export function IconCollapseLeft(props: SvgProps) {
  return (
    <Svg {...props} size={props.size ?? 12} viewBox="0 0 12 12">
      <path d="M5 3l-3 3 3 3" />
      <path d="M9 3v6" />
    </Svg>
  );
}

export function IconCollapseRight(props: SvgProps) {
  return (
    <Svg {...props} size={props.size ?? 12} viewBox="0 0 12 12">
      <path d="M7 3l3 3-3 3" />
      <path d="M3 3v6" />
    </Svg>
  );
}
