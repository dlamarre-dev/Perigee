/**
 * Sampling helpers for trajectory lines (pure). A trajectory near the camera must pass exactly through the
 * marker: the current time is a vertex, and vertices get denser towards it so the straight chords between
 * them stay closer to the curved path than a pixel at any zoom.
 */

/**
 * Times in [t0, t1] (ascending) that include `tNow`, spaced geometrically on each side: the first step away
 * from `tNow` is `span · (ratio − 1)/(ratio^perSide − 1)`, each next one `ratio` times longer, the last one
 * landing on the interval end.
 */
export function nearSampleTimes(
  t0: number,
  t1: number,
  tNow: number,
  perSide: number,
  ratio = 1.35,
): number[] {
  const now = Math.min(Math.max(tNow, t0), t1);
  const side = (span: number, sign: number): number[] => {
    if (span <= 0) return [];
    const out: number[] = [];
    // Steps r^0 … r^(n−1), normalised to the span.
    const total = (Math.pow(ratio, perSide) - 1) / (ratio - 1);
    let acc = 0;
    for (let k = 0; k < perSide; k++) {
      acc += Math.pow(ratio, k) / total;
      out.push(now + sign * span * Math.min(acc, 1));
    }
    return out;
  };
  const before = side(now - t0, -1).reverse();
  const after = side(t1 - now, 1);
  return [...before, now, ...after];
}

/**
 * Sample times for a whole trajectory drawn around a moving object: a uniform grid of `farIntervals` over
 * [tStart, tEnd] for the far parts, and around `tNow` (± one grid step) the dense geometric samples of
 * `nearSampleTimes`, so the line passes through the object and no polyline corner sits next to a camera
 * that is following it. Ascending, `tNow` included (clamped to the span).
 */
export function trajectoryTimes(
  tStart: number,
  tEnd: number,
  tNow: number,
  farIntervals: number,
  perSide = 24,
): number[] {
  if (!(tEnd > tStart) || farIntervals < 1) return [tStart];
  const step = (tEnd - tStart) / farIntervals;
  const now = Math.min(Math.max(tNow, tStart), tEnd);
  const lo = Math.max(tStart, now - step);
  const hi = Math.min(tEnd, now + step);
  const out: number[] = [];
  for (let i = 0; i <= farIntervals; i++) {
    const t = tStart + i * step;
    if (t < lo) out.push(t);
  }
  out.push(...nearSampleTimes(lo, hi, now, perSide));
  for (let i = 0; i <= farIntervals; i++) {
    const t = tStart + i * step;
    if (t > hi) out.push(t);
  }
  return out;
}
