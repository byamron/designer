import type { ReactNode } from 'react';

const Svg = ({ children }: { children: ReactNode }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {children}
  </svg>
);

// align inside the parent
export const AlignLeft = () => <Svg><path d="M2.5 2v12" /><rect x="5" y="4" width="8" height="3" rx=".5" /><rect x="5" y="9" width="5" height="3" rx=".5" /></Svg>;
export const AlignCenter = () => <Svg><path d="M8 2v12" /><rect x="3.5" y="4" width="9" height="3" rx=".5" /><rect x="5" y="9" width="6" height="3" rx=".5" /></Svg>;
export const AlignRight = () => <Svg><path d="M13.5 2v12" /><rect x="3" y="4" width="8" height="3" rx=".5" /><rect x="6" y="9" width="5" height="3" rx=".5" /></Svg>;
export const AlignTop = () => <Svg><path d="M2 2.5h12" /><rect x="4" y="5" width="3" height="8" rx=".5" /><rect x="9" y="5" width="3" height="5" rx=".5" /></Svg>;
export const AlignMiddle = () => <Svg><path d="M2 8h12" /><rect x="4" y="3.5" width="3" height="9" rx=".5" /><rect x="9" y="5" width="3" height="6" rx=".5" /></Svg>;
export const AlignBottom = () => <Svg><path d="M2 13.5h12" /><rect x="4" y="3" width="3" height="8" rx=".5" /><rect x="9" y="6" width="3" height="5" rx=".5" /></Svg>;

// layout flow
export const FlowBlock = () => <Svg><rect x="3" y="3" width="10" height="3" rx=".5" /><rect x="3" y="8" width="10" height="3" rx=".5" /></Svg>;
export const FlowVertical = () => <Svg><rect x="4" y="2.5" width="8" height="3" rx=".5" /><rect x="4" y="6.5" width="8" height="3" rx=".5" /><rect x="4" y="10.5" width="8" height="3" rx=".5" /></Svg>;
export const FlowHorizontal = () => <Svg><rect x="2.5" y="4" width="3" height="8" rx=".5" /><rect x="6.5" y="4" width="3" height="8" rx=".5" /><rect x="10.5" y="4" width="3" height="8" rx=".5" /></Svg>;
export const FlowWrap = () => <Svg><rect x="2.5" y="3" width="3" height="4" rx=".5" /><rect x="6.5" y="3" width="3" height="4" rx=".5" /><rect x="10.5" y="3" width="3" height="4" rx=".5" /><rect x="2.5" y="9" width="3" height="4" rx=".5" /></Svg>;
export const FlowGrid = () => <Svg><rect x="3" y="3" width="4" height="4" rx=".5" /><rect x="9" y="3" width="4" height="4" rx=".5" /><rect x="3" y="9" width="4" height="4" rx=".5" /><rect x="9" y="9" width="4" height="4" rx=".5" /></Svg>;

export const Eye = () => <Svg><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" /><circle cx="8" cy="8" r="1.8" /></Svg>;
export const EyeOff = () => <Svg><path d="M2 2l12 12" /><path d="M6.4 3.8A6 6 0 0 1 8 3.5c4 0 6.5 4.5 6.5 4.5a11 11 0 0 1-2 2.5M4.2 5.4A11 11 0 0 0 1.5 8S4 12.5 8 12.5a6 6 0 0 0 2.4-.5" /></Svg>;
export const Clip = () => <Svg><path d="M5 2.5H3.5a1 1 0 0 0-1 1V5M11 2.5h1.5a1 1 0 0 1 1 1V5M5 13.5H3.5a1 1 0 0 1-1-1V11M11 13.5h1.5a1 1 0 0 0 1-1V11" /><rect x="5.5" y="5.5" width="5" height="5" rx=".5" /></Svg>;
export const Plus = () => <Svg><path d="M8 3v10M3 8h10" /></Svg>;
export const Minus = () => <Svg><path d="M3 8h10" /></Svg>;
export const Rotate = () => <Svg><path d="M13 8a5 5 0 1 1-1.6-3.7" /><path d="M13 2.5v3h-3" /></Svg>;

// text alignment
export const TextLeft = () => <Svg><path d="M2.5 4h11M2.5 7h7M2.5 10h11M2.5 13h7" /></Svg>;
export const TextCenter = () => <Svg><path d="M2.5 4h11M4.5 7h7M2.5 10h11M4.5 13h7" /></Svg>;
export const TextRight = () => <Svg><path d="M2.5 4h11M6.5 7h7M2.5 10h11M6.5 13h7" /></Svg>;
export const TextJustify = () => <Svg><path d="M2.5 4h11M2.5 7h11M2.5 10h11M2.5 13h7" /></Svg>;
