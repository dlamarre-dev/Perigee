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

describe('3D models catalogue', () => {
  it('every model target exists, and each model file is published', async () => {
    const { existsSync } = await import('node:fs');
    const models = (await import('../catalog/models.json')).default;
    const marsSites = (await import('../catalog/landing-sites/mars.json')).default;
    const moonsCatalog = (await import('../catalog/moons.json')).default;
    const { ModelsCatalogSchema } = await import('../src/data/schemas');
    const parsed = ModelsCatalogSchema.parse(models);
    const missionIds = new Set(MissionsCatalogSchema.parse(missionsJson).missions.map((m) => m.id));
    const siteIds = new Set([
      ...LandingSitesSchema.parse(marsSites).sites.map((s) => s.id),
      ...LandingSitesSchema.parse(moonSitesJson).sites.map((s) => s.id),
    ]);
    const moonIds = new Set(moonsCatalog.moons.map((m: { id: string }) => m.id));
    const ids = new Set<string>();
    for (const m of parsed.models) {
      expect(ids.has(m.id), m.id).toBe(false);
      ids.add(m.id);
      expect(existsSync(`public/models/${m.id}.glb`), m.id).toBe(true);
      for (const t of m.targets) {
        const [kind, id = ''] = t.split(':');
        if (kind === 'mission') expect(missionIds.has(id), t).toBe(true);
        if (kind === 'site') expect(siteIds.has(id), t).toBe(true);
        if (kind === 'moon') expect(moonIds.has(id), t).toBe(true);
      }
    }
  });
});
