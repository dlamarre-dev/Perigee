/**
 * Which Earth element set shows a date (CLAUDE.md §5.1): the current CelesTrak set, or one of the daily copies kept
 * 30 days (manifest `earthHistory`). SGP4 is most accurate near each element set's epoch, and the epochs of a set
 * fall shortly before it was fetched: a past date uses the first copy fetched after it, whose epochs are just past
 * that date. Shared by the app (src/earth/EarthView.ts) and the engine (src/engine/data.ts).
 */
import type { EarthSnapshot, Manifest } from './schemas';

/** The current set covers dates down to a day before it was fetched. */
const CURRENT_REACH_MS = 86_400_000;

/** The snapshot for a date, or undefined for the current set. */
export function snapshotFor(
  history: Manifest['earthHistory'],
  currentFetchedAt: string | undefined,
  dateMs: number,
): EarthSnapshot | undefined {
  const snapshots = [...(history?.snapshots ?? [])].sort(
    (a, b) => Date.parse(a.fetchedAt) - Date.parse(b.fetchedAt),
  );
  if (snapshots.length === 0) return undefined;
  const current = currentFetchedAt ? Date.parse(currentFetchedAt) : Number.NaN;
  if (Number.isFinite(current) && dateMs >= current - CURRENT_REACH_MS) return undefined;
  // Before every copy: the oldest (its elements are still the nearest in time).
  return snapshots.find((s) => Date.parse(s.fetchedAt) >= dateMs) ?? undefined;
}
