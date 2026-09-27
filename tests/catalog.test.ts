import { describe, expect, it } from 'vitest';
import missionsJson from '../catalog/missions.json';
import moonSitesJson from '../catalog/landing-sites/moon.json';
import { LandingSitesSchema, MissionsCatalogSchema } from '../src/data/schemas';

describe('curated catalogues', () => {
  const missions = MissionsCatalogSchema.parse(missionsJson);
  const sites = LandingSitesSchema.parse(moonSitesJson);

  it('missions have unique ids and Horizons missions have an id and sampling', () => {
    const ids = missions.missions.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of missions.missions.filter((x) => x.ephemeris === 'horizons')) {
      // Spacecraft and planetary IDs are integers; small bodies use Horizons' "<number>;" designation.
      expect(m.horizonsId, m.id).toMatch(/^-?\d+;?$/);
      expect(m.sampling, m.id).toBeDefined();
    }
  });

  it('every mission and site cites a source', () => {
    for (const m of missions.missions) expect(m.sources.length, m.id).toBeGreaterThan(0);
    for (const s of sites.sites) expect(s.sources.length, s.id).toBeGreaterThan(0);
  });

  it('landing sites have unique ids', () => {
    const ids = sites.sites.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
