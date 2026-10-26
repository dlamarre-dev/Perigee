import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkCometCandidates,
  checkCometEphemerides,
  parseSbdbComets,
  type SbdbComet,
} from '../pipeline/audit';
import { float64LittleEndian, parseSmallBodyPhysical } from '../pipeline/horizons';
import { publishSmallBodyEphemerides, readManifest } from '../pipeline/publish';
import cometsJson from '../catalog/comets.json';
import { CometsCatalogSchema } from '../src/data/schemas';

const comets = CometsCatalogSchema.parse(cometsJson).comets;

describe('comet object data from Horizons', () => {
  it('reads the magnitude law and the radius, and leaves out what is missing', () => {
    const header =
      'Comet physical (GM= km^3/s^2; RAD= km):\n   GM= n.a.                RAD= 5.5\n   M1=  5.5      M2=  13.6     k1=  8.     k2=  5.      PHCOF=  .030\n';
    expect(parseSmallBodyPhysical(header)).toEqual({ m1: 5.5, k1: 8, radiusKm: 5.5 });
    expect(parseSmallBodyPhysical('   GM= n.a.  RAD= n.a.\n   M1=  12.3   k1=  4.5\n')).toEqual({
      m1: 12.3,
      k1: 4.5,
    });
    expect(parseSmallBodyPhysical('no object data')).toEqual({});
  });
});

describe('comet ephemerides', () => {
  let dir = '';
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'perigee-comets-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const rows = (n: number): Float64Array =>
    Float64Array.from({ length: n * 7 }, (_, i) => (i % 7 === 0 ? 2461000.5 + i / 7 : 1e8 + i));

  it('writes the vectors with the object data and drops comets left out of the catalogue', async () => {
    const write = (id: string, n: number) => {
      const data = rows(n);
      return {
        bodyId: id,
        horizonsId: `DES=${id};CAP;NOFRAG`,
        stepMin: 1440,
        source: 'test',
        fetchedAt: new Date('2026-10-26T12:00:00Z'),
        rows: data,
        bytes: float64LittleEndian(data),
        m1: 5.5,
        k1: 8,
      };
    };
    await publishSmallBodyEphemerides(
      dir,
      'comets',
      [write('halley', 10), write('old', 10)],
      new Set(['halley', 'old']),
    );
    const m = await publishSmallBodyEphemerides(dir, 'comets', [write('halley', 10)], new Set(['halley']));
    expect(Object.keys(m.comets)).toEqual(['halley']);
    expect(m.comets['halley']).toMatchObject({ count: 10, m1: 5.5, k1: 8, center: '500@10' });
    expect((await readFile(join(dir, 'ephem/comets/halley.bin'))).byteLength).toBe(10 * 56);
    // A much shorter table keeps the previous file (warning only).
    const kept = await publishSmallBodyEphemerides(dir, 'comets', [write('halley', 3)], new Set(['halley']));
    expect(kept.comets['halley']?.count).toBe(10);
    expect((await readManifest(dir)).comets['halley']?.count).toBe(10);
  });
});

describe('comet audit', () => {
  const now = new Date('2026-10-26T00:00:00Z');
  const nowJd = now.getTime() / 86_400_000 + 2440587.5;

  it('parses the SBDB query, numbered comets as "1P", the others with their prefix', () => {
    const json = {
      fields: ['full_name', 'pdes', 'prefix', 'q', 'e', 'tp', 'M1'],
      data: [
        ['    1P/Halley', '1P', 'P', '0.575', '0.9679', '2446469.97', '5.5'],
        ['C/2023 A3 (Tsuchinshan-ATLAS)', '2023 A3', 'C', '0.391', '1.0001', '2460581.2', '8.9'],
        ['P/2026 R2 (Leonard)', '2026 R2', 'P', '0.79', '0.89', '2461338.5', null],
      ],
    };
    expect(parseSbdbComets(json).map((c) => c.designation)).toEqual(['1P', 'C/2023 A3', 'P/2026 R2']);
  });

  it('suggests comets near perihelion that come close or are bright, not the catalogue ones', () => {
    const comet = (designation: string, qAu: number, days: number, m1?: number): SbdbComet => ({
      fullName: designation,
      designation,
      qAu,
      e: 0.99,
      tpTdbJd: nowJd + days,
      ...(m1 !== undefined ? { m1 } : {}),
    });
    const items = checkCometCandidates(
      [
        comet('C/2026 X1', 0.9, 30, 12),
        comet('C/2026 X2', 2.0, -60, 8),
        comet('C/2026 X3', 4.0, 10, 6), // far: faint from the Earth whatever its M1
        comet('C/2026 X4', 0.5, 400, 5), // perihelion too far in time
        comet('C/2026 X5-B', 0.5, 5, 5), // a fragment
        comet('1P', 0.6, 5, 5), // in the catalogue
      ],
      comets,
      now,
    );
    expect(items.map((i) => i.key).sort()).toEqual(['C/2026 X1', 'C/2026 X2']);
    expect(items[0]?.details?.['horizonsId']).toMatch(/^DES=C\/2026 X[12];CAP;NOFRAG$/);
  });

  it('flags comets without recent vectors', async () => {
    const manifest = await readManifest(await mkdtemp(join(tmpdir(), 'perigee-comets-')));
    const items = checkCometEphemerides(manifest, comets.slice(0, 2), now);
    expect(items[0]?.kind).toBe('comet-ephemeris-stale');
    expect(items[0]?.summary).toMatch(/2 comets/);
  });
});
