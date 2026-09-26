/**
 * Application state mirrored in the URL query string (shareable links). Pure parse/serialize functions.
 */
import { EMPTY_FILTERS, filtersFromParams, filtersToParams, type FilterState } from '../earth/filters';
import { isLang, type Lang } from '../i18n';

export type ViewId = 'earth';
export type FrameMode = 'fixed' | 'inertial';

export interface UrlState {
  readonly view: ViewId;
  readonly lang: Lang | undefined;
  readonly frame: FrameMode;
  /** Simulation time; undefined means "live" (follow real time). */
  readonly time: Date | undefined;
  readonly rate: number;
  readonly filters: FilterState;
  /** NORAD catalogue number of the selected object (integer, may exceed 99999). */
  readonly selected: number | undefined;
}

export const DEFAULT_URL_STATE: UrlState = {
  view: 'earth',
  lang: undefined,
  frame: 'fixed',
  time: undefined,
  rate: 1,
  filters: EMPTY_FILTERS,
  selected: undefined,
};

export const MAX_ABS_RATE = 10_000;

export function parseUrlState(search: string): UrlState {
  const p = new URLSearchParams(search);
  const lang = p.get('lang');
  const t = p.get('t');
  const time = t ? new Date(t) : undefined;
  const rate = Number(p.get('rate') ?? '1');
  const sel = p.get('sel');
  const selected = sel !== null && /^\d+$/.test(sel) ? Number(sel) : undefined;
  return {
    view: 'earth',
    lang: isLang(lang) ? lang : undefined,
    frame: p.get('frame') === 'inertial' ? 'inertial' : 'fixed',
    time: time && !Number.isNaN(time.getTime()) ? time : undefined,
    rate: Number.isFinite(rate) && Math.abs(rate) <= MAX_ABS_RATE ? rate : 1,
    filters: filtersFromParams(p),
    selected: selected !== undefined && selected > 0 ? selected : undefined,
  };
}

/** Serializes only non-default values to keep links short. */
export function serializeUrlState(state: UrlState): string {
  const p = new URLSearchParams();
  if (state.view !== DEFAULT_URL_STATE.view) p.set('view', state.view);
  if (state.lang) p.set('lang', state.lang);
  if (state.frame !== DEFAULT_URL_STATE.frame) p.set('frame', state.frame);
  if (state.time) p.set('t', state.time.toISOString().replace(/\.\d{3}Z$/, 'Z'));
  if (state.rate !== 1) p.set('rate', String(state.rate));
  filtersToParams(state.filters, p);
  if (state.selected !== undefined) p.set('sel', String(state.selected));
  const s = p.toString();
  return s ? `?${s}` : '';
}
