/**
 * Pick tolerance adapted to the pointer: a fingertip covers far more pixels than a mouse cursor, so touch
 * screens (coarse pointer) get a larger radius.
 */
const COARSE = typeof window !== 'undefined' ? window.matchMedia('(pointer: coarse)') : undefined;

export function pickRadiusPx(finePx: number): number {
  return COARSE?.matches ? Math.round(finePx * 1.8) : finePx;
}
