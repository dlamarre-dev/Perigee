/** The eight usual Moon phases, from its ecliptic elongation east of the Sun (0° new, 180° full). */
export const MOON_PHASES = [
  'new',
  'waxingCrescent',
  'firstQuarter',
  'waxingGibbous',
  'full',
  'waningGibbous',
  'lastQuarter',
  'waningCrescent',
] as const;
export type MoonPhase = (typeof MOON_PHASES)[number];

/** Each phase spans 45°, centred on the new moon, the quarters and the full moon. */
export function moonPhase(elongationDeg: number): MoonPhase {
  const e = ((elongationDeg % 360) + 360) % 360;
  return MOON_PHASES[Math.floor(((e + 22.5) % 360) / 45)] ?? 'new';
}
