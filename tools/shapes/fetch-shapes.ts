/**
 * Offline shape models of small irregular moons → public/shapes/<id>.json (radius grid), read by the client to
 * displace the body sphere (src/render/shapeGeometry.ts). Sources are public PDS Small Bodies Node data:
 * P. Stooke's and P. Thomas's 5° radius grids, R. Gaskell's Phoebe vertex/facet model. Every source becomes a
 * triangle mesh, is optionally rescaled per axis to the IAU triaxial dimensions (Amalthea: Voyager-era shape,
 * Galileo-era size), then sampled on a regular planetocentric grid (east longitude) by ray casting from the
 * centre. One request per file; stop on any non-200 response.
 *
 *   npx tsx tools/shapes/fetch-shapes.ts [id…]
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const USER_AGENT = 'Perigee shape tool (https://github.com/dlamarre-dev/Perigee)';
const D = Math.PI / 180;
const here = dirname(fileURLToPath(import.meta.url));

type Format =
  /** "lon lat radius", longitude positive west (planetary satellites, IAU convention). */
  | 'stooke'
  /** "lat lon radius", longitude positive west. */
  | 'thomas'
  /** "nv", nv × "i x y z" (km), "nf", nf × "i a b c" (1-based). */
  | 'gaskell';

interface ShapeSource {
  readonly url: string;
  readonly format: Format;
  /** Output grid step (degrees). */
  readonly stepDeg: number;
  /** Rescale to these semi-axes (km, body x/y/z). */
  readonly semiAxesKm?: readonly [number, number, number];
  readonly credit: string;
}

const STOOKE = 'https://sbnarchive.psi.edu/pds4/non_mission/small_bodies.stooke.shape-models/data';
const THOMAS = 'https://sbnarchive.psi.edu/pds3/non_mission/EAR_A_5_DDR_SHAPE_MODELS_V2_1/data';

const SHAPES: Record<string, ShapeSource> = {
  amalthea: {
    url: `${STOOKE}/j5amalthea.tab`,
    format: 'stooke',
    stepDeg: 5,
    // Thomas et al. 1998 (Galileo), IAU WGCCRE 2015: 250 × 146 × 128 km.
    semiAxesKm: [125, 73, 64],
    credit:
      'P. Stooke, Small Bodies Shape Models (PDS SBN, doi:10.26033/yt84-5y91); size: Thomas et al. 1998',
  },
  proteus: {
    url: `${STOOKE}/n8proteus.tab`,
    format: 'stooke',
    stepDeg: 5,
    credit: 'P. Stooke, Small Bodies Shape Models (PDS SBN, doi:10.26033/yt84-5y91)',
  },
  hyperion: {
    url: `${THOMAS}/s7hyperion.tab`,
    format: 'thomas',
    stepDeg: 5,
    credit: 'P. Thomas, Shape Models of Asteroids and Satellites V2.1 (PDS SBN, doi:10.26033/g5e0-kh52)',
  },
  phoebe: {
    url: 'https://sbnarchive.psi.edu/pds4/non_mission/gaskell.phoebe.shape-model/data/phoebe_ver64q.tab',
    format: 'gaskell',
    stepDeg: 2,
    credit: 'R. Gaskell, Phoebe Shape Model (PDS SBN, doi:10.26033/ehkj-xj95)',
  },
};

type V = [number, number, number];

async function download(id: string, url: string): Promise<string> {
  const file = join(here, 'src', `${id}${url.slice(url.lastIndexOf('.'))}`);
  if (existsSync(file)) return readFile(file, 'utf8');
  console.log(`fetch   ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (res.status !== 200) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = await res.text();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
  return text;
}

const dir = (latDeg: number, lonEastDeg: number): V => [
  Math.cos(latDeg * D) * Math.cos(lonEastDeg * D),
  Math.cos(latDeg * D) * Math.sin(lonEastDeg * D),
  Math.sin(latDeg * D),
];

/** Triangle mesh of a lat/lon radius grid (rows from −90 to 90, columns from 0 to 360 east). */
function gridMesh(rows: Map<string, number>, stepDeg: number): { v: V[]; f: [number, number, number][] } {
  const nLat = Math.round(180 / stepDeg) + 1;
  const nLon = Math.round(360 / stepDeg);
  const v: V[] = [];
  for (let i = 0; i < nLat; i++) {
    for (let j = 0; j < nLon; j++) {
      const lat = -90 + i * stepDeg;
      const lon = j * stepDeg;
      const r = rows.get(`${lat}|${lon}`);
      if (r === undefined) throw new Error(`missing grid point ${lat} ${lon}`);
      const d = dir(lat, lon);
      v.push([d[0] * r, d[1] * r, d[2] * r]);
    }
  }
  const f: [number, number, number][] = [];
  for (let i = 0; i + 1 < nLat; i++) {
    for (let j = 0; j < nLon; j++) {
      const a = i * nLon + j;
      const b = i * nLon + ((j + 1) % nLon);
      const c = (i + 1) * nLon + j;
      const d = (i + 1) * nLon + ((j + 1) % nLon);
      f.push([a, b, d], [a, d, c]);
    }
  }
  return { v, f };
}

function parse(text: string, format: Format): { v: V[]; f: [number, number, number][] } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (format === 'gaskell') {
    const nv = Number(lines[0]);
    const v: V[] = lines.slice(1, 1 + nv).map((l) => {
      const p = l.split(/\s+/).map(Number);
      return [p[1] ?? 0, p[2] ?? 0, p[3] ?? 0];
    });
    const nf = Number(lines[1 + nv]);
    const f = lines.slice(2 + nv, 2 + nv + nf).map((l) => {
      const p = l.split(/\s+/).map(Number);
      return [(p[1] ?? 1) - 1, (p[2] ?? 1) - 1, (p[3] ?? 1) - 1] as [number, number, number];
    });
    return { v, f };
  }
  const rows = new Map<string, number>();
  for (const l of lines) {
    const p = l.split(/\s+/).map(Number);
    const [lat, lonWest, r] = format === 'stooke' ? [p[1], p[0], p[2]] : [p[0], p[1], p[2]];
    if (lat === undefined || lonWest === undefined || r === undefined || Number.isNaN(r)) continue;
    // West longitude → east, in [0, 360).
    const lonEast = ((-Math.round(lonWest) % 360) + 360) % 360;
    rows.set(`${Math.round(lat)}|${lonEast}`, r);
  }
  return gridMesh(rows, 5);
}

/** Distance from the centre to the mesh along unit direction `d` (Möller–Trumbore, farthest hit). */
function castRay(d: V, v: readonly V[], f: readonly [number, number, number][]): number {
  let best = 0;
  for (const [ia, ib, ic] of f) {
    const a = v[ia];
    const b = v[ib];
    const c = v[ic];
    if (!a || !b || !c) continue;
    const e1: V = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2: V = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const p: V = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det;
    const s: V = [-a[0], -a[1], -a[2]];
    const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * inv;
    if (u < -1e-9 || u > 1 + 1e-9) continue;
    const q: V = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const w = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv;
    if (w < -1e-9 || u + w > 1 + 1e-9) continue;
    const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv;
    if (t > best) best = t;
  }
  return best;
}

async function processShape(id: string, src: ShapeSource): Promise<void> {
  const mesh = parse(await download(id, src.url), src.format);
  if (src.semiAxesKm) {
    const ext = [0, 1, 2].map((k) => Math.max(...mesh.v.map((p) => Math.abs(p[k] ?? 0))));
    const s = src.semiAxesKm.map((target, k) => target / (ext[k] ?? 1));
    mesh.v = mesh.v.map((p) => [p[0] * (s[0] ?? 1), p[1] * (s[1] ?? 1), p[2] * (s[2] ?? 1)]);
  }
  const nLat = Math.round(180 / src.stepDeg) + 1;
  const nLon = Math.round(360 / src.stepDeg);
  const radii: number[] = [];
  for (let i = 0; i < nLat; i++) {
    for (let j = 0; j < nLon; j++) {
      const r = castRay(dir(-90 + i * src.stepDeg, j * src.stepDeg), mesh.v, mesh.f);
      if (r <= 0) throw new Error(`${id}: no hit at ${-90 + i * src.stepDeg} ${j * src.stepDeg}`);
      radii.push(Math.round(r * 100) / 100);
    }
  }
  const extents = [0, 1, 2].map((k) => Math.max(...mesh.v.map((p) => Math.abs(p[k] ?? 0))));
  const out = join(here, '..', '..', 'public', 'shapes', `${id}.json`);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(
    out,
    `${JSON.stringify({ id, stepDeg: src.stepDeg, nLat, nLon, source: src.url, credit: src.credit, radiiKm: radii })}\n`,
  );
  console.log(
    `write   ${out}  (${nLat}×${nLon}, semi-axes ${extents.map((e) => e.toFixed(1)).join(' × ')} km)`,
  );
}

async function main(): Promise<void> {
  const ids = process.argv.slice(2);
  for (const id of ids.length > 0 ? ids : Object.keys(SHAPES)) {
    const src = SHAPES[id];
    if (!src) throw new Error(`Unknown shape ${id} (known: ${Object.keys(SHAPES).join(', ')})`);
    await processShape(id, src);
    await new Promise((ok) => setTimeout(ok, 500));
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
