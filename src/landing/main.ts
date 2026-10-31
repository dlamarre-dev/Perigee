/**
 * Landing pages' script (CLAUDE.md §7): the language banner, the dashboard mode, the visitor's place, the live
 * widgets (./live.ts) over the headless engine, the 3D view in its iframe (embed API `perigee:v1`) and the reload
 * when a new version of the site is deployed. The page itself is static HTML (./render.ts).
 */
import '../styles/shared';
import './landing.css';
import { EMBED_PROTOCOL } from '../app/embedApi';
import { UpdateWatcher } from '../app/updates';
import { loadManifest } from '../data/loader';
import { detectLang, I18n, isLang, type Lang } from '../i18n';
import { createWidget, renderProvenance, type Widget } from './live';
import { forgetPlace, loadPlace, localStore, locate, savePlace, type Place } from './observer';
import { topicById, topicHasPlace } from './topics';

const root = document.documentElement;
const lang: Lang = isLang(root.lang) ? root.lang : 'en';
const base = root.dataset['base'] ?? import.meta.env.BASE_URL;
const baseUrl = new URL(base, location.origin).href;
const i18n = new I18n(lang);
const store = localStore();
const BANNER_KEY = 'perigee-landing-banner';

/** A browser that prefers the other language gets a banner (no redirect: search engines read the page as is). */
function languageBanner(): void {
  const banner = document.getElementById('lp-lang-banner');
  if (!banner) return;
  let dismissed = false;
  try {
    dismissed = store?.getItem(BANNER_KEY) === '1';
  } catch {
    // Storage blocked: show it again next time.
  }
  if (dismissed || detectLang(null, navigator.languages ?? [navigator.language]) === lang) return;
  banner.hidden = false;
  document.getElementById('lp-lang-close')?.addEventListener('click', () => {
    banner.hidden = true;
    try {
      store?.setItem(BANNER_KEY, '1');
    } catch {
      // Not remembered.
    }
  });
}

/** Dashboard: full screen, large type, the screen kept awake (classroom monitors). `?dashboard=1` opens it. */
function dashboard(): void {
  const button = document.getElementById('lp-dashboard');
  if (!button) return;
  let lock: WakeLockSentinel | undefined;
  const keepAwake = async (on: boolean): Promise<void> => {
    try {
      if (on && 'wakeLock' in navigator && document.visibilityState === 'visible')
        lock = await navigator.wakeLock.request('screen');
      else {
        await lock?.release();
        lock = undefined;
      }
    } catch {
      // Not allowed (battery saver, iframe): the page still works.
    }
  };
  const set = (on: boolean): void => {
    root.classList.toggle('lp-dashboard', on);
    button.textContent = i18n.t(on ? 'landing.dashboardExit' : 'landing.dashboard');
    button.setAttribute('aria-pressed', String(on));
    void keepAwake(on);
    const url = new URL(location.href);
    if (on) url.searchParams.set('dashboard', '1');
    else url.searchParams.delete('dashboard');
    history.replaceState(null, '', url);
  };
  button.addEventListener('click', () => {
    const on = !root.classList.contains('lp-dashboard');
    set(on);
    if (on) void document.documentElement.requestFullscreen?.().catch(() => undefined);
    else if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  });
  // The lock is released when the tab is hidden: take it again on return.
  document.addEventListener('visibilitychange', () => {
    if (root.classList.contains('lp-dashboard') && document.visibilityState === 'visible')
      void keepAwake(true);
  });
  if (new URLSearchParams(location.search).get('dashboard') === '1') set(true);
}

/** The 3D view: sends it the visitor's place (postMessage only, never in its address). */
function viewFrame(): { setPlace(place: Place | undefined): void } {
  const frame = document.querySelector<HTMLIFrameElement>('.lp-view iframe');
  let ready = false;
  let wanted: Place | undefined;
  const send = (): void => {
    if (!ready || !frame?.contentWindow) return;
    frame.contentWindow.postMessage(
      {
        type: EMBED_PROTOCOL,
        id: 'observer',
        method: 'set',
        params: { observer: wanted ? { latDeg: wanted.latDeg, lonDeg: wanted.lonDeg } : null },
      },
      location.origin,
    );
  };
  window.addEventListener('message', (e: MessageEvent) => {
    const msg = e.data as { type?: string; event?: string } | null;
    if (e.source !== frame?.contentWindow || msg?.type !== EMBED_PROTOCOL || msg.event !== 'ready') return;
    ready = true;
    send();
  });
  return {
    setPlace(place) {
      wanted = place;
      send();
    },
  };
}

/** The "My location" buttons. */
function placeControls(onChange: (place: Place | undefined) => void): () => Place | undefined {
  let place = loadPlace(store);
  const use = document.getElementById('lp-locate') as HTMLButtonElement | null;
  const forget = document.getElementById('lp-forget') as HTMLButtonElement | null;
  const status = document.getElementById('lp-place-status');
  const show = (): void => {
    if (forget) forget.hidden = !place;
    if (status)
      status.textContent = place
        ? i18n.format('landing.place.at', { coords: i18n.latLon(place.latDeg, place.lonDeg) })
        : '';
  };
  use?.addEventListener('click', () => {
    if (status) status.textContent = i18n.t('landing.place.locating');
    use.disabled = true;
    locate()
      .then((p) => {
        place = p;
        savePlace(store, p);
        show();
        onChange(place);
      })
      .catch((err: unknown) => {
        if (status)
          status.textContent = i18n.t(
            err instanceof Error && err.message === 'unsupported'
              ? 'landing.place.unsupported'
              : 'landing.place.denied',
          );
      })
      .finally(() => {
        use.disabled = false;
      });
  });
  forget?.addEventListener('click', () => {
    place = undefined;
    forgetPlace(store);
    show();
    onChange(undefined);
  });
  show();
  return () => place;
}

async function start(): Promise<void> {
  languageBanner();
  dashboard();
  // A monitor left open for days: reload when a new version of the site is deployed.
  new UpdateWatcher({
    baseUrl,
    commit: __PERIGEE_BUILD__.commit,
    loaded: () => new Map(),
    loadManifest: () => loadManifest(baseUrl),
    onUpdate: (kind) => {
      if (kind === 'app') location.reload();
    },
    intervalMs: 60 * 60_000,
  }).start();
  const topic = topicById(root.dataset['topic'] ?? '');
  if (!topic) return;
  const frame = viewFrame();
  // The widget exists once the engine has loaded; a place given before then is used by its first update.
  const live: { widget?: Widget } = {};
  const placeOf = topicHasPlace(topic)
    ? placeControls((place) => {
        frame.setPlace(place);
        live.widget?.placeChanged?.(place);
        void tick();
      })
    : () => undefined;
  frame.setPlace(placeOf());
  const { createEngine } = await import('../engine');
  const engine = createEngine({ baseUrl });
  const widget = createWidget({ engine, i18n, topic, baseUrl, place: placeOf });
  live.widget = widget;
  let busy = false;
  async function tick(): Promise<void> {
    if (busy || !live.widget) return;
    busy = true;
    const now = new Date();
    try {
      await widget.tick(now);
      renderProvenance(i18n, widget.provenance(), now);
    } catch (err) {
      console.warn('Landing page update failed', err);
    } finally {
      busy = false;
    }
  }
  await tick();
  window.setInterval(() => void tick(), 1000);
}

void start();
