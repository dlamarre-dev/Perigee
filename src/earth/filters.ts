/**
 * Faceted filters: OR within a facet, AND across facets, plus free-text search.
 * Pure functions; state round-trips through the URL.
 */
import { ORBIT_REGIMES, type OrbitRegime } from '../astro/orbit';
import type { SatObject } from './catalog';

/** Facet value for objects without an operator / owner. */
export const NONE = '-';

export interface FilterState {
  readonly operators: readonly string[];
  readonly owners: readonly string[];
  readonly groups: readonly string[];
  readonly regimes: readonly OrbitRegime[];
  readonly types: readonly string[];
  readonly query: string;
}

export const EMPTY_FILTERS: FilterState = {
  operators: [],
  owners: [],
  groups: [],
  regimes: [],
  types: [],
  query: '',
};

export type FacetKey = Exclude<keyof FilterState, 'query'>;
export const FACET_KEYS: readonly FacetKey[] = ['operators', 'owners', 'groups', 'regimes', 'types'];

/** Values of an object for a facet (several for groups). */
export function facetValues(obj: SatObject, facet: FacetKey): readonly string[] {
  switch (facet) {
    case 'operators':
      return [obj.operatorId ?? NONE];
    case 'owners':
      return [obj.ownerCode ?? NONE];
    case 'groups':
      return obj.groups;
    case 'regimes':
      return [obj.regime];
    case 'types':
      return [obj.objectType];
  }
}

/**
 * Text query: every whitespace-separated term must match. A purely numeric term matches the NORAD number
 * exactly (so "25544" never matches 125544) or a substring of the name/COSPAR ("starlink 1234",
 * "2026-"); other terms match name/COSPAR substrings.
 */
export function matchesQuery(obj: SatObject, query: string): boolean {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return terms.every(
    (term) => (/^\d+$/.test(term) && obj.noradId === Number(term)) || obj.searchText.includes(term),
  );
}

export function matchesFilters(obj: SatObject, f: FilterState): boolean {
  for (const facet of FACET_KEYS) {
    const selected = f[facet];
    if (selected.length === 0) continue;
    const values = facetValues(obj, facet);
    if (!values.some((v) => (selected as readonly string[]).includes(v))) return false;
  }
  return f.query === '' || matchesQuery(obj, f.query);
}

export function isEmptyFilter(f: FilterState): boolean {
  return FACET_KEYS.every((k) => f[k].length === 0) && f.query.trim() === '';
}

/** Counts per facet value over all objects (sorted by descending count). */
export function facetCounts(objects: readonly SatObject[], facet: FacetKey): [string, number][] {
  const counts = new Map<string, number>();
  for (const obj of objects) for (const v of facetValues(obj, facet)) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const URL_KEYS: Record<FacetKey, string> = {
  operators: 'op',
  owners: 'own',
  groups: 'grp',
  regimes: 'reg',
  types: 'type',
};

export function filtersToParams(f: FilterState, p: URLSearchParams): void {
  for (const facet of FACET_KEYS) {
    if (f[facet].length > 0) p.set(URL_KEYS[facet], f[facet].join(','));
  }
  if (f.query.trim()) p.set('q', f.query.trim());
}

export function filtersFromParams(p: URLSearchParams): FilterState {
  const list = (key: string): string[] =>
    (p.get(key) ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  return {
    operators: list(URL_KEYS.operators),
    owners: list(URL_KEYS.owners),
    groups: list(URL_KEYS.groups),
    regimes: list(URL_KEYS.regimes).filter((r): r is OrbitRegime =>
      (ORBIT_REGIMES as readonly string[]).includes(r),
    ),
    types: list(URL_KEYS.types),
    query: p.get('q') ?? '',
  };
}
