/**
 * Single entry point to astronomy-engine. Import `Astronomy` from here, never from the package directly,
 * so the ΔT configuration below always applies.
 *
 * astronomy-engine's default ΔT is a long-term polynomial (Espenak–Meeus) that overestimates ΔT by ≈ 6 s
 * in 2026. Since 1972 we replace it with the exact leap-second value TT − UTC, treating UT1 ≈ UTC
 * (|UT1 − UTC| < 0.9 s by IERS design).
 */
import * as Astronomy from 'astronomy-engine';
import { FIRST_LEAP_SECOND_UNIX_MS, ttMinusUtcS, unixMsFromJ2000Days } from './leapSeconds';

Astronomy.SetDeltaTFunction((utDays: number): number => {
  const unixMs = unixMsFromJ2000Days(utDays);
  if (unixMs < FIRST_LEAP_SECOND_UNIX_MS) return Astronomy.DeltaT_EspenakMeeus(utDays);
  return ttMinusUtcS(unixMs) ?? Astronomy.DeltaT_EspenakMeeus(utDays);
});

export { Astronomy };
