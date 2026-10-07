import { describe, expect, it } from 'vitest';
import { photoFileName, withPngTitle } from '../src/render/photo';

/** Smallest valid PNG header: signature + IHDR (1×1, RGBA) + IEND, enough to check chunk insertion. */
function tinyPng(): Uint8Array {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0,
    1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

describe('photo files', () => {
  it('puts the title in an iTXt chunk right after IHDR, with a valid CRC', () => {
    const out = withPngTitle(tinyPng(), 'Périgée — Mars');
    const text = new TextDecoder().decode(out.subarray(33));
    expect(text.startsWith('\u0000\u0000\u0000')).toBe(true);
    expect(new TextDecoder().decode(out.subarray(37, 41))).toBe('iTXt');
    expect(text).toContain('Title');
    expect(text).toContain('Périgée — Mars');
    const length = new DataView(out.buffer).getUint32(33);
    // CRC-32 of "iTXt" + data, checked against an independent implementation.
    const crcInput = out.subarray(37, 41 + length);
    let c = 0xffffffff;
    for (const b of crcInput) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    expect(new DataView(out.buffer).getUint32(41 + length)).toBe((c ^ 0xffffffff) >>> 0);
    // IEND still closes the file.
    expect(new TextDecoder().decode(out.subarray(out.length - 8, out.length - 4))).toBe('IEND');
  });

  it('turns a title into a file name every system accepts', () => {
    expect(photoFileName('Périgée — ISS — 2026-10-07 10:30:00 HAE')).toBe(
      'Périgée — ISS — 2026-10-07 10-30-00 HAE.png',
    );
    expect(photoFileName('A/B: "c"?')).toBe('A-B- -c--.png');
  });
});
