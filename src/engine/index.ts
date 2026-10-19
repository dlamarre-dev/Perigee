/**
 * Perigee's headless engine (machine interface, phase 1): the same models as the app, without DOM or WebGL, for
 * the embed API, the MCP servers and the docs. Every computed answer carries its provenance (model, sources, data
 * fetch time, element age, validity window, typical accuracy) and the educational-use disclaimer.
 *
 *   const engine = createEngine();            // reads https://perigee.info/data/…
 *   await engine.distance('earth', 'mars', new Date('2026-12-01T00:00:00Z'));
 */
import { MOON_RADIUS_KM } from '../astro/bodies';
import { AU_KM } from '../astro/constants';
import { SUN_RADIUS_KM } from '../astro/planets';
import { length, sub, type Vec3 } from '../astro/vec3';
import { en, fr } from '../i18n';
import { GLOSSARY, LABEL_TERMS, type GlossaryTerm } from '../i18n/glossary';
import { LICENCES } from '../data/licences';
import { PublishedData, type DataOptions } from './data';
import {
  catalogs,
  findInCatalogs,
  imageOf,
  resolve,
  viewOf,
  type FoundObject,
  type ObjectRef,
} from './objects';
import { ACCURACY, ASTRONOMY_ENGINE, CELESTRAK, DISCLAIMER, SIMBAD, type Provenance } from './provenance';
import { EVENT_KINDS, eventsBetween, type EventKind } from './events';
import { skyFrom } from './sky';
import { describeView } from './describeView';
import { compassPoint, degrees, radians, round } from './ground';
import {
  groundPoint,
  meanOrbit,
  osculatingOrbit,
  sunlight,
  type GroundPoint,
  type OrbitDescription,
} from './orbitTools';
import { findPasses, type PassPoint } from './passes';
import { localTime } from './timeFormat';
import { helioState, satelliteElementsAt } from './state';

export { DISCLAIMER, ACCURACY };
export type { Provenance, FoundObject, ObjectRef };

const LIGHT_SPEED_KM_S = 299_792.458;
type Lang = 'en' | 'fr';

export interface StateAnswer {
  readonly id: string;
  readonly date: string;
  /** Reference point of the position: an engine id ("earth", "moon:moon", "mars", "sun"…). */
  readonly centre: string;
  /** Position relative to the centre (EQJ: ICRF/J2000 equator, km) and velocity (km/s); undefined if unknown. */
  readonly positionKm?: Vec3;
  readonly velocityKmS?: Vec3;
  readonly distanceKm?: number;
  readonly distanceAu?: number;
  /** Height above the centre's mean radius (km), when the centre is a body. */
  readonly altitudeKm?: number;
  readonly speedKmS?: number;
  readonly lightTimeS?: number;
  /** Surface point below the object, when the centre is the Earth, the Moon or Mars. */
  readonly groundPoint?: GroundPoint;
  /** Share of the Sun's disc seen from the object past the centre body (1 sunlit, 0 in its shadow). */
  readonly sunlitFraction?: number;
  readonly provenance: readonly Provenance[];
  readonly disclaimer: string;
}

export interface OrbitAnswer extends OrbitDescription {
  readonly id: string;
  readonly date: string;
  readonly provenance: readonly Provenance[];
  readonly disclaimer: string;
}

export interface PassOptions {
  readonly latDeg: number;
  readonly lonDeg: number;
  readonly heightM?: number;
  readonly start?: Date | string;
  /** Length of the search (days, default 3). */
  readonly days?: number;
  /** Lowest culmination reported, and lowest elevation counted as visible (default 10 degrees). */
  readonly minElevationDeg?: number;
  /** IANA time zone for local times (e.g. America/Toronto). */
  readonly timeZone?: string;
}

/** Longest pass search (days): the elements' accuracy fades within days anyway. */
export const MAX_PASS_DAYS = 10;
/** Longest event search (days). */
export const MAX_EVENT_DAYS = 366;

export interface PlaceOptions {
  readonly latDeg: number;
  readonly lonDeg: number;
  readonly heightM?: number;
  readonly timeZone?: string;
}

export { EVENT_KINDS, type EventKind };

function checkPlace(latDeg: number, lonDeg: number): void {
  if (!(Math.abs(latDeg) <= 90) || !(lonDeg >= -180 && lonDeg <= 360))
    throw new Error('latitude must be within 90 degrees of the equator and longitude within -180 to 360');
}

const SKY_PROVENANCE: Provenance = {
  model: 'vsop87',
  method:
    'astronomy-engine: VSOP87 planets, its lunar theory and IAU constellation boundaries, seen from the place with standard refraction; star positions from the catalogue (SIMBAD, J2000, proper motion ignored).',
  state: 'fresh',
  sources: [ASTRONOMY_ENGINE, SIMBAD],
  accuracy: {
    note: 'Positions of the Sun, the Moon and the planets to about an arcminute; rise, set and twilight times to within a minute (refraction near the horizon varies with the weather).',
  },
};

export interface DistanceAnswer {
  readonly from: string;
  readonly to: string;
  readonly date: string;
  readonly distanceKm?: number;
  readonly distanceAu?: number;
  readonly lightTimeS?: number;
  readonly provenance: readonly Provenance[];
  readonly disclaimer: string;
}

export interface SeriesAnswer {
  readonly from: string;
  readonly to: string;
  readonly points: readonly { readonly date: string; readonly distanceKm?: number }[];
  /** Smallest and largest sampled distances (the sampling step bounds their precision). */
  readonly closest?: { readonly date: string; readonly distanceKm: number };
  readonly farthest?: { readonly date: string; readonly distanceKm: number };
  readonly provenance: readonly Provenance[];
  readonly disclaimer: string;
}

export interface ViewLinkOptions {
  readonly date?: Date;
  readonly lang?: Lang;
  /** Simulation speed (1 = real time, 0 = paused). */
  readonly rate?: number;
  readonly follow?: boolean;
  /** Embed mode (no bars or panels), for an iframe. */
  readonly embed?: boolean;
}

/** Default reference point of a position: the body an object orbits or stands on. */
function defaultCentre(ref: ObjectRef): string {
  switch (ref.kind) {
    case 'satellite':
    case 'launch':
      return 'earth';
    case 'site':
      return ref.body === 'moon' ? 'moon:moon' : 'mars';
    case 'mission':
      return ref.mission.centralBody === 'moon' ? 'moon:moon' : ref.mission.centralBody;
    case 'moon':
      return ref.moon.id === 'moon' ? 'earth' : ref.moon.planet;
    default:
      return 'sun';
  }
}

/** Mean radius of a body used as a centre (for altitudes), if it is one. */
function radiusOf(ref: ObjectRef): number | undefined {
  if (ref.kind === 'sun') return SUN_RADIUS_KM;
  if (ref.kind === 'planet') return ref.planet.radiusKm;
  if (ref.kind === 'moon') return ref.moon.id === 'moon' ? MOON_RADIUS_KM : ref.moon.radiusKm;
  if (ref.kind === 'mission' && ref.mission.objectType === 'natural') return ref.mission.radiusKm;
  return undefined;
}

function parseDate(date: Date | string | undefined): Date {
  const d = date === undefined ? new Date() : typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${String(date)}`);
  return d;
}

export class Engine {
  constructor(readonly data: PublishedData) {}

  /** Objects whose name or id matches (catalogues, then active satellites by name, NORAD or COSPAR id). */
  async find(query: string, limit = 10): Promise<FoundObject[]> {
    const found = findInCatalogs(query);
    if (found.length < limit && query.trim().length >= 2) {
      for (const s of await this.data.searchSatellites(query, limit + found.length)) {
        if (found.length >= limit) break;
        if (found.some((f) => f.id === String(s.norad))) continue;
        found.push({ id: String(s.norad), kind: 'satellite', name: { en: s.name, fr: s.name } });
      }
    }
    return found.slice(0, limit);
  }

  /** Facts about an object: names, mission goals and status, identifiers, sources, image, link to its view. */
  async describe(id: string, lang: Lang = 'en'): Promise<Record<string, unknown>> {
    const ref = resolve(id);
    const image = imageOf(ref);
    const base: Record<string, unknown> = {
      id: ref.id,
      kind: ref.kind,
      view: this.viewUrl(ref.id, { lang }),
      embed: this.viewUrl(ref.id, { lang, embed: true }),
      ...(image
        ? {
            image: {
              url: `${this.data.baseUrl}images/${image.id}.webp`,
              large: `${this.data.baseUrl}images/${image.id}-large.webp`,
              kind: image.kind,
              credit: image.credit,
              licence: LICENCES[image.licence].name,
              licenceUrl: LICENCES[image.licence].url,
              source: image.sources[0],
            },
          }
        : {}),
    };
    const localized = (v: { en: string; fr: string } | undefined): string | undefined => v?.[lang];
    switch (ref.kind) {
      case 'mission': {
        const m = ref.mission;
        return {
          ...base,
          name: m.name[lang],
          agency: m.agency,
          country: m.country,
          launchDate: m.launchDate,
          centralBody: m.centralBody,
          status: m.status,
          orbit: localized(m.orbit),
          goals: localized(m.goals),
          notes: localized(m.notes),
          website: m.website,
          horizonsId: m.horizonsId,
          norad: m.norad,
          ephemeris: m.ephemeris,
          verified: m.verified,
          sources: m.sources,
        };
      }
      case 'satellite': {
        const [{ omm: o, entry }, sc] = await Promise.all([
          this.data.satelliteElements(ref.norad),
          this.data.satcatRecord(ref.norad),
        ]);
        const c = ref.curated;
        return {
          ...base,
          name: c?.name[lang] ?? o?.OBJECT_NAME ?? sc?.OBJECT_NAME,
          norad: ref.norad,
          cospar: o?.OBJECT_ID ?? sc?.OBJECT_ID,
          ...(c ? { agency: c.agency, country: c.country } : {}),
          owner: sc?.OWNER,
          launchDate: sc?.LAUNCH_DATE ?? c?.launchDate,
          launchSite: sc?.LAUNCH_SITE,
          objectType: sc?.OBJECT_TYPE,
          status: c?.status ?? sc?.OPS_STATUS_CODE,
          purpose: localized(c?.purpose),
          goals: localized(c?.goals),
          notes: localized(c?.notes),
          website: c?.website,
          elementEpoch: o ? new Date(Date.parse(`${o.EPOCH}Z`)).toISOString() : undefined,
          elementsSource: o?.SOURCE ? `CelesTrak SupGP (${o.SOURCE})` : 'CelesTrak GP',
          dataFetchedAt: entry.fetchedAt,
          active: o !== undefined,
          sources: c?.sources ?? ['https://celestrak.org'],
        };
      }
      case 'moon':
        return {
          ...base,
          name: ref.moon.name[lang],
          planet: ref.moon.planet,
          radiusKm: ref.moon.radiusKm,
          model: ref.moon.model,
          notes: localized(ref.moon.notes),
          sources: ref.moon.sources,
        };
      case 'planet':
        return {
          ...base,
          name: ref.planet.name[lang],
          radiusKm: ref.planet.radiusKm,
          orbitalPeriodDays: ref.planet.periodDays,
          dwarf: ref.planet.dwarf ?? false,
          sources: [
            'https://github.com/cosinekitty/astronomy',
            'https://nssdc.gsfc.nasa.gov/planetary/factsheet/',
          ],
        };
      case 'site':
        return {
          ...base,
          name: ref.site.name[lang],
          body: ref.body,
          type: ref.site.type,
          date: ref.site.date,
          agency: ref.site.agency,
          country: ref.site.country,
          latDeg: ref.site.latDeg,
          lonDeg: ref.site.lonDeg,
          note: localized(ref.site.note),
          sources: ref.site.sources,
        };
      case 'launch':
        return {
          ...base,
          name: ref.site.name[lang],
          operator: ref.site.operator,
          country: ref.site.country,
          latDeg: ref.site.latDeg,
          lonDeg: ref.site.lonDeg,
          firstOrbitalLaunch: ref.site.firstOrbitalLaunch,
          active: ref.site.active,
          satcatCodes: ref.site.satcatCodes,
          sources: ref.site.sources,
        };
      case 'star':
        return {
          ...base,
          name: ref.star.name[lang],
          designation: ref.star.designation,
          constellation: ref.star.constellation[lang],
          spectralType: ref.star.spectralType,
          magnitude: ref.star.magnitude,
          distanceLy: ref.star.distanceLy,
          raDeg: ref.star.raDeg,
          decDeg: ref.star.decDeg,
          notes: localized(ref.star.notes),
          sources: ref.star.sources,
        };
      case 'sun':
        return {
          ...base,
          name: lang === 'fr' ? 'Soleil' : 'Sun',
          radiusKm: SUN_RADIUS_KM,
          sources: ['https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html'],
        };
    }
  }

  /** Position and velocity of an object relative to a centre (default: the body it orbits or stands on). */
  async state(id: string, date?: Date | string, centre?: string): Promise<StateAnswer> {
    const when = parseDate(date);
    const ref = resolve(id);
    const centreRef = resolve(centre ?? defaultCentre(ref));
    const [a, c] = await Promise.all([
      helioState(ref, when, this.data),
      helioState(centreRef, when, this.data),
    ]);
    // Around its own centre an object's position is computed relative to it: the centre's model cancels out.
    const ownCentre = centreRef.kind === 'sun' || centreRef.id === resolve(defaultCentre(ref)).id;
    const provenance = ownCentre ? [a.provenance] : [a.provenance, c.provenance];
    const answer = {
      id: ref.id,
      date: when.toISOString(),
      centre: centreRef.id,
      provenance,
      disclaimer: DISCLAIMER,
    };
    if (!a.state || !c.state) return answer;
    const rel = sub(a.state.posKm, c.state.posKm);
    const vel = sub(a.state.velKmS, c.state.velKmS);
    const distanceKm = length(rel);
    const radius = radiusOf(centreRef);
    // An Earth satellite's own SGP4 state gives its ground point without a frame round trip.
    const ground = groundPoint(centreRef.id, rel, when, centreRef.id === 'earth' ? a.teme?.posKm : undefined);
    const lit =
      radius !== undefined && centreRef.kind !== 'sun'
        ? sunlight(a.state.posKm, c.state.posKm, radius)
        : undefined;
    return {
      ...answer,
      positionKm: rel,
      velocityKmS: vel,
      distanceKm,
      distanceAu: distanceKm / AU_KM,
      ...(radius !== undefined ? { altitudeKm: distanceKm - radius } : {}),
      speedKmS: length(vel),
      lightTimeS: distanceKm / LIGHT_SPEED_KM_S,
      ...(ground ? { groundPoint: ground } : {}),
      ...(lit !== undefined ? { sunlitFraction: round(lit, 3) } : {}),
    };
  }

  /**
   * Orbit of an object: mean SGP4 elements for an Earth satellite; otherwise the instantaneous two-body elements
   * around its centre (default: the body it orbits).
   */
  async orbit(id: string, date?: Date | string, centre?: string): Promise<OrbitAnswer> {
    const when = parseDate(date);
    const ref = resolve(id);
    if (ref.kind === 'satellite' && (centre === undefined || resolve(centre).id === 'earth')) {
      const h = await helioState(ref, when, this.data);
      if (!h.omm) throw new Error(`No published elements for ${ref.id}: ${h.provenance.method}`);
      return {
        id: ref.id,
        date: when.toISOString(),
        ...meanOrbit(h.omm),
        provenance: [h.provenance],
        disclaimer: DISCLAIMER,
      };
    }
    const s = await this.state(id, when, centre);
    const centreRef = resolve(s.centre);
    if (!s.positionKm || !s.velocityKmS)
      throw new Error(`No position for ${ref.id} at ${s.date} (${s.provenance[0]?.state ?? 'unknown'}).`);
    const o = osculatingOrbit(centreRef, s.positionKm, s.velocityKmS, when, radiusOf(centreRef));
    if (!o)
      throw new Error(
        `Orbits are given around the Sun, the planets and the Moon, not around ${centreRef.id}.`,
      );
    return { id: ref.id, date: s.date, ...o, provenance: s.provenance, disclaimer: DISCLAIMER };
  }

  /** Passes of an Earth satellite over a place: rise, culmination and set, and naked-eye visibility. */
  async passes(id: string, options: PassOptions, maxDays = MAX_PASS_DAYS): Promise<Record<string, unknown>> {
    const ref = resolve(id);
    if (ref.kind !== 'satellite')
      throw new Error('Passes are computed for Earth satellites (a NORAD number).');
    const { latDeg, lonDeg } = options;
    checkPlace(latDeg, lonDeg);
    const days = options.days ?? 3;
    if (!(days > 0 && days <= maxDays)) throw new Error(`days must be between 0 and ${maxDays}`);
    const minElevationDeg = options.minElevationDeg ?? 10;
    if (!(minElevationDeg >= 0 && minElevationDeg < 90))
      throw new Error('min_elevation must be between 0 and 90');
    const zone = options.timeZone;
    const local = zone ? localTime(zone) : undefined;
    const start = parseDate(options.start);
    const endMs = start.getTime() + days * 86_400_000;
    // Propagated here directly: no heliocentric position is needed.
    const h = await satelliteElementsAt(ref.norad, start, this.data);
    const satrec = h.satrec;
    if (!h.omm || !satrec) throw new Error(`No usable elements for ${ref.id}: ${h.provenance.method}`);
    const result = findPasses({
      satrec,
      observer: { latRad: radians(latDeg), lonRad: radians(lonDeg), heightKm: (options.heightM ?? 0) / 1000 },
      startMs: start.getTime(),
      endMs,
      minElevationRad: radians(minElevationDeg),
      limit: 60,
    });
    const point = (p: PassPoint): Record<string, unknown> => ({
      time: new Date(p.timeMs).toISOString(),
      ...(local ? { local: local(p.timeMs) } : {}),
      elevationDeg: degrees(p.elevationRad, 1),
      azimuthDeg: degrees(p.azimuthRad, 1),
      direction: compassPoint(p.azimuthRad),
      rangeKm: Math.round(p.rangeKm),
    });
    const epochMs = Date.parse(`${h.omm.EPOCH}Z`);
    return {
      id: ref.id,
      name: ref.curated?.name ?? { en: h.omm.OBJECT_NAME, fr: h.omm.OBJECT_NAME },
      observer: { latDeg, lonDeg, heightM: options.heightM ?? 0 },
      from: start.toISOString(),
      to: new Date(endMs).toISOString(),
      ...(zone ? { timeZone: zone } : {}),
      minElevationDeg,
      ...(result.alwaysAbove && result.atStart
        ? {
            alwaysAboveHorizon: {
              elevationDeg: degrees(result.atStart.elevationRad, 1),
              azimuthDeg: degrees(result.atStart.azimuthRad, 1),
              direction: compassPoint(result.atStart.azimuthRad),
            },
          }
        : {}),
      count: result.passes.length,
      passes: result.passes.map((p) => ({
        rise: point(p.rise),
        culmination: point(p.culmination),
        set: point(p.set),
        durationS: Math.round((p.set.timeMs - p.rise.timeMs) / 1000),
        ...(p.inProgress ? { inProgressAtStart: true } : {}),
        ...(p.unfinished ? { endsAfterWindow: true } : {}),
        visibleToNakedEye: p.visible !== undefined,
        ...(p.visible
          ? {
              visible: {
                from: new Date(p.visible.fromMs).toISOString(),
                to: new Date(p.visible.toMs).toISOString(),
                ...(local ? { localFrom: local(p.visible.fromMs), localTo: local(p.visible.toMs) } : {}),
                maxElevationDeg: degrees(p.visible.maxElevationRad, 1),
              },
            }
          : {}),
        sunElevationDeg: degrees(p.sunElevationRad, 1),
        sunlitShare: round(p.sunlitShare, 2),
      })),
      elementAgeDaysAtEnd: round((endMs - epochMs) / 86_400_000, 2),
      accuracy:
        "Times to within seconds for elements a few days old (low orbits drift by roughly a second per day of element age, more during strong solar activity); azimuth and elevation to a fraction of a degree. Refraction is ignored (it lifts objects by about 0.5 degrees at the horizon). Visible to the naked eye: the satellite is sunlit while the Sun is more than 6 degrees below the observer's horizon, above the minimum elevation; brightness is not estimated.",
      provenance: [h.provenance],
      disclaimer: DISCLAIMER,
    };
  }

  /** Distance between two objects (centre to centre) at a date, with the light time. */
  async distance(fromId: string, toId: string, date?: Date | string): Promise<DistanceAnswer> {
    const when = parseDate(date);
    const [from, to] = [resolve(fromId), resolve(toId)];
    const [a, b] = await Promise.all([helioState(from, when, this.data), helioState(to, when, this.data)]);
    const answer = {
      from: from.id,
      to: to.id,
      date: when.toISOString(),
      provenance: [a.provenance, b.provenance],
      disclaimer: DISCLAIMER,
    };
    if (!a.state || !b.state) return answer;
    const distanceKm = length(sub(a.state.posKm, b.state.posKm));
    return {
      ...answer,
      distanceKm,
      distanceAu: distanceKm / AU_KM,
      lightTimeS: distanceKm / LIGHT_SPEED_KM_S,
    };
  }

  /** Distances sampled over a period (at most 1000 points), with the closest and farthest samples. */
  async series(
    fromId: string,
    toId: string,
    start: Date | string,
    end: Date | string,
    steps = 50,
  ): Promise<SeriesAnswer> {
    const t0 = parseDate(start).getTime();
    const t1 = parseDate(end).getTime();
    const n = Math.max(1, Math.min(1000, Math.round(steps)));
    const points: { date: string; distanceKm?: number }[] = [];
    let provenance: readonly Provenance[] = [];
    for (let i = 0; i <= n; i++) {
      const d = await this.distance(fromId, toId, new Date(t0 + ((t1 - t0) * i) / n));
      if (i === 0 || i === n) provenance = [...provenance, ...d.provenance];
      points.push({ date: d.date, ...(d.distanceKm !== undefined ? { distanceKm: d.distanceKm } : {}) });
    }
    const known = points.filter((p): p is { date: string; distanceKm: number } => p.distanceKm !== undefined);
    const pick = (
      better: (a: number, b: number) => boolean,
    ): { date: string; distanceKm: number } | undefined =>
      known.reduce<{ date: string; distanceKm: number } | undefined>(
        (best, p) => (!best || better(p.distanceKm, best.distanceKm) ? p : best),
        undefined,
      );
    const closest = pick((a, b) => a < b);
    const farthest = pick((a, b) => a > b);
    return {
      from: resolve(fromId).id,
      to: resolve(toId).id,
      points,
      ...(closest ? { closest } : {}),
      ...(farthest ? { farthest } : {}),
      provenance,
      disclaimer: DISCLAIMER,
    };
  }

  /** The sky from a place at a date: Sun and twilights, the Moon and its phase, planets, bright named stars. */
  sky(
    place: PlaceOptions & { readonly date?: Date | string; readonly lang?: Lang },
  ): Record<string, unknown> {
    checkPlace(place.latDeg, place.lonDeg);
    const zone = place.timeZone;
    return {
      ...skyFrom({
        latDeg: place.latDeg,
        lonDeg: place.lonDeg,
        ...(place.heightM !== undefined ? { heightM: place.heightM } : {}),
        date: parseDate(place.date),
        lang: place.lang ?? 'en',
        ...(zone ? { local: localTime(zone) } : {}),
      }),
      ...(zone ? { timeZone: zone } : {}),
      provenance: [SKY_PROVENANCE],
      disclaimer: DISCLAIMER,
    };
  }

  /**
   * Astronomical events over a period (default: the next 30 days): Moon phases and distances, eclipses (also as
   * seen from a place, when given), equinoxes and solstices, perihelion and aphelion, planet oppositions,
   * conjunctions and elongations, and the missions' next key events.
   */
  events(
    options: {
      readonly start?: Date | string;
      readonly days?: number;
      readonly lang?: Lang;
      readonly kinds?: readonly EventKind[];
      readonly place?: PlaceOptions;
    } = {},
    maxDays = MAX_EVENT_DAYS,
  ): Record<string, unknown> {
    const start = parseDate(options.start);
    const days = options.days ?? 30;
    if (!(days > 0 && days <= maxDays)) throw new Error(`days must be between 0 and ${maxDays}`);
    const end = new Date(start.getTime() + days * 86_400_000);
    const place = options.place;
    if (place) checkPlace(place.latDeg, place.lonDeg);
    const zone = place?.timeZone;
    const events = eventsBetween({
      start,
      end,
      lang: options.lang ?? 'en',
      ...(options.kinds ? { kinds: options.kinds } : {}),
      ...(place
        ? {
            observer: {
              latDeg: place.latDeg,
              lonDeg: place.lonDeg,
              ...(place.heightM !== undefined ? { heightM: place.heightM } : {}),
            },
          }
        : {}),
      ...(zone ? { local: localTime(zone) } : {}),
    });
    return {
      from: start.toISOString(),
      to: end.toISOString(),
      ...(place ? { place: { latDeg: place.latDeg, lonDeg: place.lonDeg } } : {}),
      ...(zone ? { timeZone: zone } : {}),
      count: events.length,
      events,
      notes:
        'Times in UTC (and local time when a zone is given); astronomical events from astronomy-engine to within a minute. Supermoon: full Moon nearer than 360,000 km; micromoon: farther than 405,000 km. Mission events come from the curated catalogue (verified date given); a partial date ("2026-11") is placed at the start of its overlap with the period.',
      provenance: [SKY_PROVENANCE],
      disclaimer: DISCLAIMER,
    };
  }

  /**
   * Counts of the active satellites: by owner (country or organisation), operator, CelesTrak group, orbit regime,
   * object type, launch year and low-orbit altitude band. `owner`, `operator` or `group` narrow the lists to the
   * entries whose code or name contains the text; otherwise the `limit` largest of each are given.
   */
  async stats(
    options: {
      readonly lang?: Lang;
      readonly owner?: string;
      readonly operator?: string;
      readonly group?: string;
      readonly limit?: number;
    } = {},
  ): Promise<Record<string, unknown>> {
    const published = await this.data.stats();
    if (!published) throw new Error('The satellite statistics are not published yet.');
    const { stats, entry } = published;
    const lang = options.lang ?? 'en';
    const limit = options.limit ?? 25;
    const fold = (s: string): string =>
      s
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase();
    type Row = (typeof stats.owners)[number];
    const pick = (rows: readonly Row[], filter: string | undefined) => {
      const q = filter ? fold(filter) : undefined;
      const kept = q
        ? rows.filter((r) => fold(r.id) === q || fold(r.name.en).includes(q) || fold(r.name.fr).includes(q))
        : rows.slice(0, limit);
      return {
        count: rows.length,
        ...(q ? {} : { shown: kept.length }),
        rows: kept.map((r) => ({
          id: r.id,
          name: r.name[lang],
          ...(r.country ? { country: r.country } : {}),
          total: r.total,
          regimes: r.regimes,
        })),
      };
    };
    return {
      asOf: stats.asOf,
      total: stats.total,
      regimes: stats.regimes,
      objectTypes: stats.objectTypes,
      owners: pick(stats.owners, options.owner),
      operators: { ...pick(stats.operators, options.operator), withoutOperator: stats.withoutOperator },
      groups: pick(stats.groups, options.group),
      launchYears: stats.launchYears,
      launchedLast30Days: stats.launchedLast30Days,
      launchedLast365Days: stats.launchedLast365Days,
      leoPerigeeBandsKm: stats.leoPerigeeBands,
      staleElements: stats.staleElements,
      supplementalElements: stats.supplementalElements,
      notes:
        'Active satellites as CelesTrak lists them (its "active" group: operational payloads, no debris or rocket bodies). Regimes: LEO apogee below 2000 km, GEO about one revolution a day, HEO eccentricity of 0.25 or more, MEO otherwise. Object types (SATCAT): PAY payload, R/B rocket body, DEB debris, UNK unknown. Owner codes: SATCAT (US, PRC for China, CIS for Russia, ESA…).',
      provenance: [
        {
          model: 'catalogue-counts',
          method:
            'Counted by Perigee’s pipeline from the published CelesTrak elements, SATCAT and group lists.',
          state: 'fresh',
          sources: [CELESTRAK],
          dataFetchedAt: entry.gpFetchedAt ?? stats.asOf,
          accuracy: ACCURACY['catalogue-counts'],
        } satisfies Provenance,
      ],
      disclaimer: DISCLAIMER,
    };
  }

  /**
   * Student-level definitions (EN/FR) of the terms shown in Perigee's panels, with the panel labels they explain;
   * all of them without a term. Matches the term id or a label, ignoring case and accents.
   */
  define(term?: string, lang: Lang = 'en'): { term: string; labels: string[]; definition: string }[] {
    const messages = lang === 'fr' ? fr : en;
    const fold = (s: string): string =>
      s
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase();
    const entries = (Object.keys(GLOSSARY) as GlossaryTerm[]).map((t) => {
      const keys = Object.entries(LABEL_TERMS)
        .filter(([, v]) => v === t)
        .map(([k]) => k as keyof typeof en);
      return {
        term: t,
        labels: [...new Set(keys.map((k) => messages[k]))],
        all: [t, ...keys.flatMap((k) => [en[k], fr[k]])].map(fold),
        definition: GLOSSARY[t][lang],
      };
    });
    const q = term ? fold(term.trim()) : '';
    return entries.filter((e) => !q || e.all.some((s) => s.includes(q))).map(({ all: _all, ...e }) => e);
  }

  /**
   * A Perigee link or embed URL in words (alternative text and a description for lesson notes): view, selected
   * object and how reliable its position is, date and speed of time, frame, filters, what is hidden.
   */
  describeView(link: string, lang: Lang = 'en', timeZone?: string): Promise<Record<string, unknown>> {
    if (timeZone) new Intl.DateTimeFormat('en', { timeZone }); // throws on an unknown zone
    return describeView(this, link, lang, timeZone).then((r) => ({ ...r, disclaimer: DISCLAIMER }));
  }

  /** Link to the view showing an object (optionally at a date, followed, embedded). */
  viewUrl(id: string, options: ViewLinkOptions = {}): string {
    const { view, sel } = viewOf(resolve(id));
    const p = new URLSearchParams();
    if (view !== 'earth') p.set('view', view);
    p.set('sel', sel);
    if (options.lang) p.set('lang', options.lang);
    if (options.date) p.set('t', options.date.toISOString().replace(/\.\d{3}Z$/, 'Z'));
    if (options.rate !== undefined && options.rate !== 1) p.set('rate', String(options.rate));
    if (options.follow) p.set('follow', '1');
    if (options.embed) p.set('embed', '1');
    return `${this.data.baseUrl}?${p.toString()}`;
  }

  /** What every answer rests on: sources, models and their typical accuracy, catalogue dates. */
  async about(): Promise<Record<string, unknown>> {
    const manifest = await this.data.manifest().catch(() => undefined);
    return {
      site: this.data.baseUrl,
      dataGeneratedAt: manifest?.generatedAt,
      datasets: manifest
        ? Object.fromEntries(
            Object.entries(manifest.datasets).map(([k, v]) => [
              k,
              { fetchedAt: v.fetchedAt, source: v.source },
            ]),
          )
        : undefined,
      models: ACCURACY,
      catalogues: {
        missions: catalogs.missions.length,
        scienceSatellites: catalogs.science.length,
        landingSites: catalogs.moonSites.length + catalogs.marsSites.length,
        launchSites: catalogs.launchSites.length,
      },
      frame:
        'Positions are in the ICRF/J2000 equatorial frame (EQJ), in km; centres as named in each answer.',
      attribution:
        'CelesTrak (T.S. Kelso) / 18th & 19th SDS via Space-Track, NASA/JPL-Caltech Horizons, astronomy-engine (MIT), satellite.js (MIT); curated catalogues in https://github.com/dlamarre-dev/Perigee/tree/master/catalog',
      disclaimer: DISCLAIMER,
    };
  }
}

export function createEngine(options: DataOptions = {}): Engine {
  return new Engine(new PublishedData(options));
}
