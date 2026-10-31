/**
 * Number formats of the landing pages: distances (km, million, billion), light travel times, speeds and ages, in
 * the page's language.
 */
import type { I18n } from '../i18n';

const AU_KM = 149_597_870.7;

/** "418 km", "1.59 million km", "25.76 billion km". */
export function distance(i18n: I18n, km: number): string {
  if (km < 1e6) return i18n.format('landing.unit.km', { n: Math.round(km) });
  // French agrees "million" and "milliard" in the plural from 2 on (1,59 million de km).
  if (km < 1e9)
    return i18n.format(km < 2e6 ? 'landing.unit.millionKmOne' : 'landing.unit.millionKm', {
      n: i18n.number(km / 1e6, km < 1e7 ? 2 : 1),
    });
  return i18n.format(km < 2e9 ? 'landing.unit.billionKmOne' : 'landing.unit.billionKm', {
    n: i18n.number(km / 1e9, 2),
  });
}

/** "172.21 au" (only for distances beyond a tenth of an au). */
export function au(i18n: I18n, km: number): string | undefined {
  const v = km / AU_KM;
  return v >= 0.1 ? i18n.format('landing.unit.au', { n: i18n.number(v, v < 10 ? 3 : 2) }) : undefined;
}

/** "5.3 s", "3 min 12 s", "23 h 52 min", "1 d 2 h". */
export function lightTime(i18n: I18n, seconds: number): string {
  if (seconds < 60) return i18n.format('landing.unit.s', { s: i18n.number(seconds, seconds < 10 ? 2 : 1) });
  const s = Math.round(seconds);
  if (s < 3600) return i18n.format('landing.unit.minS', { m: Math.floor(s / 60), s: s % 60 });
  if (s < 86_400)
    return i18n.format('landing.unit.hMin', { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60) });
  return i18n.format('landing.unit.dH', { d: Math.floor(s / 86_400), h: Math.floor((s % 86_400) / 3600) });
}

/** A speed in km/s as "27,580 km/h" (rounded to 10 km/h). */
export function kmh(i18n: I18n, kmS: number): string {
  return i18n.format('landing.unit.kmh', { n: Math.round((kmS * 3600) / 10) * 10 });
}

export function kms(i18n: I18n, kmS: number): string {
  return i18n.format('landing.unit.kms', { n: i18n.number(kmS, kmS < 10 ? 2 : 1) });
}

/** How long ago or how long until: "12 min", "5 h", "3 days". */
export function span(i18n: I18n, ms: number): string {
  const min = Math.abs(ms) / 60_000;
  if (min < 90) return i18n.format('landing.unit.minutes', { n: Math.max(1, Math.round(min)) });
  const h = min / 60;
  if (h < 48) return i18n.format('landing.unit.hours', { n: Math.round(h) });
  return i18n.format('landing.unit.days', { n: Math.round(h / 24) });
}

/** A countdown "2 h 05 min", "4 min 10 s". */
export function countdown(i18n: I18n, ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 3600)
    return i18n.format('landing.unit.minS', { m: Math.floor(s / 60), s: String(s % 60).padStart(2, '0') });
  if (s < 86_400)
    return i18n.format('landing.unit.hMin', {
      h: Math.floor(s / 3600),
      m: String(Math.floor((s % 3600) / 60)).padStart(2, '0'),
    });
  return i18n.format('landing.unit.dH', { d: Math.floor(s / 86_400), h: Math.floor((s % 86_400) / 3600) });
}
