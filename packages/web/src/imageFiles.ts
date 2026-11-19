import { useEffect, useState } from 'react';
import type { ImageRef, ImageUpload } from '@designer/shared';
import { api } from './auth';

// Limits mirror the server (which checks the real bytes again). No SVG: it can carry script.
export const MAX_IMAGES = 5;
export const MAX_BYTES = 5 * 1024 * 1024;
export const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';
const TYPES = new Set(ACCEPT.split(','));

/** An image the user has added but not yet sent. `url` is a local preview, revoked when the draft is dropped. */
export interface Draft extends ImageUpload { key: string; name: string; url: string }

let counter = 0;

export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Every file in a paste or drop (a screenshot on the clipboard arrives as a file). Non-images are refused in readFiles, with a message. */
export function filesOf(dt: DataTransfer | null): File[] {
  return [...(dt?.files ?? [])];
}

/** Turn files into drafts. Anything refused is reported in plain words, never silently dropped. */
export async function readFiles(files: File[], have: number): Promise<{ drafts: Draft[]; refused: string[] }> {
  const drafts: Draft[] = [];
  const refused: string[] = [];
  for (const f of files) {
    const name = f.name || 'Pasted image';
    if (!TYPES.has(f.type)) refused.push(`${name} is not a PNG, JPEG, GIF or WebP picture.`);
    else if (f.size > MAX_BYTES) refused.push(`${name} is larger than ${MAX_BYTES / 1024 / 1024} MB.`);
    else if (have + drafts.length >= MAX_IMAGES) refused.push(`${name} was not added: up to ${MAX_IMAGES} images per message.`);
    else drafts.push({ key: `d${++counter}`, name, mime: f.type, data: toBase64(await f.arrayBuffer()), url: URL.createObjectURL(f) });
  }
  return { drafts, refused };
}

export const dropDraft = (d: Draft) => URL.revokeObjectURL(d.url);
export const uploads = (ds: Draft[]): ImageUpload[] => ds.map(({ mime, data }) => ({ mime, data }));

// Stored images need the token, which an <img src> cannot send: fetch them and show a blob URL (kept for the session).
const cache = new Map<string, Promise<string>>();
export function imageUrl(threadId: string, ref: ImageRef): Promise<string> {
  const k = `${threadId}/${ref.id}`;
  let p = cache.get(k);
  if (!p) {
    p = api(`/api/attachment/${encodeURIComponent(threadId)}/${ref.id}`)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => URL.createObjectURL(b));
    p.catch(() => cache.delete(k)); // a failed load can be retried
    cache.set(k, p);
  }
  return p;
}

/** `undefined` while loading, `null` if it could not be loaded. */
export function useImageUrl(threadId: string, ref: ImageRef): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    imageUrl(threadId, ref).then((u) => live && setUrl(u), () => live && setUrl(null));
    return () => { live = false; };
  }, [threadId, ref.id]);
  return url;
}
