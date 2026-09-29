import { describe, expect, it } from 'vitest';
import moonsJson from '../catalog/moons.json';
import { meanElementsState, moonState, solveKepler } from '../src/astro/moons';
import { length, type Vec3 } from '../src/astro/vec3';
import { MoonsCatalogSchema } from '../src/data/schemas';

const moons = MoonsCatalogSchema.parse(moonsJson).moons;
const byId = (id: string) => {
  const m = moons.find((x) => x.id === id);
  if (!m) throw new Error(`missing ${id}`);
  return m;
};
const angleDeg = (a: Vec3, b: Vec3): number =>
  (Math.acos(Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / length(a) / length(b))) * 180) / Math.PI;

/**
 * JPL Horizons planet-centred ICRF positions (km) at JD 2461450.5 TDB (2027-02-14), about 4.5 months after the
 * catalog anchoring epoch (tools/moons/anchor.ts).
 */
const TDB_JD = 2461450.5;
const DATE = new Date((TDB_JD - 2440587.5) * 86_400_000 - 69_184);
const HORIZONS: Record<string, Vec3> = {
  titan: [-1.050536774373186e6, -6.575206060446347e5, 1.371603861336126e5],
  triton: [1.784006075999236e5, -1.781416230354151e4, -3.061673382463024e5],
  phobos: [2.866366279617479e3, 8.400492803219415e3, 2.554795773737225e3],
  ariel: [3.792196518476442e4, 4.214656082349774e4, -1.822225417426716e5],
  nereid: [4.298806130550298e6, 1.938937583669132e6, 1.276778689552517e6],
  ganymede: [8.034891153698524e5, 6.31509865173767e5, 3.16034430533051e5],
  moon: [2.39231899695603e5, 2.518574222651036e5, 1.471030995723586e5],
};

describe('moons', () => {
  it('solves Kepler’s equation', () => {
    for (const e of [0, 0.1, 0.5, 0.75, 0.95]) {
      for (const M of [-3, -1, 0, 0.5, 2, 3.1]) {
        const E = solveKepler(M, e);
        const back = E - e * Math.sin(E);
        expect(Math.abs(Math.atan2(Math.sin(back - M), Math.cos(back - M)))).toBeLessThan(1e-10);
      }
    }
  });

  it('matches JPL Horizons within a few degrees (mean elements) or much better (astronomy-engine)', () => {
    for (const [id, ref] of Object.entries(HORIZONS)) {
      const m = byId(id);
      const s = moonState(m, DATE, TDB_JD);
      expect(s, id).toBeDefined();
      if (!s) continue;
      const tolerance = m.model === 'astronomy-engine' ? 0.1 : 3;
      expect(angleDeg(s.posKm, ref), id).toBeLessThan(tolerance);
      expect(Math.abs(length(s.posKm) / length(ref) - 1), id).toBeLessThan(m.id === 'nereid' ? 0.02 : 0.01);
    }
  });

  it('keeps the orbit radius within the periapsis/apoapsis range', () => {
    for (const m of moons) {
      const el = m.elements;
      if (!el || m.model !== 'mean-elements') continue;
      for (const dt of [0, 12.3, 400, -900]) {
        const r = length(meanElementsState(el, el.epochJdTdb + dt).posKm);
        expect(r, m.id).toBeGreaterThanOrEqual(el.aKm * (1 - el.e) * 0.999);
        expect(r, m.id).toBeLessThanOrEqual(el.aKm * (1 + el.e) * 1.001);
      }
    }
  });

  it('lists every moon under a planet of the solar view, with sources', () => {
    for (const m of moons) {
      expect(['earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto']).toContain(m.planet);
      expect(m.sources.length).toBeGreaterThan(0);
    }
  });
});
