/**
 * Sunspot groups at a date, from NOAA SWPC active-region reports (data/sun/regions.json.gz).
 *
 * Each report gives a region's heliographic latitude and Carrington longitude at the end of its observation day.
 * The IAU rotation model of the Sun (astronomy-engine `RotationAxis`, W = 84.176° + 14.1844° d) is the
 * Carrington frame, so a region is fixed in the Sun's body frame apart from differential rotation: the surface
 * turns faster than the Carrington rate at the equator and slower near the poles (Snodgrass & Ulrich 1990,
 * spot-tracer fit used for sunspots: ω = 14.713 − 2.396 sin²φ − 1.787 sin⁴φ °/day, sidereal).
 *
 * Only the Earth-facing half is observed: a region keeps the latest report made before the date, moved by the
 * differential rotation since, and fades out between 7 and 14 days after it (the far side is not seen and spots
 * evolve within days). Pure functions, no Three.js.
 */
import { Astronomy } from './astronomy';
import { bodyOrientationEqj } from './bodies';
import { DEG_TO_RAD, RAD_TO_DEG } from './constants';
import { quatConjugate, quatRotate } from './quat';
import type { SunRegions } from '../data/schemas';

const DAY_MS = 86_400_000;
/** Sidereal rate of the Carrington frame (°/day). */
export const CARRINGTON_RATE_DEG_PER_DAY = 14.1844;
/** Reports are shown as they were for this long, then fade out until FADE_END. */
const FADE_START_MS = 7 * DAY_MS;
const FADE_END_MS = 14 * DAY_MS;
/** A report a little after the date (the day being viewed, published at 00:30 UT the next day) still counts. */
const FUTURE_TOLERANCE_MS = DAY_MS / 2;

export interface SunspotGroup {
  readonly region: number;
  readonly latRad: number;
  /** Carrington longitude (east-positive in the Sun's IAU body frame) at the date. */
  readonly lonRad: number;
  /** Angular radius of a disc with the group's total spot area (0 for a plage without spots). */
  readonly radiusRad: number;
  readonly spots: number;
  /** 1 up to a week after the report, fading to 0 at two weeks. */
  readonly strength: number;
  /** End of the observation day of the report used (UTC). */
  readonly observedAt: Date;
  /** Observation day of the report used, as published (YYYY-MM-DD, UTC). */
  readonly reportDate: string;
}

/** Sidereal rotation rate of sunspots at a latitude (°/day). */
export function sunspotRateDegPerDay(latRad: number): number {
  const s2 = Math.sin(latRad) ** 2;
  return 14.713 - 2.396 * s2 - 1.787 * s2 * s2;
}

/** Angular radius of a disc covering `areaMh` millionths of the solar hemisphere (2πR²·A·10⁻⁶ = πr²). */
export function spotRadiusRad(areaMh: number): number {
  return Math.sqrt(2 * areaMh * 1e-6);
}

/** End of a report's observation day (positions are given as of 24:00 UT). */
export function regionObservedAt(date: string): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS);
}

/** Groups to draw at `date`: latest report per region, moved by differential rotation, faded with age. */
export function sunspotGroups(regions: SunRegions, date: Date): SunspotGroup[] {
  const t = date.getTime();
  const latest = new Map<number, { record: SunRegions[number]; observedMs: number }>();
  for (const record of regions) {
    const observedMs = regionObservedAt(record.date).getTime();
    if (observedMs > t + FUTURE_TOLERANCE_MS) continue;
    const prev = latest.get(record.region);
    if (!prev || observedMs > prev.observedMs) latest.set(record.region, { record, observedMs });
  }
  const groups: SunspotGroup[] = [];
  for (const { record, observedMs } of latest.values()) {
    const ageMs = t - observedMs;
    if (ageMs >= FADE_END_MS) continue;
    const latRad = record.latDeg * DEG_TO_RAD;
    const driftDeg = ((sunspotRateDegPerDay(latRad) - CARRINGTON_RATE_DEG_PER_DAY) * ageMs) / DAY_MS;
    const lonDeg = (((record.carringtonLonDeg + driftDeg) % 360) + 360) % 360;
    const fade = Math.min(1, Math.max(0, (ageMs - FADE_START_MS) / (FADE_END_MS - FADE_START_MS)));
    groups.push({
      region: record.region,
      latRad,
      lonRad: lonDeg * DEG_TO_RAD,
      radiusRad: record.areaMh ? spotRadiusRad(record.areaMh) : 0,
      spots: record.spots ?? 0,
      strength: 1 - fade * fade * (3 - 2 * fade),
      observedAt: new Date(observedMs),
      reportDate: record.date,
    });
  }
  // Largest first, so a cap on the number drawn drops the smallest.
  return groups.sort((a, b) => b.radiusRad - a.radiusRad || a.region - b.region);
}

/** Unit vector of a heliographic position in the Sun's body frame (Z north, X Carrington longitude 0). */
export function heliographicDirection(latRad: number, lonRad: number): [number, number, number] {
  const c = Math.cos(latRad);
  return [c * Math.cos(lonRad), c * Math.sin(lonRad), Math.sin(latRad)];
}

/**
 * Carrington longitude of the centre of the disc seen from the Earth (L0, degrees in [0, 360)), from the IAU
 * rotation model of the Sun. Geometric (no light-time), well within a degree.
 */
export function subEarthCarringtonDeg(date: Date): number {
  const e = Astronomy.HelioVector(Astronomy.Body.Earth, date);
  const b = quatRotate(quatConjugate(bodyOrientationEqj(Astronomy.Body.Sun, date)), [e.x, e.y, e.z]);
  return (((Math.atan2(b[1], b[0]) * RAD_TO_DEG) % 360) + 360) % 360;
}

/**
 * Carrington rotation number in progress. A rotation starts when the central meridian crosses Carrington
 * longitude 0 (L0 decreasing through 360°): the usual mean-period count (CR 1690 began on JD 2444235.34, 27.2753
 * days each) only picks the whole number, the fraction comes from the actual L0, so the change of number falls
 * on the crossing (the mean count alone drifts by hours over the year).
 */
export function carringtonRotation(date: Date): number {
  const jd = date.getTime() / 86_400_000 + 2_440_587.5;
  const mean = 1690 + (jd - 2_444_235.34) / 27.2753;
  const fraction = 1 - subEarthCarringtonDeg(date) / 360;
  return Math.round(mean - fraction);
}
