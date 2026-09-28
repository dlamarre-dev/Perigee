/**
 * View D — solar system: the Sun, planets (astronomy-engine) and interplanetary spacecraft (JPL Horizons,
 * heliocentric), with an optional logarithmic distance scale (CLAUDE.md §1, §5.2, §5.4).
 *
 * Frames: the body-fixed frame of this view is the J2000 ecliptic (planets in the plane); the inertial frame is
 * EQJ. Precision: markers and meshes are written relative to the camera on the CPU (Float64). Orbits of planets
 * and small bodies are osculating ellipses whose vertices are relative to the body (dense near it, exact through
 * it); spacecraft trajectories carry absolute heliocentric Float32 vertices, fine at the scales they are seen.
 */
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Sprite,
  SpriteMaterial,
  type Material,
} from 'three';
import missionsJson from '../../catalog/missions.json';
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
import { quatFromAxisAngle, quatMultiply, quatRotate, type Quat } from '../astro/quat';
import { utcToTdbJd } from '../astro/time';
import { EphemerisTrack, HIGH_ORBIT_MAX_EXTRAPOLATION_DAYS, type TrackSample } from '../astro/track';
import { add, cross, length, normalize, scale, sub, type Vec3 } from '../astro/vec3';
import { orbitStateLookingFrom } from '../camera/orbitMath';
import { loadEphemeris, loadManifest } from '../data/loader';
import { MissionsCatalogSchema, type EphemerisEntry, type Mission } from '../data/schemas';
import type { MessageKey } from '../i18n';
import { BodyMesh } from '../render/BodyMesh';
import { createEarthMesh } from '../render/earthMesh';
import { LabelLayer, LabelPriority, occludedBySphereAt } from '../render/Labels';
import { pickRadiusPx } from '../render/pointer';
import { MarkerPoints } from '../render/MarkerPoints';
import { SelectionMarker } from '../render/OrbitLine';
import { SunMesh } from '../render/SunMesh';
import { RingMesh } from '../render/RingMesh';
import { textureLevels } from '../render/textureLevels';
import { loadProgressiveTexture, placeholderTexture } from '../render/textures';
import { countryName } from '../ui/countries';
import { DetailPanel, type BadgeState, type DetailContent } from '../ui/DetailPanel';
import { formatUtcDate } from '../ui/labels';
import { SolarPanel } from '../ui/SolarPanel';

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
};
/** Hermite sub-samples per ephemeris interval for trajectory lines (1 d steps → 3 h vertices). */
const TRAJECTORY_SUBSTEPS = 8;
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
  | { readonly kind: 'mission'; readonly mission: Mission }
  | undefined;

/** Deferred texture (and ring) loading, run once the camera comes near the body. */
interface LazyLoad {
  load: (() => void) | undefined;
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
  /** Spacecraft: trajectory over the ephemeris window. */
  readonly line: Line<BufferGeometry, Material>;
  /** Small bodies: osculating orbit. */
  readonly orbit: AnchoredOrbit | undefined;
  /** Ephemeris rows spent captured by a planet (cached per table). */
  captured: Uint8Array | undefined;
  track: EphemerisTrack;
  entry: EphemerisEntry | undefined;
  sample: TrackSample;
  scene: Vec3 | undefined;
}

function tdbJdToDate(tdbJd: number): Date {
  return new Date((tdbJd - J2000_JD) * MS_PER_DAY + Date.UTC(2000, 0, 1, 12) - 69_184);
}

function glowTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,240,200,1)');
    g.addColorStop(0.25, 'rgba(255,210,120,0.6)');
    g.addColorStop(1, 'rgba(255,170,60,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new CanvasTexture(canvas);
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

  constructor(private readonly host: ViewHost) {
    this.logScale = host.initialParams.get('log') === '1';
    this.missions = MissionsCatalogSchema.parse(missionsJson).missions.filter((m) => m.centralBody === 'sun');
    const renderer = host.renderer;
    const pixelRatio = renderer.renderer.getPixelRatio();

    this.glow = new Sprite(
      new SpriteMaterial({
        map: glowTexture(),
        blending: AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: false,
      }),
    );
    this.glow.scale.set(0.05, 0.05, 1);
    renderer.scene.add(this.sun.mesh, this.glow, this.lineGroup);

    this.planetMarkers = new MarkerPoints(PLANETS.length, 10 * pixelRatio, { depthTest: false });
    this.probeMarkers = new MarkerPoints(Math.max(1, this.missions.length), 9 * pixelRatio, {
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
            new LineBasicMaterial({ color: info.color, transparent: true, opacity: 0.35 }),
          ),
        ),
        eqj: [0, 0, 0],
        scene: [0, 0, 0],
      };
      planet.load = () => {
        this.loadTexture(info.id, info.color, mesh);
        if (info.rings) {
          planet.rings = new RingMesh({
            url: `${host.baseUrl}textures/${info.id}/rings.png`,
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
      this.lineGroup.add(line);
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
        orbit,
        captured: undefined,
        track: this.makeTrack(undefined),
        entry: undefined,
        sample: { kind: 'none', state: undefined, beyondS: 0 },
        scene: undefined,
      });
    });

    this.panel = new SolarPanel(
      host.i18n,
      PLANETS,
      this.missions,
      this.colors,
      (m) => m.ephemeris === 'horizons',
      this.logScale,
      {
        onSelectPlanet: (p) => this.select({ kind: 'planet', planet: p }, { focus: true, frame: true }),
        onSelectMission: (m) => this.select({ kind: 'mission', mission: m }, { focus: true, frame: true }),
        onToggleLogScale: (on) => {
          this.host.follow.stop();
          this.logScale = on;
          this.trajectoriesKey = '';
          this.renderDetail(false);
          this.host.syncUrl();
        },
      },
    );
    this.panel.visible = window.matchMedia('(min-width: 900px)').matches;
    this.ring = new SelectionMarker(pixelRatio);
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
  bodyOrientation(): Quat {
    return ECLIPTIC_Q;
  }

  update(f: ViewFrame): void {
    const date = new Date(f.nowMs);
    this.tdbJd = utcToTdbJd(date);
    this.sceneQ = f.sceneFromInertial;
    this.lineGroup.quaternion.set(this.sceneQ.x, this.sceneQ.y, this.sceneQ.z, this.sceneQ.w);
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
      t.scene = s ? quatRotate(this.sceneQ, map(s.posKm)) : undefined;
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
      this.pendingFrame = false;
    }
    const trajectoriesKey = `${this.logScale}|${this.probes.map((t) => (t.entry ? 1 : 0)).join('')}|${this.probes.map((t) => t.sample.kind).join()}`;
    if (trajectoriesKey !== this.trajectoriesKey) {
      this.trajectoriesKey = trajectoriesKey;
      for (const t of this.probes) this.refreshTrajectory(t, map);
    }
  }

  placeOrigin(originKm: Vec3): void {
    this.originKm = originKm;
    const o = originKm;
    const rel = (p: Vec3): Vec3 => sub(p, o);
    const sun = rel([0, 0, 0]);
    this.sun.mesh.position.set(sun[0], sun[1], sun[2]);
    this.glow.position.copy(this.sun.mesh.position);
    this.lineGroup.position.set(-o[0], -o[1], -o[2]);
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
          this.occluders.push({ id: t.mission.id, sceneKm: t.scene, radiusKm: t.mission.radiusKm });
      }
    }
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
    const selected = this.scenePositionOf(this.selection);
    this.ring.set(selected ? rel(selected) : undefined);
    this.planetMarkers.commit();
    this.probeMarkers.commit();
    this.placeLabels();
  }

  uiTick(): void {
    this.renderDetail(false);
  }

  click(xCss: number, yCss: number, double: boolean): void {
    let best: { sel: Selection; d: number; depth: number } | undefined;
    const consider = (sel: Selection, scene: Vec3 | undefined): void => {
      if (!scene || !sel) return;
      const p = this.project(scene, sel.kind === 'planet' ? sel.planet.id : sel.mission.id);
      if (!p) return;
      const d = Math.hypot(p.x - xCss, p.y - yCss);
      if (d > pickRadiusPx(PICK_RADIUS_PX)) return;
      const depth = length(sub(scene, this.originKm));
      const better = !best || (Math.abs(d - best.d) < 3 ? depth < best.depth : d < best.d);
      if (better) best = { sel, d, depth };
    };
    for (const p of this.planets) consider({ kind: 'planet', planet: p.info }, p.scene);
    for (const t of this.probes) consider({ kind: 'mission', mission: t.mission }, t.scene);
    if (best) this.select(best.sel, { follow: double });
  }

  writeUrl(p: URLSearchParams): void {
    const sel = this.selection;
    if (sel?.kind === 'planet') p.set('sel', sel.planet.id);
    if (sel?.kind === 'mission') p.set('sel', sel.mission.id);
    if (this.logScale) p.set('log', '1');
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
      await Promise.all(
        this.probes.map(async (t) => {
          const entry = manifest.ephemerides[t.mission.id];
          if (!entry || entry.centralBody !== 'sun') return;
          const table = await loadEphemeris(host.baseUrl, entry);
          if (this.disposed) return;
          t.track = this.makeTrack(table);
          t.entry = entry;
          const fetched = new Date(entry.fetchedAt);
          if (!oldest || fetched < oldest) oldest = fetched;
        }),
      );
      if (this.disposed) return;
      this.panel.setFetched(oldest);
      host.showNotice(undefined);
      this.renderDetail(false);
    } catch (err) {
      console.error(err);
      host.showNotice(host.i18n.t('solar.unavailable'));
    }
  }

  /** Whole ephemeris window; solid while interpolated, dashed when extrapolated, grey when too old. */
  private refreshTrajectory(t: ProbeObject, map: (p: Vec3) => Vec3): void {
    const table = t.track.table;
    const kind = t.sample.kind;
    // Small bodies show their osculating orbit instead (their ephemeris window covers only a small arc).
    t.line.visible = table !== undefined && !t.natural;
    if (!table || t.natural) return;
    t.captured ??= this.capturedRows(table);
    // Segment pairs (LineSegments), densified with the same Hermite interpolation as the marker, so the line
    // is smooth and passes through the spacecraft; captured stretches are skipped.
    const segments: number[] = [];
    for (let i = 0; i + 1 < table.rows; i++) {
      if (t.captured[i] && t.captured[i + 1]) continue;
      const t0 = table.time(i);
      const t1 = table.time(i + 1);
      let prev = table.state(i).posKm;
      for (let k = 1; k <= TRAJECTORY_SUBSTEPS; k++) {
        const next =
          k === TRAJECTORY_SUBSTEPS
            ? table.state(i + 1).posKm
            : (table.interpolate(t0 + ((t1 - t0) * k) / TRAJECTORY_SUBSTEPS)?.posKm ?? prev);
        segments.push(...map(prev), ...map(next));
        prev = next;
      }
    }
    t.line.geometry.setAttribute('position', new Float32BufferAttribute(segments, 3));
    const color = this.colors.get(t.mission.id) ?? DEFAULT_PROBE_COLOR;
    const dashed = kind === 'extrapolated';
    if (dashed !== t.line.material instanceof LineDashedMaterial) {
      t.line.material.dispose();
      t.line.material = dashed
        ? new LineDashedMaterial({ color, dashSize: 0.05 * AU_KM, gapSize: 0.04 * AU_KM, transparent: true })
        : new LineBasicMaterial({ color, transparent: true });
    }
    if (dashed) t.line.computeLineDistances();
    const m = t.line.material as LineBasicMaterial | LineDashedMaterial;
    m.color.set(kind === 'hidden' ? '#8a8f98' : color);
    m.opacity = kind === 'hidden' ? 0.35 : 0.6;
  }

  /**
   * Marks ephemeris rows where the spacecraft is captured by a planet: within CAPTURE_HILL_FRACTION of its Hill
   * radius for at least CAPTURE_MIN_DAYS in a row. Cheap radial pre-filter before computing planet positions.
   */
  private capturedRows(table: NonNullable<EphemerisTrack['table']>): Uint8Array {
    const rows = table.rows;
    const inside = new Uint8Array(rows);
    for (const planet of PLANETS) {
      if (planet.dwarf) continue;
      const aKm = Math.cbrt(GM_KM3_S2.sun * ((planet.periodDays * SECONDS_PER_DAY) / (2 * Math.PI)) ** 2);
      for (let i = 0; i < rows; i++) {
        const pos = table.state(i).posKm;
        const r = length(pos);
        const reach = CAPTURE_HILL_FRACTION * hillRadiusKm(planet, r);
        // Planet eccentricities are ≤ 0.21 (Mercury).
        if (r < aKm * 0.78 - reach || r > aKm * 1.22 + reach) continue;
        const planetKm = heliocentricKm(planet.body, tdbJdToDate(table.time(i)));
        if (length(sub(pos, planetKm)) < reach) inside[i] = 1;
      }
    }
    // Keep only long stays (orbiting, station-keeping), not flybys.
    for (let i = 0; i < rows;) {
      if (!inside[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < rows && inside[j + 1]) j++;
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
    orbit.line.geometry.setAttribute('position', new Float32BufferAttribute(out, 3));
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
    if (mission) this.select({ kind: 'mission', mission }, { frame: true });
  }

  private select(sel: Selection, options: { follow?: boolean; focus?: boolean; frame?: boolean } = {}): void {
    const cur = this.selection;
    const same =
      (sel?.kind === 'planet' && cur?.kind === 'planet' && sel.planet.id === cur.planet.id) ||
      (sel?.kind === 'mission' && cur?.kind === 'mission' && sel.mission.id === cur.mission.id);
    if (!same) this.host.follow.stop();
    this.selection = sel;
    this.panel.setSelected(
      sel?.kind === 'planet' ? `planet:${sel.planet.id}` : sel ? `mission:${sel.mission.id}` : undefined,
    );
    this.pendingFrame = sel !== undefined && (options.frame ?? false) && !options.follow;
    if (!sel) this.detail.hide();
    else this.renderDetail(options.focus ?? false);
    if (sel && options.follow) this.startFollowing();
    this.host.syncUrl();
  }

  private scenePositionOf(sel: Selection): Vec3 | undefined {
    if (sel?.kind === 'planet') return this.planets.find((p) => p.info.id === sel.planet.id)?.scene;
    if (sel?.kind === 'mission') return this.probes.find((t) => t.mission.id === sel.mission.id)?.scene;
    return undefined;
  }

  private startFollowing(): void {
    const sel = this.selection;
    if (!sel || !this.scenePositionOf(sel)) return;
    const distanceKm = this.logScale
      ? 0.08 * AU_KM
      : sel.kind === 'planet'
        ? Math.max(sel.planet.radiusKm * 12, 60_000)
        : 3e6;
    this.detail.following = this.host.follow.start(
      () => this.scenePositionOf(this.selection === sel ? sel : undefined),
      distanceKm,
      () => (this.detail.following = false),
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
    const content = sel.kind === 'planet' ? this.planetDetail(sel.planet) : this.missionDetail(sel.mission);
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
    const badge = this.scaleBadge();
    return {
      title: info.name[i18n.lang],
      ...(badge ? { badge } : {}),
      rows,
      sources: [
        'https://nssdc.gsfc.nasa.gov/planetary/factsheet/',
        'https://github.com/cosinekitty/astronomy',
      ],
      followable: true,
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
        `${formatUtcDate(tdbJdToDate(probe.entry.startTdbJd))} → ${formatUtcDate(tdbJdToDate(probe.entry.endTdbJd))}`,
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
