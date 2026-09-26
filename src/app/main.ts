import '../styles.css';
import { Vector3 } from 'three';
import { DEG_TO_RAD, EARTH_EQUATORIAL_RADIUS_KM } from '../astro/constants';
import { eciToEcef, latLonToUnit, rotZ } from '../astro/frames';
import { sunDirectionEci } from '../astro/sun';
import { SimClock, gmstRad } from '../astro/time';
import type { Vec3 } from '../astro/vec3';
import { QuaternionOrbitControls } from '../camera/QuaternionOrbitControls';
import {
  orbitStateLookingFrom,
  quatFromAxisAngle,
  quatMultiply,
  quatNormalize,
  type OrbitState,
} from '../camera/orbitMath';
import { I18n, detectLang, type Lang } from '../i18n';
import { EarthMesh } from '../render/EarthMesh';
import { Renderer, WebGLUnavailableError } from '../render/Renderer';
import { toRenderSpace } from '../render/floatingOrigin';
import { createStarfield } from '../render/starfield';
import { loadProgressiveTexture } from '../render/textures';
import { About } from '../ui/About';
import { TimeControl } from '../ui/TimeControl';
import { Toolbar } from '../ui/Toolbar';
import { parseUrlState, serializeUrlState, type FrameMode } from './urlState';

const R = EARTH_EQUATORIAL_RADIUS_KM;
const EARTH_LIMITS = { minDistanceKm: R * 1.02, maxDistanceKm: R * 60 };
/** Default viewpoint over the Americas, north up. */
const HOME_LAT_RAD = 20 * DEG_TO_RAD;
const HOME_LON_RAD = -73 * DEG_TO_RAD;
const HOME_DISTANCE_KM = R * 3.4;
const UI_REFRESH_S = 0.25;

function homeState(frame: FrameMode, gmst: number): OrbitState {
  const dirEcef = latLonToUnit(HOME_LAT_RAD, HOME_LON_RAD);
  const dir = frame === 'fixed' ? dirEcef : rotZ(dirEcef, gmst);
  return orbitStateLookingFrom([0, 0, 0], dir, [0, 0, 1], HOME_DISTANCE_KM);
}

/** Re-expresses the camera in the other frame so the view does not jump when switching. */
function convertOrbitFrame(state: OrbitState, to: FrameMode, gmst: number): OrbitState {
  const angle = to === 'inertial' ? gmst : -gmst;
  const q = quatFromAxisAngle([0, 0, 1], angle);
  return {
    targetKm: rotZ(state.targetKm, angle),
    distanceKm: state.distanceKm,
    orientation: quatNormalize(quatMultiply(q, state.orientation)),
  };
}

function main(): void {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app not found');

  const url = parseUrlState(window.location.search);
  const i18n = new I18n(detectLang(url.lang ?? null, navigator.languages));
  let explicitLang: Lang | undefined = url.lang;
  let frame: FrameMode = url.frame;

  const applyDocumentLang = (): void => {
    document.documentElement.lang = i18n.lang;
    document.title = i18n.t('app.title');
  };
  applyDocumentLang();
  i18n.onChange(applyDocumentLang);

  const viewport = root.querySelector<HTMLElement>('#viewport');
  if (!viewport) throw new Error('#viewport not found');

  let renderer: Renderer;
  try {
    renderer = new Renderer(viewport);
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

  // Scene
  const anisotropy = renderer.renderer.capabilities.getMaxAnisotropy();
  const earth = new EarthMesh(
    loadProgressiveTexture({
      baseUrl: import.meta.env.BASE_URL,
      body: 'earth',
      name: 'day',
      maxTextureSize: renderer.maxTextureSize,
      anisotropy,
      placeholderRgb: [22, 52, 110],
      onUpdate: (tex) => earth.setDayMap(tex),
    }),
    loadProgressiveTexture({
      baseUrl: import.meta.env.BASE_URL,
      body: 'earth',
      name: 'night',
      maxTextureSize: renderer.maxTextureSize,
      anisotropy,
      placeholderRgb: [0, 0, 0],
      onUpdate: (tex) => earth.setNightMap(tex),
    }),
  );
  const stars = createStarfield(4000, renderer.renderer.getPixelRatio());
  renderer.scene.add(stars);
  renderer.scene.add(earth.mesh);

  const controls = new QuaternionOrbitControls(renderer.canvas, {
    limits: EARTH_LIMITS,
    home: homeState(frame, gmstRad(clock.nowUtc())),
  });

  // URL sync (on user actions only, never per frame).
  const syncUrl = (): void => {
    const search = serializeUrlState({
      view: 'earth',
      lang: explicitLang,
      frame,
      time: clock.isLive() ? undefined : clock.nowUtc(),
      rate: clock.rate,
    });
    history.replaceState(null, '', `${window.location.pathname}${search}${window.location.hash}`);
  };

  // UI
  const about = new About(i18n);
  const timeControl = new TimeControl(clock, i18n, syncUrl);
  const toolbar = new Toolbar(i18n, frame, {
    onRecenter: () => controls.reset(),
    onFrameChange: (mode) => {
      const gmst = gmstRad(clock.nowUtc());
      controls.setState(convertOrbitFrame(controls.state, mode, gmst));
      frame = mode;
      controls.setHome(homeState(frame, gmst));
      syncUrl();
    },
    onLangChange: (lang) => {
      explicitLang = lang;
      i18n.setLang(lang);
      syncUrl();
    },
    onAbout: () => about.open(),
  });
  root.append(toolbar.element, timeControl.element, about.element);
  root.querySelector('.loading')?.remove();

  // Frame loop
  const earthCenterKm: Vec3 = [0, 0, 0];
  const scratch = new Vector3();
  let uiTimerS = 0;
  renderer.start((dtS) => {
    const now = clock.nowUtc();
    const gmst = gmstRad(now);
    const sunEci = sunDirectionEci(now);
    if (frame === 'fixed') {
      earth.setSpinAngle(0);
      earth.setSunDirection(eciToEcef(sunEci, gmst));
      stars.rotation.set(0, 0, -gmst);
    } else {
      earth.setSpinAngle(gmst);
      earth.setSunDirection(sunEci);
      stars.rotation.set(0, 0, 0);
      controls.setHome(homeState(frame, gmst));
    }

    controls.update(dtS);
    controls.applyTo(renderer.camera);
    const originKm = controls.cameraPositionKm;
    earth.mesh.position.copy(toRenderSpace(earthCenterKm, originKm, scratch));

    const d = controls.state.distanceKm;
    renderer.setClipPlanes(Math.max(1, (d - R) * 0.5), d + R * 4);

    uiTimerS += dtS;
    if (uiTimerS >= UI_REFRESH_S) {
      uiTimerS = 0;
      timeControl.update();
    }
  });
}

main();
