/** Earth-view URL parameters: filters and the selected NORAD number (integer, may exceed 99999). */
import { EMPTY_FILTERS, filtersFromParams, filtersToParams, type FilterState } from './filters';

export interface EarthUrlState {
  readonly filters: FilterState;
  readonly selected: number | undefined;
}

export const DEFAULT_EARTH_URL: EarthUrlState = { filters: EMPTY_FILTERS, selected: undefined };

export function parseEarthUrl(p: URLSearchParams): EarthUrlState {
  const sel = p.get('sel');
  const selected = sel !== null && /^\d+$/.test(sel) ? Number(sel) : undefined;
  return {
    filters: filtersFromParams(p),
    selected: selected !== undefined && selected > 0 ? selected : undefined,
  };
}

export function writeEarthUrl(state: EarthUrlState, p: URLSearchParams): void {
  filtersToParams(state.filters, p);
  if (state.selected !== undefined) p.set('sel', String(state.selected));
}
