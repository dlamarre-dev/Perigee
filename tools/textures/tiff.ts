/**
 * Minimal reader for large uncompressed single-band GeoTIFF elevation models (USGS/DLR DEMs): libvips, through
 * sharp, converts signed 16-bit samples to unsigned and clips the negative heights, so these are read directly.
 * Strips only, no compression, 16-bit integer or 32-bit float samples; the grid is box-averaged while it is read
 * (a 23040×11520 model never sits in memory at full size).
 */
import { open } from 'node:fs/promises';

export interface TiffGridOptions {
  /** Output size (the source is averaged down to it). */
  readonly width: number;
  readonly height: number;
  /** Physical units per stored value (GDAL SCALE), and the no-data value to skip. */
  readonly scale: number;
  readonly noData?: number;
}

const TAG = {
  width: 256,
  height: 257,
  bitsPerSample: 258,
  compression: 259,
  stripOffsets: 273,
  samplesPerPixel: 277,
  rowsPerStrip: 278,
  sampleFormat: 339,
} as const;

/** Reads, decodes and averages the grid down to `width`×`height` (row 0 north, as stored). */
export async function readTiffGrid(file: string, o: TiffGridOptions): Promise<Float32Array> {
  const fh = await open(file);
  try {
    const head = Buffer.alloc(16);
    await fh.read(head, 0, 16, 0);
    const le = head.toString('ascii', 0, 2) === 'II';
    const u16 = (b: Buffer, at: number): number => (le ? b.readUInt16LE(at) : b.readUInt16BE(at));
    const u32 = (b: Buffer, at: number): number => (le ? b.readUInt32LE(at) : b.readUInt32BE(at));
    if (u16(head, 2) !== 42) throw new Error(`${file}: not a classic TIFF`);
    const ifdOffset = u32(head, 4);
    const countBuf = Buffer.alloc(2);
    await fh.read(countBuf, 0, 2, ifdOffset);
    const n = u16(countBuf, 0);
    const ifd = Buffer.alloc(n * 12);
    await fh.read(ifd, 0, ifd.length, ifdOffset + 2);
    const tags = new Map<number, { type: number; count: number; value: number }>();
    for (let k = 0; k < n; k++) {
      const e = k * 12;
      const type = u16(ifd, e + 2);
      const count = u32(ifd, e + 4);
      // SHORT values fit in the first half of the value field.
      const value = type === 3 && count === 1 ? u16(ifd, e + 8) : u32(ifd, e + 8);
      tags.set(u16(ifd, e), { type, count, value });
    }
    const get = (tag: number, fallback?: number): number => {
      const t = tags.get(tag);
      if (t === undefined) {
        if (fallback === undefined) throw new Error(`${file}: TIFF tag ${tag} missing`);
        return fallback;
      }
      return t.value;
    };
    const srcW = get(TAG.width);
    const srcH = get(TAG.height);
    const bits = get(TAG.bitsPerSample);
    const format = get(TAG.sampleFormat, 1);
    if (get(TAG.compression, 1) !== 1) throw new Error(`${file}: compressed TIFF not supported`);
    if (get(TAG.samplesPerPixel, 1) !== 1) throw new Error(`${file}: single-band TIFF expected`);
    const rowsPerStrip = get(TAG.rowsPerStrip, srcH);
    const strips = tags.get(TAG.stripOffsets);
    if (!strips) throw new Error(`${file}: no strip offsets (tiled TIFF not supported)`);
    const stripCount = strips.count;
    const offsets: number[] = [];
    if (stripCount === 1) offsets.push(strips.value);
    else {
      const size = strips.type === 3 ? 2 : 4;
      const buf = Buffer.alloc(stripCount * size);
      await fh.read(buf, 0, buf.length, strips.value);
      for (let k = 0; k < stripCount; k++) offsets.push(size === 2 ? u16(buf, k * 2) : u32(buf, k * 4));
    }
    const bytes = bits / 8;
    const sample = (b: Buffer, at: number): number => {
      if (bits === 16 && format === 2) return le ? b.readInt16LE(at) : b.readInt16BE(at);
      if (bits === 16 && format === 1) return le ? b.readUInt16LE(at) : b.readUInt16BE(at);
      if (bits === 32 && format === 3) return le ? b.readFloatLE(at) : b.readFloatBE(at);
      throw new Error(`${file}: unsupported samples (${bits} bits, format ${format})`);
    };

    const sum = new Float64Array(o.width * o.height);
    const count = new Uint32Array(o.width * o.height);
    const colOf = new Uint32Array(srcW);
    for (let i = 0; i < srcW; i++) colOf[i] = Math.min(o.width - 1, Math.floor((i * o.width) / srcW));
    const rowBytes = srcW * bytes;
    const row = Buffer.alloc(rowBytes);
    for (let y = 0; y < srcH; y++) {
      const strip = Math.floor(y / rowsPerStrip);
      const at = (offsets[strip] ?? 0) + (y - strip * rowsPerStrip) * rowBytes;
      await fh.read(row, 0, rowBytes, at);
      const base = Math.min(o.height - 1, Math.floor((y * o.height) / srcH)) * o.width;
      for (let i = 0; i < srcW; i++) {
        const v = sample(row, i * bytes);
        if (v === o.noData || Number.isNaN(v)) continue;
        const k = base + (colOf[i] ?? 0);
        sum[k] = (sum[k] ?? 0) + v;
        count[k] = (count[k] ?? 0) + 1;
      }
    }
    const out = new Float32Array(o.width * o.height);
    for (let k = 0; k < out.length; k++) {
      const c = count[k] ?? 0;
      out[k] = c > 0 ? ((sum[k] ?? 0) / c) * o.scale : Number.NaN;
    }
    return fillGaps(out, o.width, o.height);
  } finally {
    await fh.close();
  }
}

/** Cells without data take the mean of their row (DEM gaps are rare and small; enough for a slope map). */
function fillGaps(grid: Float32Array, w: number, h: number): Float32Array {
  for (let j = 0; j < h; j++) {
    let s = 0;
    let c = 0;
    for (let i = 0; i < w; i++) {
      const v = grid[j * w + i] ?? Number.NaN;
      if (!Number.isNaN(v)) {
        s += v;
        c++;
      }
    }
    const mean = c > 0 ? s / c : 0;
    for (let i = 0; i < w; i++) if (Number.isNaN(grid[j * w + i] ?? Number.NaN)) grid[j * w + i] = mean;
  }
  return grid;
}
