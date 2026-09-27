/**
 * View D — solar system: the Sun, planets (astronomy-engine) and interplanetary spacecraft (JPL Horizons,
 * heliocentric), with an optional logarithmic distance scale (CLAUDE.md §1, §5.2, §5.4).
 *
 * Frames: the body-fixed frame of this view is the J2000 ecliptic (planets in the plane); the inertial frame is
 * EQJ. Precision: markers and meshes are written relative to the camera on the CPU (Float64); only orbit and
 * trajectory lines carry absolute heliocentric Float32 vertices, which is fine at the scales they are seen.
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
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  type Material,
} from 'three';
import missionsJson from '../../catalog/missions.json';
import type { View, ViewFactory, ViewFrame, ViewHost } from '../app/View';
import { bodyOrientationEqj, earthOrientation } from '../astro/bodies';
import { AU_KM, DEG_TO_RAD, J2000_JD, MS_PER_DAY, SECONDS_PER_DAY } from '../astro/constants';
import { latLonToUnit } from '../astro/frames';
import { GM_KM3_S2 } from '../astro/kepler';
import {
  OBLIQUITY_J2000_RAD,
  PLANETS,
  SUN_RADIUS_KM,
  heliocentricKm,
  logScalePosition,
  orbitPolyline,
  type PlanetInfo,
} from '../astro/planets';
import { quatFromAxisAngle, quatMultiply, quatRotate, type Quat } from '../astro/quat';
import { utcToTdbJd } from '../astro/time';
import { EphemerisTrack, HIGH_ORBIT_MAX_EXTRAPOLATION_DAYS, type TrackSample } from '../astro/track';
import { length, normalize, scale, sub, type Vec3 } from '../astro/vec3';
import { orbitStateLookingFrom } from '../camera/orbitMath';
import { loadEphemeris, loadManifest } from '../data/loader';
import { MissionsCatalogSchema, type EphemerisEntry, type Mission } from '../data/schemas';
import type { MessageKey } from '../i18n';
import { BodyMesh } from '../render/BodyMesh';
import { createEarthMesh } from '../render/earthMesh';
import { LabelLayer, LabelPriority } from '../render/Labels';
import { MarkerPoints } from '../render/MarkerPoints';
import { placeholderTexture } from '../render/textures';
import { countryName } from '../ui/countries';
import { DetailPanel, type BadgeState, type DetailContent } from '../ui/DetailPanel';
import { formatUtcDate } from '../ui/labels';
import { SolarPanel } from '../ui/SolarPanel';

const ECLIPTIC_Q: Quat = quatFromAxisAngle([1, 0, 0], OBLIQUITY_J2000_RAD);
const PICK_RADIUS_PX = 14;
const PLANET_PRIORITY = 70;
const ORBIT_POINTS = 360;
const DEFAULT_PROBE_COLOR = '#e0e0e0';
const LIGHT_SPEED_KM_S = 299_792.458;

type Selection =
  | { readonly kind: 'planet'; readonly planet: PlanetInfo }
  | { readonly kind: 'mission'; readonly mission: Mission }
  | undefined;

interface PlanetObject {
  readonly info: PlanetInfo;
  readonly index: number;
  readonly mesh: BodyMesh;
  readonly orbit: Line<BufferGeometry, LineBasicMaterial>;
  /** Heliocentric EQJ km (true scale). */
  eqj: Vec3;
  /** Scene-frame position (possibly log-scaled). */
  scene: Vec3;
}

interface ProbeObject {
  readonly mission: Mission;
  readonly index: number;
  readonly line: Line<BufferGeometry, Material>;
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
  private readonly sun: Mesh<SphereGeometry, MeshBasicMaterial>;
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
  private orbitsKey = '';
  private trajectoriesKey = '';
  private disposed = false;

  constructor(private readonly host: ViewHost) {
    this.logScale = host.initialParams.get('log') === '1';
    this.missions = MissionsCatalogSchema.parse(missionsJson).missions.filter((m) => m.centralBody === 'sun');
    const renderer = host.renderer;
    const pixelRatio = renderer.renderer.getPixelRatio();

    this.sun = new Mesh(
      new SphereGeometry(SUN_RADIUS_KM, 64, 32),
      new MeshBasicMaterial({ color: 0xffd27a }),
    );
    this.glow = new Sprite(
      new SpriteMaterial({
        map: glowTexture(),
        blending: AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: false,
      }),
    );
    this.glow.scale.set(0.05, 0.05, 1);
    renderer.scene.add(this.sun, this.glow, this.lineGroup);

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
      const orbit = new Line(
        new BufferGeometry(),
        new LineBasicMaterial({ color: info.color, transparent: true, opacity: 0.35 }),
      );
      orbit.frustumCulled = false;
      this.lineGroup.add(orbit);
      this.planetMarkers.setColor(index, info.color);
      this.planets.push({ info, index, mesh, orbit, eqj: [0, 0, 0], scene: [0, 0, 0] });
    });
    const palette = ['#7cc4ff', '#ffb74d', '#81c784', '#ce93d8', '#f48fb1', '#4dd0e1', '#fff176', '#a1887f'];
    this.missions.forEach((mission, index) => {
      const color = mission.color ?? palette[index % palette.length] ?? DEFAULT_PROBE_COLOR;
      this.colors.set(mission.id, color);
      this.probeMarkers.setColor(index, color);
      const line = new Line(
        new BufferGeometry(),
        new LineBasicMaterial({ color, transparent: true, opacity: 0.6 }),
      );
      line.frustumCulled = false;
      this.lineGroup.add(line);
      this.probes.push({
        mission,
        index,
        line,
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
        onSelectPlanet: (p) => this.select({ kind: 'planet', planet: p }, { focus: true }),
        onSelectMission: (m) => this.select({ kind: 'mission', mission: m }, { focus: true }),
        onToggleLogScale: (on) => {
          this.host.follow.stop();
          this.logScale = on;
          this.orbitsKey = '';
          this.trajectoriesKey = '';
          this.renderDetail(false);
          this.host.syncUrl();
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
      this.probeMarkers.setColor(
        t.index,
        this.colors.get(t.mission.id) ?? DEFAULT_PROBE_COLOR,
        t.sample.kind === 'extrapolated' ? 0.45 : 1,
      );
    }

    // Planet orbits drift slowly: rebuild on scale change, clock jump, or every ~10 simulated days.
    const orbitsKey = `${this.logScale}|${f.clockEpoch}|${Math.floor(f.nowMs / (10 * MS_PER_DAY))}`;
    if (orbitsKey !== this.orbitsKey) {
      this.orbitsKey = orbitsKey;
      for (const p of this.planets) {
        const pts = orbitPolyline(p.info, date, ORBIT_POINTS);
        p.orbit.geometry.setAttribute('position', new Float32BufferAttribute(mapPacked(pts, map), 3));
      }
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
    this.sun.position.set(sun[0], sun[1], sun[2]);
    this.glow.position.copy(this.sun.position);
    this.lineGroup.position.set(-o[0], -o[1], -o[2]);
    for (const p of this.planets) {
      const r = rel(p.scene);
      p.mesh.mesh.position.set(r[0], r[1], r[2]);
      this.planetMarkers.setPosition(p.index, r[0], r[1], r[2]);
    }
    for (const t of this.probes) {
      if (t.scene) {
        const r = rel(t.scene);
        this.probeMarkers.setPosition(t.index, r[0], r[1], r[2]);
      } else {
        this.probeMarkers.hide(t.index);
      }
    }
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
      if (!scene) return;
      const p = this.project(scene);
      if (!p) return;
      const d = Math.hypot(p.x - xCss, p.y - yCss);
      if (d > PICK_RADIUS_PX) return;
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
    scene.remove(this.sun, this.glow, this.lineGroup, this.planetMarkers.points, this.probeMarkers.points);
    this.sun.geometry.dispose();
    this.sun.material.dispose();
    for (const p of this.planets) {
      scene.remove(p.mesh.mesh);
      p.mesh.dispose();
      p.orbit.geometry.dispose();
      p.orbit.material.dispose();
    }
    for (const t of this.probes) {
      t.line.geometry.dispose();
      t.line.material.dispose();
    }
    this.planetMarkers.dispose();
    this.probeMarkers.dispose();
    this.labels.dispose();
    delete (window as { __perigeeTest?: unknown }).__perigeeTest;
  }

  // --- internals -----------------------------------------------------------------------------------------

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
    t.line.visible = table !== undefined;
    if (!table) return;
    const pts = new Float64Array(table.rows * 3);
    for (let i = 0; i < table.rows; i++) pts.set(table.state(i).posKm, i * 3);
    t.line.geometry.setAttribute('position', new Float32BufferAttribute(mapPacked(pts, map), 3));
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

  private project(sceneKm: Vec3): { x: number; y: number } | undefined {
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
        className: 'label-mission',
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
      this.labels.place(
        `p:${p.info.id}`,
        sub(p.scene, o),
        p.scene,
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
      this.labels.place(
        `m:${t.mission.id}`,
        sub(t.scene, o),
        t.scene,
        camera,
        o,
        0,
        w,
        hgt,
        selected ? LabelPriority.Selected : LabelPriority.Orbiting,
      );
    }
    this.labels.layout(w, hgt);
  }

  private restoreFromUrl(p: URLSearchParams): void {
    const sel = p.get('sel');
    if (!sel) return;
    const planet = PLANETS.find((x) => x.id === sel);
    if (planet) {
      this.select({ kind: 'planet', planet });
      return;
    }
    const mission = this.missions.find((m) => m.id === sel);
    if (mission) this.select({ kind: 'mission', mission });
  }

  private select(sel: Selection, options: { follow?: boolean; focus?: boolean } = {}): void {
    const cur = this.selection;
    const same =
      (sel?.kind === 'planet' && cur?.kind === 'planet' && sel.planet.id === cur.planet.id) ||
      (sel?.kind === 'mission' && cur?.kind === 'mission' && sel.mission.id === cur.mission.id);
    if (!same) this.host.follow.stop();
    this.selection = sel;
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
    rows.push([t('info.status'), i18n.maybe(`mission.status.${m.status}`) ?? m.status]);
    if (m.phase) rows.push([t('info.phase'), m.phase[i18n.lang]]);
    if (m.nextEvent) {
      rows.push([
        t('info.next'),
        `${m.nextEvent[i18n.lang]}${m.nextEvent.date ? ` (${m.nextEvent.date})` : ''}`,
      ]);
    }
    if (m.horizonsId) rows.push([t('info.horizons'), m.horizonsId]);

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
        lookAt: (id: string): boolean => {
          const pos =
            this.planets.find((p) => p.info.id === id)?.scene ??
            this.probes.find((x) => x.mission.id === id)?.scene;
          if (!pos) return false;
          controls.setState(orbitStateLookingFrom(pos, [0, 0, 1], [0, 1, 0], 0.5 * AU_KM));
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

function mapPacked(pts: Float64Array, map: (p: Vec3) => Vec3): Float32Array {
  const out = new Float32Array(pts.length);
  for (let i = 0; i + 2 < pts.length; i += 3) {
    const m = map([pts[i] ?? 0, pts[i + 1] ?? 0, pts[i + 2] ?? 0]);
    out[i] = m[0];
    out[i + 1] = m[1];
    out[i + 2] = m[2];
  }
  return out;
}

export const createSolarView: ViewFactory = (host) => new SolarView(host);
