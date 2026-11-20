import { memo, useMemo } from 'react';
import { store } from './store';
import { localUrls } from './localUrls';

/** `http://localhost:5173/` -> `localhost:5173` for the chip label. */
export const shortUrl = (u: string) => u.replace(/^https?:\/\//i, '').replace(/\/$/, '');

/** Local URLs in a message: full URLs anywhere, bare `localhost:3000` only inside code spans and fences. */
export function urlsInMessage(text: string): string[] {
  const out = localUrls(text);
  const code = text.match(/```[\s\S]*?```|`[^`\n]+`/g)?.join('\n') ?? '';
  for (const u of localUrls(code, { code: true })) if (!out.includes(u)) out.push(u);
  return out;
}

/** One-line suggestions under a message or tool output. Clicking opens the pane; nothing opens by itself. */
export const PreviewChips = memo(function PreviewChips({ urls }: { urls: string[] }) {
  if (!urls.length) return null;
  return (
    <div className="preview-chips">
      {urls.slice(0, 3).map((u) => (
        <button key={u} className="preview-chip" onClick={() => store.openPreview(u)}>
          Open {shortUrl(u)} in preview
        </button>
      ))}
    </div>
  );
});

export function MessageChips({ text }: { text: string }) {
  const urls = useMemo(() => urlsInMessage(text), [text]);
  return <PreviewChips urls={urls} />;
}
