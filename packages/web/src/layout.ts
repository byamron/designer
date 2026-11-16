import { useCallback, useEffect, useState } from 'react';

export interface Layout {
  open: boolean;
  side: 'right' | 'left'; // which side the PREVIEW is on
  chatW: number; // px
}
const KEY = 'designer.layout';
export const MIN_CHAT = 320;
const DEFAULT: Layout = { open: false, side: 'right', chatW: 440 };

function load(): Layout {
  try {
    return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULT;
  }
}

export function useLayout() {
  const [layout, setLayout] = useState<Layout>(load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(layout));
    } catch {
      /* storage unavailable: layout just won't persist */
    }
  }, [layout]);
  const patch = useCallback((p: Partial<Layout>) => setLayout((l) => ({ ...l, ...p })), []);
  return [layout, patch] as const;
}

/** Chat width is capped at half the container so the preview always gets the larger share. */
export const clampChat = (w: number, container: number) => Math.round(Math.max(MIN_CHAT, Math.min(w, container / 2)));
