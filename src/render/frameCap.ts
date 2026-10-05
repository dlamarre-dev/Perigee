/**
 * Frame-rate cap on top of requestAnimationFrame, which can only skip whole display frames. A frame is drawn
 * when it is the one closest to the target interval (drawing now undershoots it by less than waiting for the
 * next frame would overshoot it): 120 Hz → 60 fps, 144 Hz → 72, while 60 and 75 Hz displays (closer to the
 * target than to half of it) keep every frame. A fixed slack instead skipped every other frame at 75 Hz
 * (37.5 fps), which the adaptive resolution then took for a slow device.
 */
export function shouldDrawFrame(
  elapsedMs: number,
  targetFps: number | undefined,
  displayMs: number,
): boolean {
  if (targetFps === undefined) return true;
  // 1 ms of slack for timer jitter.
  return elapsedMs >= 1000 / targetFps - displayMs / 2 - 1;
}

/** Display frame interval: the shortest seen between animation frames (ms). */
export class DisplayInterval {
  private value = 1000 / 60;
  private lastMs: number | undefined;

  get ms(): number {
    return this.value;
  }

  record(timeMs: number): void {
    // Below 4 ms: two callbacks in one frame or timer noise, not a refresh rate.
    if (this.lastMs !== undefined && timeMs - this.lastMs >= 4) {
      this.value = Math.min(this.value, timeMs - this.lastMs);
    }
    this.lastMs = timeMs;
  }
}
