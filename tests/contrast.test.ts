import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** WCAG 2.x contrast of the colour tokens in src/styles.css (AA: 4.5 for text, 3 for large text / UI). */
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

type Rgb = [number, number, number];

function token(name: string): Rgb {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  if (!m?.[1]) throw new Error(`token --${name} not found`);
  return parseColor(m[1].trim());
}

function parseColor(value: string): Rgb {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex?.[1]) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // rgb(r g b / a%) composited over the page background (panels are translucent over a black scene).
  const rgb = /^rgb\((\d+) (\d+) (\d+)(?: \/ (\d+)%)?\)$/.exec(value);
  if (rgb) {
    const a = rgb[4] === undefined ? 1 : Number(rgb[4]) / 100;
    const bg = token('bg');
    return [1, 2, 3].map((i, k) => Number(rgb[i]) * a + (bg[k] ?? 0) * (1 - a)) as Rgb;
  }
  throw new Error(`unsupported colour ${value}`);
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.040_45 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('colour contrast (WCAG AA)', () => {
  const surfaces = ['bg', 'panel-top', 'panel-bottom'] as const;
  for (const surface of surfaces) {
    for (const fg of ['text', 'text-muted', 'accent', 'live', 'paused', 'danger']) {
      it(`--${fg} on --${surface} ≥ 4.5`, () => {
        expect(contrast(token(fg), token(surface))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
  it('--on-accent on --accent (active buttons) ≥ 4.5', () => {
    expect(contrast(token('on-accent'), token('accent'))).toBeGreaterThanOrEqual(4.5);
  });
});
