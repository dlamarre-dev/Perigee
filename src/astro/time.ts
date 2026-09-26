import { Astronomy } from './astronomy';
import {
  DAYS_PER_JULIAN_CENTURY,
  DEG_TO_RAD,
  J2000_JD,
  MS_PER_DAY,
  SECONDS_PER_DAY,
  TWO_PI,
  UNIX_EPOCH_JD,
} from './constants';

/** Julian date (UTC scale) of a JS Date. */
export function utcToJd(date: Date): number {
  return date.getTime() / MS_PER_DAY + UNIX_EPOCH_JD;
}

export function jdToUtc(jdUtc: number): Date {
  return new Date((jdUtc - UNIX_EPOCH_JD) * MS_PER_DAY);
}

/**
 * Julian date on the TDB scale (the time scale of JPL Horizons output).
 * TT comes from astronomy-engine with our leap-second ΔT (see astronomy.ts); TDB − TT uses the
 * one-term approximation 0.001657 s · sin(g) (USNO Circular 179), accurate to ~30 µs.
 */
export function utcToTdbJd(date: Date): number {
  const ttJd = Astronomy.MakeTime(date).tt + J2000_JD;
  const gRad = (357.53 + 0.985_600_28 * (ttJd - J2000_JD)) * DEG_TO_RAD;
  return ttJd + (0.001_657 * Math.sin(gRad)) / SECONDS_PER_DAY;
}

/**
 * Greenwich Mean Sidereal Time, IAU 1982 model (Vallado, "Fundamentals of Astrodynamics", eq. 3-47).
 * This is the angle used by SGP4's TEME → ECEF conversion (same formula as satellite.js `gstime`),
 * so Earth rotation and satellite positions stay consistent. UT1 is approximated by UTC (|UT1−UTC| < 0.9 s).
 */
export function gmstRad(date: Date): number {
  const tUt1 = (utcToJd(date) - J2000_JD) / DAYS_PER_JULIAN_CENTURY;
  const gmstSec =
    67_310.548_41 +
    (876_600 * 3600 + 8_640_184.812_866) * tUt1 +
    0.093_104 * tUt1 * tUt1 -
    6.2e-6 * tUt1 * tUt1 * tUt1;
  const angleRad = ((gmstSec % SECONDS_PER_DAY) / SECONDS_PER_DAY) * TWO_PI;
  return angleRad < 0 ? angleRad + TWO_PI : angleRad;
}

/** Monotonic millisecond clock; injectable for tests. */
export type MonotonicClock = () => number;

const defaultMonotonic: MonotonicClock = () => performance.now();
const defaultWallClock = (): number => Date.now();

/**
 * Simulation clock. Simulated time advances at `rate` × real time (0 = paused, negative = backwards).
 * It is anchored on a monotonic clock so it does not drift and ignores wall-clock adjustments.
 */
export class SimClock {
  private anchorSimMs: number;
  private anchorMonoMs: number;
  private rateValue = 1;

  constructor(
    private readonly monotonic: MonotonicClock = defaultMonotonic,
    private readonly wallClock: () => number = defaultWallClock,
  ) {
    this.anchorSimMs = wallClock();
    this.anchorMonoMs = monotonic();
  }

  /** Current simulated time in Unix ms. */
  nowMs(): number {
    return this.anchorSimMs + (this.monotonic() - this.anchorMonoMs) * this.rateValue;
  }

  nowUtc(): Date {
    return new Date(this.nowMs());
  }

  get rate(): number {
    return this.rateValue;
  }

  setRate(rate: number): void {
    this.reanchor();
    this.rateValue = rate;
  }

  get paused(): boolean {
    return this.rateValue === 0;
  }

  jumpTo(date: Date): void {
    this.anchorSimMs = date.getTime();
    this.anchorMonoMs = this.monotonic();
  }

  /** Back to real time at ×1. */
  goLive(): void {
    this.rateValue = 1;
    this.jumpTo(new Date(this.wallClock()));
  }

  /** True when following real time (×1, within one second of the wall clock). */
  isLive(): boolean {
    return this.rateValue === 1 && Math.abs(this.nowMs() - this.wallClock()) < 1000;
  }

  private reanchor(): void {
    this.anchorSimMs = this.nowMs();
    this.anchorMonoMs = this.monotonic();
  }
}
