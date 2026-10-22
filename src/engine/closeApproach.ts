/**
 * Closest approaches between two objects in space (machine interface): the minima of their distance over a
 * window. A scan whose step shrinks as the objects close in (never more than half the time they would need to
 * meet at `maxRelativeSpeedKmS`) brackets each minimum; golden-section search times it to 20 ms. For
 * education only: real conjunction assessment needs covariances and fresher, more precise orbits.
 */

export interface Approach {
  readonly timeMs: number;
  readonly distanceKm: number;
}

export interface ApproachSearch {
  /** Distance between the two objects at a time (NaN where unknown). */
  readonly distanceKm: (timeMs: number) => number | Promise<number>;
  readonly startMs: number;
  readonly endMs: number;
  /** Bound on how fast the distance can shrink (km/s): sets the scan step from the current distance. */
  readonly maxRelativeSpeedKmS: number;
  readonly minStepMs: number;
  readonly maxStepMs: number;
  /** Most minima kept (the deepest). */
  readonly limit: number;
}

const GOLDEN = (Math.sqrt(5) - 1) / 2;

async function goldenMinimum(
  f: (t: number) => number | Promise<number>,
  lo: number,
  hi: number,
): Promise<Approach> {
  let a = lo;
  let b = hi;
  let c = b - GOLDEN * (b - a);
  let d = a + GOLDEN * (b - a);
  let fc = await f(c);
  let fd = await f(d);
  // To 20 ms: at the 10–15 km/s of two satellites crossing, a second is kilometres.
  while (b - a > 20) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - GOLDEN * (b - a);
      fc = await f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + GOLDEN * (b - a);
      fd = await f(d);
    }
  }
  const t = (a + b) / 2;
  return { timeMs: t, distanceKm: await f(t) };
}

/** Local minima of the distance in the window, deepest first (window edges count when the distance falls there). */
export async function closestApproaches(s: ApproachSearch): Promise<Approach[]> {
  const samples: { t: number; d: number }[] = [];
  let t = s.startMs;
  while (t <= s.endMs) {
    const d = await s.distanceKm(t);
    samples.push({ t, d });
    if (t === s.endMs) break;
    const step = Number.isFinite(d)
      ? Math.min(s.maxStepMs, Math.max(s.minStepMs, ((d / s.maxRelativeSpeedKmS) * 1000) / 2))
      : s.maxStepMs;
    t = Math.min(s.endMs, t + step);
  }
  const minima: Approach[] = [];
  for (let i = 0; i < samples.length; i++) {
    const cur = samples[i];
    if (!cur || !Number.isFinite(cur.d)) continue;
    const before = samples[i - 1];
    const after = samples[i + 1];
    const lowerThanBefore = !before || !Number.isFinite(before.d) || cur.d <= before.d;
    const lowerThanAfter = !after || !Number.isFinite(after.d) || cur.d < after.d;
    if (!lowerThanBefore || !lowerThanAfter) continue;
    const lo = before?.t ?? cur.t;
    const hi = after?.t ?? cur.t;
    minima.push(
      hi - lo > 1000 ? await goldenMinimum(s.distanceKm, lo, hi) : { timeMs: cur.t, distanceKm: cur.d },
    );
  }
  return minima
    .filter((m) => Number.isFinite(m.distanceKm))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, s.limit);
}
