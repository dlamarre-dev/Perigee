/**
 * Sunlight and shadow (machine interface): whether an object is in sunlight, in the penumbra or in the umbra of
 * the body it orbits, and when it enters or leaves the shadow. The lit share of the Sun's disc comes from
 * src/astro/eclipse.ts (discs on the sky, spherical body); a scan finds the changes, bisection times them to the
 * second.
 */
import { sunlitFraction } from '../astro/eclipse';
import { length, normalize, sub, type Vec3 } from '../astro/vec3';

export type Light = 'sunlight' | 'penumbra' | 'umbra';

/** Lit share of the Sun's disc → light state (the extreme values within a thousandth). */
export function lightOf(fraction: number): Light {
  return fraction >= 0.999 ? 'sunlight' : fraction <= 0.001 ? 'umbra' : 'penumbra';
}

export interface LightChange {
  readonly timeMs: number;
  readonly from: Light;
  readonly to: Light;
}

/**
 * Lit share for an Earth satellite from its TEME position and the Sun's (≈ TEME), both from the Earth's centre: the
 * Earth as a sphere of its equatorial radius.
 */
export function earthShadowFraction(satTemeKm: Vec3, sunTemeKm: Vec3, earthRadiusKm: number): number {
  const toSun = sub(sunTemeKm, satTemeKm);
  return sunlitFraction(
    [-satTemeKm[0], -satTemeKm[1], -satTemeKm[2]],
    earthRadiusKm,
    normalize(toSun),
    length(toSun),
  );
}

/**
 * Light changes over [startMs, endMs]: a scan every `stepMs`, then bisection to a second around each change of
 * state. `fraction` returns NaN where the position is unknown (those samples are skipped).
 */
export async function lightChanges(
  fraction: (timeMs: number) => number | Promise<number>,
  startMs: number,
  endMs: number,
  stepMs: number,
): Promise<LightChange[]> {
  const changes: LightChange[] = [];
  let prevMs = startMs;
  let prevF = await fraction(startMs);
  for (let t = startMs + stepMs; t <= endMs + 1e-6; t += stepMs) {
    const f = await fraction(Math.min(t, endMs));
    if (Number.isNaN(f) || Number.isNaN(prevF)) {
      prevMs = t;
      prevF = f;
      continue;
    }
    const a = lightOf(prevF);
    const b = lightOf(f);
    if (a !== b) {
      // Between two samples there can be two changes (penumbra crossed within a step): time the first one,
      // then the rest is found from there.
      let lo = prevMs;
      let hi = Math.min(t, endMs);
      while (hi - lo > 1000) {
        const mid = (lo + hi) / 2;
        const fm = await fraction(mid);
        if (lightOf(fm) === a) lo = mid;
        else hi = mid;
      }
      const to = lightOf(await fraction(hi));
      changes.push({ timeMs: hi, from: a, to });
      if (to !== b) {
        let lo2 = hi;
        let hi2 = Math.min(t, endMs);
        while (hi2 - lo2 > 1000) {
          const mid = (lo2 + hi2) / 2;
          if (lightOf(await fraction(mid)) === to) lo2 = mid;
          else hi2 = mid;
        }
        changes.push({ timeMs: hi2, from: to, to: b });
      }
    }
    prevMs = Math.min(t, endMs);
    prevF = f;
  }
  return changes;
}
