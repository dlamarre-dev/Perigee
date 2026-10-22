/**
 * Satellite passes over a place (machine interface): when an Earth satellite rises above the observer's horizon,
 * how high it climbs and in which direction, and whether it can be seen with the naked eye (lit by the Sun while
 * the observer's sky is dark). SGP4 in TEME, rotated to the Earth-fixed frame by GMST (polar motion neglected, as in
 * the app), observer on WGS 84. A coarse scan (one sample a minute, faster below the horizon) finds the passes,
 * bisection their rise and set to the second, then each pass is sampled for its culmination and visibility.
 */
import type { SatRec } from 'satellite.js';
import { AU_KM, EARTH_EQUATORIAL_RADIUS_KM } from '../astro/constants';
import { sunlitFraction } from '../astro/eclipse';
import { gmstRad } from '../astro/time';
import { dot, length, normalize, sub, type Vec3 } from '../astro/vec3';
import { propagateTeme } from '../earth/sgp4';
import { ecefFromGeodetic } from './ground';

export interface Observer {
  readonly latRad: number;
  readonly lonRad: number;
  readonly heightKm: number;
}

export interface LookAngles {
  readonly elevationRad: number;
  readonly azimuthRad: number;
  readonly rangeKm: number;
}

export interface PassPoint extends LookAngles {
  readonly timeMs: number;
}

export interface Pass {
  readonly rise: PassPoint;
  readonly culmination: PassPoint;
  readonly set: PassPoint;
  /** The pass was already under way at the start of the search (rise = start). */
  readonly inProgress: boolean;
  /** Ends after the search window (set = end). */
  readonly unfinished: boolean;
  /** Sun's elevation at the observer at culmination. */
  readonly sunElevationRad: number;
  /** Share of the pass's samples where the satellite is in sunlight. */
  readonly sunlitShare: number;
  /** Part of the pass visible to the naked eye: satellite lit, sky dark, at least the minimum elevation. */
  readonly visible?: { readonly fromMs: number; readonly toMs: number; readonly maxElevationRad: number };
}

/** The sky counts as dark enough below civil twilight. */
export const DARK_SUN_ELEVATION_RAD = (-6 * Math.PI) / 180;

/** TEME → Earth-fixed: rotation by −GMST about the pole. */
export function temeToEcef([x, y, z]: Vec3, gmst: number): Vec3 {
  const c = Math.cos(gmst);
  const s = Math.sin(gmst);
  return [c * x + s * y, -s * x + c * y, z];
}

export function lookAngles(targetEcef: Vec3, observerEcef: Vec3, o: Observer): LookAngles {
  const rho = sub(targetEcef, observerEcef);
  const sinLat = Math.sin(o.latRad);
  const cosLat = Math.cos(o.latRad);
  const sinLon = Math.sin(o.lonRad);
  const cosLon = Math.cos(o.lonRad);
  const east = -sinLon * rho[0] + cosLon * rho[1];
  const north = -sinLat * cosLon * rho[0] - sinLat * sinLon * rho[1] + cosLat * rho[2];
  const up = cosLat * cosLon * rho[0] + cosLat * sinLon * rho[1] + sinLat * rho[2];
  const rangeKm = length(rho);
  return {
    elevationRad: Math.asin(up / rangeKm),
    azimuthRad: (Math.atan2(east, north) + 2 * Math.PI) % (2 * Math.PI),
    rangeKm,
  };
}

/**
 * The Sun from the Earth's centre in the mean equator and equinox of date (≈ TEME), km: the Astronomical Almanac's
 * low-precision formula (about 0.01° until 2050), plenty to tell sunlight from shadow and day from night, and far
 * cheaper than a full ephemeris with nutation (a pass search runs it once per pass).
 */
export function sunTeme(date: Date): Vec3 {
  const n = date.getTime() / 86_400_000 + 2_440_587.5 - 2_451_545.0;
  const deg = Math.PI / 180;
  const g = (357.528 + 0.985_600_3 * n) * deg;
  const lambda = (280.46 + 0.985_647_4 * n + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * deg;
  const eps = (23.439 - 0.000_000_4 * n) * deg;
  const rKm = (1.000_14 - 0.016_71 * Math.cos(g) - 0.000_14 * Math.cos(2 * g)) * AU_KM;
  return [
    rKm * Math.cos(lambda),
    rKm * Math.cos(eps) * Math.sin(lambda),
    rKm * Math.sin(eps) * Math.sin(lambda),
  ];
}

export interface PassSearch {
  readonly satrec: SatRec;
  readonly observer: Observer;
  readonly startMs: number;
  readonly endMs: number;
  /** Passes whose culmination stays below this are left out. */
  readonly minElevationRad: number;
  /** At most this many passes. */
  readonly limit: number;
}

export interface PassResult {
  readonly passes: Pass[];
  /** Above the horizon for the whole window (a geostationary satellite in view, for example). */
  readonly alwaysAbove: boolean;
  /** Where it was at the start (when always above, or for reference). */
  readonly atStart: LookAngles | undefined;
}

export function findPasses(search: PassSearch): PassResult {
  const { satrec, observer, startMs, endMs } = search;
  const obsEcef = ecefFromGeodetic(observer.latRad, observer.lonRad, observer.heightKm);
  const obsUp = normalize(obsEcef);
  const at = (ms: number): (LookAngles & { teme: Vec3; ecef: Vec3 }) | undefined => {
    const date = new Date(ms);
    const s = propagateTeme(satrec, date);
    if (!s) return undefined;
    const ecef = temeToEcef(s.posKm, gmstRad(date));
    return { ...lookAngles(ecef, obsEcef, observer), teme: s.posKm, ecef };
  };
  const elevation = (ms: number): number => at(ms)?.elevationRad ?? -Math.PI / 2;
  /** Time of the horizon crossing between `lo` (one side) and `hi` (the other), to the second. */
  const crossing = (lo: number, hi: number): number => {
    const loAbove = elevation(lo) >= 0;
    while (hi - lo > 1000) {
      const mid = (lo + hi) / 2;
      if (elevation(mid) >= 0 === loAbove) lo = mid;
      else hi = mid;
    }
    return Math.round((lo + hi) / 2 / 1000) * 1000;
  };

  // Far below the horizon, jump to the earliest time the satellite could rise: the angle at the Earth's centre
  // between it and the observer cannot close faster than its fastest angular rate (at perigee) plus the Earth's
  // rotation, and it is above the horizon only within acos(R / r) of the observer (r at apogee, to be safe).
  // Near the horizon or above it: at most one sample a minute (slower orbits: 1/200 of a revolution, ≤ 30 min).
  const n = satrec.no / 60; // rad/s (satellite.js: rad/min)
  const e = satrec.ecco;
  const maxRateRadS = (n * (1 + e) ** 2) / (1 - e * e) ** 1.5 + 7.292_115e-5;
  const apogeeKm = Math.cbrt(398_600.8 / (n * n)) * (1 + e);
  const horizonAngle = Math.acos(Math.min(1, EARTH_EQUATORIAL_RADIUS_KM / apogeeKm));
  const baseStepMs = Math.min(1_800_000, Math.max(60_000, ((2 * Math.PI) / n / 100) * 1000));
  const nextStep = (ecef: Vec3 | undefined, elevationRad: number): number => {
    if (!ecef || elevationRad >= 0) return baseStepMs;
    const angle = Math.acos(Math.max(-1, Math.min(1, dot(normalize(ecef), obsUp))));
    const gapMs = ((angle - horizonAngle) / maxRateRadS) * 1000 * 0.9;
    return Math.max(baseStepMs, gapMs);
  };

  const first = at(startMs);
  const passes: Pass[] = [];
  let riseMs: number | undefined = first && first.elevationRad >= 0 ? startMs : undefined;
  let inProgress = riseMs !== undefined;
  let t = startMs;
  let prevEl = first?.elevationRad ?? -Math.PI / 2;
  let prevEcef = first?.ecef;
  let everBelow = !first || first.elevationRad < 0;
  while (t < endMs && passes.length < search.limit) {
    const next = Math.min(endMs, t + nextStep(prevEcef, prevEl));
    const sample = at(next);
    const el = sample?.elevationRad ?? -Math.PI / 2;
    prevEcef = sample?.ecef;
    if (el < 0) everBelow = true;
    if (prevEl < 0 && el >= 0) {
      riseMs = crossing(t, next);
      inProgress = false;
    } else if (prevEl >= 0 && el < 0 && riseMs !== undefined) {
      const pass = describePass(riseMs, crossing(t, next), inProgress, false);
      if (pass) passes.push(pass);
      riseMs = undefined;
    }
    prevEl = el;
    t = next;
  }
  if (riseMs !== undefined && passes.length < search.limit && everBelow) {
    const pass = describePass(riseMs, endMs, inProgress, true);
    if (pass) passes.push(pass);
  }
  return { passes, alwaysAbove: !everBelow, atStart: first };

  function describePass(
    fromMs: number,
    toMs: number,
    started: boolean,
    unfinished: boolean,
  ): Pass | undefined {
    // Culmination by golden-section search on the elevation (a pass rises, culminates once and sets), to ~1 s.
    const ratio = (Math.sqrt(5) - 1) / 2;
    let a = fromMs;
    let b = toMs;
    let c = b - ratio * (b - a);
    let d = a + ratio * (b - a);
    let fc = elevation(c);
    let fd = elevation(d);
    while (b - a > 2000) {
      if (fc > fd) {
        b = d;
        d = c;
        fd = fc;
        c = b - ratio * (b - a);
        fc = elevation(c);
      } else {
        a = c;
        c = d;
        fc = fd;
        d = a + ratio * (b - a);
        fd = elevation(d);
      }
    }
    const topMs = Math.round((a + b) / 2000) * 1000;
    const top = at(topMs);
    const rise = at(fromMs);
    const set = at(toMs);
    if (!top || !rise || !set || top.elevationRad < search.minElevationRad) return undefined;

    const sun = sunTeme(new Date(topMs));
    const sunDistanceKm = length(sun);
    const sunDir = normalize(sun);
    const lit = (teme: Vec3): boolean =>
      sunlitFraction(
        [-teme[0], -teme[1], -teme[2]],
        EARTH_EQUATORIAL_RADIUS_KM,
        normalize(sub(sun, teme)),
        sunDistanceKm,
      ) > 0.5;
    const sunTopRad = sunElevation(topMs, sunDir);
    // Light and visibility are sampled only when the observer's sky can be dark during the pass.
    const darkPossible =
      Math.min(sunElevation(fromMs, sunDir), sunTopRad, sunElevation(toMs, sunDir)) < DARK_SUN_ELEVATION_RAD;
    let litCount = 0;
    let samples = 0;
    let visible: { fromMs: number; toMs: number; maxElevationRad: number } | undefined;
    if (darkPossible) {
      const stepMs = Math.max(1000, Math.min(15_000, (toMs - fromMs) / 40));
      for (let ms = fromMs; ms <= toMs; ms += stepMs) {
        const p = at(ms);
        if (!p) continue;
        samples++;
        const sunlit = lit(p.teme);
        if (sunlit) litCount++;
        if (
          sunlit &&
          p.elevationRad >= search.minElevationRad &&
          sunElevation(ms, sunDir) < DARK_SUN_ELEVATION_RAD
        ) {
          visible = visible
            ? {
                fromMs: visible.fromMs,
                toMs: ms,
                maxElevationRad: Math.max(visible.maxElevationRad, p.elevationRad),
              }
            : { fromMs: ms, toMs: ms, maxElevationRad: p.elevationRad };
        }
      }
    } else {
      for (const p of [rise, top, set]) {
        samples++;
        if (lit(p.teme)) litCount++;
      }
    }
    return {
      rise: { ...strip(rise), timeMs: fromMs },
      culmination: { ...strip(top), timeMs: topMs },
      set: { ...strip(set), timeMs: toMs },
      inProgress: started,
      unfinished,
      sunElevationRad: sunTopRad,
      sunlitShare: samples ? litCount / samples : 0,
      ...(visible ? { visible } : {}),
    };
  }

  /** Elevation of the Sun at the observer (direction at infinity; refraction neglected). */
  function sunElevation(ms: number, sunDirTeme: Vec3): number {
    const dirEcef = temeToEcef(sunDirTeme, gmstRad(new Date(ms)));
    const up = [
      Math.cos(observer.latRad) * Math.cos(observer.lonRad),
      Math.cos(observer.latRad) * Math.sin(observer.lonRad),
      Math.sin(observer.latRad),
    ] as const;
    return Math.asin(dot(dirEcef, [up[0], up[1], up[2]]));
  }
}

const strip = (p: LookAngles): LookAngles => ({
  elevationRad: p.elevationRad,
  azimuthRad: p.azimuthRad,
  rangeKm: p.rangeKm,
});
