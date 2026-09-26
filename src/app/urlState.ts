/**
 * Application state mirrored in the URL query string (shareable links). Pure parse/serialize functions;
 * extended with filters and the selected object in M1.
 */
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
}

export const DEFAULT_URL_STATE: UrlState = {
  view: 'earth',
  lang: undefined,
  frame: 'fixed',
  time: undefined,
  rate: 1,
};

export const MAX_ABS_RATE = 10_000;

export function parseUrlState(search: string): UrlState {
  const p = new URLSearchParams(search);
  const lang = p.get('lang');
  const t = p.get('t');
  const time = t ? new Date(t) : undefined;
  const rate = Number(p.get('rate') ?? '1');
  return {
    view: 'earth',
    lang: isLang(lang) ? lang : undefined,
    frame: p.get('frame') === 'inertial' ? 'inertial' : 'fixed',
    time: time && !Number.isNaN(time.getTime()) ? time : undefined,
    rate: Number.isFinite(rate) && Math.abs(rate) <= MAX_ABS_RATE ? rate : 1,
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
  const s = p.toString();
  return s ? `?${s}` : '';
}
