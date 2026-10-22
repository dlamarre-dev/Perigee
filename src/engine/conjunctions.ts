/**
 * Apparent close pairings in the sky seen from a place (machine interface): the Moon and the planets with each
 * other and with the bright stars near the ecliptic, and optionally an Earth satellite passing near them. Topocentric
 * J2000 directions from astronomy-engine (the Moon's parallax counts: up to a degree), stars from the catalogue
 * (SIMBAD, J2000). The planets are sampled every 6 hours and the Moon every hour (planets in between interpolated
 * along the arc); each minimum of separation is then timed by golden-section search to about a minute.
 */
import * as Astronomy from 'astronomy-engine';
import { PLANETS } from '../astro/planets';
import { isBrightStar } from '../astro/stars';
import { dot, normalize, type Vec3 } from '../astro/vec3';
import type { SatRec } from 'satellite.js';
import { gmstRad } from '../astro/time';
import { propagateTeme } from '../earth/sgp4';
import { EARTH_EQUATORIAL_RADIUS_KM } from '../astro/constants';
import { catalogs } from './objects';
import { earthShadowFraction } from './shadow';
import { compassPoint, ecefFromGeodetic, round } from './ground';
import { findPasses, lookAngles, sunTeme, temeToEcef, DARK_SUN_ELEVATION_RAD, type Observer } from './passes';

type Lang = 'en' | 'fr';
type Localized = { readonly en: string; readonly fr: string };

const DEG = Math.PI / 180;
const HOUR_MS = 3_600_000;
const PLANET_STEP_MS = 6 * HOUR_MS;
const MOON_STEP_MS = HOUR_MS;
/** Stars taken: magnitude 1.5 or brighter, within 10° of the ecliptic (where the Moon and planets pass). */
const STAR_MAX_MAGNITUDE = 1.5;
const STAR_MAX_ECLIPTIC_LAT_DEG = 10;

interface Target {
  readonly id: string;
  readonly name: Localized;
  readonly kind: 'moon' | 'planet' | 'star';
  readonly body?: Astronomy.Body;
  /** Fixed direction (stars, J2000). */
  readonly fixed?: Vec3;
  readonly magnitude?: number;
}

const unitFromRaDec = (raHours: number, decDeg: number): Vec3 => {
  const ra = raHours * 15 * DEG;
  const dec = decDeg * DEG;
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
};

function targets(): Target[] {
  const moon: Target = {
    id: 'moon',
    name: { en: 'Moon', fr: 'Lune' },
    kind: 'moon',
    body: Astronomy.Body.Moon,
  };
  const planets: Target[] = PLANETS.filter((p) => !p.dwarf && p.id !== 'earth').map((p) => ({
    id: p.id,
    name: p.name,
    kind: 'planet',
    body: p.body,
  }));
  const stars: Target[] = catalogs.stars
    .filter((s) => isBrightStar(s) && s.magnitude <= STAR_MAX_MAGNITUDE)
    .filter((s) => {
      const v = Astronomy.VectorFromSphere(
        new Astronomy.Spherical(s.decDeg, s.raDeg, 1),
        Astronomy.MakeTime(0),
      );
      const ecl = Astronomy.Ecliptic(v);
      return Math.abs(ecl.elat) <= STAR_MAX_ECLIPTIC_LAT_DEG;
    })
    .map((s) => ({
      id: `star:${s.id}`,
      name: s.name,
      kind: 'star',
      fixed: unitFromRaDec(s.raDeg / 15, s.decDeg),
      magnitude: s.magnitude,
    }));
  return [moon, ...planets, ...stars];
}

const separationDeg = (a: Vec3, b: Vec3): number => Math.acos(Math.min(1, Math.max(-1, dot(a, b)))) / DEG;

export interface ConjunctionOptions {
  readonly latDeg: number;
  readonly lonDeg: number;
  readonly heightM?: number;
  readonly startMs: number;
  readonly endMs: number;
  /** Pairings closer than this are kept (degrees). */
  readonly maxSeparationDeg: number;
  readonly lang: Lang;
  readonly local?: (ms: number) => string;
  /** An Earth satellite: its passes above the place are checked against the Moon, the planets and the stars. */
  readonly satellite?: { readonly id: string; readonly name: Localized; readonly satrec: SatRec };
  readonly satelliteMaxSeparationDeg?: number;
}

/** Sky conjunctions in the window, in time order. */
export function skyConjunctions(o: ConjunctionOptions): Record<string, unknown>[] {
  const observer = new Astronomy.Observer(o.latDeg, o.lonDeg, o.heightM ?? 0);
  const list = targets();
  const direction = (t: Target, ms: number): Vec3 => {
    if (t.fixed) return t.fixed;
    const eq = Astronomy.Equator(
      t.body ?? Astronomy.Body.Sun,
      Astronomy.MakeTime(new Date(ms)),
      observer,
      false,
      true,
    );
    return unitFromRaDec(eq.ra, eq.dec);
  };
  // Planet directions every 6 h, interpolated along the arc in between (they move a fraction of a degree a day).
  const planetCache = new Map<string, Vec3>();
  const planetAt = (t: Target, ms: number): Vec3 => {
    const k0 = Math.floor(ms / PLANET_STEP_MS) * PLANET_STEP_MS;
    const get = (k: number): Vec3 => {
      const key = `${t.id}@${k}`;
      let v = planetCache.get(key);
      if (!v) planetCache.set(key, (v = direction(t, k)));
      return v;
    };
    const a = get(k0);
    const b = get(k0 + PLANET_STEP_MS);
    const f = (ms - k0) / PLANET_STEP_MS;
    return normalize([a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])]);
  };
  // The Moon's direction at each time once, shared by all its pairings.
  const moonCache = new Map<number, Vec3>();
  const moonAt = (t: Target, ms: number): Vec3 => {
    let v = moonCache.get(ms);
    if (!v) moonCache.set(ms, (v = direction(t, ms)));
    return v;
  };
  const at = (t: Target, ms: number): Vec3 =>
    t.kind === 'planet' ? planetAt(t, ms) : t.kind === 'moon' ? moonAt(t, ms) : direction(t, ms);

  const found: Record<string, unknown>[] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (!a || !b || (a.kind === 'star' && b.kind === 'star')) continue;
      const step = a.kind === 'moon' || b.kind === 'moon' ? MOON_STEP_MS : PLANET_STEP_MS;
      const sep = (ms: number): number => separationDeg(at(a, ms), at(b, ms));
      const samples: { t: number; s: number }[] = [];
      for (let t = o.startMs; t <= o.endMs; t += step) samples.push({ t, s: sep(t) });
      samples.forEach((cur, k) => {
        const prev = samples[k - 1];
        const next = samples[k + 1];
        if ((prev && cur.s > prev.s) || (next && cur.s >= next.s)) return;
        if (cur.s > o.maxSeparationDeg + 2) return;
        // Golden-section search between the neighbours, to about a minute.
        let lo = prev?.t ?? cur.t;
        let hi = next?.t ?? cur.t;
        const g = (Math.sqrt(5) - 1) / 2;
        while (hi - lo > 60_000) {
          const c = hi - g * (hi - lo);
          const d = lo + g * (hi - lo);
          if (sep(c) < sep(d)) hi = d;
          else lo = c;
        }
        const tMin = (lo + hi) / 2;
        const sMin = sep(tMin);
        if (sMin > o.maxSeparationDeg) return;
        found.push(describe(a, b, tMin, sMin, at(a, tMin), observer, o));
      });
    }
  }
  if (o.satellite) found.push(...satelliteConjunctions(o.satellite, list, o, at));
  return found.sort((x, y) => String(x['time']).localeCompare(String(y['time'])));
}

function horizontal(
  dir: Vec3,
  ms: number,
  observer: Astronomy.Observer,
): { altitudeDeg: number; azimuthDeg: number } {
  const time = Astronomy.MakeTime(new Date(ms));
  // The direction is J2000: to the equator of date, then the horizon (refraction included).
  const ofDate = Astronomy.RotateVector(
    Astronomy.Rotation_EQJ_EQD(time),
    new Astronomy.Vector(dir[0], dir[1], dir[2], time),
  );
  const eq = Astronomy.EquatorFromVector(ofDate);
  const hor = Astronomy.Horizon(time, observer, eq.ra, eq.dec, 'normal');
  return { altitudeDeg: hor.altitude, azimuthDeg: hor.azimuth };
}

function describe(
  a: Target,
  b: Target,
  ms: number,
  separation: number,
  dirA: Vec3,
  observer: Astronomy.Observer,
  o: ConjunctionOptions,
): Record<string, unknown> {
  const sun = sunAltitudeDeg(ms, observer);
  // The pair's place in the sky (they are a few degrees apart at most): that of the first object.
  const h = horizontal(dirA, ms, observer);
  const above = h.altitudeDeg > 0;
  const dark = sun < DARK_SUN_ELEVATION_RAD / DEG;
  return {
    time: new Date(ms).toISOString(),
    ...(o.local ? { local: o.local(ms) } : {}),
    objects: [
      { id: a.id, name: a.name[o.lang] },
      { id: b.id, name: b.name[o.lang] },
    ],
    separationDeg: round(separation, 2),
    altitudeDeg: round(h.altitudeDeg, 1),
    azimuthDeg: round(h.azimuthDeg, 1),
    direction: compassPoint(h.azimuthDeg * DEG),
    sunAltitudeDeg: round(sun, 1),
    visibleFromPlace: above && dark,
  };
}

/** The Sun's altitude at the place (refraction included), degrees. */
function sunAltitudeDeg(ms: number, observer: Astronomy.Observer): number {
  const time = Astronomy.MakeTime(new Date(ms));
  const eq = Astronomy.Equator(Astronomy.Body.Sun, time, observer, true, true);
  return Astronomy.Horizon(time, observer, eq.ra, eq.dec, 'normal').altitude;
}

/** A satellite's passes above the place: its closest approach in the sky to each target during each pass. */
function satelliteConjunctions(
  sat: NonNullable<ConjunctionOptions['satellite']>,
  list: readonly Target[],
  o: ConjunctionOptions,
  at: (t: Target, ms: number) => Vec3,
): Record<string, unknown>[] {
  const obs: Observer = { latRad: o.latDeg * DEG, lonRad: o.lonDeg * DEG, heightKm: (o.heightM ?? 0) / 1000 };
  const observer = new Astronomy.Observer(o.latDeg, o.lonDeg, o.heightM ?? 0);
  const observerEcef = ecefFromGeodetic(obs.latRad, obs.lonRad, obs.heightKm);
  const maxSep = o.satelliteMaxSeparationDeg ?? 2;
  const { passes } = findPasses({
    satrec: sat.satrec,
    observer: obs,
    startMs: o.startMs,
    endMs: o.endMs,
    minElevationRad: 10 * DEG,
    limit: 20,
  });
  const out: Record<string, unknown>[] = [];
  const toUnit = (altDeg: number, azDeg: number): Vec3 => {
    const alt = altDeg * DEG;
    const az = azDeg * DEG;
    return [Math.cos(alt) * Math.sin(az), Math.cos(alt) * Math.cos(az), Math.sin(alt)];
  };
  for (const pass of passes) {
    // The targets barely move during a pass: their place at culmination.
    const mid = pass.culmination.timeMs;
    const places = list.map((t) => ({ t, h: horizontal(at(t, mid), mid, observer) }));
    const best = new Map<string, { ms: number; sep: number; el: number; az: number }>();
    for (let ms = pass.rise.timeMs; ms <= pass.set.timeMs; ms += 2000) {
      const date = new Date(ms);
      const teme = propagateTeme(sat.satrec, date);
      if (!teme) continue;
      const look = lookAngles(temeToEcef(teme.posKm, gmstRad(date)), observerEcef, obs);
      const satDir = toUnit(look.elevationRad / DEG, look.azimuthRad / DEG);
      for (const { t, h } of places) {
        if (h.altitudeDeg <= 0) continue;
        const s = separationDeg(satDir, toUnit(h.altitudeDeg, h.azimuthDeg));
        const cur = best.get(t.id);
        if (!cur || s < cur.sep)
          best.set(t.id, { ms, sep: s, el: look.elevationRad / DEG, az: look.azimuthRad / DEG });
      }
    }
    for (const [id, b] of best) {
      if (b.sep > maxSep) continue;
      const target = list.find((t) => t.id === id);
      if (!target) continue;
      const sun = sunAltitudeDeg(b.ms, observer);
      out.push({
        time: new Date(b.ms).toISOString(),
        ...(o.local ? { local: o.local(b.ms) } : {}),
        objects: [
          { id: sat.id, name: sat.name[o.lang] },
          { id: target.id, name: target.name[o.lang] },
        ],
        separationDeg: round(b.sep, 2),
        altitudeDeg: round(b.el, 1),
        azimuthDeg: round(b.az, 1),
        direction: compassPoint(b.az * DEG),
        sunAltitudeDeg: round(sun, 1),
        satelliteSunlit: sunlit(sat.satrec, b.ms),
        visibleFromPlace: sun < DARK_SUN_ELEVATION_RAD / DEG && sunlit(sat.satrec, b.ms),
      });
    }
  }
  return out;
}

/** Lit by the Sun (more than half its disc seen past the Earth), as the pass search counts it. */
function sunlit(satrec: SatRec, ms: number): boolean {
  const date = new Date(ms);
  const teme = propagateTeme(satrec, date);
  return (
    teme !== undefined && earthShadowFraction(teme.posKm, sunTeme(date), EARTH_EQUATORIAL_RADIUS_KM) > 0.5
  );
}
