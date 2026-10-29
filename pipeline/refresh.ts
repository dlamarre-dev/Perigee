/**
 * Refresh cadence of the slow natural bodies (asteroids, dwarf planets): their Horizons vectors are fetched again
 * once they are a week old (they move smoothly; a weekly refresh is plenty) or their window ends within 300 days.
 * Spacecraft, moons and comets are fetched by every daily run.
 */
import { utcToTdbJd } from '../src/astro/time';

export const SLOW_BODY_REFRESH_DAYS = 7;

export function slowBodyDue(
  entry: { readonly fetchedAt: string; readonly endTdbJd: number } | undefined,
  now: Date,
): boolean {
  if (!entry) return true;
  const ageDays = (now.getTime() - Date.parse(entry.fetchedAt)) / 86_400_000;
  // An unreadable fetchedAt (NaN age) counts as due.
  return !(ageDays < SLOW_BODY_REFRESH_DAYS) || entry.endTdbJd < utcToTdbJd(now) + 300;
}
