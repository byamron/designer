import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ImageRef } from '@designer/shared';
import { dropDraft, useImageUrl } from './imageFiles';
import type { Draft } from './imageFiles';

/** Thumbnails above the text box, each with a remove button. */
export function DraftThumbs({ drafts, onRemove }: { drafts: Draft[]; onRemove: (key: string) => void }) {
  if (!drafts.length) return null;
  return (
    <ul className="thumbs" aria-label="Attached images">
      {drafts.map((d, i) => (
        <li className="thumb" key={d.key}>
          <img src={d.url} alt={`Attached image ${i + 1}: ${d.name}`} />
          <button className="thumb-x" onClick={() => onRemove(d.key)} aria-label={`Remove image ${i + 1}`}>✕</button>
        </li>
      ))}
    </ul>
  );
}

export function discard(ds: Draft[]) {
  ds.forEach(dropDraft);
}

/** The pictures on a sent message; a click opens the larger view. */
export function MessageImages({ threadId, images }: { threadId: string; images: ImageRef[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  return (
    <>
      <div className="msg-images">
        {images.map((im, i) => (
          <Sent key={im.id + i} threadId={threadId} image={im} n={i + 1} onOpen={(el) => { opener.current = el; setOpen(i); }} />
        ))}
      </div>
      {open !== null && (
        <Viewer threadId={threadId} image={images[open]} opener={opener.current} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

function Sent({ threadId, image, n, onOpen }: { threadId: string; image: ImageRef; n: number; onOpen: (el: HTMLElement) => void }) {
  const url = useImageUrl(threadId, image);
  return (
    <button className="sent-thumb" onClick={(e) => onOpen(e.currentTarget)} aria-label={`Open image ${n} larger`} disabled={!url}>
      {url ? <img src={url} alt="" /> : <span className="thumb-wait">{url === null ? 'Not available' : ''}</span>}
    </button>
  );
}

/** A plain larger view: Esc or a click outside closes it, and focus goes back to the thumbnail. */
function Viewer({ threadId, image, opener, onClose }: { threadId: string; image: ImageRef; opener: HTMLElement | null; onClose: () => void }) {
  const url = useImageUrl(threadId, image);
  const close = useRef<HTMLButtonElement>(null);
  const done = useRef(onClose);
  done.current = onClose;
  useEffect(() => {
    close.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); done.current(); }
      else if (e.key === 'Tab') { e.preventDefault(); close.current?.focus(); } // the close button is the only control
    };
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      opener?.focus(); // focus goes back to the thumbnail that opened it
    };
  }, [opener]);
  return createPortal( // on the page itself, so no scrolling or animated ancestor can clip or re-position it
    <div className="viewer" role="dialog" aria-modal="true" aria-label="Image" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <button ref={close} className="viewer-x" onClick={onClose} aria-label="Close image">✕</button>
      {url ? <img src={url} alt="Attached image, larger" /> : <p className="muted">{url === null ? 'This image is not available.' : 'Loading…'}</p>}
    </div>,
    document.body,
  );
}
