/**
 * View B — Moon: active lunar orbiters from JPL Horizons ephemerides (Hermite-interpolated, Kepler-extrapolated
 * outside the window), landing and impact sites, and the Earth at its true position (CLAUDE.md §5.2).
 */
import {
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  type Material,
} from 'three';
import missionsJson from '../../catalog/missions.json';
import sitesJson from '../../catalog/landing-sites/moon.json';
import type { View, ViewFactory, ViewFrame, ViewHost } from '../app/View';
import { Astronomy } from '../astro/astronomy';
import {
  MOON_RADIUS_KM,
  bodyOrientationEqj,
  earthOrientation,
  moonToEarthKm,
  moonToSunKm,
} from '../astro/bodies';
import { DEG_TO_RAD, J2000_JD, MS_PER_DAY, RAD_TO_DEG, SECONDS_PER_DAY } from '../astro/constants';
import { latLonToUnit } from '../astro/frames';
import { GM_KM3_S2, osculatingElements } from '../astro/kepler';
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
import { loadEphemeris, loadManifest } from '../data/loader';
import {
  LandingSitesSchema,
  MissionsCatalogSchema,
  type EphemerisEntry,
  type LandingSite,
  type Mission,
} from '../data/schemas';
import type { MessageKey } from '../i18n';
import { BodyMesh } from '../render/BodyMesh';
import { createEarthMesh } from '../render/earthMesh';
import { LabelLayer, occludedBySphere } from '../render/Labels';
import { MarkerPoints } from '../render/MarkerPoints';
import { SelectionMarker } from '../render/OrbitLine';
import { loadProgressiveTexture, placeholderTexture } from '../render/textures';
import { BodyPanel } from '../ui/BodyPanel';
import { DetailPanel, type BadgeState, type DetailContent } from '../ui/DetailPanel';
import { formatUtcDate } from '../ui/labels';
import { countryName } from '../ui/countries';
import { Vector3 } from 'three';

const R = MOON_RADIUS_KM;
const MU = GM_KM3_S2.moon;
const TRAJECTORY_POINTS = 360;
const TRAJECTORY_REFRESH_MS = 250;
const PICK_RADIUS_PX = 14;
const SITE_LABEL_DISTANCE_KM = 4500;
const SITE_COLORS: Record<LandingSite['type'], string> = {
  crewed: '#ffd54f',
  soft: '#aed581',
  'rover-last-known': '#4fc3f7',
  hard: '#ff8a65',
  impact: '#b0bec5',
};
const DEFAULT_MISSION_COLOR = '#e0e0e0';

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
  sample: TrackSample;
  /** Scene-frame position (km), when shown. */
  scene: Vec3 | undefined;
}

function tdbJdToDate(tdbJd: number): Date {
  // TDB − UTC ≈ 69.2 s in 2026; well below the display precision of a date.
  return new Date((tdbJd - J2000_JD) * MS_PER_DAY + Date.UTC(2000, 0, 1, 12) - 69_184);
}

function formatLatLon(latDeg: number, lonDeg: number): string {
  const lat = `${Math.abs(latDeg).toFixed(3)}° ${latDeg >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(lonDeg).toFixed(3)}° ${lonDeg >= 0 ? 'E' : 'W'}`;
  return `${lat}, ${lon}`;
}

class MoonView implements View {
  readonly id = 'moon' as const;
  readonly limits = { minDistanceKm: R * 1.02, maxDistanceKm: 600_000 };
  readonly bodyRadiusKm = R;
  /** Near side, slightly north, so the Earth-facing hemisphere and Apollo sites are in view. */
  readonly homeDirectionBody = latLonToUnit(15 * DEG_TO_RAD, 0);
  readonly homeDistanceKm = R * 4.2;
  /** The Earth is up to ~406 000 km away. */
  readonly farKm = 600_000;

  private readonly missions: Mission[];
  private readonly sites: LandingSite[];
  private readonly sitesVerified: string;
  private readonly moon: BodyMesh;
  private readonly earth: BodyMesh;
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
  private readonly v = new Vector3();

  constructor(private readonly host: ViewHost) {
    this.missions = MissionsCatalogSchema.parse(missionsJson).missions.filter(
      (m) => m.centralBody === 'moon',
    );
    const sites = LandingSitesSchema.parse(sitesJson);
    this.sites = sites.sites;
    this.sitesVerified = sites.verified;
    this.siteBodyKm = this.sites.map((s) =>
      scale(latLonToUnit(s.latDeg * DEG_TO_RAD, s.lonDeg * DEG_TO_RAD), R + 0.5),
    );

    const renderer = host.renderer;
    const anisotropy = renderer.renderer.capabilities.getMaxAnisotropy();
    const black = placeholderTexture([0, 0, 0]);
    this.moon = new BodyMesh({
      name: 'moon',
      radiusKm: R,
      dayMap: loadProgressiveTexture({
        baseUrl: host.baseUrl,
        body: 'moon',
        name: 'color',
        maxTextureSize: renderer.maxTextureSize,
        anisotropy,
        placeholderRgb: [110, 110, 110],
        onUpdate: (tex) => this.moon.setDayMap(tex),
      }),
      nightMap: black,
      ambient: 0.015,
    });
    this.earth = createEarthMesh(renderer, host.baseUrl);
    renderer.scene.add(this.moon.mesh, this.earth.mesh, this.missionGroup);

    const pixelRatio = renderer.renderer.getPixelRatio();
    const drawable = this.missions.filter((m) => m.ephemeris === 'horizons');
    // No GPU depth test: a screen-sized sprite has a single depth and would be half-buried in the curved
    // surface when seen from afar. Occlusion by the Moon is computed on the CPU instead (placeOrigin).
    this.missionMarkers = new MarkerPoints(Math.max(1, drawable.length), 11 * pixelRatio, {
      depthTest: false,
    });
    this.missionGroup.add(this.missionMarkers.points);
    drawable.forEach((mission, index) => {
      const color = mission.color ?? DEFAULT_MISSION_COLOR;
      this.colors.set(mission.id, color);
      const line = new Line(
        new BufferGeometry(),
        new LineBasicMaterial({ color, transparent: true, opacity: 0.55 }),
      );
      line.frustumCulled = false;
      this.missionGroup.add(line);
      this.tracked.push({
        mission,
        index,
        track: this.makeTrack(mission, undefined),
        entry: undefined,
        line,
        sample: { kind: 'none', state: undefined, beyondS: 0 },
        scene: undefined,
      });
    });
    this.missionRing = new SelectionMarker(pixelRatio);
    this.missionGroup.add(this.missionRing.points);

    this.siteMarkers = new MarkerPoints(Math.max(1, this.sites.length), 8 * pixelRatio, { depthTest: false });
    this.sites.forEach((s, i) => {
      const p = this.siteBodyKm[i] ?? [0, 0, 0];
      this.siteMarkers.setPosition(i, p[0], p[1], p[2]);
      this.siteMarkers.setColor(i, SITE_COLORS[s.type]);
    });
    this.siteMarkers.commit();
    this.siteRing = new SelectionMarker(pixelRatio);
    this.siteGroup.add(this.siteMarkers.points, this.siteRing.points);
    this.moon.mesh.add(this.siteGroup);

    this.panel = new BodyPanel(
      host.i18n,
      'moon.panel',
      this.missions,
      this.sites,
      this.colors,
      (m) => m.ephemeris === 'horizons',
      {
        onSelectMission: (m) => this.select({ kind: 'mission', mission: m }, { focus: true }),
        onSelectSite: (s) => this.select({ kind: 'site', site: s }, { focus: true }),
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
    return bodyOrientationEqj(Astronomy.Body.Moon, date);
  }

  update(f: ViewFrame): void {
    const date = new Date(f.nowMs);
    this.tdbJd = utcToTdbJd(date);
    this.bodyQ = f.bodyQ;
    const sceneQ = f.sceneFromInertial;
    this.bodyScene = quatMultiply(sceneQ, f.bodyQ);

    const sun = quatRotate(sceneQ, normalize(moonToSunKm(date)));
    this.moon.setOrientation(this.bodyScene);
    this.moon.setSunDirection(sun);
    this.earth.setSunDirection(sun);
    this.earthScene = quatRotate(sceneQ, moonToEarthKm(date));
    this.earth.setOrientation(quatMultiply(sceneQ, earthOrientation(date)));
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
  }

  placeOrigin(originKm: Vec3): void {
    this.originKm = originKm;
    this.moon.mesh.position.set(-originKm[0], -originKm[1], -originKm[2]);
    const e = sub(this.earthScene, originKm);
    this.earth.mesh.position.set(e[0], e[1], e[2]);
    this.missionGroup.position.set(-originKm[0], -originKm[1], -originKm[2]);
    for (const t of this.tracked) {
      const p = t.sample.state?.posKm;
      if (p && t.scene && !occludedBySphere(originKm, t.scene, R))
        this.missionMarkers.setPosition(t.index, p[0], p[1], p[2]);
      else this.missionMarkers.hide(t.index);
    }
    this.missionMarkers.commit();
    this.sites.forEach((_, i) => {
      const scene = this.siteScene[i];
      const p = this.siteBodyKm[i];
      if (p && scene && !occludedBySphere(originKm, scene, R))
        this.siteMarkers.setPosition(i, p[0], p[1], p[2]);
      else this.siteMarkers.hide(i);
    });
    this.siteMarkers.commit();
    this.placeLabels();
  }

  uiTick(): void {
    this.renderDetail(false);
  }

  click(xCss: number, yCss: number, double: boolean): void {
    let best: { sel: Selection; d: number } | undefined;
    const consider = (sel: Selection, scene: Vec3 | undefined): void => {
      const p = scene && this.project(scene);
      if (!p) return;
      const d = Math.hypot(p.x - xCss, p.y - yCss);
      if (d <= PICK_RADIUS_PX && (!best || d < best.d)) best = { sel, d };
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
    scene.remove(this.moon.mesh, this.earth.mesh, this.missionGroup);
    this.moon.dispose();
    this.earth.dispose();
    this.missionMarkers.dispose();
    this.siteMarkers.dispose();
    for (const t of this.tracked) {
      t.line.geometry.dispose();
      t.line.material.dispose();
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
      muKm3S2: MU,
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
    host.showNotice(host.i18n.t('moon.loading'));
    try {
      const manifest = await loadManifest(host.baseUrl);
      let oldest: Date | undefined;
      await Promise.all(
        this.tracked.map(async (t) => {
          const entry = manifest.ephemerides[t.mission.id];
          if (!entry || entry.centralBody !== 'moon') return;
          const table = await loadEphemeris(host.baseUrl, entry);
          if (this.disposed) return;
          t.track = this.makeTrack(t.mission, table);
          t.entry = entry;
          const fetched = new Date(entry.fetchedAt);
          if (!oldest || fetched < oldest) oldest = fetched;
        }),
      );
      if (this.disposed) return;
      this.panel.setFetched(oldest);
      this.lastTrajectoryWallMs = -Infinity;
      host.showNotice(undefined);
      this.renderDetail(false);
    } catch (err) {
      console.error(err);
      host.showNotice(host.i18n.t('moon.unavailable'));
    }
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
      t.line.material = wantDashed
        ? new LineDashedMaterial({ color, dashSize: 150, gapSize: 120, transparent: true })
        : new LineBasicMaterial({ color, transparent: true });
    }
    if (wantDashed) t.line.computeLineDistances();
    const m = t.line.material as LineBasicMaterial | LineDashedMaterial;
    m.color.set(kind === 'hidden' ? '#8a8f98' : color);
    m.opacity = kind === 'hidden' ? 0.35 : selected ? 1 : 0.55;
    t.line.visible = kind !== 'none';
  }

  private project(sceneKm: Vec3): { x: number; y: number } | undefined {
    if (occludedBySphere(this.originKm, sceneKm, R)) return undefined;
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
        className: 'label-mission',
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
    for (const t of this.tracked) {
      const s = t.scene;
      this.labels.place(`m:${t.mission.id}`, s && sub(s, o), s, camera, o, R, w, hgt);
    }
    if (!this.sitesVisible) return;
    const sel = this.selection;
    this.sites.forEach((site, i) => {
      const s = this.siteScene[i];
      const near = s && length(sub(s, o)) < SITE_LABEL_DISTANCE_KM;
      const selected = sel?.kind === 'site' && sel.site.id === site.id;
      const show = s && (near || selected);
      this.labels.place(
        `s:${site.id}`,
        show ? sub(s, o) : undefined,
        show ? s : undefined,
        camera,
        o,
        R,
        w,
        hgt,
      );
    });
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
      if (site) this.select({ kind: 'site', site });
    } else {
      const mission = this.missions.find((m) => m.id === sel);
      if (mission) this.select({ kind: 'mission', mission });
    }
  }

  private select(sel: Selection, options: { follow?: boolean; focus?: boolean } = {}): void {
    const same =
      (sel?.kind === 'mission' &&
        this.selection?.kind === 'mission' &&
        sel.mission.id === this.selection.mission.id) ||
      (sel?.kind === 'site' && this.selection?.kind === 'site' && sel.site.id === this.selection.site.id);
    if (!same) this.host.follow.stop();
    this.selection = sel;
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
    const altitudeKm = length(pos) - R;
    const distanceKm = sel.kind === 'site' ? 400 : Math.min(Math.max(altitudeKm * 2, 400), 30_000);
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
    const t = (k: MessageKey): string => i18n.t(k);
    const num = (v: number, d = 0): string => i18n.number(v, d);
    const tracked = this.trackedFor(m.id);
    const rows: [string, string][] = [
      [t('info.agency'), m.agency],
      ...(m.country ? ([[t('info.country'), countryName(i18n, m.country)]] as [string, string][]) : []),
      ...(m.launchDate ? ([[t('info.launch'), m.launchDate]] as [string, string][]) : []),
      [t('info.status'), i18n.maybe(`mission.status.${m.status}`) ?? m.status],
      ...(m.orbit ? ([[t('info.orbit'), m.orbit[i18n.lang]]] as [string, string][]) : []),
      ...(m.horizonsId ? ([[t('info.horizons'), m.horizonsId]] as [string, string][]) : []),
      ...(m.norad ? ([[t('info.norad'), String(m.norad)]] as [string, string][]) : []),
    ];

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
      // Elements relative to the lunar equator: rotate the state into the body-fixed orientation.
      const toBody = quatConjugate(this.bodyQ);
      const el = osculatingElements(
        { posKm: quatRotate(toBody, s.posKm), velKmS: quatRotate(toBody, s.velKmS) },
        MU,
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
    const rows: [string, string][] = [
      [t('info.type'), i18n.maybe(`site.${site.type}`) ?? site.type],
      [t('info.date'), site.date],
      [t('info.agency'), site.agency],
      ...(site.country ? ([[t('info.country'), countryName(i18n, site.country)]] as [string, string][]) : []),
      [t('info.coordinates'), formatLatLon(site.latDeg, site.lonDeg)],
    ];
    return {
      title: site.name[i18n.lang],
      rows,
      ...(site.note ? { notes: site.note } : {}),
      sources: site.sources,
      footnote: i18n.format('info.verified', { date: this.sitesVerified }),
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
          controls.setState(orbitStateLookingFrom([0, 0, 0], pos, [0, 0, 1], length(pos) + 2000));
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

export const createMoonView: ViewFactory = (host) => new MoonView(host);
