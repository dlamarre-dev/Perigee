/**
 * Schedules bulk propagations and tells the renderer how to interpolate between the two latest samples.
 *
 * Samples A and B bracket the current simulation time: the next request is placed ahead of "now" by
 * rate × measured latency, so B lands in the future by the time it arrives. Rendering moves each object along
 * its orbit from the samples (two-body Lagrange series, src/astro/lagrangeSeries.ts: exact endpoints, C¹), which
 * stays accurate when samples are 10–25 minutes apart at ×10 000, and past B when a sample is late (a straight
 * line would leave a low orbit by tens of kilometres within two minutes). A clock jump (new epoch) discards
 * everything.
 */

export interface TimedSample {
  readonly timeMs: number;
}

export interface Interpolation {
  /** Normalised time in [A, B]; outside [0, 1] the shader extrapolates from the nearest sample. */
  readonly tau: number;
  /** B − A in seconds (0 when only one sample is available). */
  readonly spanS: number;
  /** now − A and now − B in seconds. */
  readonly dtAS: number;
  readonly dtBS: number;
}

const LEAD_SAFETY = 1.5;
const LATENCY_SMOOTHING = 0.3;

export class SampleTimeline<S extends TimedSample> {
  a: S | undefined;
  b: S | undefined;
  private inFlight = false;
  private epoch = -1;
  /** Exponential moving average of wall-clock round-trip time (ms). */
  latencyMs = 80;

  /** Returns the simulation time to propagate next, or undefined if no request is needed now. */
  nextRequest(simNowMs: number, rate: number, clockEpoch: number): number | undefined {
    if (clockEpoch !== this.epoch) {
      this.epoch = clockEpoch;
      this.a = undefined;
      this.b = undefined;
    }
    if (this.inFlight) return undefined;
    if (!this.b) return simNowMs;
    if (rate === 0) return this.b.timeMs === simNowMs ? undefined : simNowMs;
    return simNowMs + rate * this.latencyMs * LEAD_SAFETY;
  }

  /** Marks a request as sent; returns the epoch it belongs to. */
  begin(): number {
    this.inFlight = true;
    return this.epoch;
  }

  /** Accepts a finished sample. Samples from a previous epoch are dropped. */
  accept(sample: S, requestEpoch: number, wallLatencyMs: number): boolean {
    this.inFlight = false;
    this.latencyMs += (wallLatencyMs - this.latencyMs) * LATENCY_SMOOTHING;
    if (requestEpoch !== this.epoch) return false;
    this.a = this.b ?? sample;
    this.b = sample;
    return true;
  }

  /** Request failed or was abandoned. */
  cancel(): void {
    this.inFlight = false;
  }

  interpolation(simNowMs: number): Interpolation | undefined {
    const { a, b } = this;
    if (!a || !b) return undefined;
    const spanS = (b.timeMs - a.timeMs) / 1000;
    const dtAS = (simNowMs - a.timeMs) / 1000;
    const dtBS = (simNowMs - b.timeMs) / 1000;
    // Single sample: extrapolate from B.
    const tau = spanS === 0 ? 2 : dtAS / spanS;
    return { tau, spanS, dtAS, dtBS };
  }
}
