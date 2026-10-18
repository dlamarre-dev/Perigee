/**
 * Embed API (`perigee:v1`): a page that shows Perigee in an iframe drives it with `window.postMessage`, for
 * example an AI assistant's lesson page. Nothing private crosses it (the view, the time, the selection, a picture
 * of the 3D view, the published facts), so any origin may embed and call it; replies go to the caller's origin.
 *
 *   iframe.contentWindow.postMessage({ type: 'perigee:v1', id: 1, method: 'set', params: { sel: 'mars' } }, '*');
 *   → { type: 'perigee:v1', id: 1, ok: true, result: { view: 'solar', sel: 'mars', … } }
 *
 * Methods: `get` (state; `{ details: true }` adds the selected object's facts and position with provenance),
 * `set` (any of view, sel, time, rate, frame, lang, follow), `snapshot` (PNG data URL of the 3D view, `kind:
 * 'shown' | 'objects'`), `ping`. Events, posted to the parent: `ready`, `view`, `selection`, `time`.
 */
import type { Lang } from '../i18n';
import { MAX_ABS_RATE, VIEW_IDS, type FrameMode, type ViewId } from './urlState';

export const EMBED_PROTOCOL = 'perigee:v1';

export interface EmbedState {
  readonly view: ViewId;
  /** The selection as the URL's `sel` value, or null. */
  readonly sel: string | null;
  /** Simulation time (ISO UTC) and whether it follows real time. */
  readonly time: string;
  readonly live: boolean;
  readonly rate: number;
  readonly frame: FrameMode;
  readonly lang: Lang;
  readonly following: boolean;
  /** Link to the same view in the full app. */
  readonly url: string;
}

export interface SetParams {
  readonly view?: ViewId;
  /** `sel` value; null clears the selection. */
  readonly sel?: string | null;
  /** ISO date, or "now" for real time. */
  readonly time?: string;
  readonly rate?: number;
  readonly frame?: FrameMode;
  readonly lang?: Lang;
  readonly follow?: boolean;
}

export interface EmbedHost {
  state(): EmbedState;
  set(params: SetParams): Promise<void>;
  snapshot(kind: 'shown' | 'objects'): Promise<{ readonly dataUrl: string; readonly title: string }>;
  /** Facts and position of the selection, from the headless engine (loaded on first use). */
  details(state: EmbedState): Promise<unknown>;
}

export class EmbedError extends Error {}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Checks the parameters of a `set` call; throws an EmbedError naming the first bad one. */
export function parseSetParams(raw: unknown): SetParams {
  if (raw === undefined) return {};
  if (!isObject(raw)) throw new EmbedError('params must be an object');
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(raw)) {
    switch (key) {
      case 'view':
        if (!(VIEW_IDS as readonly unknown[]).includes(v))
          throw new EmbedError(`view must be one of ${VIEW_IDS.join(', ')}`);
        break;
      case 'sel':
        if (v !== null && (typeof v !== 'string' || !v || v.length > 100))
          throw new EmbedError('sel must be a string or null');
        break;
      case 'time':
        if (typeof v !== 'string' || (v !== 'now' && Number.isNaN(Date.parse(v))))
          throw new EmbedError('time must be an ISO date or "now"');
        break;
      case 'rate':
        if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > MAX_ABS_RATE)
          throw new EmbedError(`rate must be a number within ±${MAX_ABS_RATE}`);
        break;
      case 'frame':
        if (v !== 'fixed' && v !== 'inertial') throw new EmbedError('frame must be "fixed" or "inertial"');
        break;
      case 'lang':
        if (v !== 'en' && v !== 'fr') throw new EmbedError('lang must be "en" or "fr"');
        break;
      case 'follow':
        if (typeof v !== 'boolean') throw new EmbedError('follow must be a boolean');
        break;
      default:
        throw new EmbedError(`unknown parameter "${key}"`);
    }
    out[key] = v;
  }
  return out as SetParams;
}

interface Target {
  postMessage(message: unknown, targetOrigin: string): void;
}

/** Answers `perigee:v1` requests and posts events to the embedding page. */
export class EmbedApi {
  private last: EmbedState | undefined;

  constructor(
    private readonly host: EmbedHost,
    private readonly parent: Target,
    win: Pick<Window, 'addEventListener'> = window,
  ) {
    win.addEventListener('message', (e: MessageEvent) => void this.onMessage(e));
  }

  /** Tells the parent the embed is ready, with its state. */
  ready(): void {
    this.last = this.host.state();
    this.emit('ready', this.last);
  }

  /** Posts `view`, `selection` and `time` events for what changed since the last call. */
  changed(): void {
    if (!this.last) return;
    const s = this.host.state();
    const was = this.last;
    this.last = s;
    if (s.view !== was.view) this.emit('view', s);
    if (s.sel !== was.sel) this.emit('selection', s);
    if (s.live !== was.live || s.rate !== was.rate || (!s.live && s.time !== was.time)) this.emit('time', s);
  }

  private emit(event: string, data: unknown): void {
    this.parent.postMessage({ type: EMBED_PROTOCOL, event, data }, '*');
  }

  private async onMessage(e: MessageEvent): Promise<void> {
    const msg: unknown = e.data;
    if (!isObject(msg) || msg['type'] !== EMBED_PROTOCOL || typeof msg['method'] !== 'string') return;
    const source = e.source as Target | null;
    if (!source) return;
    const id = msg['id'];
    const reply = (body: Record<string, unknown>): void =>
      source.postMessage(
        { type: EMBED_PROTOCOL, id, ...body },
        e.origin && e.origin !== 'null' ? e.origin : '*',
      );
    try {
      reply({ ok: true, result: await this.call(msg['method'], msg['params']) });
    } catch (err) {
      reply({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async call(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'ping':
        return { protocol: EMBED_PROTOCOL };
      case 'get': {
        const state = this.host.state();
        const details = isObject(params) && params['details'] === true;
        return details ? { ...state, details: await this.host.details(state) } : state;
      }
      case 'set':
        await this.host.set(parseSetParams(params));
        this.changed();
        return this.host.state();
      case 'snapshot': {
        const kind = isObject(params) && params['kind'] === 'objects' ? 'objects' : 'shown';
        return { ...(await this.host.snapshot(kind)), kind, mimeType: 'image/png', state: this.host.state() };
      }
      default:
        throw new EmbedError(`unknown method "${method}"`);
    }
  }
}

/**
 * Engine id of a `sel` value: the same, except launch sites (`site:<id>` in the Earth view) and the Earth view's
 * Moon.
 */
export function engineIdOf(view: ViewId, sel: string): string {
  if (view === 'earth' && sel.startsWith('site:')) return `launch:${sel.slice(5)}`;
  if (sel === 'moon') return 'moon:moon';
  return sel;
}
