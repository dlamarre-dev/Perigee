/**
 * Ephemeris tables and cubic Hermite interpolation (CLAUDE.md §5.2). Pure, Float64.
 *
 * Table layout (as published by the pipeline in data/ephem/<mission>.bin): rows of 7 little-endian
 * Float64 values — t (JD TDB), x, y, z (km), vx, vy, vz (km/s) — sorted by time.
 */
import { SECONDS_PER_DAY } from './constants';
import type { Vec3 } from './vec3';

export const EPHEM_ROW = 7;

export interface StateVector {
  readonly posKm: Vec3;
  readonly velKmS: Vec3;
}

export class EphemerisTable {
  readonly rows: number;

  constructor(readonly data: Float64Array) {
    if (data.length === 0 || data.length % EPHEM_ROW !== 0) {
      throw new Error(`Ephemeris table length ${data.length} is not a positive multiple of ${EPHEM_ROW}`);
    }
    this.rows = data.length / EPHEM_ROW;
    for (let i = 1; i < this.rows; i++) {
      if (this.time(i) <= this.time(i - 1)) throw new Error('Ephemeris times must be strictly increasing');
    }
  }

  get startTdbJd(): number {
    return this.time(0);
  }

  get endTdbJd(): number {
    return this.time(this.rows - 1);
  }

  time(i: number): number {
    return this.data[i * EPHEM_ROW] ?? Number.NaN;
  }

  state(i: number): StateVector {
    const o = i * EPHEM_ROW;
    const d = this.data;
    return {
      posKm: [d[o + 1] ?? 0, d[o + 2] ?? 0, d[o + 3] ?? 0],
      velKmS: [d[o + 4] ?? 0, d[o + 5] ?? 0, d[o + 6] ?? 0],
    };
  }

  contains(tTdbJd: number): boolean {
    return tTdbJd >= this.startTdbJd && tTdbJd <= this.endTdbJd;
  }

  /** Index i such that time(i) ≤ t ≤ time(i + 1), clamped to the table. */
  intervalIndex(tTdbJd: number): number {
    let lo = 0;
    let hi = this.rows - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.time(mid) <= tTdbJd) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** Cubic Hermite interpolation of position and velocity; undefined outside the table. */
  interpolate(tTdbJd: number): StateVector | undefined {
    if (!this.contains(tTdbJd)) return undefined;
    if (this.rows === 1) return this.state(0);
    const i = this.intervalIndex(tTdbJd);
    return hermite(this.time(i), this.state(i), this.time(i + 1), this.state(i + 1), tTdbJd);
  }
}

/** Cubic Hermite between two states (times in JD, velocities in km/s). */
export function hermite(
  t0Jd: number,
  s0: StateVector,
  t1Jd: number,
  s1: StateVector,
  tJd: number,
): StateVector {
  const hS = (t1Jd - t0Jd) * SECONDS_PER_DAY;
  const u = (tJd - t0Jd) / (t1Jd - t0Jd);
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  // Derivatives with respect to u (divide by hS for d/dt).
  const d00 = 6 * u2 - 6 * u;
  const d10 = 3 * u2 - 4 * u + 1;
  const d01 = -6 * u2 + 6 * u;
  const d11 = 3 * u2 - 2 * u;
  const pos = [0, 0, 0] as [number, number, number];
  const vel = [0, 0, 0] as [number, number, number];
  for (let k = 0; k < 3; k++) {
    const p0 = s0.posKm[k] ?? 0;
    const p1 = s1.posKm[k] ?? 0;
    const v0 = s0.velKmS[k] ?? 0;
    const v1 = s1.velKmS[k] ?? 0;
    pos[k] = h00 * p0 + h10 * hS * v0 + h01 * p1 + h11 * hS * v1;
    vel[k] = (d00 * p0 + d10 * hS * v0 + d01 * p1 + d11 * hS * v1) / hS;
  }
  return { posKm: pos, velKmS: vel };
}
