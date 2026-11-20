import { createHash } from 'node:crypto';
import type { ImageRef, ImageUpload } from '@designer/shared';

export const MAX_IMAGES = 5;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** 5 images of 5 MB as base64 (4/3 larger) plus room for the text and JSON around them. */
export const MAX_WS_PAYLOAD = Math.ceil((MAX_IMAGES * MAX_IMAGE_BYTES * 4) / 3) + 1024 * 1024;

/** The only types we accept. No SVG: it can carry script. */
export const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
export const MIME_BY_EXT: Record<string, string> = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));
export const ID_RE = /^[0-9a-f]{64}$/;

/** What the bytes really are, from the file signature. Never from the declared type or a file name. */
export function sniffImage(b: Buffer): string | undefined {
  const at = (o: number, s: string) => b.length >= o + s.length && b.toString('latin1', o, o + s.length) === s;
  // PNG: signature, then the IHDR chunk (13 bytes of data + CRC), so a cut-off header is refused
  if (b.length >= 33 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && at(12, 'IHDR')) return 'image/png';
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 13 && (at(0, 'GIF87a') || at(0, 'GIF89a'))) return 'image/gif'; // header + logical screen descriptor
  if (b.length >= 20 && at(0, 'RIFF') && at(8, 'WEBP') && (at(12, 'VP8 ') || at(12, 'VP8L') || at(12, 'VP8X'))) return 'image/webp';
  return undefined;
}

export interface CheckedImage extends ImageRef {
  bytes: Buffer;
}

/** Validate what a client sent. Throws an Error whose message is safe to show the user. */
export function checkImages(images: ImageUpload[] | undefined): CheckedImage[] {
  if (!images?.length) return [];
  if (!Array.isArray(images)) throw new Error('Images were not sent correctly.');
  if (images.length > MAX_IMAGES) throw new Error(`You can attach up to ${MAX_IMAGES} images per message.`);
  return images.map((im, i) => {
    const n = images.length > 1 ? `Image ${i + 1}` : 'The image';
    if (!im || typeof im.data !== 'string' || typeof im.mime !== 'string') throw new Error(`${n} was not sent correctly.`);
    if (im.data.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4) throw new Error(`${n} is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
    const bytes = Buffer.from(im.data, 'base64');
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`${n} is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
    const mime = sniffImage(bytes);
    if (!mime || im.mime !== mime) throw new Error(`${n} is not a PNG, JPEG, GIF or WebP picture.`);
    return { id: createHash('sha256').update(bytes).digest('hex'), mime, bytes };
  });
}
