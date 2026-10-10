/**
 * Simulation time for render-side animations that follow the clock (moving clouds and gas): set by the shell's
 * frame loop before the view updates and the frame is drawn, so listeners may render off-screen passes there.
 */
let nowMs = Date.now();
const listeners = new Set<(ms: number) => void>();

/** Called once per frame by the shell (src/app/main.ts). */
export function setSimTime(ms: number): void {
  nowMs = ms;
  for (const listener of listeners) listener(ms);
}

/** Simulation time of the frame being drawn (UTC ms). */
export function simTimeMs(): number {
  return nowMs;
}

/** Runs before each frame with its simulation time; returns the unsubscribe function. */
export function onSimTime(listener: (ms: number) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Two-layer cycle for animated maps: each layer drifts for one cycle from its start, then makes way for the
 * next. Layer A starts at multiples of the cycle, layer B half a cycle later; whichever is closer to the middle of
 * its life is shown, with a short cross-fade (20 % of a half cycle) between them. A layer is thus never seen
 * just after its start (same as the previous one's) nor near its end (most drifted).
 */
export interface LayerCycle {
  /** Seconds since each layer's start. */
  readonly ageA: number;
  readonly ageB: number;
  /** Cycle numbers (which drawing of each layer). */
  readonly indexA: number;
  readonly indexB: number;
  /** Weight of layer A (B gets 1 − weightA). */
  readonly weightA: number;
}

export function layerCycle(timeMs: number, cycleS: number): LayerCycle {
  const t = timeMs / 1000;
  const half = cycleS / 2;
  const indexA = Math.floor(t / cycleS);
  const indexB = Math.floor((t + half) / cycleS);
  const ageA = t - indexA * cycleS;
  const ageB = t + half - indexB * cycleS;
  // 1 in the middle of A's life, 0 at its start and end.
  const tri = 1 - Math.abs((2 * ageA) / cycleS - 1);
  const x = Math.min(1, Math.max(0, (tri - 0.4) / 0.2));
  return { ageA, ageB, indexA, indexB, weightA: x * x * (3 - 2 * x) };
}
