// Helpers for browser tests that need pictures: a real PNG, and synthetic paste / drop events.
import { deflateSync } from 'node:zlib';

const crc = (b) => {
  let c = ~0;
  for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
/** A decodable solid-colour PNG. */
export function png(rgb = [255, 0, 0], size = 64) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** files: [{ name, type, base64 }]. Dispatches a real paste event with a DataTransfer holding them; returns whether the page took it over. */
export const paste = (page, files, text) => page.evaluate(([files, text]) => {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0))], f.name, { type: f.type }));
  if (text) dt.setData('text/plain', text);
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  document.querySelector('textarea[aria-label="Message"]').dispatchEvent(ev);
  return ev.defaultPrevented;
}, [files, text]);

export const drop = (page, files) => page.evaluate((files) => {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0))], f.name, { type: f.type }));
  const box = document.querySelector('.composer .box');
  for (const type of ['dragenter', 'dragover', 'drop']) box.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
}, files);

export const pngFile = (name = 'shot.png', rgb) => ({ name, type: 'image/png', base64: png(rgb).toString('base64') });
