/**
 * View D — solar system: the Sun, planets (astronomy-engine) and interplanetary spacecraft (JPL Horizons,
 * heliocentric), with an optional logarithmic distance scale (CLAUDE.md §1, §5.2, §5.4).
 *
 * Frames: the body-fixed frame of this view is the J2000 ecliptic (planets in the plane); the inertial frame is
 * EQJ. Precision: markers and meshes are written relative to the camera on the CPU (Float64). Orbits of planets
 * and small bodies are osculating ellipses whose vertices are relative to the body (dense near it, exact through
 * it); spacecraft trajectories are offsets from an anchor near the spacecraft, plus a dense line over the current
 * ephemeris interval relative to the marker, so the line passes through it without Float32 jitter.
 */
import {
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Sprite,
  type Material,
} from 'three';
import missionsJson from '../../catalog/missions.json';
import moonsJson from '../../catalog/moons.json';
import type { View, ViewFactory, ViewFrame, ViewHost } from '../app/View';
import { bodyOrientationEqj, ceresOrientationEqj, earthOrientation } from '../astro/bodies';
import { AU_KM, DEG_TO_RAD, J2000_JD, MS_PER_DAY, SECONDS_PER_DAY } from '../astro/constants';
import { latLonToUnit } from '../astro/frames';
import { ellipseOffsetsAround, GM_KM3_S2, osculatingElements } from '../astro/kepler';
import {
  OBLIQUITY_J2000_RAD,
  PLANETS,
  RING_TAU_SCALE,
  SUN_RADIUS_KM,
  heliocentricKm,
  heliocentricState,
  hillRadiusKm,
  logScalePosition,
  type PlanetInfo,
} from '../astro/planets';
import {
  QUAT_IDENTITY,
  quatFromAxisAngle,
  quatFromBasis,
  quatMultiply,
  quatRotate,
  type Quat,
} from '../astro/quat';
import { utcToTdbJd } from '../astro/time';
import { EphemerisTrack, HIGH_ORBIT_MAX_EXTRAPOLATION_DAYS, type TrackSample } from '../astro/track';
import { nearSampleTimes } from '../astro/trajectory';
import { alignAxes, axisVector } from '../astro/attitude';
import { applyShape, loadShape } from '../render/shapeGeometry';
import {
  SceneModel,
  loadBodyShape,
  modelFollowDistanceKm,
  modelFor,
  modelMinDistance,
  withModel,
} from '../render/models';
import { add, cross, length, normalize, scale, sub, type Vec3 } from '../astro/vec3';
import { Astronomy } from '../astro/astronomy';
import { bodyFollow, orbitStateLookingFrom, type CameraObstacle } from '../camera/orbitMath';
import { ephemerisKey } from '../app/updates';
import { assetUrl } from '../render/assetUrl';
import { loadEphemeris, loadManifest } from '../data/loader';
import {
  MissionsCatalogSchema,
  MoonsCatalogSchema,
  type EphemerisEntry,
  type Mission,
  type Moon,
} from '../data/schemas';
import { moonState } from '../astro/moons';
import { hermite, type StateVector } from '../astro/hermite';
import type { MessageKey } from '../i18n';
import { BodyMesh, bodySphere } from '../render/BodyMesh';
import { createEarthMesh } from '../render/earthMesh';
import { LabelLayer, LabelPriority, occludedBySphereAt } from '../render/Labels';
import { pickRadiusPx } from '../render/pointer';
import { MarkerPoints } from '../render/MarkerPoints';
import { SelectionMarker } from '../render/OrbitLine';
import { SunMesh, createSunGlow } from '../render/SunMesh';
import { RingMesh } from '../render/RingMesh';
import { textureLevels } from '../render/textureLevels';
import { loadProgressiveTexture, placeholderTexture } from '../render/textures';
import { countryName } from '../ui/countries';
import { DetailPanel, type BadgeState, type DetailContent } from '../ui/DetailPanel';
import { SolarPanel } from '../ui/SolarPanel';
import { parseHiddenMissions, writeHiddenMissions } from '../ui/missionToggles';
import { setLinePositions } from '../render/lineBuffers';

const ECLIPTIC_Q: Quat = quatFromAxisAngle([1, 0, 0], OBLIQUITY_J2000_RAD);
const PICK_RADIUS_PX = 14;
const PLANET_PRIORITY = 70;
/** Surface maps that are not a mosaic of real images: said so in the detail panel (visual honesty). */
const TEXTURE_NOTES: Readonly<Record<string, MessageKey>> = {
  venus: 'texture.artistVenus',
  saturn: 'texture.artist',
  uranus: 'texture.artist',
  neptune: 'texture.artist',
  eris: 'texture.uniform',
  haumea: 'texture.uniform',
  makemake: 'texture.uniform',
  amalthea: 'texture.handDrawn',
  hyperion: 'texture.handDrawn',
  titan: 'texture.titanInfrared',
  miranda: 'texture.uniform',
  ariel: 'texture.uniform',
  umbriel: 'texture.uniform',
  titania: 'texture.uniform',
  oberon: 'texture.uniform',
  proteus: 'texture.uniform',
  nereid: 'texture.uniform',
  nix: 'texture.uniform',
  hydra: 'texture.uniform',
};
/** Hermite sub-samples per ephemeris interval for trajectory lines (1 d steps → 3 h vertices). */
const TRAJECTORY_SUBSTEPS = 8;
/** Near-line vertices on each side of the current time (geometric spacing, see nearSampleTimes). */
const NEAR_SAMPLES_PER_SIDE = 24;
/** Opacity of unselected osculating orbits (planets, small bodies, moons). */
const ORBIT_OPACITY = 0.35;
/**
 * A spacecraft staying longer than this within CAPTURE_HILL_FRACTION of a planet's Hill radius is orbiting that
 * planet (Juno, BepiColombo after insertion) or station-keeping near it (Sun–Earth L1/L2): its heliocentric
 * path there only retraces the planet's orbit, so that part of the line is left out. Flybys stay.
 */
const CAPTURE_MIN_DAYS = 10;
const CAPTURE_HILL_FRACTION = 1.5;
/** Rebuild an orbit once the body has moved by this fraction of its period (the dense part follows it). */
const ORBIT_REBUILD_FRACTION = 1e-3;
const DEFAULT_PROBE_COLOR = '#e0e0e0';
const LIGHT_SPEED_KM_S = 299_792.458;
/** Textures (and rings) load once the body is closer than this many radii (apparent size ≳ 0.04°). */
const TEXTURE_LOAD_RADII = 3000;

type Selection =
  | { readonly kind: 'planet'; readonly planet: PlanetInfo }
  | { readonly kind: 'moon'; readonly moon: Moon }
  | { readonly kind: 'mission'; readonly mission: Mission }
  | undefined;

/** Deferred texture (and ring) loading, run once the camera comes near the body. */
interface LazyLoad {
  load: (() => void) | undefined;
}

/** A moon is drawn once its orbit spans at least this many pixels (it separates from its planet's marker). */
/** A free-flying probe's near line is rebuilt after it covers this fraction of the ephemeris interval. */
const NEAR_REBUILD_FRACTION = 1 / 2000;
const MOON_MIN_ORBIT_PX = 14;
const MOON_PRIORITY = 55;

interface MoonObject extends LazyLoad {
  readonly moon: Moon;
  readonly planet: PlanetObject;
  readonly index: number;
  readonly mesh: BodyMesh;
  /** Orbit around the planet: vertices relative to the planet (EQJ), positioned at the planet each frame. */
  readonly orbit: Line<BufferGeometry, LineBasicMaterial>;
  orbitBuiltMs: number;
  orbitKey: string;
  /** Planet-relative EQJ state (true scale). */
  state: StateVector | undefined;
  /** Scene position (undefined in log scale: moons are not drawn there). */
  scene: Vec3 | undefined;
  /** Far enough from the planet on screen to be told apart (updated in placeOrigin). */
  shown: boolean;
  /** Orbit size from the last computed state, for moons without mean elements. */
  lastAKm: number | undefined;
}

/** Selection key used by the panel and the URL. */
function selectionKey(sel: Selection): string | undefined {
  if (!sel) return undefined;
  if (sel.kind === 'planet') return `planet:${sel.planet.id}`;
  if (sel.kind === 'moon') return `moon:${sel.moon.id}`;
  return `mission:${sel.mission.id}`;
}

function selectionId(sel: NonNullable<Selection>): string {
  return sel.kind === 'planet' ? sel.planet.id : sel.kind === 'moon' ? sel.moon.id : sel.mission.id;
}

/** Orbit polyline whose vertices are offsets from a body position (see `ellipseOffsetsAround`). */
interface AnchoredOrbit {
  readonly line: Line<BufferGeometry, Material>;
  /** Body position the vertices are relative to (EQJ km, true scale); undefined until built. */
  anchorEqj: Vec3 | undefined;
  builtMs: number;
  periodMs: number;
  key: string;
}

function anchoredOrbit(line: Line<BufferGeometry, Material>): AnchoredOrbit {
  line.frustumCulled = false;
  return { line, anchorEqj: undefined, builtMs: 0, periodMs: 0, key: '' };
}

interface PlanetObject extends LazyLoad {
  readonly info: PlanetInfo;
  readonly index: number;
  readonly mesh: BodyMesh;
  rings: RingMesh | undefined;
  readonly orbit: AnchoredOrbit;
  /** Heliocentric EQJ km (true scale). */
  eqj: Vec3;
  /** Scene-frame position (possibly log-scaled). */
  scene: Vec3;
}

interface ProbeObject extends LazyLoad {
  readonly mission: Mission;
  readonly index: number;
  /** Dwarf planet / small body: drawn like a planet, with its full osculating orbit. */
  readonly natural: boolean;
  readonly mesh: BodyMesh | undefined;
  /**
   * Spacecraft: trajectory over the ephemeris window, except the current interval. Vertices are offsets from
   * `lineAnchor` (Float64 subtraction on the CPU), so the line stays precise near the camera.
   */
  readonly line: Line<BufferGeometry, Material>;
  /** Current interval, densified around the current time and relative to the marker (rebuilt every frame). */
  readonly near: Line<BufferGeometry, Material>;
  /**
   * Stretches spent orbiting a planet (Juno at Jupiter), drawn relative to that planet (vertices = spacecraft −
   * planet), placed at the planet each frame like the moon orbits; heliocentric, they would only retrace the
   * planet's orbit.
   */
  readonly capturedLine: LineSegments<BufferGeometry, Material>;
  /** Planet the captured line is drawn around, and the line's extent (km) for the on-screen size rule. */
  capturedPlanet: PlanetObject | undefined;
  capturedExtentKm: number;
  /** Mapped EQJ position the far line's vertices are relative to. */
  lineAnchor: Vec3 | undefined;
  /** Ephemeris interval left out of the far line (−1: none). */
  lineInterval: number;
  /** Small bodies: osculating orbit. */
  readonly orbit: AnchoredOrbit | undefined;
  /** Ephemeris rows spent captured by a planet: 0, or the planet's index in `planets` + 1 (cached per table). */
  captured: Uint8Array | undefined;
  /** Heliocentric EQJ positions of the capturing planet at the trajectory substeps (cached per table). */
  capturedPlanetKm: Map<number, Vec3> | undefined;
  /**
   * Near line built at this TDB date around this (mapped EQJ) position; undefined while it follows a planet
   * (rebuilt every frame).
   */
  nearBuiltJd: number;
  nearAnchor: Vec3 | undefined;
  /** Host planet's states at the ends of the current ephemeris interval (near line of a captured probe). */
  nearPlanet:
    | {
        readonly key: string;
        readonly t0: number;
        readonly s0: StateVector;
        readonly t1: number;
        readonly s1: StateVector;
      }
    | undefined;
  track: EphemerisTrack;
  entry: EphemerisEntry | undefined;
  sample: TrackSample;
  scene: Vec3 | undefined;
}

function tdbJdToDate(tdbJd: number): Date {
  return new Date((tdbJd - J2000_JD) * MS_PER_DAY + Date.UTC(2000, 0, 1, 12) - 69_184);
}

class SolarView implements View {
  readonly id = 'solar' as const;
  readonly limits = { minDistanceKm: SUN_RADIUS_KM * 1.5, maxDistanceKm: 400 * AU_KM };
  readonly bodyRadiusKm = SUN_RADIUS_KM;
  /** Above the ecliptic, looking at the inner solar system and Jupiter. */
  readonly homeDirectionBody = latLonToUnit(55 * DEG_TO_RAD, -90 * DEG_TO_RAD);
  readonly homeDistanceKm = 7 * AU_KM;
  readonly farKm = 1e11;

  private readonly missions: Mission[];
  private readonly lineGroup = new Group();
  private readonly sun = new SunMesh(SUN_RADIUS_KM);
  private readonly glow: Sprite;
  private readonly planets: PlanetObject[] = [];
  private readonly probes: ProbeObject[] = [];
  private readonly moons: MoonObject[] = [];
  private readonly moonMarkers: MarkerPoints;
  private readonly jupiterCache: Parameters<typeof moonState>[3] = {};
  private readonly planetMarkers: MarkerPoints;
  private readonly probeMarkers: MarkerPoints;
  private readonly labels = new LabelLayer();
  private readonly panel: SolarPanel;
  private readonly detail: DetailPanel;
  private readonly colors = new Map<string, string>();
  private sceneQ: Quat = { x: 0, y: 0, z: 0, w: 1 };
  private tdbJd = 0;
  private originKm: Vec3 = [0, 0, 0];
  private logScale: boolean;
  private selection: Selection;
  private trajectoriesKey = '';
  private disposed = false;
  private readonly ring: SelectionMarker;
  /** Spheres that hide what is behind them this frame (scene km); rebuilt in placeOrigin. */
  private occluders: { readonly id: string; readonly sceneKm: Vec3; readonly radiusKm: number }[] = [];
  /** Frame the selection once its position is known (next update). */
  private pendingFrame = false;
  private readonly loadedData = new Map<string, string>();
  /** Ephemerides loaded (or failed): a framing request without a position can be dropped. */
  private ephemeridesSettled = false;
  /** Spacecraft unticked in the panel: no marker, trajectory, label or picking (URL `hide`). */
  private hiddenMissions: ReadonlySet<string> = new Set();
  /** NASA 3D model of the selected spacecraft, drawn once it covers a few pixels. */
  private readonly sceneModel: SceneModel;

  constructor(private readonly host: ViewHost) {
    this.logScale = host.initialParams.get('log') === '1';
    this.missions = MissionsCatalogSchema.parse(missionsJson).missions.filter((m) => m.centralBody === 'sun');
    const renderer = host.renderer;

    this.glow = createSunGlow(0.05);
    renderer.scene.add(this.sun.mesh, this.glow, this.lineGroup);

    this.planetMarkers = new MarkerPoints(PLANETS.length, 10, { depthTest: false });
    this.probeMarkers = new MarkerPoints(Math.max(1, this.missions.length), 9, {
      depthTest: false,
    });
    renderer.scene.add(this.planetMarkers.points, this.probeMarkers.points);
    const black = placeholderTexture([0, 0, 0]);
    PLANETS.forEach((info, index) => {
      const mesh =
        info.id === 'earth'
          ? createEarthMesh(renderer, host.baseUrl)
          : new BodyMesh({
              name: info.id,
              radiusKm: info.radiusKm,
              dayMap: placeholderTexture(hexToRgb(info.color)),
              nightMap: black,
              ambient: 0.03,
            });
      renderer.scene.add(mesh.mesh);
      const planet: PlanetObject = {
        info,
        index,
        mesh,
        rings: undefined,
        load: undefined,
        orbit: anchoredOrbit(
          new Line(
            new BufferGeometry(),
            new LineBasicMaterial({ color: info.color, transparent: true, opacity: ORBIT_OPACITY }),
          ),
        ),
        eqj: [0, 0, 0],
        scene: [0, 0, 0],
      };
      planet.load = () => {
        this.loadTexture(info.id, info.color, mesh);
        if (info.rings) {
          planet.rings = new RingMesh({
            url: assetUrl(host.baseUrl, `textures/${info.id}/rings.png`),
            innerKm: info.rings.innerKm,
            outerKm: info.rings.outerKm,
            tauScale: RING_TAU_SCALE,
            planetRadiusKm: info.radiusKm,
          });
          mesh.mesh.add(planet.rings.mesh);
        }
      };
      renderer.scene.add(planet.orbit.line);
      this.planetMarkers.setColor(index, info.color);
      this.planets.push(planet);
    });
    const moonCatalog = MoonsCatalogSchema.parse(moonsJson).moons.filter((m) =>
      this.planets.some((p) => p.info.id === m.planet),
    );
    this.moonMarkers = new MarkerPoints(Math.max(1, moonCatalog.length), 7, {
      depthTest: false,
    });
    renderer.scene.add(this.moonMarkers.points);
    moonCatalog.forEach((moon, index) => {
      const planet = this.planets.find((p) => p.info.id === moon.planet);
      if (!planet) return;
      const mesh = new BodyMesh({
        name: moon.id,
        radiusKm: moon.radiusKm,
        dayMap: placeholderTexture(hexToRgb(moon.color)),
        nightMap: black,
        ambient: 0.03,
      });
      mesh.mesh.visible = false;
      renderer.scene.add(mesh.mesh);
      const orbit = new Line(
        new BufferGeometry(),
        new LineBasicMaterial({ color: moon.color, transparent: true, opacity: ORBIT_OPACITY }),
      );
      orbit.frustumCulled = false;
      orbit.visible = false;
      renderer.scene.add(orbit);
      this.moonMarkers.setColor(index, moon.color);
      this.colors.set(moon.id, moon.color);
      this.moons.push({
        moon,
        planet,
        index,
        mesh,
        orbit,
        orbitBuiltMs: 0,
        orbitKey: '',
        state: undefined,
        scene: undefined,
        shown: false,
        lastAKm: undefined,
        load: () => {
          const body = modelFor(`moon:${moon.id}`);
          // A NASA shape model brings its own map; otherwise the equirectangular texture.
          if (!body?.body) this.loadTexture(moon.id, moon.color, mesh);
          if (body?.body) {
            void loadBodyShape(this.host.baseUrl, body.id).then((shape) => {
              if (!shape || this.disposed) return;
              mesh.setGeometry(shape.geometry);
              if (shape.map) mesh.setDayMap(shape.map);
            });
          }
          if (moon.shape === 'grid') {
            void loadShape(this.host.baseUrl, moon.id).then((grid) => {
              if (!grid || this.disposed) return;
              const shaped = bodySphere(mesh.radiusKm);
              applyShape(shaped, grid);
              mesh.setGeometry(shaped);
            });
          }
        },
      });
    });
    const palette = ['#7cc4ff', '#ffb74d', '#81c784', '#ce93d8', '#f48fb1', '#4dd0e1', '#fff176', '#a1887f'];
    this.missions.forEach((mission, index) => {
      const natural = mission.objectType === 'natural';
      const color = mission.color ?? palette[index % palette.length] ?? DEFAULT_PROBE_COLOR;
      this.colors.set(mission.id, color);
      this.probeMarkers.setColor(index, color);
      const line = new LineSegments(
        new BufferGeometry(),
        new LineBasicMaterial({ color, transparent: true, opacity: 0.6 }),
      );
      line.frustumCulled = false;
      line.visible = false;
      // Shares the far line's material (same style).
      const near = new Line(new BufferGeometry(), line.material);
      near.frustumCulled = false;
      near.visible = false;
      this.lineGroup.add(line, near);
      const capturedLine = new LineSegments(new BufferGeometry(), line.material);
      capturedLine.frustumCulled = false;
      capturedLine.visible = false;
      renderer.scene.add(capturedLine);
      const orbit = natural
        ? anchoredOrbit(
            new Line(
              new BufferGeometry(),
              new LineBasicMaterial({ color, transparent: true, opacity: 0.35 }),
            ),
          )
        : undefined;
      if (orbit) renderer.scene.add(orbit.line);
      const mesh =
        natural && mission.radiusKm
          ? new BodyMesh({
              name: mission.id,
              radiusKm: mission.radiusKm,
              dayMap: placeholderTexture(hexToRgb(color)),
              nightMap: black,
              ambient: 0.03,
            })
          : undefined;
      if (mesh) renderer.scene.add(mesh.mesh);
      this.probes.push({
        mission,
        index,
        natural,
        mesh,
        load: mesh ? () => this.loadTexture(mission.id, color, mesh) : undefined,
        line,
        near,
        lineAnchor: undefined,
        lineInterval: -1,
        orbit,
        captured: undefined,
        capturedPlanetKm: undefined,
        nearPlanet: undefined,
        nearBuiltJd: Number.NaN,
        nearAnchor: undefined,
        capturedLine,
        capturedPlanet: undefined,
        capturedExtentKm: 0,
        track: this.makeTrack(undefined),
        entry: undefined,
        sample: { kind: 'none', state: undefined, beyondS: 0 },
        scene: undefined,
      });
    });

    this.sceneModel = new SceneModel(renderer.scene, renderer.renderer, host.baseUrl);
    this.hiddenMissions = parseHiddenMissions(host.initialParams);
    this.panel = new SolarPanel(
      host.i18n,
      PLANETS,
      this.moons.map((m) => m.moon),
      this.missions,
      this.colors,
      (m) => m.ephemeris === 'horizons',
      this.logScale,
      {
        onSelectPlanet: (p) => this.select({ kind: 'planet', planet: p }, { focus: true, frame: true }),
        onSelectMission: (m) => this.select({ kind: 'mission', mission: m }, { focus: true, frame: true }),
        onSelectMoon: (m) => this.select({ kind: 'moon', moon: m }, { focus: true, frame: true }),
        onToggleLogScale: (on) => {
          this.host.follow.stop();
          this.logScale = on;
          this.trajectoriesKey = '';
          this.renderDetail(false);
          this.host.syncUrl();
        },
        onMissionVisibility: (hidden) => {
          this.hiddenMissions = new Set(hidden);
          const sel = this.selection;
          if (sel?.kind === 'mission' && hidden.has(sel.mission.id)) this.select(undefined);
          this.trajectoriesKey = '';
          this.host.syncUrl();
        },
      },
      this.hiddenMissions,
    );
    this.panel.visible = window.matchMedia('(min-width: 900px)').matches;
    this.ring = new SelectionMarker();
    renderer.scene.add(this.ring.points);
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

  /** The "body-fixed" frame of this view is the J2000 ecliptic. */
  /** The Sun, planets, moons and small bodies drawn at true scale (the same set that hides markers). */
  cameraObstacles(): readonly CameraObstacle[] {
    return this.occluders.map((o) => ({ centreKm: o.sceneKm, radiusKm: o.radiusKm }));
  }

  distancesToScale(): boolean {
    return !this.logScale;
  }

  bodyOrientation(): Quat {
    return ECLIPTIC_Q;
  }

  update(f: ViewFrame): void {
    const date = new Date(f.nowMs);
    this.tdbJd = utcToTdbJd(date);
    this.sceneQ = f.sceneFromInertial;
    const map = (p: Vec3): Vec3 => (this.logScale ? logScalePosition(p) : p);

    for (const p of this.planets) {
      p.eqj = heliocentricKm(p.info.body, date);
      p.scene = quatRotate(this.sceneQ, map(p.eqj));
      const orientation =
        p.info.id === 'earth' ? earthOrientation(date) : bodyOrientationEqj(p.info.body, date);
      p.mesh.setOrientation(quatMultiply(this.sceneQ, orientation));
      p.mesh.setSunDirection(normalize(scale(p.scene, -1)));
      p.mesh.mesh.visible = !this.logScale;
    }
    for (const t of this.probes) {
      t.sample = t.track.sample(this.tdbJd);
      const s = t.sample.state;
      t.scene =
        s && !this.hiddenMissions.has(t.mission.id) ? quatRotate(this.sceneQ, map(s.posKm)) : undefined;
      if (t.mesh) {
        t.mesh.mesh.visible = !this.logScale && t.scene !== undefined;
        if (t.scene) t.mesh.setSunDirection(normalize(scale(t.scene, -1)));
        // Only Ceres has a published rotation model among the small bodies shown here.
        if (t.mission.id === 'ceres')
          t.mesh.setOrientation(quatMultiply(this.sceneQ, ceresOrientationEqj(this.tdbJd)));
      }
      this.probeMarkers.setColor(
        t.index,
        this.colors.get(t.mission.id) ?? DEFAULT_PROBE_COLOR,
        t.sample.kind === 'extrapolated' ? 0.45 : 1,
      );
    }

    // Osculating orbits: rebuilt on scale change, clock jump, or once the body has moved a little along them.
    const orbitsKey = `${this.logScale}|${f.clockEpoch}`;
    for (const p of this.planets) {
      if (!needsRebuild(p.orbit, orbitsKey, f.nowMs)) continue;
      const state = heliocentricState(p.info.body, date);
      this.buildOrbit(
        p.orbit,
        state,
        GM_KM3_S2.sun + p.info.gmKm3S2,
        p.info.radiusKm,
        orbitsKey,
        f.nowMs,
        map,
      );
    }
    for (const t of this.probes) {
      if (!t.orbit) continue;
      const state = t.sample.state;
      t.orbit.line.visible = state !== undefined;
      if (!state || !needsRebuild(t.orbit, orbitsKey, f.nowMs)) continue;
      this.buildOrbit(t.orbit, state, GM_KM3_S2.sun, t.mission.radiusKm ?? 100, orbitsKey, f.nowMs, map);
    }
    this.updateMoons(date, f.nowMs, orbitsKey);
    if (this.pendingFrame && this.selection?.kind === 'moon') {
      const m = this.moons.find(
        (x) => this.selection?.kind === 'moon' && x.moon.id === this.selection.moon.id,
      );
      const pos = m?.scene;
      if (m && pos) {
        // Close enough to see the moon's whole orbit around its planet.
        const aKm = m.moon.elements?.aKm ?? (m.state ? length(m.state.posKm) : 0);
        this.host.frameObject(pos, {
          tiltRad: 35 * DEG_TO_RAD,
          targetFraction: 1,
          distanceKm: Math.max(aKm * 2.2, m.moon.radiusKm * 12),
        });
      }
      this.pendingFrame = false;
    }
    if (this.pendingFrame) {
      const pos = this.scenePositionOf(this.selection);
      // Look from above the ecliptic so the object does not sit on top of the Sun.
      // Aim between the Sun and the object so both are in view.
      if (pos)
        this.host.frameObject(pos, {
          tiltRad: 50 * DEG_TO_RAD,
          targetFraction: 0.5,
          distanceKm: length(pos) * 1.9,
        });
      // A spacecraft selected from the URL has no position until its ephemeris loads: keep the request until then.
      if (pos || this.ephemeridesSettled) this.pendingFrame = false;
    }
    const trajectoriesKey = `${this.logScale}|${this.probes.map((t) => (t.entry ? 1 : 0)).join('')}|${this.probes.map((t) => t.sample.kind).join()}`;
    if (trajectoriesKey !== this.trajectoriesKey) {
      this.trajectoriesKey = trajectoriesKey;
      for (const t of this.probes) this.refreshTrajectory(t, map);
    }
    for (const t of this.probes) {
      // The far line leaves out the current interval: rebuild it when time moves to another one.
      if (this.currentInterval(t) !== t.lineInterval) this.refreshTrajectory(t, map);
      this.refreshNearTrajectory(t, map);
    }
  }

  placeOrigin(originKm: Vec3): void {
    this.originKm = originKm;
    const o = originKm;
    const rel = (p: Vec3): Vec3 => sub(p, o);
    const sun = rel([0, 0, 0]);
    this.sun.mesh.position.set(sun[0], sun[1], sun[2]);
    this.glow.position.copy(this.sun.mesh.position);
    const q = this.sceneQ;
    for (const t of this.probes) {
      if (t.lineAnchor) {
        const r = rel(quatRotate(q, t.lineAnchor));
        t.line.position.set(r[0], r[1], r[2]);
        t.line.quaternion.set(q.x, q.y, q.z, q.w);
      }
      if (t.scene) {
        // Placed where it was built (free flight), or at the probe (following a planet).
        const r = rel(t.nearAnchor ? quatRotate(q, t.nearAnchor) : t.scene);
        t.near.position.set(r[0], r[1], r[2]);
        t.near.quaternion.set(q.x, q.y, q.z, q.w);
      }
      this.placeCapturedLine(t, rel);
    }
    const map = (p: Vec3): Vec3 => (this.logScale ? logScalePosition(p) : p);
    for (const orbit of [...this.planets.map((p) => p.orbit), ...this.probes.map((t) => t.orbit)]) {
      if (!orbit?.anchorEqj) continue;
      const r = rel(quatRotate(this.sceneQ, map(orbit.anchorEqj)));
      orbit.line.position.set(r[0], r[1], r[2]);
      orbit.line.quaternion.set(this.sceneQ.x, this.sceneQ.y, this.sceneQ.z, this.sceneQ.w);
    }
    // The Sun always; planet and small-body meshes only at true scale (hidden in log scale).
    this.occluders = [{ id: 'sun', sceneKm: [0, 0, 0], radiusKm: SUN_RADIUS_KM }];
    if (!this.logScale) {
      for (const p of this.planets)
        this.occluders.push({ id: p.info.id, sceneKm: p.scene, radiusKm: p.info.radiusKm });
      for (const t of this.probes) {
        if (t.mesh && t.scene && t.mission.radiusKm)
          this.occluders.push({
            id: t.mission.id,
            sceneKm: t.scene,
            radiusKm: Math.max(t.mission.radiusKm, t.mesh.boundingRadiusKm),
          });
      }
    }
    this.placeMoons(rel);
    for (const p of this.planets) {
      const r = rel(p.scene);
      p.mesh.mesh.position.set(r[0], r[1], r[2]);
      if (this.behindBody(p.scene, p.info.id)) this.planetMarkers.hide(p.index);
      else this.planetMarkers.setPosition(p.index, r[0], r[1], r[2]);
      this.maybeLoad(p, r, p.info.radiusKm);
      p.rings?.setLighting(normalize(scale(p.scene, -1)), r);
    }
    for (const t of this.probes) {
      if (t.scene) {
        const r = rel(t.scene);
        if (this.behindBody(t.scene, t.mission.id)) this.probeMarkers.hide(t.index);
        else this.probeMarkers.setPosition(t.index, r[0], r[1], r[2]);
        t.mesh?.mesh.position.set(r[0], r[1], r[2]);
        this.maybeLoad(t, r, t.mission.radiusKm ?? 0);
      } else {
        this.probeMarkers.hide(t.index);
      }
    }
    const modelShown = this.placeModel(rel);
    const selected = this.scenePositionOf(this.selection);
    this.ring.set(selected && !modelShown ? rel(selected) : undefined);
    this.planetMarkers.commit();
    this.probeMarkers.commit();
    this.moonMarkers.commit();
    this.placeLabels();
  }

  /** The selected spacecraft's 3D model, in place of its marker when close (true scale only). */
  private placeModel(rel: (p: Vec3) => Vec3): boolean {
    const sel = this.selection;
    const probe =
      sel?.kind === 'mission' ? this.probes.find((t) => t.mission.id === sel.mission.id) : undefined;
    const entry = probe && !this.logScale ? modelFor(`mission:${probe.mission.id}`) : undefined;
    const scene = probe?.scene;
    const earth = this.planets.find((p) => p.info.id === 'earth')?.scene;
    const camera = this.host.renderer.camera;
    const focalPx = this.host.renderer.canvas.clientHeight / 2 / Math.tan((camera.fov * DEG_TO_RAD) / 2);
    if (!probe || !entry || !scene || !earth) {
      this.sceneModel.update(undefined, undefined, QUAT_IDENTITY, [1, 0, 0], focalPx);
      return false;
    }
    const sunDir = normalize(scale(scene, -1));
    const toEarth = normalize(sub(earth, scene));
    // High-gain antenna at the Earth; roll from the scene north (seen from afar, the Sun and the Earth are
    // nearly aligned, so the Sun would not fix it).
    const earthAxis = entry.earthAxis ?? '+z';
    const q = alignAxes(
      axisVector(earthAxis),
      toEarth,
      axisVector(earthAxis.endsWith('z') ? '+y' : '+z'),
      [0, 0, 1],
    );
    const shown = this.sceneModel.update(entry, rel(scene), q, sunDir, focalPx);
    if (shown) this.probeMarkers.hide(probe.index);
    return shown;
  }

  /** Captured line at its planet; shown like the moons (wide enough on screen, or selected), not in log scale. */
  private placeCapturedLine(t: ProbeObject, rel: (p: Vec3) => Vec3): void {
    const planet = t.capturedPlanet;
    const line = t.capturedLine;
    if (!planet || this.logScale || !t.line.visible || t.capturedExtentKm === 0) {
      line.visible = false;
      return;
    }
    const camera = this.host.renderer.camera;
    const focalPx = this.host.renderer.canvas.clientHeight / 2 / Math.tan((camera.fov * DEG_TO_RAD) / 2);
    const r = rel(planet.scene);
    const selected = this.selection?.kind === 'mission' && this.selection.mission.id === t.mission.id;
    line.visible = selected || (t.capturedExtentKm / Math.max(1, length(r))) * focalPx >= MOON_MIN_ORBIT_PX;
    const q = this.sceneQ;
    line.position.set(r[0], r[1], r[2]);
    line.quaternion.set(q.x, q.y, q.z, q.w);
  }

  uiTick(): void {
    this.renderDetail(false);
  }

  click(xCss: number, yCss: number, double: boolean): void {
    let best: { sel: Selection; d: number; depth: number } | undefined;
    const consider = (sel: Selection, scene: Vec3 | undefined): void => {
      if (!scene || !sel) return;
      const p = this.project(scene, selectionId(sel));
      if (!p) return;
      const d = Math.hypot(p.x - xCss, p.y - yCss);
      if (d > pickRadiusPx(PICK_RADIUS_PX)) return;
      const depth = length(sub(scene, this.originKm));
      const better = !best || (Math.abs(d - best.d) < 3 ? depth < best.depth : d < best.d);
      if (better) best = { sel, d, depth };
    };
    for (const p of this.planets) consider({ kind: 'planet', planet: p.info }, p.scene);
    for (const t of this.probes) consider({ kind: 'mission', mission: t.mission }, t.scene);
    for (const m of this.moons) if (m.shown) consider({ kind: 'moon', moon: m.moon }, m.scene);
    if (best) this.select(best.sel, { follow: double });
  }

  dataVersions(): ReadonlyMap<string, string> {
    return this.loadedData;
  }

  writeUrl(p: URLSearchParams): void {
    const sel = this.selection;
    if (sel?.kind === 'planet') p.set('sel', sel.planet.id);
    if (sel?.kind === 'mission') p.set('sel', sel.mission.id);
    if (sel?.kind === 'moon') p.set('sel', `moon:${sel.moon.id}`);
    if (this.logScale) p.set('log', '1');
    writeHiddenMissions(p, this.hiddenMissions);
  }

  dispose(): void {
    this.disposed = true;
    const scene = this.host.renderer.scene;
    scene.remove(
      this.sun.mesh,
      this.glow,
      this.lineGroup,
      this.planetMarkers.points,
      this.probeMarkers.points,
    );
    this.sun.dispose();
    this.sceneModel.dispose();
    for (const p of this.planets) {
      scene.remove(p.mesh.mesh);
      p.mesh.dispose();
      p.rings?.dispose();
      scene.remove(p.orbit.line);
      p.orbit.line.geometry.dispose();
      p.orbit.line.material.dispose();
    }
    for (const t of this.probes) {
      t.line.geometry.dispose();
      scene.remove(t.capturedLine);
      t.capturedLine.geometry.dispose();
      t.near.geometry.dispose();
      t.line.material.dispose();
      if (t.orbit) {
        scene.remove(t.orbit.line);
        t.orbit.line.geometry.dispose();
        t.orbit.line.material.dispose();
      }
    }
    this.planetMarkers.dispose();
    this.probeMarkers.dispose();
    scene.remove(this.ring.points);
    for (const t of this.probes) {
      if (t.mesh) {
        scene.remove(t.mesh.mesh);
        t.mesh.dispose();
      }
    }
    scene.remove(this.moonMarkers.points);
    this.moonMarkers.dispose();
    for (const m of this.moons) {
      scene.remove(m.mesh.mesh, m.orbit);
      m.mesh.dispose();
      m.orbit.geometry.dispose();
      m.orbit.material.dispose();
    }
    this.labels.dispose();
    delete (window as { __perigeeTest?: unknown }).__perigeeTest;
  }

  // --- internals -----------------------------------------------------------------------------------------

  /** Starts the deferred load once the body (at camera-relative `relKm`) is near enough to show detail. */
  private maybeLoad(o: LazyLoad, relKm: Vec3, radiusKm: number): void {
    if (!o.load || this.logScale || length(relKm) > radiusKm * TEXTURE_LOAD_RADII) return;
    const load = o.load;
    o.load = undefined;
    load();
  }

  private loadTexture(id: string, color: string, mesh: BodyMesh): void {
    if (!textureLevels(id, 'color')) return;
    const renderer = this.host.renderer;
    loadProgressiveTexture({
      baseUrl: this.host.baseUrl,
      body: id,
      name: 'color',
      maxTextureSize: renderer.maxTextureSize,
      anisotropy: renderer.renderer.capabilities.getMaxAnisotropy(),
      placeholderRgb: hexToRgb(color),
      onUpdate: (tex) => {
        if (!this.disposed) mesh.setDayMap(tex);
      },
    });
  }

  private makeTrack(table: ConstructorParameters<typeof EphemerisTrack>[0]): EphemerisTrack {
    return new EphemerisTrack(table, {
      muKm3S2: GM_KM3_S2.sun,
      maxExtrapolationDays: HIGH_ORBIT_MAX_EXTRAPOLATION_DAYS,
    });
  }

  private async loadEphemerides(): Promise<void> {
    const { host } = this;
    host.showNotice(host.i18n.t('solar.loading'));
    try {
      const manifest = await loadManifest(host.baseUrl);
      let oldest: Date | undefined;
      // Each ephemeris on its own: one missing or corrupt file must not hide the others.
      let failed = 0;
      let loaded = 0;
      await Promise.all(
        this.probes.map(async (t) => {
          const entry = manifest.ephemerides[t.mission.id];
          if (!entry || entry.centralBody !== 'sun') return;
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
          t.track = this.makeTrack(table);
          t.entry = entry;
          const fetched = new Date(entry.fetchedAt);
          if (!oldest || fetched < oldest) oldest = fetched;
        }),
      );
      if (this.disposed) return;
      if (failed > 0 && loaded === 0) throw new Error(`no ephemeris could be loaded (${failed} failed)`);
      this.panel.setFetched(oldest);
      host.showNotice(undefined);
      this.ephemeridesSettled = true;
      this.renderDetail(false);
    } catch (err) {
      console.error(err);
      this.ephemeridesSettled = true;
      host.showNotice(host.i18n.t('solar.unavailable'));
    }
  }

  /** Whole ephemeris window; solid while interpolated, dashed when extrapolated, grey when too old. */
  private refreshTrajectory(t: ProbeObject, map: (p: Vec3) => Vec3): void {
    t.nearBuiltJd = Number.NaN;
    const table = t.track.table;
    const kind = t.sample.kind;
    // Small bodies show their osculating orbit instead (their ephemeris window covers only a small arc).
    t.line.visible = table !== undefined && !t.natural && !this.hiddenMissions.has(t.mission.id);
    if (!table || t.natural) return;
    t.captured ??= this.capturedRows(table);
    // Segment pairs (LineSegments), densified with the same Hermite interpolation as the marker; captured
    // stretches are skipped, and the current interval is drawn by the near line. Offsets from an anchor near
    // the spacecraft: absolute heliocentric Float32 vertices would be off by kilometres and jitter as the
    // camera moves.
    const interval = this.currentInterval(t);
    t.lineInterval = interval;
    const anchor = map(t.sample.state?.posKm ?? table.state(table.rows - 1).posKm);
    t.lineAnchor = anchor;
    const segments: number[] = [];
    const push = (p: Vec3): void => {
      const m = map(p);
      segments.push(m[0] - anchor[0], m[1] - anchor[1], m[2] - anchor[2]);
    };
    for (let i = 0; i + 1 < table.rows; i++) {
      if (i === interval) continue;
      if (t.captured[i] && t.captured[i + 1]) continue;
      const t0 = table.time(i);
      const t1 = table.time(i + 1);
      let prev = table.state(i).posKm;
      for (let k = 1; k <= TRAJECTORY_SUBSTEPS; k++) {
        const next =
          k === TRAJECTORY_SUBSTEPS
            ? table.state(i + 1).posKm
            : (table.interpolate(t0 + ((t1 - t0) * k) / TRAJECTORY_SUBSTEPS)?.posKm ?? prev);
        push(prev);
        push(next);
        prev = next;
      }
    }
    setLinePositions(t.line, segments);
    this.buildCapturedLine(t, table, interval);
    const color = this.colors.get(t.mission.id) ?? DEFAULT_PROBE_COLOR;
    const dashed = kind === 'extrapolated';
    if (dashed !== t.line.material instanceof LineDashedMaterial) {
      t.line.material.dispose();
      t.line.material = dashed
        ? new LineDashedMaterial({ color, dashSize: 0.05 * AU_KM, gapSize: 0.04 * AU_KM, transparent: true })
        : new LineBasicMaterial({ color, transparent: true });
      t.near.material = t.line.material;
      t.capturedLine.material = t.line.material;
    }
    if (dashed) {
      t.line.computeLineDistances();
      t.capturedLine.computeLineDistances();
    }
    this.styleTrajectory(t);
  }

  /** Captured stretches around one planet (that of the current interval, else the first one), planet-relative. */
  private buildCapturedLine(
    t: ProbeObject,
    table: NonNullable<EphemerisTrack['table']>,
    interval: number,
  ): void {
    const captured = t.captured;
    const code = captured
      ? interval >= 0 && captured[interval] && captured[interval] === captured[interval + 1]
        ? captured[interval]
        : captured.find((c) => c > 0)
      : undefined;
    const planet = code ? this.planets[code - 1] : undefined;
    t.capturedPlanet = planet;
    if (!captured || !code || !planet) {
      setLinePositions(t.capturedLine, []);
      return;
    }
    t.capturedPlanetKm ??= new Map();
    const cache = t.capturedPlanetKm;
    const planetAt = (key: number, time: number): Vec3 => {
      let p = cache.get(key);
      if (!p) {
        p = heliocentricKm(planet.info.body, tdbJdToDate(time));
        cache.set(key, p);
      }
      return p;
    };
    const segments: number[] = [];
    let extent = 0;
    const push = (p: Vec3, planetKm: Vec3): void => {
      const x = p[0] - planetKm[0];
      const y = p[1] - planetKm[1];
      const z = p[2] - planetKm[2];
      extent = Math.max(extent, Math.hypot(x, y, z));
      segments.push(x, y, z);
    };
    for (let i = 0; i + 1 < table.rows; i++) {
      if (i === interval || captured[i] !== code || captured[i + 1] !== code) continue;
      const t0 = table.time(i);
      const t1 = table.time(i + 1);
      let prevTime = t0;
      let prev = table.state(i).posKm;
      for (let k = 1; k <= TRAJECTORY_SUBSTEPS; k++) {
        const time = t0 + ((t1 - t0) * k) / TRAJECTORY_SUBSTEPS;
        const next =
          k === TRAJECTORY_SUBSTEPS ? table.state(i + 1).posKm : (table.interpolate(time)?.posKm ?? prev);
        push(prev, planetAt(i * TRAJECTORY_SUBSTEPS + k - 1, prevTime));
        push(next, planetAt(i * TRAJECTORY_SUBSTEPS + k, time));
        prev = next;
        prevTime = time;
      }
    }
    t.capturedExtentKm = extent;
    setLinePositions(t.capturedLine, segments);
  }

  /** Interval of the ephemeris containing the current time, or −1 outside the window. */
  private currentInterval(t: ProbeObject): number {
    const table = t.track.table;
    if (!table || t.natural || t.sample.kind !== 'interpolated' || table.rows < 2) return -1;
    return table.intervalIndex(this.tdbJd);
  }

  /**
   * The current interval, densified towards the current time (a vertex), relative to the spacecraft: the line
   * passes exactly through the marker at any zoom.
   */
  private refreshNearTrajectory(t: ProbeObject, map: (p: Vec3) => Vec3): void {
    const table = t.track.table;
    const i = t.lineInterval;
    const now = t.sample.state;
    const code = t.captured?.[i];
    const planet =
      code && t.captured?.[i + 1] === code && !this.logScale ? this.planets[code - 1] : undefined;
    t.near.visible = t.line.visible && table !== undefined && i >= 0 && now !== undefined;
    if (!t.near.visible || !table || !now) return;
    // A free-flying probe moves along its own curve: the line (relative to where it was built) is rebuilt after
    // NEAR_REBUILD_FRACTION of the interval (43 s for a one-day step; every frame at high rates), the probe then
    // being at most metres from it. Following a planet, it is rebuilt every frame.
    const span = table.time(i + 1) - table.time(i);
    if (!planet && Math.abs(this.tdbJd - t.nearBuiltJd) < span * NEAR_REBUILD_FRACTION) return;
    const centre = map(now.posKm);
    t.nearBuiltJd = this.tdbJd;
    t.nearAnchor = planet ? undefined : centre;
    // Captured: follow the planet's motion, so the near line continues the planet-relative captured line. The
    // planet is interpolated over the interval from its states at both ends (Hermite, ~0.03 km over a day)
    // instead of evaluating the planetary theory at every sample, every frame.
    let planetAt: ((tJd: number) => Vec3) | undefined;
    if (planet) {
      const key = `${planet.info.id}:${table.time(i)}:${table.time(i + 1)}`;
      if (t.nearPlanet?.key !== key) {
        const t0 = table.time(i);
        const t1 = table.time(i + 1);
        t.nearPlanet = {
          key,
          t0,
          s0: heliocentricState(planet.info.body, tdbJdToDate(t0)),
          t1,
          s1: heliocentricState(planet.info.body, tdbJdToDate(t1)),
        };
      }
      const np = t.nearPlanet;
      planetAt = (tJd) => hermite(np.t0, np.s0, np.t1, np.s1, tJd).posKm;
    }
    const planetNow = planetAt?.(this.tdbJd);
    const points: number[] = [];
    for (const time of nearSampleTimes(table.time(i), table.time(i + 1), this.tdbJd, NEAR_SAMPLES_PER_SIDE)) {
      const p = time === this.tdbJd ? now.posKm : (table.interpolate(time)?.posKm ?? now.posKm);
      if (planet && planetNow) {
        const pl = time === this.tdbJd || !planetAt ? planetNow : planetAt(time);
        points.push(
          p[0] - pl[0] - (now.posKm[0] - planetNow[0]),
          p[1] - pl[1] - (now.posKm[1] - planetNow[1]),
          p[2] - pl[2] - (now.posKm[2] - planetNow[2]),
        );
        continue;
      }
      const m = map(p);
      points.push(m[0] - centre[0], m[1] - centre[1], m[2] - centre[2]);
    }
    setLinePositions(t.near, points);
  }

  /** Probe trajectory style: grey when the position is hidden, opaque when selected. */
  private styleTrajectory(t: ProbeObject): void {
    const color = this.colors.get(t.mission.id) ?? DEFAULT_PROBE_COLOR;
    const kind = t.sample.kind;
    const selected = this.selection?.kind === 'mission' && this.selection.mission.id === t.mission.id;
    const m = t.line.material as LineBasicMaterial | LineDashedMaterial;
    m.color.set(kind === 'hidden' ? '#8a8f98' : color);
    m.opacity = kind === 'hidden' ? (selected ? 0.6 : 0.35) : selected ? 1 : 0.6;
  }

  /** The selected object's orbit or trajectory stands out (as in the Moon and Mars views). */
  private styleOrbits(): void {
    const sel = this.selection;
    const set = (material: Material, selected: boolean): void => {
      (material as LineBasicMaterial).opacity = selected ? 0.9 : ORBIT_OPACITY;
    };
    for (const p of this.planets)
      set(p.orbit.line.material, sel?.kind === 'planet' && sel.planet.id === p.info.id);
    for (const t of this.probes) {
      const selected = sel?.kind === 'mission' && sel.mission.id === t.mission.id;
      if (t.orbit) set(t.orbit.line.material, selected);
      else this.styleTrajectory(t);
    }
    for (const m of this.moons) set(m.orbit.material, sel?.kind === 'moon' && sel.moon.id === m.moon.id);
  }

  /**
   * Marks ephemeris rows where the spacecraft is captured by a planet: within CAPTURE_HILL_FRACTION of its Hill
   * radius for at least CAPTURE_MIN_DAYS in a row. Cheap radial pre-filter before computing planet positions.
   */
  private capturedRows(table: NonNullable<EphemerisTrack['table']>): Uint8Array {
    const rows = table.rows;
    const inside = new Uint8Array(rows);
    for (const [index, planet] of PLANETS.entries()) {
      if (planet.dwarf) continue;
      const aKm = Math.cbrt(GM_KM3_S2.sun * ((planet.periodDays * SECONDS_PER_DAY) / (2 * Math.PI)) ** 2);
      for (let i = 0; i < rows; i++) {
        const pos = table.state(i).posKm;
        const r = length(pos);
        const reach = CAPTURE_HILL_FRACTION * hillRadiusKm(planet, r);
        // Planet eccentricities are ≤ 0.21 (Mercury).
        if (r < aKm * 0.78 - reach || r > aKm * 1.22 + reach) continue;
        const planetKm = heliocentricKm(planet.body, tdbJdToDate(table.time(i)));
        if (length(sub(pos, planetKm)) < reach) inside[i] = index + 1;
      }
    }
    // Keep only long stays (orbiting, station-keeping), not flybys.
    for (let i = 0; i < rows;) {
      if (!inside[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < rows && inside[j + 1] === inside[i]) j++;
      if (table.time(j) - table.time(i) < CAPTURE_MIN_DAYS) inside.fill(0, i, j + 1);
      i = j + 1;
    }
    return inside;
  }

  /** Rebuilds an osculating orbit around `state` (vertices relative to the body; see placeOrigin). */
  private buildOrbit(
    orbit: AnchoredOrbit,
    state: { posKm: Vec3; velKmS: Vec3 },
    muKm3S2: number,
    radiusKm: number,
    key: string,
    nowMs: number,
    map: (p: Vec3) => Vec3,
  ): void {
    const r = length(state.posKm);
    // First step ≈ 2 % of the body radius, so the line stays on the body even at the closest zoom.
    const minStepRad = Math.min(1e-5, Math.max(1e-10, (0.02 * radiusKm) / r));
    const offsets = ellipseOffsetsAround(state, muKm3S2, minStepRad);
    const periodS = osculatingElements(state, muKm3S2).periodS;
    if (!offsets || !periodS) {
      orbit.line.visible = false;
      return;
    }
    const anchor = map(state.posKm);
    const out = new Float32Array(offsets.length);
    for (let i = 0; i + 2 < offsets.length; i += 3) {
      const p = map([
        state.posKm[0] + (offsets[i] ?? 0),
        state.posKm[1] + (offsets[i + 1] ?? 0),
        state.posKm[2] + (offsets[i + 2] ?? 0),
      ]);
      out[i] = p[0] - anchor[0];
      out[i + 1] = p[1] - anchor[1];
      out[i + 2] = p[2] - anchor[2];
    }
    setLinePositions(orbit.line, out);
    orbit.anchorEqj = state.posKm;
    orbit.builtMs = nowMs;
    orbit.periodMs = periodS * 1000;
    orbit.key = key;
  }

  /** True when the Sun, a planet or a small body (other than `selfId`) hides `sceneKm` from the camera. */
  private behindBody(sceneKm: Vec3, selfId: string): boolean {
    return this.occluders.some(
      (o) => o.id !== selfId && occludedBySphereAt(this.originKm, sceneKm, o.sceneKm, o.radiusKm),
    );
  }

  private project(sceneKm: Vec3, selfId?: string): { x: number; y: number } | undefined {
    if (selfId !== undefined && this.behindBody(sceneKm, selfId)) return undefined;
    const canvas = this.host.renderer.canvas;
    const r = sub(sceneKm, this.originKm);
    return this.labels.project(
      r,
      sceneKm,
      this.host.renderer.camera,
      this.originKm,
      0,
      canvas.clientWidth,
      canvas.clientHeight,
    );
  }

  private refreshLabels(): void {
    const lang = this.host.i18n.lang;
    this.labels.setItems([
      ...this.planets.map((p) => ({
        id: `p:${p.info.id}`,
        text: p.info.name[lang],
        className: 'label-planet',
      })),
      ...this.probes.map((t) => ({
        id: `m:${t.mission.id}`,
        text: t.mission.name[lang],
        className: t.natural ? 'label-planet' : 'label-mission',
      })),
      ...this.moons.map((m) => ({
        id: `s:${m.moon.id}`,
        text: m.moon.name[lang],
        className: 'label-planet',
      })),
    ]);
  }

  private placeLabels(): void {
    const camera = this.host.renderer.camera;
    const canvas = this.host.renderer.canvas;
    const w = canvas.clientWidth;
    const hgt = canvas.clientHeight;
    const o = this.originKm;
    const sel = this.selection;
    this.labels.begin();
    for (const p of this.planets) {
      const selected = sel?.kind === 'planet' && sel.planet.id === p.info.id;
      const hiddenP = this.behindBody(p.scene, p.info.id);
      this.labels.place(
        `p:${p.info.id}`,
        hiddenP ? undefined : sub(p.scene, o),
        hiddenP ? undefined : p.scene,
        camera,
        o,
        0,
        w,
        hgt,
        selected ? LabelPriority.Selected : PLANET_PRIORITY,
      );
      const pr = this.project(p.scene);
      if (pr) this.labels.obstacle(pr.x, pr.y, 8, PLANET_PRIORITY);
    }
    for (const t of this.probes) {
      if (!t.scene) continue;
      const selected = sel?.kind === 'mission' && sel.mission.id === t.mission.id;
      const hiddenM = this.behindBody(t.scene, t.mission.id);
      this.labels.place(
        `m:${t.mission.id}`,
        hiddenM ? undefined : sub(t.scene, o),
        hiddenM ? undefined : t.scene,
        camera,
        o,
        0,
        w,
        hgt,
        selected ? LabelPriority.Selected : t.natural ? PLANET_PRIORITY : LabelPriority.Orbiting,
      );
    }
    for (const m of this.moons) {
      const selected = sel?.kind === 'moon' && sel.moon.id === m.moon.id;
      const scene = m.shown && m.scene && !this.behindBody(m.scene, m.moon.id) ? m.scene : undefined;
      this.labels.place(
        `s:${m.moon.id}`,
        scene ? sub(scene, o) : undefined,
        scene,
        camera,
        o,
        0,
        w,
        hgt,
        selected ? LabelPriority.Selected : MOON_PRIORITY,
      );
    }
    this.labels.layout(w, hgt);
  }

  private restoreFromUrl(p: URLSearchParams): void {
    const sel = p.get('sel');
    if (!sel) return;
    const planet = PLANETS.find((x) => x.id === sel);
    if (planet) {
      this.select({ kind: 'planet', planet }, { frame: true });
      return;
    }
    const mission = this.missions.find((m) => m.id === sel);
    if (mission) {
      this.select({ kind: 'mission', mission }, { frame: true });
      return;
    }
    const moon = this.moons.find((m) => `moon:${m.moon.id}` === sel)?.moon;
    if (moon) this.select({ kind: 'moon', moon }, { frame: true });
  }

  private select(sel: Selection, options: { follow?: boolean; focus?: boolean; frame?: boolean } = {}): void {
    const cur = this.selection;
    const same = selectionKey(sel) === selectionKey(cur);
    if (!same) this.host.follow.stop();
    this.selection = sel;
    this.panel.setSelected(selectionKey(sel));
    this.styleOrbits();
    this.pendingFrame = sel !== undefined && (options.frame ?? false) && !options.follow;
    if (!sel) this.detail.hide();
    else this.renderDetail(options.focus ?? false);
    if (sel && options.follow) this.startFollowing();
    this.host.syncUrl();
  }

  private scenePositionOf(sel: Selection): Vec3 | undefined {
    if (sel?.kind === 'planet') return this.planets.find((p) => p.info.id === sel.planet.id)?.scene;
    if (sel?.kind === 'mission') return this.probes.find((t) => t.mission.id === sel.mission.id)?.scene;
    if (sel?.kind === 'moon') {
      // A moon too small to show is not computed every frame: solve it now when it is asked for (selection,
      // follow, framing), not only at the next frame.
      const m = this.moons.find((x) => x.moon.id === sel.moon.id);
      if (m && !m.scene) this.solveMoon(m);
      return m?.scene;
    }
    return undefined;
  }

  toggleFollow(): void {
    if (this.host.follow.active) this.host.follow.stop();
    else if (this.selection) this.startFollowing();
  }

  private startFollowing(): void {
    const sel = this.selection;
    if (!sel || !this.scenePositionOf(sel)) return;
    // Following supersedes a framing requested by the same selection but not applied yet.
    this.pendingFrame = false;
    // Planets, moons and natural objects (dwarf planets) are framed by their size; spacecraft by their model.
    const radiusKm =
      sel.kind === 'planet'
        ? sel.planet.radiusKm
        : sel.kind === 'moon'
          ? sel.moon.radiusKm
          : sel.mission.objectType === 'natural'
            ? sel.mission.radiusKm
            : undefined;
    const body = radiusKm !== undefined && !this.logScale ? bodyFollow(radiusKm) : undefined;
    const modelKm =
      sel.kind === 'mission' && !this.logScale
        ? modelFollowDistanceKm(`mission:${sel.mission.id}`)
        : undefined;
    const distanceKm = this.logScale ? 0.08 * AU_KM : (body?.distanceKm ?? modelKm ?? 3e6);
    // Seen from the day side, 45° from the Sun direction towards the scene north (the Sun is at the origin).
    const pos = this.scenePositionOf(sel) ?? [1, 0, 0];
    const sunward = normalize(scale(pos, -1));
    const viewFrom = add(scale(sunward, Math.SQRT1_2), [0, 0, Math.SQRT1_2]);
    this.detail.following = this.host.follow.start(
      () => this.scenePositionOf(this.selection === sel ? sel : undefined),
      distanceKm,
      () => (this.detail.following = false),
      {
        viewFrom,
        ...(body
          ? { minDistanceKm: body.minDistanceKm, surfaceRadiusKm: body.surfaceRadiusKm }
          : modelMinDistance(sel.kind === 'mission' ? `mission:${sel.mission.id}` : '')),
      },
    );
  }

  private earthEqj(): Vec3 {
    return this.planets.find((p) => p.info.id === 'earth')?.eqj ?? [AU_KM, 0, 0];
  }

  private distanceRows(posEqj: Vec3): [string, string][] {
    const { i18n } = this.host;
    const t = (k: MessageKey): string => i18n.t(k);
    const au = (km: number): string => `${i18n.number(km / AU_KM, km < 3 * AU_KM ? 3 : 2)} AU`;
    const toEarth = length(sub(posEqj, this.earthEqj()));
    const lightS = toEarth / LIGHT_SPEED_KM_S;
    const light =
      lightS < 60
        ? `${i18n.number(lightS, 1)} s`
        : lightS < 3600
          ? `${i18n.number(lightS / 60, 1)} min`
          : `${i18n.number(lightS / 3600, 2)} h`;
    return [
      [t('info.distSun'), au(length(posEqj))],
      [t('info.distEarth'), `${au(toEarth)} · ${t('info.lightTime')} ${light}`],
    ];
  }

  private renderDetail(focus: boolean): void {
    const sel = this.selection;
    if (!sel) return;
    const content =
      sel.kind === 'planet'
        ? this.planetDetail(sel.planet)
        : sel.kind === 'moon'
          ? this.moonDetail(sel.moon)
          : this.missionDetail(sel.mission);
    this.detail.show(content, focus);
  }

  private scaleBadge(): { text: string; state: BadgeState } | undefined {
    return this.logScale ? { text: this.host.i18n.t('solar.logWarning'), state: 'stale' } : undefined;
  }

  private planetDetail(info: PlanetInfo): DetailContent {
    const { i18n } = this.host;
    const t = (k: MessageKey): string => i18n.t(k);
    const p = this.planets.find((x) => x.info.id === info.id);
    const rows: [string, string][] = p ? this.distanceRows(p.eqj) : [];
    // The Earth's distance to itself is meaningless.
    if (info.id === 'earth') rows.splice(1, 1);
    rows.push([t('info.radius'), `${i18n.number(info.radiusKm)} km`]);
    const years = info.periodDays / 365.25;
    rows.push([
      t('info.orbitalPeriod'),
      years < 1
        ? `${i18n.number(info.periodDays, 1)} ${t('unit.days')}`
        : `${i18n.number(years, 2)} ${t('unit.years')}`,
    ]);
    const texture = TEXTURE_NOTES[info.id];
    if (texture) rows.push([t('info.texture'), t(texture)]);
    // How the position is obtained, as for the moons: astronomy-engine's VSOP87 series for the planets, a
    // numerical integration under the giant planets' attraction for Pluto.
    const badge = this.scaleBadge() ?? {
      text: t(info.id === 'pluto' ? 'planet.model.pluto' : 'planet.model.vsop87'),
      state: 'fresh' as BadgeState,
    };
    return {
      title: info.name[i18n.lang],
      badge,
      rows,
      sources: [
        'https://nssdc.gsfc.nasa.gov/planetary/factsheet/',
        'https://github.com/cosinekitty/astronomy',
      ],
      followable: true,
    };
  }

  /** Moon states, meshes (lit, tidally locked) and planet-relative orbits; nothing is drawn in log scale. */
  /** Date of the last moon update, to solve a skipped moon on demand (see `solveMoon`). */
  private moonDate: Date | undefined;

  /** Planet-relative state and scene position of one moon at the last update's date. */
  private solveMoon(m: MoonObject): void {
    const date = this.moonDate;
    m.state = date && !this.logScale ? moonState(m.moon, date, this.tdbJd, this.jupiterCache) : undefined;
    if (m.state) m.lastAKm = length(m.state.posKm);
    m.scene = m.state ? add(m.planet.scene, quatRotate(this.sceneQ, m.state.posKm)) : undefined;
  }

  private updateMoons(date: Date, nowMs: number, orbitsKey: string): void {
    this.moonDate = date;
    const focalPx = this.focalPx();
    const sel = this.selection;
    for (const m of this.moons) {
      // Moons too close to their planet on screen to be shown (placeMoons) are not computed at all; the margin
      // covers the camera moving between this frame and the last one.
      const selected = sel?.kind === 'moon' && sel.moon.id === m.moon.id;
      const aKm = m.moon.elements?.aKm ?? m.lastAKm;
      if (!selected && aKm !== undefined && this.originKm && !this.logScale) {
        const toPlanet = Math.max(1, length(sub(m.planet.scene, this.originKm)));
        if ((aKm / toPlanet) * focalPx < MOON_MIN_ORBIT_PX * 0.5) {
          m.state = undefined;
          m.scene = undefined;
          continue;
        }
      }
      this.solveMoon(m);
      const s = m.state;
      if (!s || !m.scene) continue;
      m.mesh.setSunDirection(normalize(scale(m.scene, -1)));
      m.mesh.setOrientation(quatMultiply(this.sceneQ, this.moonOrientation(m, s, date)));
      const periodMs =
        (m.moon.elements?.periodDays ?? osculatingElements(s, this.moonMu(m, s)).periodS ?? 0) * 1000;
      const period = m.moon.elements ? periodMs * SECONDS_PER_DAY : periodMs;
      if (m.orbitKey !== orbitsKey || Math.abs(nowMs - m.orbitBuiltMs) > ORBIT_REBUILD_FRACTION * period) {
        const offsets = ellipseOffsetsAround(
          s,
          this.moonMu(m, s),
          Math.max(1e-6, (0.02 * m.moon.radiusKm) / length(s.posKm)),
        );
        if (offsets) {
          const pts = new Float32Array(offsets.length);
          for (let i = 0; i + 2 < offsets.length; i += 3) {
            pts[i] = s.posKm[0] + (offsets[i] ?? 0);
            pts[i + 1] = s.posKm[1] + (offsets[i + 1] ?? 0);
            pts[i + 2] = s.posKm[2] + (offsets[i + 2] ?? 0);
          }
          setLinePositions(m.orbit, pts);
        }
        m.orbitBuiltMs = nowMs;
        m.orbitKey = orbitsKey;
      }
    }
  }

  /** Gravitational parameter for a moon's two-body orbit: from its mean motion, else its planet's GM. */
  private moonMu(m: MoonObject, s: StateVector): number {
    const el = m.moon.elements;
    if (el) {
      const n = (el.nDegPerDay * DEG_TO_RAD) / SECONDS_PER_DAY;
      return n * n * el.aKm ** 3;
    }
    return m.planet.info.id === 'earth'
      ? GM_KM3_S2.earth + GM_KM3_S2.moon
      : m.planet.info.gmKm3S2 || length(s.velKmS) ** 2 * length(s.posKm);
  }

  /**
   * EQJ ← moon body frame. The Moon uses its IAU model; the others are assumed tidally locked (true for all the
   * regular moons shown): longitude 0 faces the planet, north along the orbit normal. Hyperion tumbles and the
   * outer irregular moons do not face their planet; their orientation is only indicative.
   */
  private moonOrientation(m: MoonObject, s: StateVector, date: Date): Quat {
    if (m.moon.id === 'moon') return bodyOrientationEqj(Astronomy.Body.Moon, date);
    const x = normalize(scale(s.posKm, -1));
    const z = normalize(cross(s.posKm, s.velKmS));
    const y = cross(z, x);
    return quatFromBasis(x, y, z);
  }

  /** Shows a moon once its orbit is wide enough on screen, and hides what bodies cover. */
  /** Focal length in CSS pixels (screen size of an object = size / distance × focal). */
  private focalPx(): number {
    const camera = this.host.renderer.camera;
    return this.host.renderer.canvas.clientHeight / 2 / Math.tan((camera.fov * DEG_TO_RAD) / 2);
  }

  private placeMoons(rel: (p: Vec3) => Vec3): void {
    const focalPx = this.focalPx();
    const sel = this.selection;
    for (const m of this.moons) {
      const selected = sel?.kind === 'moon' && sel.moon.id === m.moon.id;
      let shown = false;
      if (m.scene && m.state) {
        const aKm = m.moon.elements?.aKm ?? length(m.state.posKm);
        const toPlanet = Math.max(1, length(rel(m.planet.scene)));
        shown = selected || (aKm / toPlanet) * focalPx >= MOON_MIN_ORBIT_PX;
      }
      m.shown = shown;
      m.mesh.mesh.visible = shown;
      m.orbit.visible = shown;
      if (!shown || !m.scene) {
        this.moonMarkers.hide(m.index);
        continue;
      }
      const r = rel(m.scene);
      m.mesh.mesh.position.set(r[0], r[1], r[2]);
      const p = rel(m.planet.scene);
      m.orbit.position.set(p[0], p[1], p[2]);
      m.orbit.quaternion.set(this.sceneQ.x, this.sceneQ.y, this.sceneQ.z, this.sceneQ.w);
      // Irregular moons reach beyond their mean radius.
      this.occluders.push({
        id: m.moon.id,
        sceneKm: m.scene,
        radiusKm: Math.max(m.moon.radiusKm, m.mesh.boundingRadiusKm),
      });
      this.maybeLoad(m, r, m.moon.radiusKm);
    }
    for (const m of this.moons) {
      if (!m.shown || !m.scene) continue;
      if (this.behindBody(m.scene, m.moon.id)) this.moonMarkers.hide(m.index);
      else {
        const r = rel(m.scene);
        this.moonMarkers.setPosition(m.index, r[0], r[1], r[2]);
      }
    }
  }

  private moonDetail(moon: Moon): DetailContent {
    const { i18n } = this.host;
    const t = (k: MessageKey): string => i18n.t(k);
    const num = (v: number, d = 0): string => i18n.number(v, d);
    const m = this.moons.find((x) => x.moon.id === moon.id);
    const s = m?.state;
    const planetName = m?.planet.info.name[i18n.lang] ?? moon.planet;
    const rows: [string, string][] = [[t('info.parent'), planetName]];
    rows.push([t('info.radius'), `${num(moon.radiusKm)} km`]);
    if (s) {
      rows.push([t('info.distPlanet'), `${num(length(s.posKm))} km`]);
      rows.push([t('info.speedPlanet'), `${num(length(s.velKmS), 2)} km/s`]);
    }
    const el = moon.elements;
    const osc = s && m ? osculatingElements(s, this.moonMu(m, s)) : undefined;
    const aKm = el?.aKm ?? osc?.semiMajorAxisKm;
    if (aKm) rows.push([t('info.semiMajorAxis'), `${num(aKm)} km`]);
    const periodDays = el?.periodDays ?? (osc?.periodS ? osc.periodS / SECONDS_PER_DAY : undefined);
    if (periodDays) {
      rows.push([
        t('info.orbitalPeriod'),
        periodDays < 2 ? `${num(periodDays * 24, 1)} h` : `${num(periodDays, 2)} ${t('unit.days')}`,
      ]);
    }
    const e = el?.e ?? osc?.eccentricity;
    if (e !== undefined) rows.push([t('info.eccentricity'), num(e, 4)]);
    if (el) {
      rows.push([
        t('info.inclination'),
        `${num(el.iDeg, 2)}° (${t(el.referencePlane === 'ecliptic' ? 'moon.plane.ecliptic' : el.referencePlane === 'laplace' ? 'moon.plane.laplace' : 'moon.plane.equator')})`,
      ]);
    }
    if (m?.scene && s && m.planet) rows.push(...this.distanceRows(add(m.planet.eqj, s.posKm)));
    const texture = TEXTURE_NOTES[moon.id];
    if (texture) rows.push([t('info.texture'), t(texture)]);
    if (moon.shape === 'grid') rows.push([t('info.shape'), t('shape.pds')]);
    const badge: { text: string; state: BadgeState } = this.logScale
      ? { text: t('solar.logWarning'), state: 'stale' }
      : moon.model === 'mean-elements'
        ? { text: t('moon.model.meanElements'), state: 'stale' }
        : { text: t('moon.model.theory'), state: 'fresh' };
    return {
      title: moon.name[i18n.lang],
      badge,
      rows,
      ...(moon.notes ? { notes: moon.notes[i18n.lang] } : {}),
      sources: moon.sources,
      footnote: i18n.format('info.verified', { date: moon.verified }),
      followable: m?.scene !== undefined,
    };
  }

  private missionDetail(m: Mission): DetailContent {
    const { i18n } = this.host;
    const t = (k: MessageKey): string => i18n.t(k);
    const num = (v: number, d = 0): string => i18n.number(v, d);
    const probe = this.probes.find((x) => x.mission.id === m.id);
    const rows: [string, string][] = [];
    if (m.agency) rows.push([t('info.agency'), m.agency]);
    if (m.country) rows.push([t('info.country'), countryName(i18n, m.country)]);
    if (m.launchDate) rows.push([t('info.launch'), m.launchDate]);
    if (m.objectType === 'natural') {
      if (m.radiusKm) rows.push([t('info.radius'), `${num(m.radiusKm)} km`]);
      if (m.orbit) rows.push([t('info.orbit'), m.orbit[i18n.lang]]);
      const texture = TEXTURE_NOTES[m.id];
      if (texture) rows.push([t('info.texture'), t(texture)]);
    } else {
      rows.push([t('info.status'), i18n.maybe(`mission.status.${m.status}`) ?? m.status]);
    }
    if (m.phase) rows.push([t('info.phase'), m.phase[i18n.lang]]);
    if (m.nextEvent) {
      rows.push([
        t('info.next'),
        `${m.nextEvent[i18n.lang]}${m.nextEvent.date ? ` (${m.nextEvent.date})` : ''}`,
      ]);
    }
    // Small bodies use Horizons' "<number>;" syntax; show the number only.
    if (m.horizonsId) rows.push([t('info.horizons'), m.horizonsId.replace(/;$/, '')]);

    const sample = probe?.sample;
    let badge: { text: string; state: BadgeState };
    if (m.status === 'planned') badge = { text: t('ephem.planned'), state: 'invalid' };
    else if (!probe || !sample || sample.kind === 'none') badge = { text: t('ephem.none'), state: 'invalid' };
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
      rows.push(...this.distanceRows(s.posKm));
      rows.push([t('info.speedSun'), `${num(length(s.velKmS), 2)} km/s`]);
    }
    if (probe?.entry) {
      rows.push([
        t('info.window'),
        `${i18n.dateTime(tdbJdToDate(probe.entry.startTdbJd))} → ${i18n.dateTime(tdbJdToDate(probe.entry.endTdbJd))}`,
      ]);
    }
    const notes = [m.notes?.[i18n.lang], this.logScale ? t('solar.logWarning') : undefined]
      .filter(Boolean)
      .join(' ');
    return {
      title: m.name[i18n.lang],
      badge,
      rows,
      ...(notes ? { notes } : {}),
      sources: m.sources,
      footnote: i18n.format('info.verified', { date: m.verified }),
      followable: s !== undefined,
      ...withModel(`mission:${m.id}`),
    };
  }

  /** `?e2e` hook: frames an object so tests can click it at the canvas centre. */
  private installTestHook(): void {
    const { controls } = this.host;
    Object.assign(window, {
      __perigeeTest: {
        lookAt: (id: string, distanceKm = 0.5 * AU_KM, fromDir: Vec3 = [0, 0, 1]): boolean => {
          const pos: Vec3 | undefined =
            id === 'sun'
              ? [0, 0, 0]
              : (this.planets.find((p) => p.info.id === id)?.scene ??
                this.probes.find((x) => x.mission.id === id)?.scene);
          if (!pos) return false;
          controls.setState(orbitStateLookingFrom(pos, normalize(fromDir), [0, 1, 0], distanceKm));
          return true;
        },
        /**
         * Camera `distanceKm` in front of body `front`, on the far side from `back`, shifted sideways by
         * `offsetRadii` radii of `front` so that `back` projects that far from the disc centre.
         */
        lookThrough: (front: string, back: string, distanceKm: number, offsetRadii: number): boolean => {
          const f = this.planets.find((p) => p.info.id === front);
          const b = this.planets.find((p) => p.info.id === back);
          if (!f || !b) return false;
          const u = normalize(sub(f.scene, b.scene));
          const w = normalize(cross(u, [0, 0, 1]));
          const target = add(f.scene, scale(w, offsetRadii * f.info.radiusKm));
          controls.setState(orbitStateLookingFrom(target, u, [0, 0, 1], distanceKm));
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

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function needsRebuild(orbit: AnchoredOrbit, key: string, nowMs: number): boolean {
  return (
    orbit.key !== key ||
    orbit.anchorEqj === undefined ||
    Math.abs(nowMs - orbit.builtMs) > ORBIT_REBUILD_FRACTION * orbit.periodMs
  );
}

export const createSolarView: ViewFactory = (host) => new SolarView(host);
