import { MS_PER_DAY } from './constants';

/** TT − TAI, exact by definition. */
export const TT_MINUS_TAI_S = 32.184;

/**
 * TAI − UTC steps (IERS Bulletin C). Each entry: [UTC instant the value takes effect, TAI − UTC in s].
 * Last checked 2026-09-26: no leap second announced after 2017-01-01.
 */
const LEAP_SECONDS: ReadonlyArray<readonly [number, number]> = (
  [
    ['1972-01-01', 10],
    ['1972-07-01', 11],
    ['1973-01-01', 12],
    ['1974-01-01', 13],
    ['1975-01-01', 14],
    ['1976-01-01', 15],
    ['1977-01-01', 16],
    ['1978-01-01', 17],
    ['1979-01-01', 18],
    ['1980-01-01', 19],
    ['1981-07-01', 20],
    ['1982-07-01', 21],
    ['1983-07-01', 22],
    ['1985-07-01', 23],
    ['1988-01-01', 24],
    ['1990-01-01', 25],
    ['1991-01-01', 26],
    ['1992-07-01', 27],
    ['1993-07-01', 28],
    ['1994-07-01', 29],
    ['1996-01-01', 30],
    ['1997-07-01', 31],
    ['1999-01-01', 32],
    ['2006-01-01', 33],
    ['2009-01-01', 34],
    ['2012-07-01', 35],
    ['2015-07-01', 36],
    ['2017-01-01', 37],
  ] as const
).map(([iso, s]) => [Date.parse(`${iso}T00:00:00Z`), s] as const);

export const FIRST_LEAP_SECOND_UNIX_MS = Date.UTC(1972, 0, 1);

/** TAI − UTC in seconds at a Unix instant, or undefined before 1972 (no integer-second UTC). */
export function taiMinusUtcS(unixMs: number): number | undefined {
  let value: number | undefined;
  for (const [startMs, s] of LEAP_SECONDS) {
    if (unixMs < startMs) break;
    value = s;
  }
  return value;
}

/** TT − UTC in seconds, or undefined before 1972. */
export function ttMinusUtcS(unixMs: number): number | undefined {
  const tai = taiMinusUtcS(unixMs);
  return tai === undefined ? undefined : tai + TT_MINUS_TAI_S;
}

export function unixMsFromJ2000Days(daysSinceJ2000: number): number {
  return Date.UTC(2000, 0, 1, 12) + daysSinceJ2000 * MS_PER_DAY;
}
