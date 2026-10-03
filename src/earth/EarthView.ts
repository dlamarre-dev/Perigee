/** View A — Earth: every active catalogued satellite, propagated with SGP4 (CLAUDE.md §5.1). */
import launchSitesJson from '../../catalog/launch-sites.json';
import earthScienceJson from '../../catalog/earth-science.json';
import operatorsJson from '../../catalog/operators.json';
import { DEG_TO_RAD, EARTH_EQUATORIAL_RADIUS_KM } from '../astro/constants';
import { latLonToUnit, rotZ } from '../astro/frames';
import { earthOrientation, geoSunKm } from '../astro/bodies';
import { alignAxes, axisVector } from '../astro/attitude';
import { QUAT_IDENTITY, quatMultiply, quatRotate, type Quat } from '../astro/quat';
import { sunDirectionEci } from '../astro/sun';
import { SUN_RADIUS_KM } from '../astro/planets';
import { gmstRad } from '../astro/time';
import { cross, length, normalize, scale, sub, type Vec3 } from '../astro/vec3';
import { orbitStateLookingFrom } from '../camera/orbitMath';
import type { View, ViewFactory, ViewFrame, ViewHost } from '../app/View';
import { datasetKey } from '../app/updates';
import { loadDataset, loadManifest, loadOptionalDataset } from '../data/loader';
import {
  GroupsSchema,
  EarthScienceCatalogSchema,
  LaunchSitesSchema,
  OmmListSchema,
  OperatorsCatalogSchema,
  SatcatListSchema,
  type LaunchSite,
} from '../data/schemas';
import type { BodyMesh } from '../render/BodyMesh';
import { createEarthMesh } from '../render/earthMesh';
import { DistantSun } from '../render/SunMesh';
import { MoonInSky } from './MoonInSky';
import { SceneModel, modelFollowDistanceKm, modelFor, modelMinDistance } from '../render/models';
import { countryName } from '../ui/countries';
import { DetailPanel, type DetailContent } from '../ui/DetailPanel';
import { h } from '../ui/dom';
import { FilterPanel } from '../ui/FilterPanel';
import { InfoPanel } from '../ui/InfoPanel';
import { buildCatalog, type SatCatalog, type SatObject } from './catalog';
import { EarthSatellites } from './EarthSatellites';
import { parseEarthUrl, writeEarthUrl } from './earthUrl';
import { EMPTY_FILTERS, type FilterState } from './filters';
import { LaunchSiteLayer } from './LaunchSiteLayer';
import { makeSatrec, propagateTeme } from './sgp4';

const R = EARTH_EQUATORIAL_RADIUS_KM;
const FOLLOW_DISTANCE_KM = 1500;
const SITE_FOLLOW_DISTANCE_KM = 2500;
/** A launch site this close to the pointer wins over satellites (they are dense near the Earth). */
const SITE_PRIORITY_PX = 8;

function formatLatLon(latDeg: number, lonDeg: number): string {
  const lat = `${Math.abs(latDeg).toFixed(3)}° ${latDeg >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(lonDeg).toFixed(3)}° ${lonDeg >= 0 ? 'E' : 'W'}`;
  return `${lat}, ${lon}`;
}

class EarthView implements View {
  readonly id = 'earth' as const;
  /** Far enough to frame the Earth and the Moon together. */
  readonly limits = { minDistanceKm: R * 1.02, maxDistanceKm: R * 100 };
  /** Beyond ×10,000, bulk SGP4 samples would be more than an orbit apart for low satellites. */
  readonly maxRate = 10_000;
  readonly maxRateHint = 'time.maxRate.earth' as const;
  readonly bodyRadiusKm = R;
  /** Over the Americas, north up. */
  readonly homeDirectionBody = latLonToUnit(20 * DEG_TO_RAD, -73 * DEG_TO_RAD);
  readonly homeDistanceKm = R * 3.4;
  /** Highly elliptical orbits reach beyond 400 000 km. */
  /** Up to the Sun (aphelion + radius): it is drawn at its true distance. */
  readonly farKm = 1.53e8;

  private readonly earth: BodyMesh;
  private readonly operators = OperatorsCatalogSchema.parse(operatorsJson);
  private readonly infoPanel: InfoPanel;
  private readonly siteDetail: DetailPanel;
  private readonly launchSites: readonly LaunchSite[];
  private readonly launchVerified: string;
  private readonly launch: LaunchSiteLayer;
  private selectedSite: LaunchSite | undefined;
  private catalog: SatCatalog | undefined;
  private sats: EarthSatellites | undefined;
  private filterPanel: FilterPanel | undefined;
  private filters: FilterState;
  private selectedNorad: number | undefined;
  /** Unit direction of the Sun (scene frame). */
  private sunScene: Vec3 = [1, 0, 0];
  /** Sun centre in the scene frame (km). */
  private sunSceneKm: Vec3 = [1.496e8, 0, 0];
  private readonly moon: MoonInSky;
  private get moonSceneKm(): Vec3 {
    return this.moon.sceneKm;
  }
  private readonly distantSun: DistantSun;
  /** NASA 3D model of the selected satellite, drawn once it covers a few pixels. */
  private readonly sceneModel: SceneModel;
  private frameAngleRad = 0;
  private disposed = false;
  /** Frame the selection once its position is known (next update). */
  private pendingFrame = false;
  private readonly loadedData = new Map<string, string>();

  constructor(private readonly host: ViewHost) {
    const initial = parseEarthUrl(host.initialParams);
    this.filters = initial.filters;
    this.selectedNorad = initial.selected;
    this.earth = createEarthMesh(host.renderer, host.baseUrl);
    host.renderer.scene.add(this.earth.mesh);
    this.sceneModel = new SceneModel(host.renderer.scene, host.renderer.renderer, host.baseUrl);
    this.distantSun = new DistantSun(host.renderer.scene, SUN_RADIUS_KM);
    this.moon = new MoonInSky(host.renderer.scene, host.renderer, host.baseUrl, host.i18n.t('earth.moon'));
    host.mount(this.moon.labels.element);
    this.infoPanel = new InfoPanel(host.i18n, this.operators, {
      onClose: () => this.select(undefined),
      onToggleFollow: () => (host.follow.active ? host.follow.stop() : this.startFollowing()),
    });
    host.mount(this.infoPanel.element);

    const sites = LaunchSitesSchema.parse(launchSitesJson);
    this.launchSites = sites.sites;
    this.launchVerified = sites.verified;
    this.launch = new LaunchSiteLayer(this.launchSites, host.renderer.renderer.getPixelRatio());
    this.earth.mesh.add(this.launch.group);
    this.launch.setLanguage(host.i18n.lang);
    host.i18n.onChange((lang) => {
      if (this.disposed) return;
      this.launch.setLanguage(lang);
      this.moon.setLabel(host.i18n.t('earth.moon'));
      if (this.selectedSite) this.showSite(this.selectedSite, false);
    });
    host.mount(this.launch.labels.element);
    this.launch.visible = host.initialParams.get('ls') !== '0';
    this.siteDetail = new DetailPanel(host.i18n, {
      onClose: () => this.selectSite(undefined),
      onToggleFollow: () => (host.follow.active ? host.follow.stop() : this.followSite()),
    });
    host.mount(this.siteDetail.element);
    const sel = host.initialParams.get('sel');
    if (sel?.startsWith('site:')) {
      const site = this.launchSites.find((x) => x.id === sel.slice(5));
      if (site) this.selectSite(site);
    }
    void this.loadSatellites();
  }

  /** Closest surface other than the Earth (the Moon), for the near clipping plane. */
  nearestSurfaceKm(originKm: Vec3): number {
    return this.moon.surfaceDistanceKm(originKm);
  }

  bodyOrientation(date: Date): Quat {
    return earthOrientation(date);
  }

  update(f: ViewFrame): void {
    const date = new Date(f.nowMs);
    const gmst = gmstRad(date);
    this.earth.setOrientation(quatMultiply(f.sceneFromInertial, f.bodyQ));
    this.sunScene = quatRotate(f.sceneFromInertial, sunDirectionEci(date));
    this.sunSceneKm = scale(this.sunScene, length(geoSunKm(date)));
    this.earth.setSunDirection(this.sunScene);
    this.moon.update(date, f.sceneFromInertial, this.sunScene);
    this.frameAngleRad = f.frame === 'fixed' ? -gmst : 0;
    this.sats?.update(f.nowMs, f.rate, f.clockEpoch, this.frameAngleRad);
    if (this.pendingFrame && this.sats) {
      const pos = this.sats.selectedWorldPositionKm(this.frameAngleRad);
      if (pos) this.host.frameObject(pos);
      this.pendingFrame = false;
    }
    this.launch.update(quatMultiply(f.sceneFromInertial, f.bodyQ));
  }

  placeOrigin(originKm: Vec3): void {
    this.earth.mesh.position.set(-originKm[0], -originKm[1], -originKm[2]);
    // 8k maps once the camera is within one radius of the surface.
    if (length(originKm) < 2 * this.earth.radiusKm) this.earth.requestDetail();
    this.sats?.placeOrigin(originKm);
    this.distantSun.place(this.sunSceneKm, originKm);
    const canvasEl = this.host.renderer.canvas;
    this.moon.place(
      originKm,
      this.host.renderer.camera,
      this.earth.radiusKm,
      canvasEl.clientWidth,
      canvasEl.clientHeight,
    );
    const canvas = this.host.renderer.canvas;
    this.launch.placeOrigin(originKm, this.host.renderer.camera, canvas.clientWidth, canvas.clientHeight);
    this.placeModel(originKm);
  }

  /** The selected satellite's 3D model (LVLH attitude: nadir axis down, front along the velocity). */
  private placeModel(originKm: Vec3): void {
    const camera = this.host.renderer.camera;
    const focalPx = this.host.renderer.canvas.clientHeight / 2 / Math.tan((camera.fov * Math.PI) / 360);
    const entry = this.selectedNorad !== undefined ? modelFor(`norad:${this.selectedNorad}`) : undefined;
    const pos = entry ? this.sats?.selectedWorldPositionKm(this.frameAngleRad) : undefined;
    const vel = entry ? this.sats?.selectedWorldVelocityKmS(this.frameAngleRad) : undefined;
    if (!entry || !pos || !vel) {
      this.sceneModel.update(undefined, undefined, QUAT_IDENTITY, this.sunScene, focalPx);
      this.sats?.setSelectedPointHidden(false);
      return;
    }
    const q = alignAxes(
      axisVector(entry.nadirAxis ?? '-y'),
      normalize(scale(pos, -1)),
      axisVector(entry.forwardAxis ?? '+z'),
      vel,
    );
    const shown = this.sceneModel.update(entry, sub(pos, originKm), q, this.sunScene, focalPx);
    this.sats?.setSelectedPointHidden(shown);
  }

  uiTick(nowMs: number): void {
    if (!this.sats) return;
    this.filterPanel?.updateStats(this.sats.stats);
    this.infoPanel.update(this.sats.selection?.state, nowMs);
  }

  click(xCss: number, yCss: number, double: boolean): void {
    const { renderer } = this.host;
    const w = renderer.canvas.clientWidth;
    const hgt = renderer.canvas.clientHeight;
    const site = this.launch.pick(xCss, yCss, renderer.camera, w, hgt);
    if (site && site.distancePx <= SITE_PRIORITY_PX) {
      this.selectSite(site.site, { follow: double });
      return;
    }
    const obj = this.sats?.pick(renderer.scene, renderer.camera, xCss, yCss);
    if (obj) this.select(obj, { follow: double });
    else if (site) this.selectSite(site.site, { follow: double });
  }

  dataVersions(): ReadonlyMap<string, string> {
    return this.loadedData;
  }

  writeUrl(p: URLSearchParams): void {
    writeEarthUrl({ filters: this.filters, selected: this.selectedNorad }, p);
    if (this.selectedSite) p.set('sel', `site:${this.selectedSite.id}`);
    if (!this.launch.visible) p.set('ls', '0');
  }

  dispose(): void {
    this.disposed = true;
    this.host.renderer.scene.remove(this.earth.mesh);
    this.earth.dispose();
    this.sceneModel.dispose();
    this.distantSun.dispose();
    this.moon.dispose();
    this.launch.dispose();
    if (this.sats) {
      this.host.renderer.scene.remove(this.sats.group);
      this.sats.dispose();
    }
    delete (window as { __perigeeTest?: unknown }).__perigeeTest;
  }

  toggleFollow(): void {
    // Following supersedes a framing requested by the selection but not applied yet.
    this.pendingFrame = false;
    if (this.host.follow.active) this.host.follow.stop();
    else if (this.selectedSite) this.followSite();
    else this.startFollowing();
  }

  private startFollowing(): void {
    const sats = this.sats;
    if (!sats?.selection) return;
    const started = this.host.follow.start(
      () => sats.selectedWorldPositionKm(this.frameAngleRad),
      modelFollowDistanceKm(`norad:${this.selectedNorad ?? 0}`) ?? FOLLOW_DISTANCE_KM,
      () => (this.infoPanel.following = false),
      modelMinDistance(`norad:${this.selectedNorad ?? 0}`),
    );
    this.infoPanel.following = started;
  }

  private select(
    obj: SatObject | undefined,
    options: { follow?: boolean; focus?: boolean; frame?: boolean } = {},
  ): void {
    if (!this.sats) return;
    if (!obj || obj.noradId !== this.selectedNorad) this.host.follow.stop();
    if (obj && this.selectedSite) this.clearSite();
    this.sats.select(obj);
    this.selectedNorad = obj?.noradId;
    this.infoPanel.show(obj, options.focus ?? false);
    this.filterPanel?.setSelected(obj?.noradId);
    this.pendingFrame = obj !== undefined && (options.frame ?? false) && !options.follow;
    if (obj && options.follow) {
      // The selected state is computed on the next update; follow once it exists.
      this.sats.update(
        this.host.clock.nowMs(),
        this.host.clock.rate,
        this.host.clock.epoch,
        this.frameAngleRad,
      );
      this.startFollowing();
    }
    this.host.syncUrl();
  }

  private clearSite(): void {
    this.selectedSite = undefined;
    this.launch.select(undefined);
    this.siteDetail.hide();
  }

  private selectSite(site: LaunchSite | undefined, options: { follow?: boolean } = {}): void {
    if (site?.id !== this.selectedSite?.id) this.host.follow.stop();
    if (site && this.selectedNorad !== undefined) {
      this.sats?.select(undefined);
      this.selectedNorad = undefined;
      this.infoPanel.show(undefined);
    }
    if (!site) {
      this.clearSite();
    } else {
      this.selectedSite = site;
      this.launch.select(site.id);
      this.showSite(site, true);
      if (options.follow) this.followSite();
    }
    this.host.syncUrl();
  }

  private followSite(): void {
    const site = this.selectedSite;
    if (!site) return;
    this.siteDetail.following = this.host.follow.start(
      () => (this.selectedSite === site ? this.launch.scenePosition(site.id) : undefined),
      SITE_FOLLOW_DISTANCE_KM,
      () => (this.siteDetail.following = false),
    );
  }

  private showSite(site: LaunchSite, focus: boolean): void {
    this.siteDetail.show(this.siteContent(site), focus);
  }

  private siteContent(site: LaunchSite): DetailContent {
    const { i18n } = this.host;
    const t = i18n.t.bind(i18n);
    const codes = new Set(site.satcatCodes);
    const launched = this.catalog?.objects.filter(
      (o) => o.launchSite !== undefined && codes.has(o.launchSite),
    );
    const rows: [string, string][] = [[t('launch.operator'), site.operator]];
    if (site.country) rows.push([t('info.country'), countryName(i18n, site.country)]);
    rows.push([t('info.coordinates'), formatLatLon(site.latDeg, site.lonDeg)]);
    if (site.firstOrbitalLaunch) rows.push([t('launch.first'), site.firstOrbitalLaunch]);
    if (site.satcatCodes.length) rows.push([t('launch.codes'), site.satcatCodes.join(', ')]);
    if (launched) rows.push([t('launch.satellites'), i18n.number(launched.length)]);
    const content: DetailContent = {
      title: site.name[i18n.lang],
      badge: {
        text: t(site.active ? 'launch.active' : 'launch.inactive'),
        state: site.active ? 'fresh' : 'stale',
      },
      rows,
      ...(site.note ? { notes: site.note } : {}),
      sources: site.sources,
      footnote: i18n.format('info.verified', { date: this.launchVerified }),
      followable: true,
    };
    if (!launched?.length || !site.satcatCodes.length) return content;
    return {
      ...content,
      action: {
        label: t('launch.showSatellites'),
        run: () => this.filterPanel?.setFilters({ ...EMPTY_FILTERS, launchSites: [...site.satcatCodes] }),
      },
    };
  }

  private async loadSatellites(): Promise<void> {
    const { host } = this;
    host.showNotice(host.i18n.t('sat.loading'));
    try {
      const manifest = await loadManifest(host.baseUrl);
      const [gp, satcat, groups] = await Promise.all([
        loadDataset(host.baseUrl, manifest, 'earth.gp', OmmListSchema),
        loadOptionalDataset(host.baseUrl, manifest, 'earth.satcat', SatcatListSchema),
        loadOptionalDataset(host.baseUrl, manifest, 'earth.groups', GroupsSchema),
      ]);
      if (this.disposed) return;
      this.loadedData.set(datasetKey('earth.gp'), gp.entry.sha256);
      if (satcat) this.loadedData.set(datasetKey('earth.satcat'), satcat.entry.sha256);
      if (groups) this.loadedData.set(datasetKey('earth.groups'), groups.entry.sha256);
      const catalog = buildCatalog(
        gp.data,
        satcat?.data,
        groups?.data,
        this.operators,
        this.launchSites,
        EarthScienceCatalogSchema.parse(earthScienceJson).satellites,
      );
      this.catalog = catalog;
      this.infoPanel.setLaunchSiteNames((code) => catalog.launchSiteByCode.get(code)?.name[host.i18n.lang]);
      const layer = new EarthSatellites(catalog, host.renderer.renderer);
      await layer.ready;
      if (this.disposed) {
        layer.dispose();
        return;
      }
      this.sats = layer;
      host.renderer.scene.add(layer.group);
      layer.setFilters(this.filters);

      const panel = new FilterPanel(host.i18n, catalog, this.filters, new Date(gp.entry.fetchedAt), {
        onChange: (next) => {
          this.filters = next;
          layer.setFilters(next);
          panel.setResults(layer.filteredObjects(), layer.stats);
          host.syncUrl();
        },
        onSelect: (obj) => this.select(obj, { focus: true, frame: true }),
      });
      this.filterPanel = panel;
      const toggle = h('input', {
        type: 'checkbox',
        id: 'toggle-launch-sites',
        checked: this.launch.visible,
      });
      const toggleLabel = h('label', { for: 'toggle-launch-sites' }, [
        host.i18n.t('filters.showLaunchSites'),
      ]);
      host.i18n.onChange(() => (toggleLabel.textContent = host.i18n.t('filters.showLaunchSites')));
      toggle.addEventListener('change', () => {
        this.launch.visible = toggle.checked;
        host.syncUrl();
      });
      panel.addControl(h('p', { class: 'search-row' }, [toggle, toggleLabel]));
      if (this.selectedSite) this.showSite(this.selectedSite, false);
      panel.element.id = 'side-panel';
      panel.visible = window.matchMedia('(min-width: 900px)').matches;
      host.mount(panel.element);
      host.setPanelToggle(
        'toolbar.filters',
        () => {
          panel.visible = !panel.visible;
          return panel.visible;
        },
        panel.visible,
      );
      panel.setResults(layer.filteredObjects(), layer.stats);

      if (this.selectedNorad !== undefined) {
        this.select(catalog.byNorad.get(this.selectedNorad), { frame: true });
      }
      host.showNotice(undefined);
      if (host.e2e) this.installTestHook(catalog);
    } catch (err) {
      console.error(err);
      host.showNotice(host.i18n.t('sat.unavailable'));
    }
  }

  /**
   * End-to-end test hook (only with `?e2e`): points the camera at an object from outside its orbit, so
   * tests can exercise real GPU picking by clicking the canvas centre.
   */
  private installTestHook(catalog: SatCatalog): void {
    const { controls, clock } = this.host;
    Object.assign(window, {
      __perigeeTest: {
        lookAt: (norad: number): boolean => {
          const obj = catalog.byNorad.get(norad);
          const satrec = obj && makeSatrec(obj.omm);
          const s = satrec && propagateTeme(satrec, clock.nowUtc());
          if (!s) return false;
          const world = rotZ(s.posKm, this.frameAngleRad);
          controls.setState(orbitStateLookingFrom([0, 0, 0], world, [0, 0, 1], length(world) + 3000));
          return true;
        },
        /** Camera on the far side of the Earth from the Sun (or the Moon), looking past the Earth at it. */
        lookToward: (what: 'sun' | 'moon', distanceKm = 30_000): boolean => {
          const target = what === 'sun' ? this.sunSceneKm : this.moonSceneKm;
          if (!target) return false;
          // 22° off the anti-Sun direction, so the target shows beside the body's limb.
          const away = normalize(scale(target, -1));
          const side = normalize(cross(away, [0, 0, 1]));
          const dir = normalize([away[0] - 0.4 * side[0], away[1] - 0.4 * side[1], away[2] - 0.4 * side[2]]);
          controls.setState(orbitStateLookingFrom([0, 0, 0], dir, [0, 0, 1], distanceKm));
          return true;
        },
        camera: () => ({
          ...controls.state,
          positionKm: controls.cameraPositionKm,
          following: controls.following,
        }),
      },
    });
  }
}

export const createEarthView: ViewFactory = (host) => new EarthView(host);
