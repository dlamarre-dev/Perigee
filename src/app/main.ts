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
import { SkyMesh } from '../render/SkyMesh';
import { createStarfield } from '../render/starfield';
import { configureKtx2 } from '../render/textures';
import { loadManifest } from '../data/loader';
import { About } from '../ui/About';
import { ReportDialog, qualitySummary } from '../ui/ReportDialog';
import { setPreviewFrameRate } from '../ui/ModelPreview';
import { MusicPanel } from '../ui/MusicPanel';
import { TimeControl } from '../ui/TimeControl';
import { Toolbar } from '../ui/Toolbar';
import { h, setSheetGrabLabel } from '../ui/dom';
import { MAX_ABS_RATE, parseUrlState, serializeUrlState, type FrameMode, type ViewId } from './urlState';
import {
  readDeviceSignals,
  resolveQuality,
  setQuality,
  storedPixelRatio,
  storeChoice,
  storePixelRatio,
} from '../render/quality';
import {
  UpdateWatcher,
  claimAutoReload,
  saveCamera,
  takeCamera,
  type CameraSnapshot,
  type UpdateKind,
} from './updates';
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
 * Offline support (production builds only: the dev server's modules are not cacheable assets). New deployments
 * are detected by the UpdateWatcher (./updates.ts), not by the worker: its script rarely changes.
 */
/**
 * Phone portrait layout (bottom sheets); must match the media query in styles.css. Landscape phones keep side
 * panels, which do not cover the bottom of the view.
 */
const PHONE_QUERY = '(max-width: 640px)';

function registerServiceWorker(baseUrl: string): void {
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
    if (!hadController) handOver();
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

  // Quality tier (src/app/quality.ts): decided before the renderer, which it configures.
  const qualityState = resolveQuality(startParams.get('quality'), readDeviceSignals());
  setQuality(qualityState);
  const q = qualityState.settings;
  document.documentElement.dataset['quality'] = q.tier;
  setPreviewFrameRate(q.previewFps);
  // Idle: clock paused, camera still, no input for a moment (the low tier then draws fewer frames).
  let lastInputMs = performance.now();
  for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart']) {
    window.addEventListener(type, () => (lastInputMs = performance.now()), { passive: true, capture: true });
  }
  let isIdle = (): boolean => false;

  let renderer: Renderer;
  try {
    renderer = new Renderer(viewport, {
      logarithmicDepthBuffer: true,
      antialias: q.msaa,
      maxPixelRatio: q.maxPixelRatio,
      minPixelRatio: q.minPixelRatio,
      startPixelRatio: storedPixelRatio(q.tier),
      maxFps: q.maxFps,
      idleFps: q.idleFps,
      isIdle: () => isIdle(),
      onPixelRatio: (ratio) => storePixelRatio(q.tier, ratio),
    });
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

  // Real sky (NASA SVS star map); the procedural starfield shows until it has loaded.
  const stars = createStarfield(4000, renderer.pixelRatio);
  const sky = new SkyMesh({
    baseUrl: import.meta.env.BASE_URL,
    maxTextureSize: renderer.maxTextureSize,
    anisotropy: renderer.renderer.capabilities.getMaxAnisotropy(),
    onReady: () => {
      stars.visible = false;
      // The 8k level (~25 MB) only pays off on large high-density screens of the high tier, once the page has
      // settled.
      const px = Math.max(window.screen.width, window.screen.height) * window.devicePixelRatio;
      if (q.textures8k && px >= 2500 && renderer.maxTextureSize >= 8192)
        window.setTimeout(() => sky.requestDetail(), 8000);
    },
  });
  renderer.scene.add(sky.mesh, stars);

  const placeholderHome: OrbitState = orbitStateLookingFrom([0, 0, 0], [1, 0, 0], [0, 0, 1], 20_000);
  const controls = new QuaternionOrbitControls(renderer.canvas, {
    limits: { minDistanceKm: 1, maxDistanceKm: 1e7 },
    home: placeholderHome,
  });
  isIdle = () => clock.paused && !controls.moving && performance.now() - lastInputMs > 1500;

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
      (p) => {
        view?.writeUrl(p);
        // Test hooks, a forced quality tier and the perf overlay survive the URL rewrites (and update reloads).
        if (startParams.has('e2e')) p.set('e2e', '');
        for (const key of ['quality', 'debug']) {
          const value = startParams.get(key);
          if (value) p.set(key, value);
        }
      },
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
  registerServiceWorker(import.meta.env.BASE_URL);
  const showNotice = (text: string | undefined): void => {
    notice.hidden = !text;
    notice.textContent = text ?? '';
  };

  // New build or newer data while the tab stays open (./updates.ts): a tab in the background reloads when it
  // comes back; a visible one offers a button. The URL already holds view, selection, filters and time; the
  // camera is carried over in sessionStorage.
  const updateText = h('span');
  const updateButton = h('button', { type: 'button', class: 'btn' });
  const updateNotice = h('p', { class: 'update-notice', role: 'status', hidden: true }, [
    updateText,
    updateButton,
  ]);
  let updateKind: UpdateKind | undefined;
  const renderUpdateNotice = (): void => {
    updateText.textContent = updateKind
      ? i18n.t(updateKind === 'app' ? 'app.updateReady' : 'app.dataReady')
      : '';
    updateButton.textContent = i18n.t('app.refresh');
  };
  i18n.onChange(renderUpdateNotice);
  const cameraSnapshot = (): CameraSnapshot => {
    const s = controls.state;
    const q = s.orientation;
    return {
      view: viewId,
      frame,
      savedAtMs: Date.now(),
      targetKm: [s.targetKm[0], s.targetKm[1], s.targetKm[2]],
      distanceKm: s.distanceKm,
      orientation: { x: q.x, y: q.y, z: q.z, w: q.w },
      following: controls.following,
    };
  };
  const reloadKeepingView = (): void => {
    syncUrl();
    if (view) saveCamera(cameraSnapshot());
    window.location.reload();
  };
  updateButton.addEventListener('click', reloadKeepingView);
  let reloadWhenVisible = false;
  document.addEventListener('visibilitychange', () => {
    if (reloadWhenVisible && document.visibilityState === 'visible') reloadKeepingView();
  });
  const updates = new UpdateWatcher({
    baseUrl: import.meta.env.BASE_URL,
    commit: __PERIGEE_BUILD__.commit,
    loaded: () => view?.dataVersions?.() ?? new Map<string, string>(),
    loadManifest: () => loadManifest(import.meta.env.BASE_URL),
    onUpdate: (kind) => {
      if (document.visibilityState === 'hidden') {
        reloadWhenVisible = true;
        return;
      }
      updateKind = kind;
      renderUpdateNotice();
      updateNotice.hidden = false;
    },
  });
  updates.start();
  if (startParams.has('e2e')) {
    Object.assign(window, {
      __perigeeShell: { checkUpdates: () => updates.check(), camera: () => controls.state },
    });
  }

  // Follow mode, shared by all views.
  let followEnd: (() => void) | undefined;
  const endFollow = (): void => {
    const cb = followEnd;
    followEnd = undefined;
    if (view) controls.setLimits(view.limits);
    cb?.();
  };
  const follow: FollowApi = {
    start(scenePosition, distanceKm, onEnd, options = {}) {
      const pos = scenePosition();
      if (!pos || !view) return false;
      if (controls.following) follow.stop();
      followEnd = onEnd;
      controls.setLimits({
        minDistanceKm: options.minDistanceKm ?? FOLLOW_MIN_DISTANCE_KM,
        maxDistanceKm: view.limits.maxDistanceKm,
      });
      controls.setFollow(scenePosition);
      // Look at the object from above (radially outward from the body) unless told otherwise, north up.
      controls.flyTo(orbitStateLookingFrom(pos, options.viewFrom ?? pos, [0, 0, 1], distanceKm));
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
  const report = new ReportDialog(i18n);
  const timeControl = new TimeControl(clock, i18n, syncUrl);

  // Phones: the time bar and bottom sheets cover the lower part of the canvas. Their height feeds the CSS
  // (sheets sit above the time bar) and the camera, whose projection centre moves to the visible part.
  const phone = window.matchMedia(PHONE_QUERY);
  // Run before the UI tick writes to the DOM, so these reads use the layout the browser already has.
  // The bars' real extent feeds the CSS, so panels and notices sit between them whatever their layout
  // (--toolbar-bottom: from the top of the window to the top bar's bottom edge, its open menu included, so the
  // panels make room for it; --timebar-space: from the bottom bar's top edge to the bottom of the window).
  const cssPx = new Map<string, string>();
  const setCssPx = (name: string, px: number): void => {
    const value = `${Math.ceil(px)}px`;
    if (cssPx.get(name) === value) return;
    cssPx.set(name, value);
    document.documentElement.style.setProperty(name, value);
  };
  function updateBottomInset(): void {
    const timeRect = timeControl.element.getBoundingClientRect();
    setCssPx('--timebar-h', timeRect.height);
    setCssPx('--timebar-space', window.innerHeight - timeRect.top);
    setCssPx('--toolbar-bottom', toolbar.element.getBoundingClientRect().bottom);
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
  const toolbar = new Toolbar(
    i18n,
    viewId,
    frame,
    {
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
      onReport: () => report.open(),
      onQualityChange: (choice) => {
        storeChoice(choice);
        // Applied from startup (MSAA, textures and models are chosen once): reload in place, view and camera kept.
        reloadKeepingView();
      },
      onTogglePanel: () => {
        if (panelToggle) toolbar.setPanelOpen(panelToggle());
      },
    },
    qualityState.choice,
    qualityState.detected.tier,
  );
  // The panels follow a bar as soon as it changes size (menu opened, date row, new layout level).
  const barObserver = new ResizeObserver(() => updateBottomInset());
  barObserver.observe(toolbar.element);
  barObserver.observe(timeControl.element);
  const music = new MusicPanel(i18n);
  app.append(
    toolbar.element,
    timeControl.element,
    music.element,
    notice,
    updateNotice,
    offline,
    about.element,
    report.element,
  );
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
      if (!view || keepRestoredCamera) return;
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

  // Camera carried over an update reload: the view's startup framing (selection from the URL) must not move it,
  // until the user takes the controls. Following resumes once the selected object has a position.
  let keepRestoredCamera = false;
  let resumeFollowUntilMs = 0;
  const releaseRestoredCamera = (): void => {
    keepRestoredCamera = false;
  };
  function restoreCamera(s: CameraSnapshot): void {
    controls.setState({
      targetKm: [s.targetKm[0], s.targetKm[1], s.targetKm[2]],
      distanceKm: s.distanceKm,
      orientation: quatNormalize(s.orientation),
    });
    keepRestoredCamera = true;
    for (const type of ['pointerdown', 'wheel', 'keydown', 'touchstart']) {
      window.addEventListener(type, releaseRestoredCamera, { once: true, capture: true });
    }
    window.setTimeout(releaseRestoredCamera, 20_000);
    if (s.following) resumeFollowUntilMs = Date.now() + 20_000;
  }

  // View switches run one after the other (each chained synchronously on the previous one, so two quick
  // clicks cannot run together); a switch superseded by a later request before it starts is skipped.
  let switching = Promise.resolve();
  let requestedView: ViewId = viewId;
  let firstView = true;
  async function switchView(id: ViewId): Promise<void> {
    requestedView = id;
    const run = switching.then(async () => {
      if (id !== requestedView) return;
      follow.stop();
      view?.dispose();
      view = undefined;
      for (const el of viewDom) el.remove();
      viewDom = [];
      host.setPanelToggle(undefined);
      showNotice(undefined);
      // The page's URL parameters (selection, filters…) apply to the first view only.
      const params = firstView && id === url.view ? startParams : new URLSearchParams();
      firstView = false;
      viewId = id;
      toolbar.setView(id);
      const factory = await VIEW_LOADERS[id]().catch((err: unknown) => {
        // A tab opened before a deployment asks for chunks that no longer exist: reload on the new build (once).
        if (claimAutoReload()) {
          syncUrl();
          window.location.reload();
        }
        throw err;
      });
      view = factory({ ...host, initialParams: params });
      controls.setLimits(view.limits);
      timeControl.setMaxRate(view.maxRate ?? MAX_ABS_RATE, view.maxRateHint ? i18n.t(view.maxRateHint) : '');
      const home = homeState(clock.nowUtc());
      controls.setHome(home);
      controls.setState(home);
      const restored = takeCamera(id, frame);
      if (restored) restoreCamera(restored);
      syncUrl();
    });
    switching = run.catch((err: unknown) => console.error(err));
    await run;
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

  // ?debug=perf: tier, reasons, GPU, frame rate and render scale (maintenance only, not translated).
  let framesDrawn = 0;
  if (startParams.get('debug') === 'perf') {
    const overlay = h('pre', { class: 'perf-overlay', 'aria-hidden': 'true' });
    app.append(overlay);
    let last = performance.now();
    window.setInterval(() => {
      const now = performance.now();
      const fps = (framesDrawn * 1000) / (now - last);
      framesDrawn = 0;
      last = now;
      overlay.textContent = `${qualitySummary()}
${
  q.tier === qualityState.detected.tier
    ? ''
    : `detected ${qualityState.detected.tier} (${qualityState.detected.reasons.join(', ')})
`
}${fps.toFixed(0)} fps · DPR ${window.devicePixelRatio} · max texture ${qualityState.signals.maxTextureSize} · MSAA ${qualityState.signals.maxSamples} · ${qualityState.signals.deviceMemoryGb ?? '?'} GB · ${qualityState.signals.cores ?? '?'} cores`;
    }, 500);
  }

  // Frame loop
  let uiTimerS = 0;
  let wasFollowing = false;
  renderer.start((dtS) => {
    framesDrawn++;
    const nowMs = clock.nowMs();
    const date = new Date(nowMs);
    const v = view;
    if (v) {
      const bodyQ = v.bodyOrientation(date);
      const sceneQ = frame === 'fixed' ? quatConjugate(bodyQ) : QUAT_IDENTITY;
      stars.quaternion.set(sceneQ.x, sceneQ.y, sceneQ.z, sceneQ.w);
      sky.mesh.quaternion.copy(stars.quaternion);
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
      const otherSurfaceKm = v.nearestSurfaceKm?.(originKm) ?? Infinity;
      renderer.setClipPlanes(
        Math.max(
          0.001,
          Math.min(
            Math.max(altitudeKm, 0.01) * 0.5,
            controls.state.distanceKm * 0.1,
            Math.max(otherSurfaceKm, 0.01) * 0.5,
          ),
        ),
        length(originKm) + v.farKm,
      );
    }

    uiTimerS += dtS;
    if (uiTimerS >= UI_REFRESH_S) {
      uiTimerS = 0;
      updateBottomInset();
      timeControl.update();
      v?.uiTick(nowMs);
      if (resumeFollowUntilMs > 0) {
        if (follow.active || Date.now() > resumeFollowUntilMs) resumeFollowUntilMs = 0;
        else v?.toggleFollow();
      }
    }
  });
}

main();
