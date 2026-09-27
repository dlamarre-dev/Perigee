/** View A — Earth: every active catalogued satellite, propagated with SGP4 (CLAUDE.md §5.1). */
import operatorsJson from '../../catalog/operators.json';
import { DEG_TO_RAD, EARTH_EQUATORIAL_RADIUS_KM } from '../astro/constants';
import { latLonToUnit, rotZ } from '../astro/frames';
import { earthOrientation } from '../astro/bodies';
import { quatMultiply, quatRotate, type Quat } from '../astro/quat';
import { sunDirectionEci } from '../astro/sun';
import { gmstRad } from '../astro/time';
import { length, type Vec3 } from '../astro/vec3';
import { orbitStateLookingFrom } from '../camera/orbitMath';
import type { View, ViewFactory, ViewFrame, ViewHost } from '../app/View';
import { loadDataset, loadManifest, loadOptionalDataset } from '../data/loader';
import { GroupsSchema, OmmListSchema, OperatorsCatalogSchema, SatcatListSchema } from '../data/schemas';
import type { BodyMesh } from '../render/BodyMesh';
import { createEarthMesh } from '../render/earthMesh';
import { FilterPanel } from '../ui/FilterPanel';
import { InfoPanel } from '../ui/InfoPanel';
import { buildCatalog, type SatCatalog, type SatObject } from './catalog';
import { EarthSatellites } from './EarthSatellites';
import { parseEarthUrl, writeEarthUrl } from './earthUrl';
import type { FilterState } from './filters';
import { makeSatrec, propagateTeme } from './sgp4';

const R = EARTH_EQUATORIAL_RADIUS_KM;
const FOLLOW_DISTANCE_KM = 1500;

class EarthView implements View {
  readonly id = 'earth' as const;
  readonly limits = { minDistanceKm: R * 1.02, maxDistanceKm: R * 60 };
  readonly bodyRadiusKm = R;
  /** Over the Americas, north up. */
  readonly homeDirectionBody = latLonToUnit(20 * DEG_TO_RAD, -73 * DEG_TO_RAD);
  readonly homeDistanceKm = R * 3.4;
  /** Highly elliptical orbits reach beyond 400 000 km. */
  readonly farKm = 1.2e6;

  private readonly earth: BodyMesh;
  private readonly operators = OperatorsCatalogSchema.parse(operatorsJson);
  private readonly infoPanel: InfoPanel;
  private sats: EarthSatellites | undefined;
  private filterPanel: FilterPanel | undefined;
  private filters: FilterState;
  private selectedNorad: number | undefined;
  private frameAngleRad = 0;
  private disposed = false;

  constructor(private readonly host: ViewHost) {
    const initial = parseEarthUrl(host.initialParams);
    this.filters = initial.filters;
    this.selectedNorad = initial.selected;
    this.earth = createEarthMesh(host.renderer, host.baseUrl);
    host.renderer.scene.add(this.earth.mesh);
    this.infoPanel = new InfoPanel(host.i18n, this.operators, {
      onClose: () => this.select(undefined),
      onToggleFollow: () => (host.follow.active ? host.follow.stop() : this.startFollowing()),
    });
    host.mount(this.infoPanel.element);
    void this.loadSatellites();
  }

  bodyOrientation(date: Date): Quat {
    return earthOrientation(date);
  }

  update(f: ViewFrame): void {
    const date = new Date(f.nowMs);
    const gmst = gmstRad(date);
    this.earth.setOrientation(quatMultiply(f.sceneFromInertial, f.bodyQ));
    this.earth.setSunDirection(quatRotate(f.sceneFromInertial, sunDirectionEci(date)));
    this.frameAngleRad = f.frame === 'fixed' ? -gmst : 0;
    this.sats?.update(f.nowMs, f.rate, f.clockEpoch, this.frameAngleRad);
  }

  placeOrigin(originKm: Vec3): void {
    this.earth.mesh.position.set(-originKm[0], -originKm[1], -originKm[2]);
    this.sats?.placeOrigin(originKm);
  }

  uiTick(nowMs: number): void {
    if (!this.sats) return;
    this.filterPanel?.updateStats(this.sats.stats);
    this.infoPanel.update(this.sats.selection?.state, nowMs);
  }

  click(xCss: number, yCss: number, double: boolean): void {
    const obj = this.sats?.pick(this.host.renderer.scene, this.host.renderer.camera, xCss, yCss);
    if (obj) this.select(obj, { follow: double });
  }

  writeUrl(p: URLSearchParams): void {
    writeEarthUrl({ filters: this.filters, selected: this.selectedNorad }, p);
  }

  dispose(): void {
    this.disposed = true;
    this.host.renderer.scene.remove(this.earth.mesh);
    this.earth.dispose();
    if (this.sats) {
      this.host.renderer.scene.remove(this.sats.group);
      this.sats.dispose();
    }
    delete (window as { __perigeeTest?: unknown }).__perigeeTest;
  }

  private startFollowing(): void {
    const sats = this.sats;
    if (!sats?.selection) return;
    const started = this.host.follow.start(
      () => sats.selectedWorldPositionKm(this.frameAngleRad),
      FOLLOW_DISTANCE_KM,
      () => (this.infoPanel.following = false),
    );
    this.infoPanel.following = started;
  }

  private select(obj: SatObject | undefined, options: { follow?: boolean; focus?: boolean } = {}): void {
    if (!this.sats) return;
    if (!obj || obj.noradId !== this.selectedNorad) this.host.follow.stop();
    this.sats.select(obj);
    this.selectedNorad = obj?.noradId;
    this.infoPanel.show(obj, options.focus ?? false);
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
      const catalog = buildCatalog(gp.data, satcat?.data, groups?.data, this.operators);
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
        onSelect: (obj) => this.select(obj, { focus: true }),
      });
      this.filterPanel = panel;
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

      if (this.selectedNorad !== undefined) this.select(catalog.byNorad.get(this.selectedNorad));
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
