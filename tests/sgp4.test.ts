/**
 * SGP4 reference tests (CLAUDE.md §12).
 *
 * Fixtures: Vallado et al., "Revisiting Spacetrack Report #3", AIAA 2006-6753 — SGP4-VER.TLE and
 * tcppver.out, redistributed with python-sgp4 (MIT). The reference cases are TLEs by nature, so this is
 * the one place where twoline2satrec is used; the OMM path (json2satrec) is checked separately.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gstime, eciToEcf, sgp4, twoline2satrec } from 'satellite.js';
import { describe, expect, it } from 'vitest';
import { eciToEcef } from '../src/astro/frames';
import { gmstRad } from '../src/astro/time';
import { length, sub } from '../src/astro/vec3';
import { OmmListSchema, type Omm } from '../src/data/schemas';
import { makeSatrec, propagateTeme } from '../src/earth/sgp4';

const fixtures = resolve(import.meta.dirname, 'fixtures');

interface RefCase {
  readonly line1: string;
  readonly line2: string;
  readonly rows: { tsinceMin: number; r: [number, number, number]; v: [number, number, number] }[];
}

/** Catalogue numbers appear as "00005" in the TLE file and "5" in tcppver.out. */
function normalizeId(id: string): string {
  return String(Number(id.trim()));
}

/**
 * 33334 is an error-code test (mean motion 0.00001 rev/day). Vallado's C++ prints the t = 0 state before
 * flagging error 2; satellite.js reports the error immediately, which is the behaviour we rely on.
 */
const EXPECTED_ERROR_CASES = new Set(['33334']);

function loadVallado(): Map<string, RefCase> {
  const tle = readFileSync(resolve(fixtures, 'vallado/SGP4-VER.TLE'), 'utf8').split(/\r?\n/);
  const lines1 = new Map<string, string>();
  const cases = new Map<string, RefCase>();
  for (const line of tle) {
    if (line.startsWith('1 ')) lines1.set(normalizeId(line.slice(2, 7)), line);
    if (line.startsWith('2 ')) {
      const id = normalizeId(line.slice(2, 7));
      const line1 = lines1.get(id);
      if (line1) cases.set(id, { line1, line2: line.slice(0, 69), rows: [] });
    }
  }
  let current: RefCase | undefined;
  for (const line of readFileSync(resolve(fixtures, 'vallado/tcppver.out'), 'utf8').split(/\r?\n/)) {
    const header = /^\s*(\S+)\s+xx\s*$/.exec(line);
    if (header) {
      current = cases.get(normalizeId(header[1] ?? ''));
      continue;
    }
    const n = line.trim().split(/\s+/).map(Number);
    if (!current || n.length < 7 || n.slice(0, 7).some(Number.isNaN)) continue;
    const [t, x, y, z, vx, vy, vz] = n as [number, number, number, number, number, number, number];
    current.rows.push({ tsinceMin: t, r: [x, y, z], v: [vx, vy, vz] });
  }
  return new Map([...cases].filter(([id, c]) => c.rows.length > 0 && !EXPECTED_ERROR_CASES.has(id)));
}

const vallado = loadVallado();

describe('SGP4 vs Vallado SGP4-VER reference (tcppver.out)', () => {
  it('loads the verification set', () => {
    expect(vallado.size).toBeGreaterThan(25);
  });

  for (const [id, c] of vallado) {
    it(`catalogue ${id}: position error < 1 m over ${c.rows.length} steps`, () => {
      const satrec = twoline2satrec(c.line1, c.line2);
      let maxErrKm = 0;
      for (const row of c.rows) {
        const pv = sgp4(satrec, row.tsinceMin);
        expect(pv, `propagation failed at ${row.tsinceMin} min`).not.toBeNull();
        if (!pv) continue;
        const err = length(sub([pv.position.x, pv.position.y, pv.position.z], row.r));
        maxErrKm = Math.max(maxErrKm, err);
      }
      expect(maxErrKm).toBeLessThan(0.001);
    });
  }
});

describe('OMM path (json2satrec)', () => {
  it('reproduces the Vallado 00005 TEME case from equivalent OMM elements (< 1 m)', () => {
    // TLE epoch 00179.78495062 → 2000-06-27T18:50:19.733568 UTC.
    const omm: Omm = {
      OBJECT_NAME: 'VALLADO 00005',
      OBJECT_ID: '1958-002B',
      EPOCH: '2000-06-27T18:50:19.733568',
      MEAN_MOTION: 10.82419157,
      ECCENTRICITY: 0.1859667,
      INCLINATION: 34.2682,
      RA_OF_ASC_NODE: 348.7242,
      ARG_OF_PERICENTER: 331.7664,
      MEAN_ANOMALY: 19.3264,
      EPHEMERIS_TYPE: 0,
      CLASSIFICATION_TYPE: 'U',
      NORAD_CAT_ID: 5,
      ELEMENT_SET_NO: 475,
      REV_AT_EPOCH: 41366,
      BSTAR: 0.28098e-4,
      MEAN_MOTION_DOT: 0.00000023,
      MEAN_MOTION_DDOT: 0,
    };
    const satrec = makeSatrec(omm);
    expect(satrec).toBeDefined();
    const ref = vallado.get('5');
    expect(ref).toBeDefined();
    for (const row of ref?.rows ?? []) {
      const pv = satrec && sgp4(satrec, row.tsinceMin);
      expect(pv).toBeTruthy();
      if (!pv) continue;
      expect(length(sub([pv.position.x, pv.position.y, pv.position.z], row.r))).toBeLessThan(0.001);
    }
  });
});

describe('TEME → ECEF (GMST rotation only)', () => {
  it('matches Vallado example 3-15 within 1 km', () => {
    // Vallado, Fundamentals of Astrodynamics, 4th ed., example 3-15 (2004-04-06 07:51:28.386009 UTC).
    const date = new Date(Date.UTC(2004, 3, 6, 7, 51, 28, 386.009));
    const rTeme: [number, number, number] = [5094.1801621, 6127.6446595, 6380.3445327];
    const rItrf: [number, number, number] = [-1033.479383, 7901.2952754, 6380.3565958];
    const rEcef = eciToEcef(rTeme, gmstRad(date));
    // Residual comes from neglected polar motion and UT1 − UTC (−0.44 s) — a few hundred metres.
    expect(length(sub(rEcef, rItrf))).toBeLessThan(1);
  });

  it('agrees with satellite.js (gstime + eciToEcf) for the ISS', () => {
    const omms = OmmListSchema.parse(JSON.parse(readFileSync(resolve(fixtures, 'omm-sample.json'), 'utf8')));
    const iss = omms.find((o) => o.NORAD_CAT_ID === 25544);
    const satrec = iss && makeSatrec(iss);
    expect(satrec).toBeDefined();
    if (!satrec) return;
    const date = new Date('2026-09-26T12:00:00Z');
    const s = propagateTeme(satrec, date);
    expect(s).toBeDefined();
    if (!s) return;
    const ours = eciToEcef(s.posKm, gmstRad(date));
    const lib = eciToEcf({ x: s.posKm[0], y: s.posKm[1], z: s.posKm[2] }, gstime(date));
    expect(length(sub(ours, [lib.x, lib.y, lib.z]))).toBeLessThan(0.001);
    const altitudeKm = length(s.posKm) - 6378.137;
    expect(altitudeKm).toBeGreaterThan(370);
    expect(altitudeKm).toBeLessThan(460);
  });
});
