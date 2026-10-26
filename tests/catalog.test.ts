import { describe, expect, it } from 'vitest';
import missionsJson from '../catalog/missions.json';
import moonSitesJson from '../catalog/landing-sites/moon.json';
import marsSitesJson from '../catalog/landing-sites/mars.json';
import mercurySitesJson from '../catalog/landing-sites/mercury.json';
import venusSitesJson from '../catalog/landing-sites/venus.json';
import titanSitesJson from '../catalog/landing-sites/titan.json';
import { isInactiveMission, LandingSitesSchema, MissionsCatalogSchema } from '../src/data/schemas';

/** Every landing-site file: `site:<id>` is one namespace across them. */
const ALL_SITES = [moonSitesJson, marsSitesJson, mercurySitesJson, venusSitesJson, titanSitesJson].flatMap(
  (f) => LandingSitesSchema.parse(f).sites,
);

describe('curated catalogues', () => {
  const missions = MissionsCatalogSchema.parse(missionsJson);
  const sites = { sites: ALL_SITES };

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
    const moonsCatalog = (await import('../catalog/moons.json')).default;
    const { ModelsCatalogSchema } = await import('../src/data/schemas');
    const parsed = ModelsCatalogSchema.parse(models);
    const missionIds = new Set(MissionsCatalogSchema.parse(missionsJson).missions.map((m) => m.id));
    const siteIds = new Set(ALL_SITES.map((s) => s.id));
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

describe('panel images catalogue', () => {
  it('every image target exists, has no 3D model, appears once, and each image file is published', async () => {
    const { existsSync } = await import('node:fs');
    const images = (await import('../catalog/images.json')).default;
    const models = (await import('../catalog/models.json')).default;
    const launchSites = (await import('../catalog/launch-sites.json')).default;
    const science = (await import('../catalog/earth-science.json')).default;
    const comets = (await import('../catalog/comets.json')).default;
    const {
      ImagesCatalogSchema,
      ModelsCatalogSchema,
      LaunchSitesSchema,
      EarthScienceCatalogSchema,
      CometsCatalogSchema,
    } = await import('../src/data/schemas');
    const parsed = ImagesCatalogSchema.parse(images);
    const known = new Set([
      ...MissionsCatalogSchema.parse(missionsJson).missions.map((m) => `mission:${m.id}`),
      ...ALL_SITES.map((s) => `site:${s.id}`),
      ...LaunchSitesSchema.parse(launchSites).sites.map((s) => `launch:${s.id}`),
      ...EarthScienceCatalogSchema.parse(science).satellites.map((s) => `norad:${s.norad}`),
      ...CometsCatalogSchema.parse(comets).comets.map((c) => `comet:${c.id}`),
    ]);
    const modelled = new Set(ModelsCatalogSchema.parse(models).models.flatMap((m) => m.targets));
    const targets = new Set<string>();
    for (const i of parsed.images) {
      expect(known.has(i.target), i.target).toBe(true);
      expect(modelled.has(i.target), `${i.target} has a 3D model`).toBe(false);
      expect(targets.has(i.target), i.target).toBe(false);
      targets.add(i.target);
      expect(i.sources[0], i.id).toMatch(/^https:\/\//);
      expect(existsSync(`public/images/${i.id}.webp`), i.id).toBe(true);
      expect(existsSync(`public/images/${i.id}-large.webp`), i.id).toBe(true);
    }
  });
});

describe('mission goals and main pages', () => {
  it('every spacecraft of the other views and every science satellite describes its goals in EN and FR', async () => {
    const science = (await import('../catalog/earth-science.json')).default;
    const { EarthScienceCatalogSchema } = await import('../src/data/schemas');
    const entries = [
      ...MissionsCatalogSchema.parse(missionsJson).missions.filter((m) => m.objectType !== 'natural'),
      ...EarthScienceCatalogSchema.parse(science).satellites,
    ];
    for (const e of entries) {
      expect(e.goals?.en.length ?? 0, e.id).toBeGreaterThan(80);
      expect(e.goals?.fr.length ?? 0, e.id).toBeGreaterThan(80);
      // Quebec typography: a no-break space before ":" only.
      expect(e.goals?.fr, e.id).not.toMatch(/ :|[ \u00a0][;?!]/);
    }
  });
});

describe('active and inactive spacecraft', () => {
  const missions = MissionsCatalogSchema.parse(missionsJson).missions;
  const inactive = (id: string): boolean => {
    const m = missions.find((x) => x.id === id);
    if (!m) throw new Error(`${id} not in the catalogue`);
    return isInactiveMission(m);
  };

  it('lists ended or silent spacecraft apart, never natural bodies', () => {
    expect(inactive('gaia')).toBe(true);
    expect(inactive('dart')).toBe(true);
    expect(inactive('pioneer-10')).toBe(true);
    expect(inactive('voyager-1')).toBe(false);
    expect(inactive('mmx')).toBe(false);
    expect(inactive('ceres')).toBe(false);
    expect(inactive('phobos')).toBe(false);
  });
});
