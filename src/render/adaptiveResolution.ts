/**
 * Adaptive resolution: lowers the pixel ratio by steps while frames are slow and raises it back once they have
 * kept the display's pace for a while. Pure (frame intervals in, pixel ratio out), so it is tested.
 *
 * - The display's own interval is the shortest one seen (16.7 ms at 60 Hz, 8.3 ms at 120 Hz), assumed no longer
 *   than DISPLAY_MAX_MS: a device slow from the start must not take its slowness for the display's pace.
 * - Slow: the median over the last SLOW_WINDOW_MS is above max(SLOW_MS, 1.5 × display interval).
 * - Fast: the median over the last FAST_WINDOW_MS is within 15 % of the display interval.
 * - A step up followed by a step down within FAST_WINDOW_MS makes that level a ceiling (no oscillation).
 * - Intervals above MAX_SAMPLE_MS (tab switches, GC pauses, loading) are ignored, and nothing is decided during
 *   the first WARMUP_MS (shader compilation, texture uploads and data parsing make the first frames slow).
 */

export const STEP = 0.25;
const SLOW_MS = 22;
const SLOW_WINDOW_MS = 2000;
const FAST_WINDOW_MS = 10_000;
const MAX_SAMPLE_MS = 100;
const DISPLAY_MAX_MS = 17.5;
const WARMUP_MS = 5000;

export class AdaptiveResolution {
  private samples: number[] = [];
  private sinceChangeMs = 0;
  private lastUpAtMs = -Infinity;
  private elapsedMs = 0;
  private ceiling: number;
  private displayMs = DISPLAY_MAX_MS;

  constructor(
    private ratio: number,
    readonly minRatio: number,
    maxRatio: number,
  ) {
    this.ceiling = maxRatio;
    this.ratio = Math.min(Math.max(ratio, minRatio), maxRatio);
  }

  get pixelRatio(): number {
    return this.ratio;
  }

  /** Records a rendered frame's interval; returns the new pixel ratio when it changes. */
  record(intervalMs: number): number | undefined {
    if (!(intervalMs > 0) || intervalMs > MAX_SAMPLE_MS) return undefined;
    this.elapsedMs += intervalMs;
    this.sinceChangeMs += intervalMs;
    this.samples.push(intervalMs);
    // Enough samples for the longer window at up to 240 Hz.
    if (this.samples.length > 2400) this.samples.splice(0, this.samples.length - 2400);
    this.displayMs = Math.min(this.displayMs, intervalMs);
    const display = this.displayMs;
    if (this.elapsedMs < WARMUP_MS) {
      this.sinceChangeMs = 0;
      this.samples = [];
      return undefined;
    }
    if (this.sinceChangeMs >= SLOW_WINDOW_MS && this.ratio > this.minRatio) {
      const slow = median(lastSpan(this.samples, SLOW_WINDOW_MS));
      if (slow > Math.max(SLOW_MS, 1.5 * display)) {
        // Going back down right after going up: that level is too much for this device.
        if (this.elapsedMs - this.lastUpAtMs < FAST_WINDOW_MS) this.ceiling = this.ratio - STEP;
        return this.change(Math.max(this.minRatio, this.ratio - STEP));
      }
    }
    if (this.sinceChangeMs >= FAST_WINDOW_MS && this.ratio < this.ceiling) {
      const fast = median(lastSpan(this.samples, FAST_WINDOW_MS));
      if (fast <= display * 1.15) {
        this.lastUpAtMs = this.elapsedMs;
        return this.change(Math.min(this.ceiling, this.ratio + STEP));
      }
    }
    return undefined;
  }

  private change(ratio: number): number | undefined {
    this.sinceChangeMs = 0;
    this.samples = [];
    if (ratio === this.ratio) return undefined;
    this.ratio = ratio;
    return ratio;
  }
}

/** The most recent samples covering `spanMs`. */
function lastSpan(samples: readonly number[], spanMs: number): number[] {
  let total = 0;
  let i = samples.length;
  while (i > 0 && total < spanMs) total += samples[--i] ?? 0;
  return samples.slice(i);
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}
