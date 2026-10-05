/**
 * The renderer's current pixel ratio, which the adaptive resolution may change at runtime. Screen-sized points
 * (satellites, markers, selection rings) are given in CSS pixels and scaled in their shaders by this one shared
 * uniform, so they keep their size on screen when the resolution changes, with nothing to subscribe or release.
 */
export const PIXEL_RATIO_UNIFORM: { value: number } = { value: 1 };

export function pixelRatio(): number {
  return PIXEL_RATIO_UNIFORM.value;
}
