/**
 * Re-anchors the mean-element moons of catalog/moons.json on a recent epoch (run by hand, about once a year).
 *
 * JPL's mean orbital elements (https://ssd.jpl.nasa.gov/sats/elem/) are referred to J2000; propagated to today
 * with their rounded periods and without perturbations, the moons drift by tens of degrees (and the Saturnian
 * table does not reproduce Horizons even at J2000). This tool keeps JPL's reference plane, mean motion and
 * precession periods, and replaces the epoch and the epoch angles (e, ω, M, i, Ω) by the two-body elements of
 * the JPL Horizons state at the new epoch, expressed in that plane. The tabulated period is rounded (4 digits
 * for Phobos): the mean motion is then refined so that the longitude also matches Horizons one year later.
 * The browser still computes every position.
 *
 *   npx tsx tools/moons/anchor.ts [YYYY-MM-DD]     (default: today, 0h TDB) — three Horizons requests per moon
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { meanElementsState, referencePlaneEqj } from '../../src/astro/moons';
import { quatConjugate, quatRotate } from '../../src/astro/quat';
import { MoonsCatalogSchema } from '../../src/data/schemas';

const USER_AGENT = 'Perigee moon tool (https://github.com/dlamarre-dev/Perigee)';
const CATALOG = 'catalog/moons.json';
const D = 180 / Math.PI;
const PLANET_CENTER: Record<string, number> = {
  mars: 499,
  jupiter: 599,
  saturn: 699,
  uranus: 799,
  neptune: 899,
  pluto: 999,
};
/** Nix and Hydra are tabulated relative to the Pluto–Charon barycentre. */
const BARYCENTRIC = new Set(['nix', 'hydra']);
/** Baselines of the mean-motion refinement (days): short first, then long. */
const REFINE_DAYS = [10, 365] as const;

type Vec = [number, number, number];

async function horizonsState(
  spkid: number,
  center: number,
  tdbJd: number,
): Promise<{ r: Vec; v: Vec; url: string }> {
  const url =
    `https://ssd.jpl.nasa.gov/api/horizons.api?format=json&COMMAND='${spkid}'&EPHEM_TYPE=VECTORS` +
    `&CENTER='500@${center}'&REF_SYSTEM=ICRF&REF_PLANE=FRAME&OUT_UNITS=KM-S&VEC_TABLE=2&CSV_FORMAT=YES&TLIST='${tdbJd}'`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (res.status !== 200) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = ((await res.json()) as { result: string }).result;
  const row = text.split('$$SOE')[1]?.split('$$EOE')[0]?.trim().split('\n')[0];
  if (!row) throw new Error(`No vectors for ${spkid}: ${text.slice(0, 200)}`);
  const n = row.split(',').slice(2, 8).map(Number);
  return { r: [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0], v: [n[3] ?? 0, n[4] ?? 0, n[5] ?? 0], url };
}

/** Two-body elements (degrees) of a state in the reference plane, with μ from the mean motion. */
export function elementsInPlane(r: Vec, v: Vec, muKm3S2: number) {
  const h: Vec = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]];
  const hn = Math.hypot(...h);
  const i = Math.acos(h[2] / hn);
  const node = Math.atan2(h[0], -h[1]);
  const rn = Math.hypot(...r);
  const rv = r[0] * v[0] + r[1] * v[1] + r[2] * v[2];
  const p = (hn * hn) / muKm3S2;
  const ecos = p / rn - 1;
  const esin = (hn * rv) / (muKm3S2 * rn);
  const e = Math.hypot(ecos, esin);
  const nu = Math.atan2(esin, ecos);
  const u = Math.atan2(r[2] / Math.sin(i), r[0] * Math.cos(node) + r[1] * Math.sin(node));
  const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2));
  const deg = (x: number): number => (((x * D) % 360) + 360) % 360;
  return { e, wDeg: deg(u - nu), MDeg: deg(E - e * Math.sin(E)), iDeg: i * D, nodeDeg: deg(node) };
}

async function main(): Promise<void> {
  const day = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  // 0h TDB of that day, as a Julian date.
  const tdbJd = Date.parse(`${day}T00:00:00Z`) / 86_400_000 + 2440587.5;
  const raw = JSON.parse(readFileSync(CATALOG, 'utf8')) as {
    verified: string;
    moons: Record<string, unknown>[];
  };
  const catalog = MoonsCatalogSchema.parse(raw);
  for (const moon of catalog.moons) {
    const el = moon.elements;
    if (moon.model !== 'mean-elements' || !el) continue;
    const center = BARYCENTRIC.has(moon.id) ? 9 : PLANET_CENTER[moon.planet];
    if (!center) continue;
    const { r, v, url } = await horizonsState(moon.spkid, center, tdbJd);
    const toPlane = quatConjugate(referencePlaneEqj(el));
    const n = el.nDegPerDay / D / 86_400;
    const fit = elementsInPlane(
      quatRotate(toPlane, r) as Vec,
      quatRotate(toPlane, v) as Vec,
      n * n * el.aKm ** 3,
    );
    const entry = raw.moons.find((m) => m['id'] === moon.id) as {
      elements: Record<string, unknown>;
      sources: string[];
      verified: string;
    };
    Object.assign(entry.elements, {
      epochJdTdb: tdbJd,
      e: +fit.e.toFixed(5),
      wDeg: +fit.wDeg.toFixed(3),
      MDeg: +fit.MDeg.toFixed(3),
      iDeg: +fit.iDeg.toFixed(4),
      nodeDeg: +fit.nodeDeg.toFixed(3),
    });
    // One Horizons source per moon, pointing at the anchoring state.
    entry.sources = [
      ...entry.sources.filter((s) => !s.includes('ssd.jpl.nasa.gov/api/horizons.api')),
      url.replace('format=json', 'format=text'),
    ];
    // Mean-motion refinement against Horizons longitudes in the reference plane: a short baseline first (no
    // ambiguity on the number of revolutions), then a long one (precision).
    const lon = (p: Vec): number => {
      const q = quatRotate(toPlane, p);
      return Math.atan2(q[1], q[0]);
    };
    // Retrograde orbits run backwards in the plane's longitude.
    const sense = el.iDeg > 90 ? -1 : 1;
    let nDegPerDay = el.nDegPerDay;
    for (const days of REFINE_DAYS) {
      const later = await horizonsState(moon.spkid, center, tdbJd + days);
      const anchored = { ...el, ...(entry.elements as object), nDegPerDay, epochJdTdb: tdbJd } as typeof el;
      const predicted = meanElementsState(anchored, tdbJd + days).posKm as Vec;
      const d = lon(later.r) - lon(predicted);
      nDegPerDay += (sense * Math.atan2(Math.sin(d), Math.cos(d)) * D) / days;
      await new Promise((ok) => setTimeout(ok, 300));
    }
    entry.elements['nDegPerDay'] = +nDegPerDay.toFixed(9);
    entry.elements['periodDays'] = +(360 / nDegPerDay).toFixed(9);
    entry.verified = day;
    console.log(
      `${moon.id.padEnd(10)} e ${fit.e.toFixed(4)} ω ${fit.wDeg.toFixed(1)} M ${fit.MDeg.toFixed(1)} i ${fit.iDeg.toFixed(2)} Ω ${fit.nodeDeg.toFixed(1)}  n ${nDegPerDay.toFixed(6)} °/d`,
    );
    await new Promise((ok) => setTimeout(ok, 300));
  }
  raw.verified = day;
  writeFileSync(CATALOG, `${JSON.stringify(raw, null, 2)}\n`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
