/**
 * Generic view centred on a solid body other than the Earth (Moon, Mars): spacecraft and natural satellites
 * from JPL Horizons ephemerides (Hermite-interpolated, Kepler-extrapolated outside the window, hidden
 * beyond a limit), landing/impact sites, optionally the Earth at its true position (CLAUDE.md §5.2).
 * Each body is a `PlanetaryConfig`; see src/moon/MoonView.ts and src/mars/MarsView.ts.
 */
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  Vector3,
  type Material,
} from 'three';
import type { View, ViewFrame, ViewHost } from '../app/View';
import type { Astronomy } from '../astro/astronomy';
import { bodyOrientationEqj, earthOrientation } from '../astro/bodies';
import { DEG_TO_RAD, J2000_JD, MS_PER_DAY, RAD_TO_DEG, SECONDS_PER_DAY } from '../astro/constants';
import { latLonToUnit } from '../astro/frames';
import { osculatingElements } from '../astro/kepler';
import { quatConjugate, quatMultiply, quatRotate, type Quat } from '../astro/quat';
import { utcToTdbJd } from '../astro/time';
import {
  EphemerisTrack,
  HIGH_ORBIT_MAX_EXTRAPOLATION_DAYS,
  LOW_ORBIT_MAX_EXTRAPOLATION_DAYS,
  type TrackSample,
} from '../astro/track';
import { length, normalize, scale, sub, type Vec3 } from '../astro/vec3';
import { orbitStateLookingFrom } from '../camera/orbitMath';
import { loadEphemeris, loadManifest, loadOptionalDataset } from '../data/loader';
import {
  RoverPositionsSchema,
  type CentralBody,
  type EphemerisEntry,
  type LandingSite,
  type LandingSites,
  type Mission,
  type RoverPositions,
} from '../data/schemas';
import type { MessageKey } from '../i18n';
import { BodyMesh } from '../render/BodyMesh';
import { createEarthMesh } from '../render/earthMesh';
import { LabelLayer, LabelPriority, occludedBySphere, occludedBySphereAt } from '../render/Labels';
import { pickRadiusPx } from '../render/pointer';
import { MarkerPoints } from '../render/MarkerPoints';
import { SelectionMarker } from '../render/OrbitLine';
import { placeholderTexture, progressiveTexture, type ProgressiveTexture } from '../render/textures';
import { BodyPanel } from '../ui/BodyPanel';
import { countryName } from '../ui/countries';
import { DetailPanel, type BadgeState, type DetailContent } from '../ui/DetailPanel';
import { formatUtcDate } from '../ui/labels';

export interface PlanetaryConfig {
  readonly id: 'moon' | 'mars';
  readonly centralBody: CentralBody;
  readonly body: Astronomy.Body;
  readonly radiusKm: number;
  readonly muKm3S2: number;
  readonly texture: { readonly name: string; readonly placeholderRgb: readonly [number, number, number] };
  readonly ambient: number;
  readonly atmosphere?: { readonly color: readonly [number, number, number]; readonly strength: number };
  readonly homeDirectionBody: Vec3;
  /** Recompute the home direction towards the sunlit hemisphere (latitude kept, longitude from the Sun). */
  readonly homeFacesSun?: boolean;
  readonly homeDistanceKm: number;
  readonly maxDistanceKm: number;
  readonly farKm: number;
  readonly missions: readonly Mission[];
  readonly sites: LandingSites;
  /** Sun centre relative to the body centre, EQJ, km. */
  readonly sunFromBodyKm: (date: Date) => Vec3;
  /** Earth centre relative to the body centre (shown when defined). */
  readonly earthFromBodyKm?: (date: Date) => Vec3;
  readonly siteLabelDistanceKm: number;
  /** Override feed-backed sites (rovers) with the published `mars.rovers` dataset. */
  readonly roverFeed?: boolean;
  readonly keys: {
    readonly panel: MessageKey;
    readonly loading: MessageKey;
    readonly unavailable: MessageKey;
    readonly sites: MessageKey;
    readonly showSites: MessageKey;
  };
}

const TRAJECTORY_POINTS = 360;
const TRAJECTORY_REFRESH_MS = 250;
const PICK_RADIUS_PX = 14;
const SITE_COLORS: Record<LandingSite['type'], string> = {
  crewed: '#ffd54f',
  soft: '#aed581',
  'rover-last-known': '#4fc3f7',
  hard: '#ff8a65',
  impact: '#b0bec5',
};
const DEFAULT_MISSION_COLOR = '#e0e0e0';
const NATURAL_COLOR = '#c9b8a6';

type Selection =
  | { readonly kind: 'mission'; readonly mission: Mission }
  | { readonly kind: 'site'; readonly site: LandingSite }
  | undefined;

interface Tracked {
  readonly mission: Mission;
  readonly index: number;
  track: EphemerisTrack;
  entry: EphemerisEntry | undefined;
  readonly line: Line<BufferGeometry, Material>;
  /** Small sphere for natural satellites. */
  readonly mesh: BodyMesh | undefined;
  sample: TrackSample;
  /** Scene-frame position (km), when shown. */
  scene: Vec3 | undefined;
}

function tdbJdToDate(tdbJd: number): Date {
  // TDB − UTC ≈ 69.2 s in 2026; well below the display precision of a date.
  return new Date((tdbJd - J2000_JD) * MS_PER_DAY + Date.UTC(2000, 0, 1, 12) - 69_184);
}

export function formatLatLon(latDeg: number, lonDeg: number): string {
  const lat = `${Math.abs(latDeg).toFixed(3)}° ${latDeg >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(lonDeg).toFixed(3)}° ${lonDeg >= 0 ? 'E' : 'W'}`;
  return `${lat}, ${lon}`;
}

export class PlanetaryView implements View {
  readonly id: 'moon' | 'mars';
  readonly limits: { minDistanceKm: number; maxDistanceKm: number };
  readonly bodyRadiusKm: number;
  readonly homeDistanceKm: number;
  readonly farKm: number;

  private readonly R: number;
  private readonly missions: readonly Mission[];
  private readonly sites: readonly LandingSite[];
  private readonly body: BodyMesh;
  private readonly surface: ProgressiveTexture;
  private readonly earth: BodyMesh | undefined;
  private readonly missionGroup = new Group();
  private readonly siteGroup = new Group();
  private readonly missionMarkers: MarkerPoints;
  private readonly siteMarkers: MarkerPoints;
  private readonly missionRing: SelectionMarker;
  private readonly siteRing: SelectionMarker;
  private readonly labels = new LabelLayer();
  private readonly panel: BodyPanel;
  private readonly detail: DetailPanel;
  private readonly tracked: Tracked[] = [];
  private readonly colors = new Map<string, string>();
  private readonly siteBodyKm: Vec3[];
  /** Live rover positions (by site id) when a feed dataset is published. */
  private rovers: RoverPositions = {};
  private siteScene: Vec3[] = [];
  private earthScene: Vec3 = [0, 0, 0];
  private bodyScene: Quat = { x: 0, y: 0, z: 0, w: 1 };
  private bodyQ: Quat = { x: 0, y: 0, z: 0, w: 1 };
  private tdbJd = 0;
  private originKm: Vec3 = [0, 0, 0];
  private selection: Selection;
  private sitesVisible = true;
  private lastTrajectoryWallMs = -Infinity;
  private lastEpoch = -1;
  private disposed = false;
  /** Frame the selection once its position is known (next update). */
  private pendingFrame = false;
  private readonly v = new Vector3();

  constructor(
    private readonly host: ViewHost,
    private readonly config: PlanetaryConfig,
  ) {
    const R = config.radiusKm;
    this.R = R;
    this.id = config.id;
    this.limits = { minDistanceKm: R * 1.02, maxDistanceKm: config.maxDistanceKm };
    this.bodyRadiusKm = R;
    this.homeDistanceKm = config.homeDistanceKm;
    this.farKm = config.farKm;
    this.missions = config.missions;
    this.sites = config.sites.sites;
    this.siteBodyKm = this.sites.map((s) =>
      scale(latLonToUnit(s.latDeg * DEG_TO_RAD, s.lonDeg * DEG_TO_RAD), R + R * 3e-4),
    );

    const renderer = host.renderer;
    const anisotropy = renderer.renderer.capabilities.getMaxAnisotropy();
    const black = placeholderTexture([0, 0, 0]);
    this.surface = progressiveTexture({
      baseUrl: host.baseUrl,
      body: config.id,
      name: config.texture.name,
      maxTextureSize: renderer.maxTextureSize,
      anisotropy,
      placeholderRgb: config.texture.placeholderRgb,
      onUpdate: (tex) => this.body.setDayMap(tex),
    });
    this.body = new BodyMesh({
      name: config.id,
      radiusKm: R,
      dayMap: this.surface.initial,
      nightMap: black,
      ambient: config.ambient,
      ...(config.atmosphere
        ? { atmosphereColor: config.atmosphere.color, atmosphereStrength: config.atmosphere.strength }
        : {}),
    });
    this.earth = config.earthFromBodyKm ? createEarthMesh(renderer, host.baseUrl) : undefined;
    renderer.scene.add(this.body.mesh, this.missionGroup);
    if (this.earth) renderer.scene.add(this.earth.mesh);

    const pixelRatio = renderer.renderer.getPixelRatio();
    const drawable = this.missions.filter((m) => m.ephemeris === 'horizons');
    // No GPU depth test: a screen-sized sprite has a single depth and would be half-buried in the curved
    // surface when seen from afar. Occlusion by the body is computed on the CPU instead (placeOrigin).
    this.missionMarkers = new MarkerPoints(Math.max(1, drawable.length), 11 * pixelRatio, {
      depthTest: false,
    });
    this.missionGroup.add(this.missionMarkers.points);
    const grey = placeholderTexture([150, 140, 130]);
    drawable.forEach((mission, index) => {
      const natural = mission.objectType === 'natural';
      const color = mission.color ?? (natural ? NATURAL_COLOR : DEFAULT_MISSION_COLOR);
      this.colors.set(mission.id, color);
      const line = new Line(
        new BufferGeometry(),
        new LineBasicMaterial({ color, transparent: true, opacity: 0.55 }),
      );
      line.frustumCulled = false;
      this.missionGroup.add(line);
      const mesh =
        natural && mission.radiusKm
          ? new BodyMesh({
              name: mission.id,
              radiusKm: mission.radiusKm,
              dayMap: grey,
              nightMap: black,
              ambient: 0.05,
            })
          : undefined;
      if (mesh) renderer.scene.add(mesh.mesh);
      this.tracked.push({
        mission,
        index,
        track: this.makeTrack(mission, undefined),
        entry: undefined,
        line,
        mesh,
        sample: { kind: 'none', state: undefined, beyondS: 0 },
        scene: undefined,
      });
    });
    this.missionRing = new SelectionMarker(pixelRatio);
    this.missionGroup.add(this.missionRing.points);

    this.siteMarkers = new MarkerPoints(Math.max(1, this.sites.length), 8 * pixelRatio, { depthTest: false });
    this.sites.forEach((s, i) => this.siteMarkers.setColor(i, SITE_COLORS[s.type]));
    this.siteRing = new SelectionMarker(pixelRatio, { surface: true });
    this.siteGroup.add(this.siteMarkers.points, this.siteRing.points);
    this.body.mesh.add(this.siteGroup);

    this.panel = new BodyPanel(
      host.i18n,
      { panel: config.keys.panel, sites: config.keys.sites, showSites: config.keys.showSites },
      this.missions,
      this.sites,
      this.colors,
      (m) => m.ephemeris === 'horizons',
      {
        onSelectMission: (m) => this.select({ kind: 'mission', mission: m }, { focus: true, frame: true }),
        onSelectSite: (s) => this.select({ kind: 'site', site: s }, { focus: true, frame: true }),
        onToggleSites: (visible) => {
          this.sitesVisible = visible;
          this.siteGroup.visible = visible;
          this.refreshLabels();
          host.syncUrl();
        },
      },
    );
    this.panel.visible = window.matchMedia('(min-width: 900px)').matches;
    this.detail = new DetailPanel(host.i18n, {
      onClose: () => this.select(undefined),
      onToggleFollow: () => (host.follow.active ? host.follow.stop() : this.startFollowing()),
    });
    host.mount(this.panel.element);
    host.mount(this.detail.element);
    host.mount(this.labels.element);
    host.setPanelToggle(
      'toolbar.missions',
      () => {
        this.panel.visible = !this.panel.visible;
        return this.panel.visible;
      },
      this.panel.visible,
    );
    host.i18n.onChange(() => {
      if (!this.disposed) this.refreshLabels();
    });
    this.refreshLabels();

    this.restoreFromUrl(host.initialParams);
    void this.loadEphemerides();
    if (host.e2e) this.installTestHook();
  }

  bodyOrientation(date: Date): Quat {
    return bodyOrientationEqj(this.config.body, date);
  }

  /** Default viewpoint (body-fixed). With `homeFacesSun`, it looks at the day side, 30° after the subsolar meridian. */
  get homeDirectionBody(): Vec3 {
    const base = this.config.homeDirectionBody;
    if (!this.config.homeFacesSun) return base;
    const date = this.host.clock.nowUtc();
    const sunBody = quatRotate(quatConjugate(this.bodyOrientation(date)), this.config.sunFromBodyKm(date));
    const lonRad = Math.atan2(sunBody[1], sunBody[0]) + 30 * DEG_TO_RAD;
    return latLonToUnit(Math.asin(Math.max(-1, Math.min(1, base[2]))), lonRad);
  }

  update(f: ViewFrame): void {
    const date = new Date(f.nowMs);
    this.tdbJd = utcToTdbJd(date);
    this.bodyQ = f.bodyQ;
    const sceneQ = f.sceneFromInertial;
    this.bodyScene = quatMultiply(sceneQ, f.bodyQ);

    const sun = quatRotate(sceneQ, normalize(this.config.sunFromBodyKm(date)));
    this.body.setOrientation(this.bodyScene);
    this.body.setSunDirection(sun);
    if (this.earth && this.config.earthFromBodyKm) {
      this.earth.setSunDirection(sun);
      this.earthScene = quatRotate(sceneQ, this.config.earthFromBodyKm(date));
      this.earth.setOrientation(quatMultiply(sceneQ, earthOrientation(date)));
    }
    this.missionGroup.quaternion.set(sceneQ.x, sceneQ.y, sceneQ.z, sceneQ.w);

    for (const t of this.tracked) {
      t.sample = t.track.sample(this.tdbJd);
      const s = t.sample.state;
      if (s) {
        this.missionMarkers.setColor(
          t.index,
          this.colors.get(t.mission.id) ?? DEFAULT_MISSION_COLOR,
          t.sample.kind === 'extrapolated' ? 0.45 : 1,
        );
        t.scene = quatRotate(sceneQ, s.posKm);
      } else {
        t.scene = undefined;
      }
      t.mesh?.setSunDirection(sun);
      if (t.mesh) t.mesh.mesh.visible = t.scene !== undefined;
    }
    this.siteScene = this.siteBodyKm.map((p) => quatRotate(this.bodyScene, p));

    const wall = performance.now();
    if (f.clockEpoch !== this.lastEpoch || wall - this.lastTrajectoryWallMs > TRAJECTORY_REFRESH_MS) {
      this.lastEpoch = f.clockEpoch;
      this.lastTrajectoryWallMs = wall;
      this.refreshTrajectories();
    }

    const sel = this.selection;
    const selTracked = sel?.kind === 'mission' ? this.trackedFor(sel.mission.id) : undefined;
    this.missionRing.set(selTracked?.sample.state?.posKm);
    this.siteRing.set(sel?.kind === 'site' ? this.siteBodyKm[this.sites.indexOf(sel.site)] : undefined);
    if (this.pendingFrame) {
      const pos = this.scenePositionOf(sel);
      if (pos) this.host.frameObject(pos);
      // Objects without a 3D position (no ephemeris) cannot be framed: give up rather than wait forever.
      this.pendingFrame = false;
    }
  }

  placeOrigin(originKm: Vec3): void {
    this.originKm = originKm;
    this.body.mesh.position.set(-originKm[0], -originKm[1], -originKm[2]);
    // High-detail surface (8k) once the camera is within one radius of the surface.
    if (length(originKm) < 2 * this.config.radiusKm) this.surface.requestDetail();
    if (this.earth) {
      const e = sub(this.earthScene, originKm);
      this.earth.mesh.position.set(e[0], e[1], e[2]);
    }
    this.missionGroup.position.set(-originKm[0], -originKm[1], -originKm[2]);
    for (const t of this.tracked) {
      const p = t.sample.state?.posKm;
      if (p && t.scene && !this.hidden(t.scene)) {
        this.missionMarkers.setPosition(t.index, p[0], p[1], p[2]);
      } else {
        this.missionMarkers.hide(t.index);
      }
      if (t.mesh && t.scene) {
        const r = sub(t.scene, originKm);
        t.mesh.mesh.position.set(r[0], r[1], r[2]);
      }
    }
    this.missionMarkers.commit();
    this.sites.forEach((_, i) => {
      const scene = this.siteScene[i];
      const p = this.siteBodyKm[i];
      const shown = p && scene && !this.hidden(scene);
      if (shown) this.siteMarkers.setPosition(i, p[0], p[1], p[2]);
      else this.siteMarkers.hide(i);
      if (this.selection?.kind === 'site' && this.selection.site === this.sites[i])
        this.siteRing.setOccluded(!shown);
    });
    this.siteMarkers.commit();
    this.placeLabels();
  }

  uiTick(): void {
    this.renderDetail(false);
  }

  click(xCss: number, yCss: number, double: boolean): void {
    let best: { sel: Selection; d: number; depth: number } | undefined;
    const consider = (sel: Selection, scene: Vec3 | undefined): void => {
      const p = scene && this.project(scene);
      if (!scene || !p) return;
      const d = Math.hypot(p.x - xCss, p.y - yCss);
      if (d > pickRadiusPx(PICK_RADIUS_PX)) return;
      const depth = length(sub(scene, this.originKm));
      // Objects overlapping on screen (within a few pixels): the one in front wins.
      const better = !best || (Math.abs(d - best.d) < 3 ? depth < best.depth : d < best.d);
      if (better) best = { sel, d, depth };
    };
    for (const t of this.tracked) consider({ kind: 'mission', mission: t.mission }, t.scene);
    if (this.sitesVisible)
      this.sites.forEach((s, i) => consider({ kind: 'site', site: s }, this.siteScene[i]));
    if (best) this.select(best.sel, { follow: double });
  }

  writeUrl(p: URLSearchParams): void {
    const sel = this.selection;
    if (sel?.kind === 'mission') p.set('sel', sel.mission.id);
    if (sel?.kind === 'site') p.set('sel', `site:${sel.site.id}`);
    if (!this.sitesVisible) p.set('sites', '0');
  }

  dispose(): void {
    this.disposed = true;
    const scene = this.host.renderer.scene;
    scene.remove(this.body.mesh, this.missionGroup);
    this.body.dispose();
    if (this.earth) {
      scene.remove(this.earth.mesh);
      this.earth.dispose();
    }
    this.missionMarkers.dispose();
    this.siteMarkers.dispose();
    for (const t of this.tracked) {
      t.line.geometry.dispose();
      t.line.material.dispose();
      if (t.mesh) {
        scene.remove(t.mesh.mesh);
        t.mesh.dispose();
      }
    }
    this.labels.dispose();
    delete (window as { __perigeeTest?: unknown }).__perigeeTest;
  }

  // --- internals -----------------------------------------------------------------------------------------

  private makeTrack(
    mission: Mission,
    table: ConstructorParameters<typeof EphemerisTrack>[0],
  ): EphemerisTrack {
    return new EphemerisTrack(table, {
      muKm3S2: this.config.muKm3S2,
      maxExtrapolationDays: mission.lowOrbit
        ? LOW_ORBIT_MAX_EXTRAPOLATION_DAYS
        : HIGH_ORBIT_MAX_EXTRAPOLATION_DAYS,
    });
  }

  private trackedFor(id: string): Tracked | undefined {
    return this.tracked.find((t) => t.mission.id === id);
  }

  private async loadEphemerides(): Promise<void> {
    const { host } = this;
    host.showNotice(host.i18n.t(this.config.keys.loading));
    try {
      const manifest = await loadManifest(host.baseUrl);
      let oldest: Date | undefined;
      await Promise.all(
        this.tracked.map(async (t) => {
          const entry = manifest.ephemerides[t.mission.id];
          if (!entry || entry.centralBody !== this.config.centralBody) return;
          const table = await loadEphemeris(host.baseUrl, entry);
          if (this.disposed) return;
          t.track = this.makeTrack(t.mission, table);
          t.entry = entry;
          const fetched = new Date(entry.fetchedAt);
          if (!oldest || fetched < oldest) oldest = fetched;
        }),
      );
      if (this.disposed) return;
      if (this.config.roverFeed) {
        const rovers = await loadOptionalDataset(host.baseUrl, manifest, 'mars.rovers', RoverPositionsSchema);
        if (rovers && !this.disposed) this.applyRovers(rovers.data);
      }
      this.panel.setFetched(oldest);
      this.lastTrajectoryWallMs = -Infinity;
      host.showNotice(undefined);
      this.renderDetail(false);
    } catch (err) {
      console.error(err);
      host.showNotice(host.i18n.t(this.config.keys.unavailable));
    }
  }

  private applyRovers(rovers: RoverPositions): void {
    this.rovers = rovers;
    this.sites.forEach((site, i) => {
      const p = rovers[site.id];
      if (p) this.siteBodyKm[i] = this.siteSurfaceKm(p.latDeg, p.lonDeg);
    });
  }

  private siteSurfaceKm(latDeg: number, lonDeg: number): Vec3 {
    return scale(latLonToUnit(latDeg * DEG_TO_RAD, lonDeg * DEG_TO_RAD), this.R * (1 + 3e-4));
  }

  private refreshTrajectories(): void {
    for (const t of this.tracked) {
      const period = t.track.periodS(this.tdbJd);
      const spanS = Math.min(Math.max(period ?? SECONDS_PER_DAY, 3600), 7 * SECONDS_PER_DAY);
      const pts = t.track.trajectory(this.tdbJd, spanS, TRAJECTORY_POINTS);
      t.line.geometry.setAttribute('position', new Float32BufferAttribute(Float32Array.from(pts), 3));
      const selected = this.selection?.kind === 'mission' && this.selection.mission.id === t.mission.id;
      this.styleLine(t, selected);
    }
  }

  /** Visual honesty: solid when interpolated, dashed when extrapolated, grey when only the past is known. */
  private styleLine(t: Tracked, selected: boolean): void {
    const color = this.colors.get(t.mission.id) ?? DEFAULT_MISSION_COLOR;
    const kind = t.sample.kind;
    const wantDashed = kind === 'extrapolated';
    const current = t.line.material;
    if (wantDashed !== current instanceof LineDashedMaterial) {
      current.dispose();
      const dash = this.R * 0.09;
      t.line.material = wantDashed
        ? new LineDashedMaterial({ color, dashSize: dash, gapSize: dash * 0.8, transparent: true })
        : new LineBasicMaterial({ color, transparent: true });
    }
    if (wantDashed) t.line.computeLineDistances();
    const m = t.line.material as LineBasicMaterial | LineDashedMaterial;
    m.color.set(kind === 'hidden' ? '#8a8f98' : color);
    m.opacity = kind === 'hidden' ? 0.35 : selected ? 1 : 0.55;
    t.line.visible = kind !== 'none';
  }

  /** Behind the central body, or behind the Earth (Moon view), as seen from the camera. */
  private hidden(sceneKm: Vec3): boolean {
    return (
      occludedBySphere(this.originKm, sceneKm, this.R) ||
      (this.earth !== undefined &&
        occludedBySphereAt(this.originKm, sceneKm, this.earthScene, this.earth.radiusKm))
    );
  }

  private project(sceneKm: Vec3): { x: number; y: number } | undefined {
    if (this.hidden(sceneKm)) return undefined;
    const r = sub(sceneKm, this.originKm);
    this.v.set(r[0], r[1], r[2]).project(this.host.renderer.camera);
    if (this.v.z > 1 || Math.abs(this.v.x) > 1 || Math.abs(this.v.y) > 1) return undefined;
    const canvas = this.host.renderer.canvas;
    return { x: ((this.v.x + 1) / 2) * canvas.clientWidth, y: ((1 - this.v.y) / 2) * canvas.clientHeight };
  }

  private refreshLabels(): void {
    const lang = this.host.i18n.lang;
    this.labels.setItems([
      ...this.tracked.map((t) => ({
        id: `m:${t.mission.id}`,
        text: t.mission.name[lang],
        className: t.mission.objectType === 'natural' ? 'label-natural' : 'label-mission',
      })),
      ...(this.sitesVisible
        ? this.sites.map((s) => ({ id: `s:${s.id}`, text: s.name[lang], className: 'label-site' }))
        : []),
    ]);
  }

  private placeLabels(): void {
    const camera = this.host.renderer.camera;
    const canvas = this.host.renderer.canvas;
    const w = canvas.clientWidth;
    const hgt = canvas.clientHeight;
    const o = this.originKm;
    const R = this.R;
    const sel = this.selection;
    this.labels.begin();
    for (const t of this.tracked) {
      const s = t.scene;
      if (!s) continue;
      const r = sub(s, o);
      const selected = sel?.kind === 'mission' && sel.mission.id === t.mission.id;
      this.labels.place(
        `m:${t.mission.id}`,
        r,
        s,
        camera,
        o,
        R,
        w,
        hgt,
        selected ? LabelPriority.Selected : LabelPriority.Orbiting,
      );
      // Ground-site labels must not cover the markers of orbiting objects.
      const p = this.labels.project(r, s, camera, o, R, w, hgt);
      if (p) this.labels.obstacle(p.x, p.y, 8, LabelPriority.Orbiting);
    }
    if (this.sitesVisible) {
      this.sites.forEach((site, i) => {
        const s = this.siteScene[i];
        if (!s) return;
        const near = length(sub(s, o)) < this.config.siteLabelDistanceKm;
        const selected = sel?.kind === 'site' && sel.site.id === site.id;
        if (!near && !selected) return;
        this.labels.place(
          `s:${site.id}`,
          sub(s, o),
          s,
          camera,
          o,
          R,
          w,
          hgt,
          selected ? LabelPriority.Selected : LabelPriority.Site,
        );
      });
    }
    this.labels.layout(w, hgt);
  }

  private restoreFromUrl(p: URLSearchParams): void {
    if (p.get('sites') === '0') {
      this.sitesVisible = false;
      this.siteGroup.visible = false;
      this.refreshLabels();
    }
    const sel = p.get('sel');
    if (!sel) return;
    if (sel.startsWith('site:')) {
      const site = this.sites.find((s) => s.id === sel.slice(5));
      if (site) this.select({ kind: 'site', site }, { frame: true });
    } else {
      const mission = this.missions.find((m) => m.id === sel);
      if (mission) this.select({ kind: 'mission', mission }, { frame: true });
    }
  }

  private select(sel: Selection, options: { follow?: boolean; focus?: boolean; frame?: boolean } = {}): void {
    const cur = this.selection;
    const same =
      (sel?.kind === 'mission' && cur?.kind === 'mission' && sel.mission.id === cur.mission.id) ||
      (sel?.kind === 'site' && cur?.kind === 'site' && sel.site.id === cur.site.id);
    if (!same) this.host.follow.stop();
    this.selection = sel;
    this.panel.setSelected(
      sel?.kind === 'mission' ? `mission:${sel.mission.id}` : sel ? `site:${sel.site.id}` : undefined,
    );
    this.pendingFrame = sel !== undefined && (options.frame ?? false) && !options.follow;
    this.lastTrajectoryWallMs = -Infinity;
    if (!sel) this.detail.hide();
    else this.renderDetail(options.focus ?? false);
    if (sel && options.follow) this.startFollowing();
    this.host.syncUrl();
  }

  private scenePositionOf(sel: Selection): Vec3 | undefined {
    if (sel?.kind === 'mission') return this.trackedFor(sel.mission.id)?.scene;
    if (sel?.kind === 'site') return this.siteScene[this.sites.indexOf(sel.site)];
    return undefined;
  }

  private startFollowing(): void {
    const sel = this.selection;
    const pos = this.scenePositionOf(sel);
    if (!sel || !pos) return;
    const R = this.R;
    const altitudeKm = length(pos) - R;
    const distanceKm = sel.kind === 'site' ? R * 0.25 : Math.min(Math.max(altitudeKm * 2, R * 0.25), R * 17);
    this.detail.following = this.host.follow.start(
      () => this.scenePositionOf(this.selection === sel ? sel : undefined),
      distanceKm,
      () => (this.detail.following = false),
    );
  }

  private renderDetail(focus: boolean): void {
    const sel = this.selection;
    if (!sel) return;
    const content = sel.kind === 'mission' ? this.missionDetail(sel.mission) : this.siteDetail(sel.site);
    this.detail.show(content, focus);
  }

  private missionDetail(m: Mission): DetailContent {
    const { i18n } = this.host;
    const R = this.R;
    const t = (k: MessageKey): string => i18n.t(k);
    const num = (v: number, d = 0): string => i18n.number(v, d);
    const tracked = this.trackedFor(m.id);
    const rows: [string, string][] = [];
    if (m.agency) rows.push([t('info.agency'), m.agency]);
    if (m.country) rows.push([t('info.country'), countryName(i18n, m.country)]);
    if (m.launchDate) rows.push([t('info.launch'), m.launchDate]);
    if (m.objectType !== 'natural')
      rows.push([t('info.status'), i18n.maybe(`mission.status.${m.status}`) ?? m.status]);
    if (m.orbit) rows.push([t('info.orbit'), m.orbit[i18n.lang]]);
    if (m.radiusKm) rows.push([t('info.radius'), `${num(m.radiusKm, 1)} km`]);
    if (m.horizonsId) rows.push([t('info.horizons'), m.horizonsId]);
    if (m.norad) rows.push([t('info.norad'), String(m.norad)]);

    let badge: { text: string; state: BadgeState };
    const sample = tracked?.sample;
    if (m.status === 'planned') badge = { text: t('ephem.planned'), state: 'invalid' };
    else if (!tracked || !sample || sample.kind === 'none')
      badge = { text: t('ephem.none'), state: 'invalid' };
    else if (sample.kind === 'interpolated') badge = { text: t('ephem.interpolated'), state: 'fresh' };
    else if (sample.kind === 'extrapolated') {
      badge = {
        text: i18n.format('ephem.extrapolated', { h: num(sample.beyondS / 3600, 1) }),
        state: 'stale',
      };
    } else {
      badge = {
        text: i18n.format('ephem.hidden', { d: num(sample.beyondS / SECONDS_PER_DAY, 0) }),
        state: 'invalid',
      };
    }

    const s = sample?.state;
    if (s) {
      // Elements relative to the body's equator: rotate the state into the body-fixed orientation.
      const toBody = quatConjugate(this.bodyQ);
      const el = osculatingElements(
        { posKm: quatRotate(toBody, s.posKm), velKmS: quatRotate(toBody, s.velKmS) },
        this.config.muKm3S2,
      );
      rows.push([t('info.altitude'), `${num(length(s.posKm) - R)} km`]);
      rows.push([t('info.speed'), `${num(length(s.velKmS), 3)} km/s`]);
      const apo = el.apoapsisRadiusKm === undefined ? '∞' : num(el.apoapsisRadiusKm - R);
      rows.push([t('info.periapsis'), `${num(el.periapsisRadiusKm - R)} / ${apo} km`]);
      if (el.periodS) rows.push([t('info.period'), `${num(el.periodS / 60, 1)} min`]);
      rows.push([t('info.inclinationEquator'), `${num(el.inclinationRad * RAD_TO_DEG, 1)}°`]);
    }
    const entry = tracked?.entry;
    if (entry) {
      rows.push([
        t('info.window'),
        `${formatUtcDate(tdbJdToDate(entry.startTdbJd))} → ${formatUtcDate(tdbJdToDate(entry.endTdbJd))}`,
      ]);
    }
    return {
      title: m.name[i18n.lang],
      badge,
      rows,
      ...(m.notes ? { notes: m.notes[i18n.lang] } : {}),
      sources: m.sources,
      footnote: i18n.format('info.verified', { date: m.verified }),
      followable: s !== undefined,
    };
  }

  private siteDetail(site: LandingSite): DetailContent {
    const { i18n } = this.host;
    const t = (k: MessageKey): string => i18n.t(k);
    const live = this.rovers[site.id];
    const rows: [string, string][] = [[t('info.type'), i18n.maybe(`site.${site.type}`) ?? site.type]];
    if (live && site.feed) {
      // Mars solar day = 88 775.244 s; sol 0 is the landing day.
      const date = new Date(Date.parse(`${site.feed.solZeroDate}T00:00:00Z`) + live.sol * 88_775_244);
      rows.push([t('info.sol'), `${i18n.number(live.sol)} (≈ ${date.toISOString().slice(0, 10)})`]);
      if (live.distanceTotalM !== undefined) {
        rows.push([t('info.odometry'), `${i18n.number(live.distanceTotalM / 1000, 2)} km`]);
      }
    } else {
      rows.push([t('info.date'), site.date]);
    }
    rows.push([t('info.agency'), site.agency]);
    if (site.country) rows.push([t('info.country'), countryName(i18n, site.country)]);
    rows.push([
      t('info.coordinates'),
      formatLatLon(live?.latDeg ?? site.latDeg, live?.lonDeg ?? site.lonDeg),
    ]);
    return {
      title: site.name[i18n.lang],
      ...(live ? { badge: { text: t('info.liveFeed'), state: 'fresh' as const } } : {}),
      rows,
      ...(site.note && !live ? { notes: site.note } : {}),
      sources: live ? [live.source, ...site.sources.filter((u) => u !== live.source)] : site.sources,
      footnote: i18n.format('info.verified', { date: this.config.sites.verified }),
      followable: true,
    };
  }

  /** `?e2e` hook: frames an object from outside so tests can click it at the canvas centre. */
  private installTestHook(): void {
    const { controls } = this.host;
    Object.assign(window, {
      __perigeeTest: {
        lookAt: (id: string): boolean => {
          const pos = id.startsWith('site:')
            ? this.siteScene[this.sites.findIndex((s) => s.id === id.slice(5))]
            : this.trackedFor(id)?.scene;
          if (!pos) return false;
          controls.setState(orbitStateLookingFrom([0, 0, 0], pos, [0, 0, 1], length(pos) + this.R * 1.2));
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
