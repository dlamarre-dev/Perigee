/**
 * Selected-orbit trace of the Earth view: the far trace (rebuilt now and then) and the near stretch (rebuilt every
 * frame) must join, and the near stretch must pass through the object wherever it is between far rebuilds.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Omm } from '../src/data/schemas';
import type * as Sats from '../src/earth/EarthSatellites';
import { makeSatrec, propagateTeme } from '../src/earth/sgp4';

let sats: typeof Sats;
beforeAll(async () => {
  // OrbitLine (imported by EarthSatellites) reads a media query when loaded.
  const matchMedia = () => ({ matches: false, addEventListener: () => undefined });
  vi.stubGlobal('window', { matchMedia });
  sats = await import('../src/earth/EarthSatellites');
});

const ISS = {
  OBJECT_NAME: 'ISS (ZARYA)',
  OBJECT_ID: '1998-067A',
  EPOCH: '2026-10-09T12:00:00.000',
  MEAN_MOTION: 15.5,
  ECCENTRICITY: 0.0004,
  INCLINATION: 51.64,
  RA_OF_ASC_NODE: 200,
  ARG_OF_PERICENTER: 100,
  MEAN_ANOMALY: 50,
  EPHEMERIS_TYPE: 0,
  CLASSIFICATION_TYPE: 'U',
  NORAD_CAT_ID: 25544,
  ELEMENT_SET_NO: 999,
  REV_AT_EPOCH: 1,
  BSTAR: 0.0002,
  MEAN_MOTION_DOT: 0.0001,
  MEAN_MOTION_DDOT: 0,
} as Omm;

const PERIOD_MS = (1440 / 15.5) * 60_000;
const BUILT_MS = Date.parse('2026-10-10T00:00:00Z');

function vertex(a: Float32Array, i: number, centre: readonly number[]): number[] {
  const j = i < 0 ? a.length / 3 + i : i;
  return [0, 1, 2].map((k) => (a[j * 3 + k] ?? NaN) + (centre[k] ?? 0));
}

describe('orbit trace', () => {
  it('near stretch passes through the object and meets the far trace at both ends', () => {
    const satrec = makeSatrec(ISS);
    expect(satrec).toBeDefined();
    if (!satrec) return;
    const built = propagateTeme(satrec, new Date(BUILT_MS))?.posKm ?? [0, 0, 0];
    const far = sats.orbitTraceFar(satrec, BUILT_MS, PERIOD_MS, built);
    expect(far).toBeDefined();
    if (!far) return;
    // Anywhere until the next far rebuild (half a degree of the orbit).
    for (const f of [0, 0.3, 0.999]) {
      const nowMs = BUILT_MS + (PERIOD_MS / 720) * f;
      const now = propagateTeme(satrec, new Date(nowMs))?.posKm ?? [0, 0, 0];
      const near = sats.orbitTraceNear(satrec, BUILT_MS, nowMs, PERIOD_MS, now);
      expect(near).toBeDefined();
      if (!near) return;
      const atObject = Array.from({ length: near.length / 3 }, (_, i) =>
        Math.hypot(...vertex(near, i, [0, 0, 0])),
      );
      expect(Math.min(...atObject)).toBeLessThan(1e-6);
      // Near ends: the far trace's last vertex (just before the stretch) and first one (just after it).
      const gapStart = Math.hypot(
        ...vertex(near, 0, now).map((x, k) => x - (vertex(far, -1, built)[k] ?? 0)),
      );
      const gapEnd = Math.hypot(...vertex(near, -1, now).map((x, k) => x - (vertex(far, 0, built)[k] ?? 0)));
      expect(gapStart).toBeLessThan(0.01);
      expect(gapEnd).toBeLessThan(0.01);
    }
  });
});
