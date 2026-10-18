/**
 * The objects the engine knows, by identifier, from Perigee's curated catalogues (bundled) and the published
 * satellite elements (fetched): the Sun, planets and dwarf planets, moons, spacecraft beyond Earth orbit, Earth
 * satellites (NORAD number), landing and launch sites, named stars. Identifiers follow the app's `sel` URL
 * parameter, so an answer can link to the matching view.
 */
import earthScienceJson from '../../catalog/earth-science.json';
import imagesJson from '../../catalog/images.json';
import launchSitesJson from '../../catalog/launch-sites.json';
import marsSitesJson from '../../catalog/landing-sites/mars.json';
import moonSitesJson from '../../catalog/landing-sites/moon.json';
import missionsJson from '../../catalog/missions.json';
import moonsJson from '../../catalog/moons.json';
import starsJson from '../../catalog/stars.json';
import { PLANETS, type PlanetInfo } from '../astro/planets';
import {
  EarthScienceCatalogSchema,
  ImagesCatalogSchema,
  LandingSitesSchema,
  LaunchSitesSchema,
  MissionsCatalogSchema,
  MoonsCatalogSchema,
  StarsCatalogSchema,
  type EarthScienceSatellite,
  type ImageEntry,
  type LandingSite,
  type LaunchSite,
  type Mission,
  type Moon,
  type Star,
} from '../data/schemas';

export const catalogs = {
  missions: MissionsCatalogSchema.parse(missionsJson).missions,
  science: EarthScienceCatalogSchema.parse(earthScienceJson).satellites,
  moons: MoonsCatalogSchema.parse(moonsJson).moons,
  stars: StarsCatalogSchema.parse(starsJson).stars,
  moonSites: LandingSitesSchema.parse(moonSitesJson).sites,
  marsSites: LandingSitesSchema.parse(marsSitesJson).sites,
  launchSites: LaunchSitesSchema.parse(launchSitesJson).sites,
  images: ImagesCatalogSchema.parse(imagesJson).images,
};

/** A resolved object. Satellites carry only their number here; their elements are fetched on demand. */
export type ObjectRef =
  | { readonly kind: 'sun'; readonly id: 'sun' }
  | { readonly kind: 'planet'; readonly id: string; readonly planet: PlanetInfo }
  | { readonly kind: 'moon'; readonly id: string; readonly moon: Moon }
  | { readonly kind: 'mission'; readonly id: string; readonly mission: Mission }
  | {
      readonly kind: 'satellite';
      readonly id: string;
      readonly norad: number;
      readonly curated?: EarthScienceSatellite;
    }
  | { readonly kind: 'site'; readonly id: string; readonly site: LandingSite; readonly body: 'moon' | 'mars' }
  | { readonly kind: 'launch'; readonly id: string; readonly site: LaunchSite }
  | { readonly kind: 'star'; readonly id: string; readonly star: Star };

export class UnknownObjectError extends Error {
  constructor(id: string) {
    super(`Unknown object "${id}": use find() to look it up by name`);
    this.name = 'UnknownObjectError';
  }
}

/**
 * Resolves an identifier: "sun", a planet id ("mars"), "moon:<id>" or a moon id ("moon", "titan"), a mission id
 * ("lro"), a NORAD number ("25544"), "site:<id>" (Moon or Mars), "launch:<id>", "star:<id>".
 */
export function resolve(id: string): ObjectRef {
  const key = id.trim().toLowerCase();
  if (key === 'sun') return { kind: 'sun', id: 'sun' };
  if (/^\d+$/.test(key)) {
    const norad = Number(key);
    const curated = catalogs.science.find((s) => s.norad === norad);
    return { kind: 'satellite', id: key, norad, ...(curated ? { curated } : {}) };
  }
  const [prefix, rest = ''] = key.includes(':') ? key.split(/:(.*)/s) : ['', key];
  if (prefix === 'site') {
    const moonSite = catalogs.moonSites.find((s) => s.id === rest);
    if (moonSite) return { kind: 'site', id: key, site: moonSite, body: 'moon' };
    const marsSite = catalogs.marsSites.find((s) => s.id === rest);
    if (marsSite) return { kind: 'site', id: key, site: marsSite, body: 'mars' };
  }
  if (prefix === 'launch') {
    const site = catalogs.launchSites.find((s) => s.id === rest);
    if (site) return { kind: 'launch', id: key, site };
  }
  if (prefix === 'star') {
    const star = catalogs.stars.find((s) => s.id === rest);
    if (star) return { kind: 'star', id: key, star };
  }
  if (prefix === 'moon') {
    const moon = catalogs.moons.find((m) => m.id === rest);
    if (moon) return { kind: 'moon', id: `moon:${moon.id}`, moon };
  }
  if (prefix === '') {
    // A plain id is a planet, then a mission, then a moon ("mars" is the planet; "moon" is the Earth's Moon).
    const planet = PLANETS.find((p) => p.id === key);
    if (planet) return { kind: 'planet', id: planet.id, planet };
    const mission = catalogs.missions.find((m) => m.id === key);
    if (mission) return { kind: 'mission', id: mission.id, mission };
    const moon = catalogs.moons.find((m) => m.id === key);
    if (moon) return { kind: 'moon', id: `moon:${moon.id}`, moon };
  }
  throw new UnknownObjectError(id);
}

export interface FoundObject {
  readonly id: string;
  readonly kind: ObjectRef['kind'];
  readonly name: { readonly en: string; readonly fr: string };
}

const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** Catalogue objects matching a text (name in either language or identifier), best matches first. */
export function findInCatalogs(query: string): FoundObject[] {
  const q = fold(query.trim());
  if (!q) return [];
  const all: FoundObject[] = [
    { id: 'sun', kind: 'sun', name: { en: 'Sun', fr: 'Soleil' } },
    ...PLANETS.map((p) => ({ id: p.id, kind: 'planet' as const, name: p.name })),
    ...catalogs.moons.map((m) => ({ id: `moon:${m.id}`, kind: 'moon' as const, name: m.name })),
    ...catalogs.missions.map((m) => ({ id: m.id, kind: 'mission' as const, name: m.name })),
    ...catalogs.science.map((s) => ({ id: String(s.norad), kind: 'satellite' as const, name: s.name })),
    ...catalogs.moonSites.map((s) => ({ id: `site:${s.id}`, kind: 'site' as const, name: s.name })),
    ...catalogs.marsSites.map((s) => ({ id: `site:${s.id}`, kind: 'site' as const, name: s.name })),
    ...catalogs.launchSites.map((s) => ({ id: `launch:${s.id}`, kind: 'launch' as const, name: s.name })),
    ...catalogs.stars.map((s) => ({ id: `star:${s.id}`, kind: 'star' as const, name: s.name })),
  ];
  const score = (o: FoundObject): number => {
    const names = [o.name.en, o.name.fr, o.id].map(fold);
    if (names.some((n) => n === q)) return 3;
    if (names.some((n) => n.startsWith(q))) return 2;
    if (names.some((n) => n.includes(q))) return 1;
    return 0;
  };
  return all
    .map((o) => [o, score(o)] as const)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([o]) => o);
}

/** The panel image of an object, if the catalogue has one (credit and licence included). */
export function imageOf(ref: ObjectRef): ImageEntry | undefined {
  const target =
    ref.kind === 'mission'
      ? `mission:${ref.id}`
      : ref.kind === 'satellite'
        ? `norad:${ref.norad}`
        : ref.kind === 'site'
          ? ref.id
          : ref.kind === 'launch'
            ? ref.id
            : undefined;
  return target ? catalogs.images.find((i) => i.target === target) : undefined;
}

/** The app view showing an object, and its `sel` value there. */
export function viewOf(ref: ObjectRef): { view: 'earth' | 'moon' | 'mars' | 'solar'; sel: string } {
  switch (ref.kind) {
    case 'satellite':
      return { view: 'earth', sel: String(ref.norad) };
    case 'launch':
      return { view: 'earth', sel: `site:${ref.site.id}` };
    case 'site':
      return { view: ref.body, sel: `site:${ref.site.id}` };
    case 'mission':
      return {
        view: ref.mission.centralBody === 'sun' ? 'solar' : ref.mission.centralBody,
        sel: ref.mission.id,
      };
    case 'moon':
      return ref.moon.id === 'moon'
        ? { view: 'earth', sel: 'moon' }
        : { view: 'solar', sel: `moon:${ref.moon.id}` };
    case 'planet':
      return { view: 'solar', sel: ref.planet.id };
    case 'star':
      return { view: 'solar', sel: `star:${ref.star.id}` };
    case 'sun':
      return { view: 'solar', sel: 'sun' };
  }
}
