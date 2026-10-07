/**
 * Generic view centred on a solid body other than the Earth (Moon, Mars): spacecraft and natural satellites
 * from JPL Horizons ephemerides (Hermite-interpolated, Kepler-extrapolated outside the window, hidden
 * beyond a limit), landing/impact sites, optionally the Earth at its true position (CLAUDE.md §5.2).
 * Each body is a `PlanetaryConfig`; see src/moon/MoonView.ts and src/mars/MarsView.ts.
 */
import {
  BufferGeometry,
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
import { SUN_RADIUS_KM } from '../astro/planets';
import { quatConjugate, quatFromBasis, quatMultiply, quatRotate, type Quat } from '../astro/quat';
import { alignAxes, axisVector } from '../astro/attitude';
import { utcToTdbJd } from '../astro/time';
import {
  EphemerisTrack,
  HIGH_ORBIT_MAX_EXTRAPOLATION_DAYS,
  LOW_ORBIT_MAX_EXTRAPOLATION_DAYS,
  type TrackSample,
} from '../astro/track';
import { add, cross, dot, length, normalize, scale, sub, type Vec3 } from '../astro/vec3';
import { bodyFollow, orbitStateLookingFrom, type CameraObstacle } from '../camera/orbitMath';
import { datasetKey, ephemerisKey } from '../app/updates';
import { loadEphemeris, loadManifest, loadOptionalDataset } from '../data/loader';
import {
  RoverPositionsSchema,
  type CentralBody,
  type EphemerisEntry,
  type LandingSite,
  type LandingSites,
  type Mission,
  type RoverPositions,
  type ModelEntry,
} from '../data/schemas';
import type { MessageKey } from '../i18n';
import { BodyMesh } from '../render/BodyMesh';
import {
  SceneModel,
  loadBodyShape,
  modelFollowDistanceKm,
  modelFor,
  modelMinDistance,
  withModel,
} from '../render/models';
import { createEarthMesh } from '../render/earthMesh';
import { DistantSun } from '../render/SunMesh';
import { LabelLayer, LabelPriority, occludedBySphere, occludedBySphereAt } from '../render/Labels';
import { pickRadiusPx } from '../render/pointer';
import { MarkerPoints } from '../render/MarkerPoints';
import { SelectionMarker } from '../render/OrbitLine';
import { placeholderTexture, progressiveTexture, type ProgressiveTexture } from '../render/textures';
import { BodyPanel } from '../ui/BodyPanel';
import { parseHiddenMissions, writeHiddenMissions } from '../ui/missionToggles';
import { countryName } from '../ui/countries';
import { DetailPanel, type BadgeState, type DetailContent } from '../ui/DetailPanel';
import { formatUtcDate } from '../ui/labels';
import { setLinePositions } from '../render/lineBuffers';

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
  /** Largest Sun distance from this body (km), plus the Sun's radius: the far plane must include it. */
  readonly sunMaxDistanceKm: number;
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

/** Site markers float 1 m above the drawn surface (screen-sized, not depth-tested: occlusion is on the CPU). */
const SITE_MARKER_LIFT_KM = 0.001;
/** Gap under a site's model (5 cm): see siteModelScene. */
const SITE_MODEL_CLEARANCE_KM = 5e-5;

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
  /** Unit direction of the Sun (scene frame). */
  private sunScene: Vec3 = [1, 0, 0];
  /** Sun centre in the scene frame (km), drawn at its true distance. */
  private sunSceneKm: Vec3 = [1.496e8, 0, 0];
  private readonly distantSun: DistantSun;
  /** NASA 3D model of the selected orbiter or rover, drawn once it covers a few pixels. */
  private sceneModel!: SceneModel;
  private bodyQ: Quat = { x: 0, y: 0, z: 0, w: 1 };
  private tdbJd = 0;
  private originKm: Vec3 = [0, 0, 0];
  private selection: Selection;
  private sitesVisible = true;
  private lastTrajectoryWallMs = -Infinity;
  private lastEpoch = -1;
  /** Missions unticked in the panel: no marker, trajectory, label or picking (URL `hide`). */
  private hiddenMissions: ReadonlySet<string> = new Set();
  private disposed = false;
  /** Frame the selection once its position is known (next update). */
  private pendingFrame = false;
  private readonly loadedData = new Map<string, string>();
  /** Ephemerides loaded (or failed): a framing request without a position can be dropped. */
  private ephemeridesSettled = false;
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
    // Up to the Sun, drawn at its true distance (~1.53e8 km from the Moon, ~2.5e8 km from Mars).
    this.farKm = Math.max(config.farKm, config.sunMaxDistanceKm);
    this.missions = config.missions;
    this.sites = config.sites.sites;

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
    this.siteBodyKm = this.sites.map((site) => this.siteSurfaceKm(site.latDeg, site.lonDeg));
    this.earth = config.earthFromBodyKm ? createEarthMesh(renderer, host.baseUrl) : undefined;
    renderer.scene.add(this.body.mesh, this.missionGroup);
    if (this.earth) renderer.scene.add(this.earth.mesh);

    const drawable = this.missions.filter((m) => m.ephemeris === 'horizons');
    // No GPU depth test: a screen-sized sprite has a single depth and would be half-buried in the curved
    // surface when seen from afar. Occlusion by the body is computed on the CPU instead (placeOrigin).
    this.missionMarkers = new MarkerPoints(Math.max(1, drawable.length), 11, {
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
      if (mesh) {
        renderer.scene.add(mesh.mesh);
        // Irregular moons (Phobos, Deimos): NASA shape model and map instead of the grey sphere.
        if (modelFor(`mission:${mission.id}`)?.body) {
          void loadBodyShape(host.baseUrl, `${modelFor(`mission:${mission.id}`)?.id}`).then((shape) => {
            if (!shape || this.disposed) return;
            mesh.setGeometry(shape.geometry);
            if (shape.map) mesh.setDayMap(shape.map);
          });
        }
      }
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
    this.missionRing = new SelectionMarker();
    this.missionGroup.add(this.missionRing.points);

    this.siteMarkers = new MarkerPoints(Math.max(1, this.sites.length), 8, { depthTest: false });
    this.sites.forEach((s, i) => this.siteMarkers.setColor(i, SITE_COLORS[s.type]));
    this.siteRing = new SelectionMarker({ surface: true });
    this.siteGroup.add(this.siteMarkers.points, this.siteRing.points);
    this.body.mesh.add(this.siteGroup);

    this.hiddenMissions = parseHiddenMissions(host.initialParams);
    this.sceneModel = new SceneModel(renderer.scene, renderer.renderer, host.baseUrl);
    this.distantSun = new DistantSun(renderer.scene, SUN_RADIUS_KM);
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
        onMissionVisibility: (hidden) => {
          this.hiddenMissions = new Set(hidden);
          const sel = this.selection;
          if (sel?.kind === 'mission' && hidden.has(sel.mission.id)) this.select(undefined);
          this.lastTrajectoryWallMs = -Infinity;
          host.syncUrl();
        },
      },
      this.hiddenMissions,
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

  cameraObstacles(): readonly CameraObstacle[] {
    const toBody = quatConjugate(this.bodyScene);
    const list: CameraObstacle[] = [
      {
        centreKm: [0, 0, 0],
        radiusKm: this.body.boundingRadiusKm,
        surfaceKm: (dir) => this.body.surfaceUnderKm(quatRotate(toBody, dir)),
      },
    ];
    for (const t of this.tracked) {
      if (t.mesh && t.scene && t.mesh.mesh.visible)
        list.push({ centreKm: t.scene, radiusKm: t.mesh.boundingRadiusKm });
    }
    if (this.earth) list.push({ centreKm: this.earthScene, radiusKm: this.earth.radiusKm });
    return list;
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

    this.sunSceneKm = quatRotate(sceneQ, this.config.sunFromBodyKm(date));
    const sun = normalize(this.sunSceneKm);
    this.sunScene = sun;
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
      if (s && !this.hiddenMissions.has(t.mission.id)) {
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
      // Natural satellites are tidally locked: body x axis towards the planet, z along the orbit normal.
      if (t.mesh && s) {
        const x = normalize(scale(s.posKm, -1));
        const z = normalize(cross(s.posKm, s.velKmS));
        t.mesh.setOrientation(quatMultiply(sceneQ, quatFromBasis(x, cross(z, x), z)));
      }
      if (t.mesh) t.mesh.mesh.visible = t.scene !== undefined;
    }
    this.siteScene = this.siteBodyKm.map((p) => quatRotate(this.bodyScene, p));

    // Trajectories are drawn relative to their spacecraft, densified around it: the selected one (which the
    // camera may follow closely) every frame, the others a few times per second.
    const wall = performance.now();
    const all = f.clockEpoch !== this.lastEpoch || wall - this.lastTrajectoryWallMs > TRAJECTORY_REFRESH_MS;
    if (all) {
      this.lastEpoch = f.clockEpoch;
      this.lastTrajectoryWallMs = wall;
    }
    this.refreshTrajectories(!all);

    const sel = this.selection;
    const selTracked = sel?.kind === 'mission' ? this.trackedFor(sel.mission.id) : undefined;
    this.missionRing.set(selTracked?.scene ? selTracked.sample.state?.posKm : undefined);
    this.siteRing.set(sel?.kind === 'site' ? this.siteBodyKm[this.sites.indexOf(sel.site)] : undefined);
    if (this.pendingFrame) {
      const pos = this.scenePositionOf(sel);
      if (pos) this.host.frameObject(pos);
      // Wait for the ephemerides (a selection from the URL precedes them); objects without a 3D position once
      // they are loaded cannot be framed: give up rather than wait forever.
      if (pos || this.ephemeridesSettled) this.pendingFrame = false;
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
    this.distantSun.place(this.sunSceneKm, originKm);
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
    this.placeModel(originKm);
    this.placeLabels();
  }

  /**
   * The selected orbiter's or rover's 3D model, in place of its marker when close. Orbiters: the model's nadir
   * axis towards the body, then the Sun; rovers: upright on the local vertical, front towards north.
   */
  private placeModel(originKm: Vec3): void {
    const sel = this.selection;
    // Around a selected site, the ground is drawn at full precision (a rover would flicker through the sphere).
    this.body.setLocalPatch(sel?.kind === 'site' ? this.siteBodyKm[this.sites.indexOf(sel.site)] : undefined);
    const camera = this.host.renderer.camera;
    const focalPx = this.host.renderer.canvas.clientHeight / 2 / Math.tan((camera.fov * Math.PI) / 360);
    let entry: ModelEntry | undefined;
    let scene: Vec3 | undefined;
    let q: Quat = { x: 0, y: 0, z: 0, w: 1 };
    let hideMarker = (): void => undefined;
    if (sel?.kind === 'mission') {
      const t = this.trackedFor(sel.mission.id);
      // Natural bodies draw their model through their BodyMesh.
      const found = modelFor(`mission:${sel.mission.id}`);
      entry = found?.body ? undefined : found;
      scene = t?.scene;
      if (t && scene && entry) {
        q = alignAxes(
          axisVector(entry.nadirAxis ?? '-y'),
          normalize(scale(scene, -1)),
          axisVector(entry.sunAxis ?? '+z'),
          this.sunScene,
        );
        hideMarker = () => {
          this.missionMarkers.hide(t.index);
          this.missionMarkers.commit();
          this.missionRing.set(undefined);
        };
      }
    } else if (sel?.kind === 'site') {
      const i = this.sites.indexOf(sel.site);
      entry = modelFor(`site:${sel.site.id}`);
      scene = entry ? this.siteModelScene(i, entry) : undefined;
      if (scene && entry) {
        const north = quatRotate(this.bodyScene, [0, 0, 1]);
        q = alignAxes(
          axisVector(entry.nadirAxis ?? '-y'),
          normalize(scale(scene, -1)),
          axisVector('+z'),
          north,
        );
        hideMarker = () => {
          this.siteMarkers.hide(i);
          this.siteMarkers.commit();
          this.siteRing.set(undefined);
        };
      }
    }
    const shown = this.sceneModel.update(
      scene ? entry : undefined,
      scene ? sub(scene, originKm) : undefined,
      q,
      this.sunScene,
      focalPx,
    );
    if (shown && scene && entry) {
      hideMarker();
      this.hideBehindModel(originKm, scene, entry.sizeM / 1000);
    }
  }

  /**
   * Markers drawn without depth test (sites, other spacecraft) would show through a 3D model: hide those behind
   * it, within its bounding circle on screen.
   */
  private hideBehindModel(originKm: Vec3, modelScene: Vec3, sizeKm: number): void {
    const toModel = sub(modelScene, originKm);
    const distKm = length(toModel);
    if (distKm === 0) return;
    const radiusRad = Math.atan2(sizeKm * 0.6, distKm);
    const dir = scale(toModel, 1 / distKm);
    const behind = (p: Vec3): boolean => {
      const v = sub(p, originKm);
      const d = length(v);
      return d > distKm && Math.acos(Math.min(1, dot(v, dir) / d)) < radiusRad;
    };
    let sites = false;
    this.sites.forEach((_, i) => {
      const p = this.siteScene[i];
      if (p && behind(p)) {
        this.siteMarkers.hide(i);
        sites = true;
      }
    });
    if (sites) this.siteMarkers.commit();
    let missions = false;
    for (const t of this.tracked) {
      if (t.scene && t.scene !== modelScene && behind(t.scene)) {
        this.missionMarkers.hide(t.index);
        missions = true;
      }
    }
    if (missions) this.missionMarkers.commit();
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

  dataVersions(): ReadonlyMap<string, string> {
    return this.loadedData;
  }

  writeUrl(p: URLSearchParams): void {
    const sel = this.selection;
    if (sel?.kind === 'mission') p.set('sel', sel.mission.id);
    if (sel?.kind === 'site') p.set('sel', `site:${sel.site.id}`);
    if (!this.sitesVisible) p.set('sites', '0');
    writeHiddenMissions(p, this.hiddenMissions);
  }

  dispose(): void {
    this.disposed = true;
    const scene = this.host.renderer.scene;
    scene.remove(this.body.mesh, this.missionGroup);
    this.sceneModel.dispose();
    this.distantSun.dispose();
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
      // Each ephemeris on its own: one missing or corrupt file must not hide the others.
      let failed = 0;
      let loaded = 0;
      await Promise.all(
        this.tracked.map(async (t) => {
          const entry = manifest.ephemerides[t.mission.id];
          if (!entry || entry.centralBody !== this.config.centralBody) return;
          let table;
          try {
            table = await loadEphemeris(host.baseUrl, entry);
          } catch (err) {
            failed++;
            console.warn(`Ephemeris unavailable: ${t.mission.id}`, err);
            return;
          }
          if (this.disposed) return;
          loaded++;
          this.loadedData.set(ephemerisKey(t.mission.id), entry.sha256);
          t.track = this.makeTrack(t.mission, table);
          t.entry = entry;
          const fetched = new Date(entry.fetchedAt);
          if (!oldest || fetched < oldest) oldest = fetched;
        }),
      );
      if (this.disposed) return;
      if (failed > 0 && loaded === 0) throw new Error(`no ephemeris could be loaded (${failed} failed)`);
      if (this.config.roverFeed) {
        const rovers = await loadOptionalDataset(host.baseUrl, manifest, 'mars.rovers', RoverPositionsSchema);
        if (rovers && !this.disposed) {
          this.loadedData.set(datasetKey('mars.rovers'), rovers.entry.sha256);
          this.applyRovers(rovers.data);
        }
      }
      this.panel.setFetched(oldest);
      host.showNotice(undefined);
      this.ephemeridesSettled = true;
      this.renderDetail(false);
    } catch (err) {
      console.error(err);
      this.ephemeridesSettled = true;
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

  /**
   * Where a site's model stands (scene frame): on the surface actually drawn, its lowest point (a rover's wheels)
   * on the ground, raised by a few centimetres: the model stands upright along the radial while the facet under
   * it tilts by up to π/192, so without it a wheel dips into the ground and flickers as the view turns. The
   * model, the follow camera and the framing use this point.
   */
  private siteModelScene(i: number, entry: ModelEntry): Vec3 | undefined {
    const body = this.siteBodyKm[i];
    if (!body) return undefined;
    const up = normalize(body);
    const below = this.sceneModel.extentAlongM(axisVector(entry.nadirAxis ?? '-y')) ?? 0;
    return quatRotate(
      this.bodyScene,
      scale(up, this.groundDistanceKm(up) + below / 1000 + SITE_MODEL_CLEARANCE_KM),
    );
  }

  /** Drawn-surface distance along body-frame directions, cached (sites and rovers rarely move). */
  private readonly groundCache = new Map<string, number>();

  private groundDistanceKm(up: Vec3): number {
    const key = `${up[0].toFixed(9)},${up[1].toFixed(9)},${up[2].toFixed(9)}`;
    let d = this.groundCache.get(key);
    if (d === undefined) {
      d = this.body.surfaceDistanceKm(up);
      this.groundCache.set(key, d);
    }
    return d;
  }

  /** Marker position of a site (body frame): just above the surface actually drawn. */
  private siteSurfaceKm(latDeg: number, lonDeg: number): Vec3 {
    const up = latLonToUnit(latDeg * DEG_TO_RAD, lonDeg * DEG_TO_RAD);
    return scale(up, this.groundDistanceKm(up) + SITE_MARKER_LIFT_KM);
  }

  private refreshTrajectories(selectedOnly = false): void {
    const sel = this.selection;
    for (const t of this.tracked) {
      if (selectedOnly && !(sel?.kind === 'mission' && sel.mission.id === t.mission.id)) continue;
      const period = t.track.periodS(this.tdbJd);
      const spanS = Math.min(Math.max(period ?? SECONDS_PER_DAY, 3600), 7 * SECONDS_PER_DAY);
      const pts = t.track.trajectory(this.tdbJd, spanS, TRAJECTORY_POINTS);
      // Vertices relative to the spacecraft (Float64 subtraction), the line placed at it: no Float32 jitter
      // when the camera follows it closely, and the line passes exactly through the marker.
      const c: Vec3 = t.sample.state?.posKm ?? [pts[0] ?? 0, pts[1] ?? 0, pts[2] ?? 0];
      const rel = new Float32Array(pts.length);
      for (let i = 0; i < pts.length; i += 3) {
        rel[i] = (pts[i] ?? 0) - c[0];
        rel[i + 1] = (pts[i + 1] ?? 0) - c[1];
        rel[i + 2] = (pts[i + 2] ?? 0) - c[2];
      }
      t.line.position.set(c[0], c[1], c[2]);
      setLinePositions(t.line, rel);
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
    t.line.visible = kind !== 'none' && !this.hiddenMissions.has(t.mission.id);
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
    if (sel?.kind === 'site') {
      const i = this.sites.indexOf(sel.site);
      const entry = modelFor(`site:${sel.site.id}`);
      return (entry && this.siteModelScene(i, entry)) || this.siteScene[i];
    }
    return undefined;
  }

  toggleFollow(): void {
    // Following supersedes a framing requested by the selection but not applied yet.
    this.pendingFrame = false;
    if (this.host.follow.active) this.host.follow.stop();
    else if (this.selection) this.startFollowing();
  }

  private startFollowing(): void {
    const sel = this.selection;
    const pos = this.scenePositionOf(sel);
    if (!sel || !pos) return;
    const R = this.R;
    const altitudeKm = length(pos) - R;
    const target = sel.kind === 'mission' ? `mission:${sel.mission.id}` : `site:${sel.site.id}`;
    // Natural satellites (Phobos, Deimos) are framed by their own size, like bodies in the other views.
    const radiusKm =
      sel.kind === 'mission' && sel.mission.objectType === 'natural' ? sel.mission.radiusKm : undefined;
    const body = radiusKm !== undefined ? bodyFollow(radiusKm) : undefined;
    const distanceKm =
      body?.distanceKm ??
      modelFollowDistanceKm(target) ??
      (sel.kind === 'site' ? R * 0.25 : Math.min(Math.max(altitudeKm * 2, R * 0.25), R * 17));
    this.detail.following = this.host.follow.start(
      () => this.scenePositionOf(this.selection === sel ? sel : undefined),
      distanceKm,
      () => (this.detail.following = false),
      body
        ? {
            minDistanceKm: body.minDistanceKm,
            surfaceRadiusKm: body.surfaceRadiusKm,
            viewFrom: this.litViewFrom(pos),
          }
        : modelMinDistance(target),
    );
  }

  /**
   * Direction (scene frame) from a natural satellite to a camera that sees its day side, leaning outward so the
   * planet shows behind it when it can; straight from the Sun when the satellite is behind the planet.
   */
  private litViewFrom(posKm: Vec3): Vec3 {
    const v = add(this.sunScene, scale(normalize(posKm), 0.5));
    return length(v) > 0.3 ? normalize(v) : this.sunScene;
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
      ...withModel(`mission:${m.id}`),
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
    rows.push([t('info.coordinates'), i18n.latLon(live?.latDeg ?? site.latDeg, live?.lonDeg ?? site.lonDeg)]);
    return {
      title: site.name[i18n.lang],
      ...(live ? { badge: { text: t('info.liveFeed'), state: 'fresh' as const } } : {}),
      rows,
      ...(site.note && !live ? { notes: site.note[i18n.lang] } : {}),
      sources: live ? [live.source, ...site.sources.filter((u) => u !== live.source)] : site.sources,
      footnote: i18n.format('info.verified', { date: this.config.sites.verified }),
      followable: true,
      ...withModel(`site:${site.id}`),
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
        /** Camera on the far side of the body from the Sun, looking past it at the Sun. */
        lookToward: (_what: 'sun', distanceKm = this.R * 6): boolean => {
          // 22° off the anti-Sun direction, so the target shows beside the body's limb.
          const away = normalize(scale(this.sunSceneKm, -1));
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
