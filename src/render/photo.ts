/**
 * Photo mode: two PNG images of the 3D view, downloaded together.
 * - "view": the canvas as shown, with the on-screen labels of the objects drawn over it (they are HTML, so they
 *   are painted here from their computed style), without the panels and bars;
 * - "objects only": the same frame rendered again without any point, line or sprite (markers, satellites as
 *   dots, orbits, trajectories, selection rings), keeping only meshes (bodies, 3D models) and the sky.
 * The title (object, date, time and zone) names the files and goes into the PNG's iTXt "Title" field.
 */
import type { Object3D, Scene } from 'three';

/** Objects kept in the "objects only" image although they are points or sprites (starfield, Sun halo). */
export const PHOTO_KEEP = 'photoKeep';

export function keepInPhoto(object: Object3D): void {
  object.userData[PHOTO_KEEP] = true;
}

/** Hides every point, line and sprite of `scene` (except the kept ones); returns the function that restores them. */
export function hideOverlays(scene: Scene): () => void {
  const hidden: Object3D[] = [];
  scene.traverseVisible((o) => {
    const overlay =
      (o as { isPoints?: boolean }).isPoints ||
      (o as { isLine?: boolean }).isLine ||
      (o as { isSprite?: boolean }).isSprite;
    if (overlay && !o.userData[PHOTO_KEEP]) hidden.push(o);
  });
  for (const o of hidden) o.visible = false;
  return () => {
    for (const o of hidden) o.visible = true;
  };
}

/** A 2D copy of the WebGL canvas, taken right after a render (the drawing buffer is not preserved). */
export function copyCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  canvas.getContext('2d')?.drawImage(source, 0, 0);
  return canvas;
}

/**
 * Paints the visible labels inside `root` over `target`, whose pixels map to `area` (the 3D canvas on screen):
 * background, left accent bar and text, from each label's computed style.
 */
export function drawLabels(target: HTMLCanvasElement, root: ParentNode, area: DOMRect): void {
  const ctx = target.getContext('2d');
  if (!ctx || area.width === 0) return;
  const scale = target.width / area.width;
  ctx.save();
  ctx.scale(scale, scale);
  for (const el of root.querySelectorAll<HTMLElement>(
    '.label-layer:not([hidden]) .label[data-shown="true"]',
  )) {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (r.width === 0 || style.visibility === 'hidden' || style.display === 'none') continue;
    const x = r.left - area.left;
    const y = r.top - area.top;
    ctx.globalAlpha = Number(style.opacity) || 1;
    ctx.fillStyle = style.backgroundColor;
    ctx.fillRect(x, y, r.width, r.height);
    const bar = parseFloat(style.borderLeftWidth) || 0;
    if (bar > 0) {
      ctx.fillStyle = style.borderLeftColor;
      ctx.fillRect(x, y, bar, r.height);
    }
    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    (ctx as { letterSpacing?: string }).letterSpacing =
      style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
    ctx.fillStyle = style.color;
    ctx.textBaseline = 'middle';
    const text =
      style.textTransform === 'uppercase' ? (el.textContent ?? '').toUpperCase() : (el.textContent ?? '');
    ctx.fillText(text, x + bar + (parseFloat(style.paddingLeft) || 0), y + r.height / 2);
  }
  ctx.restore();
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** PNG with an iTXt "Title" chunk (UTF-8, so accents survive) inserted after IHDR. */
export function withPngTitle(png: Uint8Array, title: string): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  // keyword \0, compression flag 0, method 0, language tag "" \0, translated keyword "" \0, text.
  const data = new Uint8Array([...enc.encode('Title'), 0, 0, 0, 0, 0, ...enc.encode(title)]);
  const type = enc.encode('iTXt');
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(type, 4);
  chunk.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(type, 0);
  crcInput.set(data, 4);
  view.setUint32(8 + data.length, crc32(crcInput));
  // Signature (8) + IHDR chunk (4 length + 4 type + 13 data + 4 CRC) = 33 bytes.
  const at = 33;
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, at), 0);
  out.set(chunk, at);
  out.set(png.subarray(at), at + chunk.length);
  return out;
}

/** File name from a title: characters Windows, macOS or Linux refuse become "-". */
export function photoFileName(title: string): string {
  return `${title
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()}.png`;
}

/** Encodes `canvas` as PNG with `title`, then downloads it. */
export async function downloadPng(canvas: HTMLCanvasElement, title: string): Promise<void> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG encoding failed');
  const png = withPngTitle(new Uint8Array(await blob.arrayBuffer()), title);
  const url = URL.createObjectURL(new Blob([png], { type: 'image/png' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = photoFileName(title);
  document.body.append(a);
  a.click();
  a.remove();
  // The download has started from the URL; free it a little later.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
