/**
 * Writes deterministic fixture data into dist/data for the Playwright run, using the pipeline's own
 * publishing code. Never touches the network.
 */
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { float64LittleEndian } from '../../pipeline/horizons';
import { publishDatasets, publishEphemerides } from '../../pipeline/publish';
import { MARS_RADIUS_KM, MOON_RADIUS_KM } from '../../src/astro/bodies';
import { GM_KM3_S2, propagateKepler } from '../../src/astro/kepler';
import { utcToTdbJd } from '../../src/astro/time';
import { OmmListSchema, type SatcatRecord } from '../../src/data/schemas';

const dataDir = resolve('dist/data');
const omms = OmmListSchema.parse(JSON.parse(readFileSync(resolve('tests/fixtures/omm-sample.json'), 'utf8')));
const satcat: SatcatRecord[] = [
  {
    NORAD_CAT_ID: 25544,
    OBJECT_NAME: 'ISS (ZARYA)',
    OBJECT_ID: '1998-067A',
    OBJECT_TYPE: 'PAY',
    OPS_STATUS_CODE: '+',
    OWNER: 'ISS',
    LAUNCH_DATE: '1998-11-20',
    LAUNCH_SITE: 'TYMSC',
    PERIOD: 92.9,
    INCLINATION: 51.6,
    APOGEE: 425,
    PERIGEE: 416,
    RCS: null,
  },
];
const fetchedAt = new Date('2026-09-26T12:00:00Z');

await rm(dataDir, { recursive: true, force: true });
await publishDatasets(dataDir, [
  {
    key: 'earth.gp',
    path: 'earth/gp-active.json.gz',
    source: 'fixture',
    fetchedAt,
    count: omms.length,
    payload: omms,
  },
  {
    key: 'earth.satcat',
    path: 'earth/satcat.json.gz',
    source: 'fixture',
    fetchedAt,
    count: 1,
    payload: satcat,
  },
  {
    key: 'earth.groups',
    path: 'earth/groups.json.gz',
    source: 'fixture',
    fetchedAt,
    count: 1,
    payload: { stations: [25544] },
  },
]);

// Synthetic lunar orbiter ephemeris for "lro": 100 km two-body polar orbit, 2 min step, ±2 days around the
// frozen test time. Not real data — only exercises loading, interpolation, picking and the panels.
const MU_MOON = GM_KM3_S2.moon;
const r0 = MOON_RADIUS_KM + 100;
const v0 = Math.sqrt(MU_MOON / r0);
const centreTdbJd = utcToTdbJd(new Date('2026-09-26T12:00:00Z'));
const stepS = 120;
const rows: number[] = [];
for (let k = -1440; k <= 1440; k++) {
  const s = propagateKepler({ posKm: [r0, 0, 0], velKmS: [0, v0 * 0.1, v0 * 0.995] }, k * stepS, MU_MOON);
  rows.push(centreTdbJd + (k * stepS) / 86_400, ...s.posKm, ...s.velKmS);
}
const table = Float64Array.from(rows);
await publishEphemerides(dataDir, [
  {
    missionId: 'lro',
    horizonsId: '-85',
    center: '500@301',
    centralBody: 'moon',
    stepMin: 2,
    source: 'fixture (synthetic Kepler orbit)',
    fetchedAt,
    rows: table,
    bytes: float64LittleEndian(table),
  },
]);

// Synthetic Mars orbiter ("mro", 300 km polar) and Phobos (9 376 km circular, equatorial) around the frozen
// test time. Not real data — only exercises the Mars view.
const MU_MARS = GM_KM3_S2.mars;
function synthetic(radiusKm: number, inclined: boolean, stepS: number, halfSpanS: number): Float64Array {
  const v = Math.sqrt(MU_MARS / radiusKm);
  const out: number[] = [];
  for (let t = -halfSpanS; t <= halfSpanS; t += stepS) {
    const s = propagateKepler(
      { posKm: [radiusKm, 0, 0], velKmS: inclined ? [0, v * 0.1, v * 0.995] : [0, v, 0] },
      t,
      MU_MARS,
    );
    out.push(centreTdbJd + t / 86_400, ...s.posKm, ...s.velKmS);
  }
  return Float64Array.from(out);
}
const mro = synthetic(MARS_RADIUS_KM + 300, true, 120, 2 * 86_400);
const phobos = synthetic(9376, false, 600, 2 * 86_400);
await publishEphemerides(
  dataDir,
  [
    ['mro', '-74', mro, 2],
    ['phobos', '401', phobos, 10],
  ].map(([missionId, horizonsId, rows, stepMin]) => ({
    missionId: missionId as string,
    horizonsId: horizonsId as string,
    center: '500@499',
    centralBody: 'mars' as const,
    stepMin: stepMin as number,
    source: 'fixture (synthetic Kepler orbit)',
    fetchedAt,
    rows: rows as Float64Array,
    bytes: float64LittleEndian(rows as Float64Array),
  })),
);
