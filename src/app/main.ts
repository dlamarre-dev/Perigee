/**
 * Application shell: renderer, clock, camera controller, toolbar, time bar, URL state, follow mode and
 * view switching. Views (Earth, Moon, …) are loaded on demand and implement `View` (./View.ts).
 */
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
import { length, type Vec3 } from '../astro/vec3';
import { QuaternionOrbitControls } from '../camera/QuaternionOrbitControls';
import { orbitStateLookingFrom, type OrbitState } from '../camera/orbitMath';
import { I18n, detectLang, type Lang, type MessageKey } from '../i18n';
import { Renderer, WebGLUnavailableError } from '../render/Renderer';
import { createStarfield } from '../render/starfield';
import { About } from '../ui/About';
import { TimeControl } from '../ui/TimeControl';
import { Toolbar } from '../ui/Toolbar';
import { h } from '../ui/dom';
import { parseUrlState, serializeUrlState, type FrameMode, type ViewId } from './urlState';
import type { FollowApi, View, ViewFactory, ViewHost } from './View';

const UI_REFRESH_S = 0.25;
/** A pointer that moved less than this between down and up is a click, not a drag. */
const CLICK_TOLERANCE_PX = 5;
const FOLLOW_MIN_DISTANCE_KM = 10;

const VIEW_LOADERS: Record<ViewId, () => Promise<ViewFactory>> = {
  earth: () => import('../earth/EarthView').then((m) => m.createEarthView),
  moon: () => import('../moon/MoonView').then((m) => m.createMoonView),
};

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
  };
  applyDocumentLang();
  i18n.onChange(applyDocumentLang);

  const viewport = app.querySelector<HTMLElement>('#viewport');
  if (!viewport) throw new Error('#viewport not found');

  let renderer: Renderer;
  try {
    renderer = new Renderer(viewport, { logarithmicDepthBuffer: true });
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
    start(scenePosition, distanceKm, onEnd) {
      const pos = scenePosition();
      if (!pos || !view) return false;
      if (controls.following) follow.stop();
      followEnd = onEnd;
      controls.setLimits({ minDistanceKm: FOLLOW_MIN_DISTANCE_KM, maxDistanceKm: view.limits.maxDistanceKm });
      controls.setFollow(scenePosition);
      // Look at the object from above (radially outward from the body), north up.
      controls.flyTo(orbitStateLookingFrom(pos, pos, [0, 0, 1], distanceKm));
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

  const about = new About(i18n);
  const timeControl = new TimeControl(clock, i18n, syncUrl);
  const toolbar = new Toolbar(i18n, viewId, frame, {
    onViewChange: (id) => void switchView(id),
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
  app.append(toolbar.element, timeControl.element, notice, about.element);
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
    }
  });
}

main();
