/**
 * Land outline of the landing pages' ground-track map (src/landing/GroundTrackMap.ts): the Natural Earth 1:110m
 * countries of src/engine/regions.json (public domain, written by ./fetch-regions.ts) as one SVG path in an
 * equirectangular frame (x = longitude + 180, y = 90 − latitude, degrees), points closer than 0.4° dropped.
 *
 *   npx tsx tools/geo/world-outline.ts   → public/landing/world.json
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const MIN_STEP_DEG = 0.4;

interface Regions {
  readonly source: string;
  readonly url: string;
  readonly licence: string;
  readonly countries: readonly { readonly polygons: readonly (readonly (readonly number[])[])[] }[];
}

const fmt = (v: number): string => String(Math.round(v * 10) / 10);

function ringPath(flat: readonly number[]): string | undefined {
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const x = (flat[i] ?? 0) / 100 + 180;
    const y = 90 - (flat[i + 1] ?? 0) / 100;
    const last = pts.at(-1);
    if (!last || Math.hypot(x - last[0], y - last[1]) >= MIN_STEP_DEG) pts.push([x, y]);
  }
  if (pts.length < 3) return undefined;
  return `M${pts.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join('L')}Z`;
}

const regions = JSON.parse(await readFile('src/engine/regions.json', 'utf8')) as Regions;
const parts: string[] = [];
for (const country of regions.countries) {
  for (const polygon of country.polygons) {
    const outer = polygon[0];
    const d = outer && ringPath(outer);
    if (d) parts.push(d);
  }
}
await mkdir('public/landing', { recursive: true });
const out = {
  source: regions.source,
  url: regions.url,
  licence: regions.licence,
  viewBox: '0 0 360 180',
  d: parts.join(''),
};
await writeFile('public/landing/world.json', `${JSON.stringify(out)}\n`);
console.log(`public/landing/world.json: ${parts.length} rings, ${(out.d.length / 1024).toFixed(0)} KiB`);
