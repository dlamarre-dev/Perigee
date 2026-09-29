/**
 * Application shell: renderer, clock, camera controller, toolbar, time bar, URL state, follow mode and
 * view switching. Views (Earth, Moon, …) are loaded on demand and implement `View` (./View.ts).
 */
// Bundled OFL fonts (latin subset only: covers English and French).
import '@fontsource/rajdhani/latin-500.css';
import '@fontsource/rajdhani/latin-600.css';
import '@fontsource/rajdhani/latin-700.css';
import '@fontsource/saira-semi-condensed/latin-400.css';
import '@fontsource/saira-semi-condensed/latin-500.css';
import '@fontsource/saira-semi-condensed/latin-600.css';
import '../styles.css';
import {
  QUAT_IDENTITY,
  quatConjugate,
  quatMultiply,
  quatNormalize,
  quatRotate,
  type Quat,
} from '../astro/quat';
import { SimClock } from '../astro/time';
import { add, cross, dot, length, normalize, scale, type Vec3 } from '../astro/vec3';
import { QuaternionOrbitControls } from '../camera/QuaternionOrbitControls';
import { orbitStateLookingFrom, type OrbitState } from '../camera/orbitMath';
import { I18n, detectLang, type Lang, type MessageKey } from '../i18n';
import { Renderer, WebGLUnavailableError } from '../render/Renderer';
import { createStarfield } from '../render/starfield';
import { configureKtx2 } from '../render/textures';
import { About } from '../ui/About';
import { MusicPanel } from '../ui/MusicPanel';
import { TimeControl } from '../ui/TimeControl';
import { Toolbar } from '../ui/Toolbar';
import { h, setSheetGrabLabel } from '../ui/dom';
import { MAX_ABS_RATE, parseUrlState, serializeUrlState, type FrameMode, type ViewId } from './urlState';
import type { FollowApi, View, ViewFactory, ViewHost } from './View';

const UI_REFRESH_S = 0.25;
/** A pointer that moved less than this between down and up is a click, not a drag. */
const CLICK_TOLERANCE_PX = 5;
const FOLLOW_MIN_DISTANCE_KM = 10;

const VIEW_LOADERS: Record<ViewId, () => Promise<ViewFactory>> = {
  earth: () => import('../earth/EarthView').then((m) => m.createEarthView),
  moon: () => import('../moon/MoonView').then((m) => m.createMoonView),
  mars: () => import('../mars/MarsView').then((m) => m.createMarsView),
  solar: () => import('../solar/SolarView').then((m) => m.createSolarView),
};

/**
 * Offline support (production builds only: the dev server's modules are not cacheable assets).
 * `onUpdate` runs when a new worker takes over a page that was already controlled, i.e. a new deployment.
 */
/**
 * Phone portrait layout (bottom sheets); must match the media query in styles.css. Landscape phones keep side
 * panels, which do not cover the bottom of the view.
 */
const PHONE_QUERY = '(max-width: 640px)';

function registerServiceWorker(baseUrl: string, onUpdate: () => void): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const hadController = navigator.serviceWorker.controller !== null;
  // First visit: resources fetched before the worker controls the page bypass it, and Chromium keeps routing
  // requests past it for a moment even after `controllerchange`. Hand everything loaded so far over for caching
  // once control starts, then again a little later; URLs already cached are skipped by the worker.
  const post = (): void => {
    const urls = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((u) => u.startsWith(window.location.origin));
    navigator.serviceWorker.controller?.postMessage({
      type: 'cache-urls',
      urls: [...urls, window.location.href],
    });
  };
  let handedOver = false;
  const handOver = (): void => {
    if (handedOver) return;
    handedOver = true;
    post();
    for (const delayMs of [3_000, 12_000]) window.setTimeout(post, delayMs);
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) onUpdate();
    else handOver();
  });
  const register = (): void => {
    navigator.serviceWorker
      .register(`${baseUrl}sw.js`, { scope: baseUrl })
      .then(() => navigator.serviceWorker.ready)
      .then(() => {
        // Already controlled without a change event (claimed before this listener ran).
        if (!hadController && navigator.serviceWorker.controller) handOver();
      })
      .catch((err: unknown) => {
        console.warn('Service worker registration failed', err);
      });
  };
  // Register after the page's own loads, so caching never competes with the first render.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

function main(): void {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app not found');
  const app: HTMLElement = root;

  const startParams = new URLSearchParams(window.location.search);
  const url = parseUrlState(window.location.search);
  const i18n = new I18n(detectLang(url.lang ?? null, navigator.languages));
  let explicitLang: Lang | undefined = url.lang;
  let frame: FrameMode = url.frame;
  let viewId: ViewId = url.view;

  const applyDocumentLang = (): void => {
    document.documentElement.lang = i18n.lang;
    document.title = i18n.t('app.title');
    document.querySelector('canvas')?.setAttribute('aria-label', i18n.t('app.canvasLabel'));
    setSheetGrabLabel(i18n.t('panel.collapse'));
  };
  applyDocumentLang();
  i18n.onChange(applyDocumentLang);

  const viewport = app.querySelector<HTMLElement>('#viewport');
  if (!viewport) throw new Error('#viewport not found');

  let renderer: Renderer;
  try {
    renderer = new Renderer(viewport, { logarithmicDepthBuffer: true });
    configureKtx2(renderer.renderer, import.meta.env.BASE_URL);
    renderer.canvas.setAttribute('aria-label', i18n.t('app.canvasLabel'));
  } catch (err) {
    if (err instanceof WebGLUnavailableError) {
      viewport.textContent = i18n.t('app.webglUnavailable');
      return;
    }
    throw err;
  }

  const clock = new SimClock();
  if (url.time) clock.jumpTo(url.time);
  clock.setRate(url.rate);

  const stars = createStarfield(4000, renderer.renderer.getPixelRatio());
  renderer.scene.add(stars);

  const placeholderHome: OrbitState = orbitStateLookingFrom([0, 0, 0], [1, 0, 0], [0, 0, 1], 20_000);
  const controls = new QuaternionOrbitControls(renderer.canvas, {
    limits: { minDistanceKm: 1, maxDistanceKm: 1e7 },
    home: placeholderHome,
  });

  let view: View | undefined;
  let viewDom: HTMLElement[] = [];
  let panelToggle: (() => boolean) | undefined;

  const sceneFromInertial = (date: Date): Quat =>
    view && frame === 'fixed' ? quatConjugate(view.bodyOrientation(date)) : QUAT_IDENTITY;

  const homeState = (date: Date): OrbitState => {
    if (!view) return placeholderHome;
    const dir = quatRotate(
      quatMultiply(sceneFromInertial(date), view.bodyOrientation(date)),
      view.homeDirectionBody,
    );
    return orbitStateLookingFrom([0, 0, 0], dir, [0, 0, 1], view.homeDistanceKm);
  };

  // URL sync (on user actions only, never per frame).
  const syncUrl = (): void => {
    const search = serializeUrlState(
      {
        view: viewId,
        lang: explicitLang,
        frame,
        time: clock.isLive() ? undefined : clock.nowUtc(),
        rate: clock.rate,
      },
      (p) => view?.writeUrl(p),
    );
    history.replaceState(null, '', `${window.location.pathname}${search}${window.location.hash}`);
  };

  const notice = h('p', { class: 'notice', role: 'status', hidden: true });
  const offline = h('p', { class: 'offline-badge', role: 'status', hidden: true });
  const renderOffline = (): void => {
    offline.hidden = navigator.onLine;
    offline.textContent = i18n.t('app.offline');
  };
  window.addEventListener('online', renderOffline);
  window.addEventListener('offline', renderOffline);
  i18n.onChange(renderOffline);
  renderOffline();
  registerServiceWorker(import.meta.env.BASE_URL, () => showNotice(i18n.t('app.updateReady')));
  const showNotice = (text: string | undefined): void => {
    notice.hidden = !text;
    notice.textContent = text ?? '';
  };

  // Follow mode, shared by all views.
  let followEnd: (() => void) | undefined;
  const endFollow = (): void => {
    const cb = followEnd;
    followEnd = undefined;
    if (view) controls.setLimits(view.limits);
    cb?.();
  };
  const follow: FollowApi = {
    start(scenePosition, distanceKm, onEnd, viewFrom) {
      const pos = scenePosition();
      if (!pos || !view) return false;
      if (controls.following) follow.stop();
      followEnd = onEnd;
      controls.setLimits({ minDistanceKm: FOLLOW_MIN_DISTANCE_KM, maxDistanceKm: view.limits.maxDistanceKm });
      controls.setFollow(scenePosition);
      // Look at the object from above (radially outward from the body) unless told otherwise, north up.
      controls.flyTo(orbitStateLookingFrom(pos, viewFrom ?? pos, [0, 0, 1], distanceKm));
      return true;
    },
    stop() {
      if (!controls.following) return;
      controls.setFollow(undefined);
      const camKm = controls.cameraPositionKm;
      endFollow();
      if (view) {
        controls.flyTo({
          targetKm: [0, 0, 0],
          distanceKm: Math.max(view.limits.minDistanceKm, length(camKm)),
          orientation: controls.orientation,
        });
      }
    },
    get active() {
      return controls.following;
    },
  };

  const about = new About(i18n, import.meta.env.BASE_URL);
  const timeControl = new TimeControl(clock, i18n, syncUrl);

  // Phones: the time bar and bottom sheets cover the lower part of the canvas. Their height feeds the CSS
  // (sheets sit above the time bar) and the camera, whose projection centre moves to the visible part.
  const phone = window.matchMedia(PHONE_QUERY);
  function updateBottomInset(): void {
    const root = document.documentElement;
    root.style.setProperty(
      '--timebar-h',
      `${Math.ceil(timeControl.element.getBoundingClientRect().height)}px`,
    );
    if (!phone.matches) {
      renderer.setBottomInset(0);
      return;
    }
    const canvasRect = renderer.canvas.getBoundingClientRect();
    let top = canvasRect.bottom;
    for (const el of app.querySelectorAll<HTMLElement>('.side-panel, .music.is-open')) {
      if (el.hidden || el.offsetParent === null) continue;
      top = Math.min(top, el.getBoundingClientRect().top);
    }
    // Only sheets count: the thin time bar alone does not justify moving the view.
    renderer.setBottomInset(top < canvasRect.bottom ? canvasRect.bottom - top : 0);
  }
  phone.addEventListener('change', updateBottomInset);
  window.addEventListener('resize', updateBottomInset);
  const toolbar = new Toolbar(i18n, viewId, frame, {
    onViewChange: (id) => void switchView(id),
    // `music` is created below; the menu can only be used once the page is running.
    onSoundtrack: () => music.toggleOpen(),
    onRecenter: () => {
      follow.stop();
      controls.reset();
    },
    onFrameChange: (mode) => {
      const date = clock.nowUtc();
      if (view) {
        // Re-express the camera in the other frame so the view does not jump.
        const bodyQ = view.bodyOrientation(date);
        const q = mode === 'inertial' ? bodyQ : quatConjugate(bodyQ);
        const s = controls.state;
        controls.setState({
          targetKm: quatRotate(q, s.targetKm),
          distanceKm: s.distanceKm,
          orientation: quatNormalize(quatMultiply(q, s.orientation)),
        });
      }
      frame = mode;
      controls.setHome(homeState(date));
      syncUrl();
    },
    onLangChange: (lang) => {
      explicitLang = lang;
      i18n.setLang(lang);
      syncUrl();
    },
    onAbout: () => about.open(),
    onTogglePanel: () => {
      if (panelToggle) toolbar.setPanelOpen(panelToggle());
    },
  });
  const music = new MusicPanel(i18n);
  app.append(toolbar.element, timeControl.element, music.element, notice, offline, about.element);
  app.querySelector('.loading')?.remove();

  const host: ViewHost = {
    renderer,
    controls,
    clock,
    i18n,
    baseUrl: import.meta.env.BASE_URL,
    initialParams: startParams,
    e2e: startParams.has('e2e'),
    follow,
    frame: () => frame,
    frameObject: (
      pos: Vec3,
      options: {
        tiltRad?: number;
        minDistanceKm?: number;
        targetFraction?: number;
        distanceKm?: number;
      } = {},
    ) => {
      if (!view) return;
      follow.stop();
      const r = length(pos);
      if (r === 0) return;
      const radial = normalize(pos);
      // Tilt the viewpoint towards the scene north (or any perpendicular when the object is on the pole).
      const tilt = options.tiltRad ?? 0;
      let up: Vec3 = [0, 0, 1];
      if (Math.abs(dot(radial, up)) > 0.98) up = [1, 0, 0];
      const side = normalize(cross(radial, up));
      const toNorth = cross(side, radial);
      const dir = normalize(add(scale(radial, Math.cos(tilt)), scale(toNorth, Math.sin(tilt))));
      const distanceKm = Math.min(
        view.limits.maxDistanceKm,
        options.distanceKm ??
          Math.max(controls.state.distanceKm, r * 1.6, options.minDistanceKm ?? 0, view.limits.minDistanceKm),
      );
      const target = scale(pos, options.targetFraction ?? 0);
      controls.flyTo(orbitStateLookingFrom(target, dir, [0, 0, 1], distanceKm));
    },
    sceneFromInertial,
    mount: (el) => {
      viewDom.push(el);
      app.insertBefore(el, timeControl.element);
    },
    syncUrl,
    showNotice,
    setPanelToggle: (labelKey: MessageKey | undefined, toggle?: () => boolean, initiallyOpen = false) => {
      panelToggle = toggle;
      toolbar.setPanel(labelKey, initiallyOpen);
    },
  };

  let switching = Promise.resolve();
  async function switchView(id: ViewId): Promise<void> {
    await switching;
    switching = (async () => {
      follow.stop();
      view?.dispose();
      for (const el of viewDom) el.remove();
      viewDom = [];
      host.setPanelToggle(undefined);
      showNotice(undefined);
      const params = id === url.view && !view ? startParams : new URLSearchParams();
      viewId = id;
      toolbar.setView(id);
      const factory = await VIEW_LOADERS[id]();
      view = factory({ ...host, initialParams: params });
      controls.setLimits(view.limits);
      timeControl.setMaxRate(view.maxRate ?? MAX_ABS_RATE, view.maxRateHint ? i18n.t(view.maxRateHint) : '');
      const home = homeState(clock.nowUtc());
      controls.setHome(home);
      controls.setState(home);
      syncUrl();
    })();
    await switching;
  }
  void switchView(viewId);

  // Clicks: select (click) and follow (double-click); drags are not clicks.
  let downAt: { x: number; y: number } | undefined;
  renderer.canvas.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }));
  const handleClick = (e: MouseEvent, double: boolean): void => {
    if (!view || !downAt) return;
    if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > CLICK_TOLERANCE_PX) return;
    // Pick against the current camera state, not the last rendered frame (slow GPUs, fresh setState).
    controls.applyTo(renderer.camera);
    view.placeOrigin(controls.cameraPositionKm);
    const rect = renderer.canvas.getBoundingClientRect();
    view.click(e.clientX - rect.left, e.clientY - rect.top, double);
  };
  // F: follow the selection / stop following (same guards as the camera keys).
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)))
      return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.toLowerCase() !== 'f') return;
    e.preventDefault();
    view?.toggleFollow();
  });
  renderer.canvas.addEventListener('click', (e) => handleClick(e, false));
  renderer.canvas.addEventListener('dblclick', (e) => handleClick(e, true));

  // Frame loop
  let uiTimerS = 0;
  let wasFollowing = false;
  renderer.start((dtS) => {
    const nowMs = clock.nowMs();
    const date = new Date(nowMs);
    const v = view;
    if (v) {
      const bodyQ = v.bodyOrientation(date);
      const sceneQ = frame === 'fixed' ? quatConjugate(bodyQ) : QUAT_IDENTITY;
      stars.quaternion.set(sceneQ.x, sceneQ.y, sceneQ.z, sceneQ.w);
      if (frame === 'inertial') controls.setHome(homeState(date));

      // The view first: the camera may follow one of its objects.
      const frameInfo = {
        nowMs,
        dtS,
        rate: clock.rate,
        clockEpoch: clock.epoch,
        frame,
        bodyQ,
        sceneFromInertial: sceneQ,
      };
      v.update(frameInfo);
      controls.update(dtS);
      // The R key resets the controls directly; restore the view limits when following ends that way.
      if (wasFollowing && !controls.following) endFollow();
      wasFollowing = controls.following;
      controls.applyTo(renderer.camera);
      const originKm: Vec3 = controls.cameraPositionKm;
      v.placeOrigin(originKm);
      const altitudeKm = length(originKm) - v.bodyRadiusKm;
      renderer.setClipPlanes(
        Math.max(0.001, Math.min(Math.max(altitudeKm, 0.01) * 0.5, controls.state.distanceKm * 0.1)),
        length(originKm) + v.farKm,
      );
    }

    uiTimerS += dtS;
    if (uiTimerS >= UI_REFRESH_S) {
      uiTimerS = 0;
      timeControl.update();
      v?.uiTick(nowMs);
      updateBottomInset();
    }
  });
}

main();
