/**
 * Missions not drawn in the Moon, Mars and solar views, as kept in the URL. Inactive spacecraft
 * (`isInactiveMission`) are hidden by default, so the URL keeps only the departures from that default:
 * `hide=a,b` (active missions hidden) and `show=c,d` (inactive ones drawn). No DOM: the engine reads it too.
 */
import { isInactiveMission, type Mission } from '../data/schemas';

const ids = (params: URLSearchParams, key: string): string[] =>
  (params.get(key) ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Missions hidden by default: the inactive ones. */
export function defaultHiddenMissions(missions: readonly Mission[]): Set<string> {
  return new Set(missions.filter(isInactiveMission).map((m) => m.id));
}

/** `hide=a,b&show=c` over the default (inactive missions hidden) → set of hidden ids. */
export function parseHiddenMissions(params: URLSearchParams, missions: readonly Mission[]): Set<string> {
  const hidden = defaultHiddenMissions(missions);
  for (const id of ids(params, 'show')) hidden.delete(id);
  for (const id of ids(params, 'hide')) hidden.add(id);
  return hidden;
}

export function writeHiddenMissions(
  params: URLSearchParams,
  hidden: ReadonlySet<string>,
  missions: readonly Mission[],
): void {
  const byDefault = defaultHiddenMissions(missions);
  const hide = [...hidden].filter((id) => !byDefault.has(id));
  const show = [...byDefault].filter((id) => !hidden.has(id));
  if (hide.length > 0) params.set('hide', hide.sort().join(','));
  if (show.length > 0) params.set('show', show.sort().join(','));
}
