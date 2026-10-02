/**
 * OpenEXR (half or float, linear) → 8-bit sRGB RGB, for the NASA SVS star maps. Decoded with three's EXRLoader,
 * which runs in Node (no DOM needed for parsing).
 */
import { readFile } from 'node:fs/promises';
import { FloatType } from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';

function linearToSrgb(v: number): number {
  const c = Math.min(1, Math.max(0, v));
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** RGB bytes, top row first (EXR rows are bottom-up in three's loader). `exposure` scales the linear values. */
export async function decodeExr(
  file: string,
  exposure = 1,
): Promise<{ data: Buffer; width: number; height: number }> {
  const buf = await readFile(file);
  const parsed = new EXRLoader()
    .setDataType(FloatType)
    .parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const width = parsed.width ?? 0;
  const height = parsed.height ?? 0;
  if (width === 0 || height === 0) throw new Error(`Empty EXR ${file}`);
  const src = parsed.data as Float32Array;
  const out = Buffer.alloc(width * height * 3);
  // Lookup table on a fine linear grid: the map has 33 Mpixels.
  const LUT_SIZE = 1 << 16;
  const lut = new Uint8Array(LUT_SIZE + 1);
  for (let i = 0; i <= LUT_SIZE; i++) lut[i] = Math.round(linearToSrgb(i / LUT_SIZE) * 255);
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * width * 4;
    const dstRow = y * width * 3;
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        const v = (src[srcRow + x * 4 + c] ?? 0) * exposure;
        out[dstRow + x * 3 + c] = lut[Math.min(LUT_SIZE, Math.max(0, Math.round(v * LUT_SIZE)))] ?? 0;
      }
    }
  }
  return { data: out, width, height };
}
