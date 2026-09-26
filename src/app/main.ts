import '../styles.css';
import { Vector3 } from 'three';
import operatorsJson from '../../catalog/operators.json';
import { DEG_TO_RAD, EARTH_EQUATORIAL_RADIUS_KM } from '../astro/constants';
import { eciToEcef, latLonToUnit, rotZ } from '../astro/frames';
import { sunDirectionEci } from '../astro/sun';
import { SimClock, gmstRad } from '../astro/time';
import { length, type Vec3 } from '../astro/vec3';
import { QuaternionOrbitControls } from '../camera/QuaternionOrbitControls';
import {
  orbitStateLookingFrom,
  quatFromAxisAngle,
  quatMultiply,
  quatNormalize,
  type OrbitState,
} from '../camera/orbitMath';
import { loadDataset, loadManifest, loadOptionalDataset } from '../data/loader';
import { GroupsSchema, OmmListSchema, OperatorsCatalogSchema, SatcatListSchema } from '../data/schemas';
import { buildCatalog, type SatObject } from '../earth/catalog';
import { EarthSatellites } from '../earth/EarthSatellites';
import type { FilterState } from '../earth/filters';
import { makeSatrec, propagateTeme } from '../earth/sgp4';
import { I18n, detectLang, type Lang } from '../i18n';
import { EarthMesh } from '../render/EarthMesh';
import { Renderer, WebGLUnavailableError } from '../render/Renderer';
import { toRenderSpace } from '../render/floatingOrigin';
import { createStarfield } from '../render/starfield';
import { loadProgressiveTexture } from '../render/textures';
import { About } from '../ui/About';
import { FilterPanel } from '../ui/FilterPanel';
import { InfoPanel } from '../ui/InfoPanel';
import { TimeControl } from '../ui/TimeControl';
import { Toolbar } from '../ui/Toolbar';
import { h } from '../ui/dom';
import { parseUrlState, serializeUrlState, type FrameMode } from './urlState';

const R = EARTH_EQUATORIAL_RADIUS_KM;
const EARTH_LIMITS = { minDistanceKm: R * 1.02, maxDistanceKm: R * 60 };
const FOLLOW_LIMITS = { minDistanceKm: 10, maxDistanceKm: R * 60 };
const FOLLOW_DISTANCE_KM = 1500;
/** Default viewpoint over the Americas, north up. */
const HOME_LAT_RAD = 20 * DEG_TO_RAD;
const HOME_LON_RAD = -73 * DEG_TO_RAD;
const HOME_DISTANCE_KM = R * 3.4;
const UI_REFRESH_S = 0.25;
/** A pointer that moved less than this between down and up is a click, not a drag. */
const CLICK_TOLERANCE_PX = 5;

function homeState(frame: FrameMode, gmst: number): OrbitState {
  const dirEcef = latLonToUnit(HOME_LAT_RAD, HOME_LON_RAD);
  const dir = frame === 'fixed' ? dirEcef : rotZ(dirEcef, gmst);
  return orbitStateLookingFrom([0, 0, 0], dir, [0, 0, 1], HOME_DISTANCE_KM);
}

/** Rotation from TEME (≈ inertial) into the scene frame. */
function frameAngle(frame: FrameMode, gmst: number): number {
  return frame === 'fixed' ? -gmst : 0;
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
  // Read before any URL rewrite (syncUrl drops unknown parameters).
  const e2eHook = new URLSearchParams(window.location.search).has('e2e');
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

  // Satellites (loaded asynchronously).
  let sats: EarthSatellites | undefined;
  let filterPanel: FilterPanel | undefined;
  let filters: FilterState = url.filters;
  let selectedNorad: number | undefined = url.selected;

  // URL sync (on user actions only, never per frame).
  const syncUrl = (): void => {
    const search = serializeUrlState({
      view: 'earth',
      lang: explicitLang,
      frame,
      time: clock.isLive() ? undefined : clock.nowUtc(),
      rate: clock.rate,
      filters,
      selected: selectedNorad,
    });
    history.replaceState(null, '', `${window.location.pathname}${search}${window.location.hash}`);
  };

  // UI
  const operators = OperatorsCatalogSchema.parse(operatorsJson);
  const notice = h('p', { class: 'notice', role: 'status', hidden: true });
  const about = new About(i18n);
  const timeControl = new TimeControl(clock, i18n, syncUrl);

  const stopFollowing = (): void => {
    if (!controls.following) return;
    controls.setFollow(undefined);
    controls.setLimits(EARTH_LIMITS);
    const camKm = controls.cameraPositionKm;
    controls.flyTo({
      targetKm: [0, 0, 0],
      distanceKm: Math.max(EARTH_LIMITS.minDistanceKm, length(camKm)),
      orientation: controls.orientation,
    });
    infoPanel.following = false;
  };

  const startFollowing = (): void => {
    if (!sats?.selection) return;
    const s = sats;
    const worldPos = (): Vec3 | undefined =>
      s.selectedWorldPositionKm(frameAngle(frame, gmstRad(clock.nowUtc())));
    const pos = worldPos();
    if (!pos) return;
    controls.setLimits(FOLLOW_LIMITS);
    controls.setFollow(worldPos);
    // Look at the object from above (radially outward), with the Earth behind it and north up.
    controls.flyTo(orbitStateLookingFrom(pos, pos, [0, 0, 1], FOLLOW_DISTANCE_KM));
    infoPanel.following = true;
  };

  const select = (obj: SatObject | undefined, options: { follow?: boolean; focus?: boolean } = {}): void => {
    if (!sats) return;
    if (!obj || obj.noradId !== selectedNorad) stopFollowing();
    sats.select(obj);
    selectedNorad = obj?.noradId;
    infoPanel.show(obj, options.focus ?? false);
    if (obj && options.follow) startFollowing();
    syncUrl();
  };

  const infoPanel = new InfoPanel(i18n, operators, {
    onClose: () => select(undefined),
    onToggleFollow: () => (controls.following ? stopFollowing() : startFollowing()),
  });

  const toolbar = new Toolbar(i18n, frame, {
    onRecenter: () => {
      stopFollowing();
      controls.reset();
    },
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
    onToggleFilters: () => {
      if (!filterPanel) return;
      filterPanel.visible = !filterPanel.visible;
      toolbar.setFiltersOpen(filterPanel.visible);
    },
  });
  root.append(toolbar.element, infoPanel.element, timeControl.element, notice, about.element);
  root.querySelector('.loading')?.remove();

  const showNotice = (text: string | undefined): void => {
    notice.hidden = !text;
    notice.textContent = text ?? '';
  };

  // Picking: click selects, double-click selects and follows.
  let downAt: { x: number; y: number } | undefined;
  renderer.canvas.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }));
  const pickAt = (e: MouseEvent): SatObject | undefined => {
    if (!sats || !downAt) return undefined;
    if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > CLICK_TOLERANCE_PX) return undefined;
    const rect = renderer.canvas.getBoundingClientRect();
    return sats.pick(renderer.scene, renderer.camera, e.clientX - rect.left, e.clientY - rect.top);
  };
  renderer.canvas.addEventListener('click', (e) => {
    const obj = pickAt(e);
    if (obj) select(obj);
  });
  renderer.canvas.addEventListener('dblclick', (e) => {
    const obj = pickAt(e);
    if (obj) select(obj, { follow: true });
  });

  void loadSatellites();

  async function loadSatellites(): Promise<void> {
    showNotice(i18n.t('sat.loading'));
    try {
      const base = import.meta.env.BASE_URL;
      const manifest = await loadManifest(base);
      const [gp, satcat, groups] = await Promise.all([
        loadDataset(base, manifest, 'earth.gp', OmmListSchema),
        loadOptionalDataset(base, manifest, 'earth.satcat', SatcatListSchema),
        loadOptionalDataset(base, manifest, 'earth.groups', GroupsSchema),
      ]);
      const catalog = buildCatalog(gp.data, satcat?.data, groups?.data, operators);
      const layer = new EarthSatellites(catalog, renderer.renderer);
      await layer.ready;
      sats = layer;
      renderer.scene.add(layer.group);
      layer.setFilters(filters);

      filterPanel = new FilterPanel(i18n, catalog, filters, new Date(gp.entry.fetchedAt), {
        onChange: (next) => {
          filters = next;
          layer.setFilters(next);
          filterPanel?.setResults(layer.filteredObjects(), layer.stats);
          syncUrl();
        },
        onSelect: (obj) => select(obj, { focus: true }),
      });
      filterPanel.element.id = 'filters-panel';
      filterPanel.visible = window.matchMedia('(min-width: 900px)').matches;
      toolbar.setFiltersOpen(filterPanel.visible);
      root?.insertBefore(filterPanel.element, infoPanel.element);
      filterPanel.setResults(layer.filteredObjects(), layer.stats);

      if (selectedNorad !== undefined) select(catalog.byNorad.get(selectedNorad));
      showNotice(undefined);
      if (e2eHook) installTestHook(catalog);
    } catch (err) {
      console.error(err);
      showNotice(i18n.t('sat.unavailable'));
    }
  }

  /**
   * End-to-end test hook (only with `?e2e`): points the camera at an object from outside its orbit, so
   * tests can exercise real GPU picking by clicking the canvas centre.
   */
  function installTestHook(catalog: ReturnType<typeof buildCatalog>): void {
    Object.assign(window, {
      __perigeeTest: {
        lookAt(norad: number): boolean {
          const obj = catalog.byNorad.get(norad);
          const satrec = obj && makeSatrec(obj.omm);
          const s = satrec && propagateTeme(satrec, clock.nowUtc());
          if (!s) return false;
          const world = rotZ(s.posKm, frameAngle(frame, gmstRad(clock.nowUtc())));
          controls.setState(orbitStateLookingFrom([0, 0, 0], world, [0, 0, 1], length(world) + 3000));
          return true;
        },
        camera(): { targetKm: Vec3; distanceKm: number; positionKm: Vec3; following: boolean } {
          return { ...controls.state, positionKm: controls.cameraPositionKm, following: controls.following };
        },
      },
    });
  }

  // Frame loop
  const earthCenterKm: Vec3 = [0, 0, 0];
  const scratch = new Vector3();
  let uiTimerS = 0;
  let wasFollowing = false;
  renderer.start((dtS) => {
    const nowMs = clock.nowMs();
    const now = new Date(nowMs);
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

    // Satellites first: the camera may follow the selected one.
    sats?.update(nowMs, clock.rate, clock.epoch, frameAngle(frame, gmst), controls.cameraPositionKm);
    controls.update(dtS);
    // The R key resets the controls directly; restore Earth limits when following ends that way.
    if (wasFollowing && !controls.following) {
      controls.setLimits(EARTH_LIMITS);
      infoPanel.following = false;
    }
    wasFollowing = controls.following;
    controls.applyTo(renderer.camera);

    const originKm = controls.cameraPositionKm;
    earth.mesh.position.copy(toRenderSpace(earthCenterKm, originKm, scratch));
    sats?.group.position.set(-originKm[0], -originKm[1], -originKm[2]);

    const altitudeKm = length(originKm) - R;
    renderer.setClipPlanes(
      Math.max(0.01, Math.min(altitudeKm * 0.5, controls.state.distanceKm * 0.1)),
      length(originKm) + R * 10,
    );

    uiTimerS += dtS;
    if (uiTimerS >= UI_REFRESH_S) {
      uiTimerS = 0;
      timeControl.update();
      if (sats) {
        filterPanel?.updateStats(sats.stats);
        infoPanel.update(sats.selection?.state, nowMs);
      }
    }
  });
}

main();
