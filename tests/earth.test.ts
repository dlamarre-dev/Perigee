import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import operatorsJson from '../catalog/operators.json';
import { DEFAULT_URL_STATE, parseUrlState, serializeUrlState } from '../src/app/urlState';
import { DEFAULT_EARTH_URL, parseEarthUrl, writeEarthUrl } from '../src/earth/earthUrl';
import { apsides, orbitRegime, periodMin } from '../src/astro/orbit';
import { OmmListSchema, OperatorsCatalogSchema, type SatcatRecord } from '../src/data/schemas';
import { buildCatalog, isStale, parseOmmEpochMs } from '../src/earth/catalog';
import { EMPTY_FILTERS, facetCounts, matchesFilters, NONE } from '../src/earth/filters';
import { SampleTimeline } from '../src/earth/SampleTimeline';
import { makeSatrec, propagateTeme } from '../src/earth/sgp4';
import { nearestId } from '../src/render/GpuPicker';
import { decodePickId, encodePickId } from '../src/render/SatellitePoints';

const operators = OperatorsCatalogSchema.parse(operatorsJson);
const omms = OmmListSchema.parse(
  JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/omm-sample.json'), 'utf8')),
);
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
const catalog = buildCatalog(omms, satcat, { stations: [25544], starlink: [] }, operators);

describe('orbit descriptors', () => {
  it('classifies regimes', () => {
    expect(orbitRegime(15.5, 0.0005)).toBe('LEO');
    expect(orbitRegime(2.005, 0.002)).toBe('MEO'); // GPS
    expect(orbitRegime(1.0027, 0.0002)).toBe('GEO');
    expect(orbitRegime(2.006, 0.72)).toBe('HEO'); // Molniya
  });

  it('computes GEO altitude ≈ 35 786 km and a sidereal-day period', () => {
    const { perigeeAltKm } = apsides(1.00273791, 0);
    expect(perigeeAltKm).toBeGreaterThan(35_700);
    expect(perigeeAltKm).toBeLessThan(35_850);
    expect(periodMin(1.00273791)).toBeCloseTo(1436.07, 1);
  });
});

describe('catalogue with 6-digit NORAD numbers', () => {
  it('parses OMM epochs with microseconds as UTC', () => {
    // Sub-millisecond precision is kept (Date.UTC would truncate it).
    expect(parseOmmEpochMs('2026-09-26T09:35:46.494816')).toBeCloseTo(
      Date.UTC(2026, 8, 26, 9, 35, 46, 494) + 0.816,
      6,
    );
  });

  it('ingests an object with NORAD_CAT_ID ≥ 100000 as an integer', () => {
    const obj = catalog.byNorad.get(100830);
    expect(obj).toBeDefined();
    expect(obj?.noradId).toBe(100830);
    expect(typeof obj?.omm.NORAD_CAT_ID).toBe('number');
  });

  it('propagates the 6-digit object with json2satrec', () => {
    const obj = catalog.byNorad.get(100830);
    const satrec = obj && makeSatrec(obj.omm);
    expect(satrec).toBeDefined();
    const s = satrec && propagateTeme(satrec, new Date('2026-09-26T12:00:00Z'));
    expect(s?.posKm.every(Number.isFinite)).toBe(true);
  });

  it('finds 6-digit objects by exact NORAD number only', () => {
    const f = { ...EMPTY_FILTERS, query: '100830' };
    expect(catalog.objects.filter((o) => matchesFilters(o, f)).map((o) => o.noradId)).toEqual([100830]);
    // "25544" must not match 125544-like numbers, nor partial numbers.
    expect(catalog.objects.filter((o) => matchesFilters(o, { ...EMPTY_FILTERS, query: '1008' }))).toEqual([]);
  });

  it('round-trips a 6-digit selection through the URL', () => {
    const search = serializeUrlState(DEFAULT_URL_STATE, (p) =>
      writeEarthUrl({ ...DEFAULT_EARTH_URL, selected: 100830 }, p),
    );
    expect(search).toBe('?sel=100830');
    expect(parseEarthUrl(new URLSearchParams(search)).selected).toBe(100830);
  });

  it('merges SATCAT and group metadata', () => {
    const iss = catalog.byNorad.get(25544);
    expect(iss?.ownerCode).toBe('ISS');
    expect(iss?.groups).toEqual(['stations']);
    expect(iss?.objectType).toBe('PAY');
    expect(catalog.byNorad.get(20580)?.ownerCode).toBeUndefined();
  });

  it('flags elements older than 14 days as stale', () => {
    const iss = catalog.byNorad.get(25544);
    if (!iss) throw new Error('ISS missing');
    expect(isStale(iss, iss.epochMs + 13 * 86_400_000)).toBe(false);
    expect(isStale(iss, iss.epochMs + 15 * 86_400_000)).toBe(true);
  });
});

describe('filters', () => {
  it('ORs within a facet and ANDs across facets', () => {
    const byOwner = { ...EMPTY_FILTERS, owners: ['ISS', NONE] };
    expect(catalog.objects.filter((o) => matchesFilters(o, byOwner))).toHaveLength(3);
    const andRegime = { ...byOwner, regimes: ['LEO' as const], groups: ['stations'] };
    expect(catalog.objects.filter((o) => matchesFilters(o, andRegime)).map((o) => o.noradId)).toEqual([
      25544,
    ]);
  });

  it('counts facet values', () => {
    expect(facetCounts(catalog.objects, 'owners')).toEqual([
      [NONE, 2],
      ['ISS', 1],
    ]);
  });

  it('round-trips filters through the URL', () => {
    const filters = {
      ...EMPTY_FILTERS,
      operators: ['spacex', 'eutelsat'],
      regimes: ['LEO' as const],
      query: 'star',
    };
    const search = serializeUrlState(DEFAULT_URL_STATE, (p) =>
      writeEarthUrl({ ...DEFAULT_EARTH_URL, filters }, p),
    );
    const state = parseEarthUrl(new URLSearchParams(search));
    expect(parseUrlState(search)).toEqual(DEFAULT_URL_STATE);
    expect(state.filters).toEqual(filters);
  });
});

describe('operators catalogue', () => {
  it('links every group operator to a known operator', () => {
    for (const [group, g] of Object.entries(operators.groups)) {
      if (g.operator) expect(operators.operators[g.operator], group).toBeDefined();
    }
  });
});

describe('SampleTimeline', () => {
  const s = (timeMs: number) => ({ timeMs });

  it('requests now, then ahead of now by rate × latency', () => {
    const tl = new SampleTimeline<{ timeMs: number }>();
    expect(tl.nextRequest(1000, 1, 0)).toBe(1000);
    const epoch = tl.begin();
    expect(tl.nextRequest(1000, 1, 0)).toBeUndefined(); // in flight
    tl.accept(s(1000), epoch, 80);
    const next = tl.nextRequest(1000, 100, 0);
    expect(next).toBeGreaterThan(1000 + 100 * 50);
  });

  it('interpolates inside [A, B] and extrapolates outside', () => {
    const tl = new SampleTimeline<{ timeMs: number }>();
    tl.nextRequest(0, 1, 0);
    tl.accept(s(0), tl.begin(), 50);
    tl.nextRequest(0, 1, 0);
    tl.accept(s(10_000), tl.begin(), 50);
    expect(tl.interpolation(5000)?.tau).toBeCloseTo(0.5);
    expect(tl.interpolation(5000)?.spanS).toBe(10);
    expect(tl.interpolation(12_000)?.tau).toBeGreaterThan(1);
  });

  it('drops samples from before a clock jump', () => {
    const tl = new SampleTimeline<{ timeMs: number }>();
    tl.nextRequest(0, 1, 0);
    const epoch = tl.begin();
    tl.nextRequest(0, 1, 1); // jump
    expect(tl.accept(s(0), epoch, 50)).toBe(false);
    expect(tl.interpolation(0)).toBeUndefined();
  });

  it('stops requesting when paused on the latest sample', () => {
    const tl = new SampleTimeline<{ timeMs: number }>();
    tl.nextRequest(500, 0, 0);
    tl.accept(s(500), tl.begin(), 50);
    expect(tl.nextRequest(500, 0, 0)).toBeUndefined();
    expect(tl.nextRequest(900, 0, 0)).toBe(900);
  });
});

describe('GPU pick encoding', () => {
  it('round-trips indices up to 2^24 − 2', () => {
    const buf = new Uint8Array(3);
    for (const i of [0, 1, 255, 256, 16_620, 100_829, 16_777_214]) {
      encodePickId(i, buf, 0);
      expect(decodePickId(buf[0] ?? 0, buf[1] ?? 0, buf[2] ?? 0)).toBe(i);
    }
    expect(decodePickId(0, 0, 0)).toBeUndefined();
  });

  it('prefers the hit closest to the pointer', () => {
    const size = 5;
    const px = new Uint8Array(size * size * 4);
    encodePickId(7, px, (0 * size + 0) * 4); // corner
    encodePickId(42, px, (2 * size + 3) * 4); // next to centre
    expect(nearestId(px, size)).toBe(42);
  });
});
