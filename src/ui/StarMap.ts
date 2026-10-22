/**
 * 3D map of a star and the Sun (opened from a star's illustration in the info panel): every catalogue star at its
 * real place around the Sun (ICRS direction × distance, light-years), the star and the Sun named in the accent
 * colour and joined by a dashed line with their distance. To place the dots in depth, the map is a "stalk map":
 * rings of the galactic plane around the Sun, and from every star a thin stalk down (or up) to its foot on that
 * plane, so the stalk's length is the star's height and its foot where it lies in the plane; only the followed
 * star's and the clicked star's stalks stand out, the others are faint. One other star is picked at a time by a
 * click: named, with its own dashed line and distance to the Sun for comparison. An axis gizmo in the top-right
 * corner (src/ui/viewGizmo.ts) looks along the six galactic axes and switches to an orthographic projection. Drag to turn, wheel or pinch to zoom (the view's own QuaternionOrbitControls) around the
 * Sun; a double click on a star centres the map on it. Positions are to scale; the stars are dots, not to scale.
 *
 * Its own small WebGL renderer, created when the dialog opens and released when it closes (one extra context
 * only while the map is shown). Loaded on demand by the solar view, which mirrors it in the URL (`map=1`, the
 * picked star in `pick`) so links and the MCP server's perigee_view can open it. In embed mode (`embed=1`) the map
 * fills the frame alone, with a link to the full app instead of the Close button.
 */
import {
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Matrix4,
  OrthographicCamera,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Material,
} from 'three';
import starsJson from '../../catalog/stars.json';
import { DEG_TO_RAD } from '../astro/constants';
import { quatFromBasis, type Quat } from '../astro/quat';
import { raDecToUnit, starDirectionEqj } from '../astro/stars';
import { add, cross, dot, length, normalize, scale, sub, type Vec3 } from '../astro/vec3';
import { QuaternionOrbitControls } from '../camera/QuaternionOrbitControls';
import type { OrbitState } from '../camera/orbitMath';
import { StarsCatalogSchema, type Star } from '../data/schemas';
import type { I18n, MessageKey } from '../i18n';
import { blackbodyRgb, temperatureFromSpectralType } from '../render/starImage';
import { h, scrollingDialog } from './dom';
import { ViewGizmo, type GizmoAxis } from './viewGizmo';

const STARS = StarsCatalogSchema.parse(starsJson).stars;
const SUN_TEMPERATURE_K = 5772;
const FOV_Y_DEG = 45;
/** Screen size of the dots (CSS px): the two highlighted ones larger. */
const DOT_PX = 5;
const HIGHLIGHT_DOT_PX = 11;
/** Stalks and feet of the stars neither followed nor picked: barely there. */
const FADED_STALK_OPACITY = 0.08;
const FADED_FOOT_RGB: [number, number, number] = [0.22, 0.26, 0.3];
/** Label offset from its dot (CSS px), and the gap kept between labels. */
const LABEL_DX = 8;
const LABEL_GAP_PX = 2;

type Side = 'right' | 'left' | 'above' | 'below';
const SIDES: readonly Side[] = ['right', 'left', 'above', 'below'];

/** Position of a catalogue star around the Sun, in light-years (EQJ axes). */
export function starPositionLy(star: Pick<Star, 'raDeg' | 'decDeg' | 'distanceLy'>): Vec3 {
  return scale(starDirectionEqj(star), star.distanceLy);
}

/** North galactic pole (IAU, J2000: RA 192.85948°, Dec +27.12825°): the normal of the map's reference plane. */
export const GALACTIC_NORTH_EQJ: Vec3 = raDecToUnit(192.85948 * DEG_TO_RAD, 27.12825 * DEG_TO_RAD);
/** Galactic centre (Sgr A*, J2000: RA 266.40500°, Dec −28.93617°): the rings' zero direction. */
const GALACTIC_CENTRE_EQJ: Vec3 = raDecToUnit(266.405 * DEG_TO_RAD, -28.93617 * DEG_TO_RAD);
/** Radii of the galactic-plane rings around the Sun (light-years). */
const RING_LY = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
const RING_SEGMENTS = 128;
/** The opening view looks down on the galactic plane by this angle, so the rings show as ellipses. */
const HOME_TILT_RAD = 25 * DEG_TO_RAD;

/** Foot of a point on the galactic plane through the Sun (the bottom of its stalk). */
export function footOnPlane(positionLy: Vec3): Vec3 {
  return sub(positionLy, scale(GALACTIC_NORTH_EQJ, dot(positionLy, GALACTIC_NORTH_EQJ)));
}

/** Share of the half-width between the Sun, at the centre, and the star at the opening. */
const HOME_STAR_X = 0.7;
/** Click or double click: the star whose dot is nearest the pointer within this distance (CSS px). */
const PICK_PX = 24;
/** A press that moved farther than this (CSS px) was a drag, not a click. */
const CLICK_SLOP_PX = 5;

/**
 * Opening camera: centred on the Sun (the zoom's pivot), galactic north straight up so every stalk is vertical on
 * screen, the star towards the right (its foot on the plane horizontal from the Sun), the camera raised by
 * HOME_TILT_RAD above the plane, far enough for the star to sit at HOME_STAR_X of the half-width or height.
 */
export function homeState(positionLy: Vec3, aspect: number): OrbitState {
  const tanHalfY = Math.tan(((FOV_Y_DEG / 2) * Math.PI) / 180);
  const tanHalfX = tanHalfY * aspect;
  const n = GALACTIC_NORTH_EQJ;
  const foot = footOnPlane(positionLy);
  const x = length(foot) > 1e-9 ? normalize(foot) : normalize(footOnPlane(GALACTIC_CENTRE_EQJ));
  // Level view (x right, galactic north up, z towards the camera), then raised about x to look down on the plane.
  const level = cross(x, n);
  const z = add(scale(level, Math.cos(HOME_TILT_RAD)), scale(n, Math.sin(HOME_TILT_RAD)));
  const y = cross(z, x);
  const m = new Matrix4().makeBasis(new Vector3(...x), new Vector3(...y), new Vector3(...z));
  const q = new Quaternion().setFromRotationMatrix(m);
  const height = Math.abs(dot(positionLy, n));
  return {
    targetKm: [0, 0, 0],
    distanceKm: Math.max(length(foot) / (HOME_STAR_X * tanHalfX), height / (HOME_STAR_X * tanHalfY), 1),
    orientation: { x: q.x, y: q.y, z: q.z, w: q.w },
  };
}

/** Rings of the galactic plane around the Sun (one geometry, segments of every ring). */
function ringGeometry(): BufferGeometry {
  const u = normalize(footOnPlane(GALACTIC_CENTRE_EQJ));
  const v = cross(GALACTIC_NORTH_EQJ, u);
  const xyz: number[] = [];
  for (const r of RING_LY) {
    for (let i = 0; i < RING_SEGMENTS; i++) {
      for (const k of [i, i + 1]) {
        const a = (2 * Math.PI * k) / RING_SEGMENTS;
        xyz.push(...add(scale(u, r * Math.cos(a)), scale(v, r * Math.sin(a))));
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(xyz, 3));
  return g;
}

/** Stalks from each star to its foot on the galactic plane, as segment pairs. */
function stalkGeometry(stars: readonly Star[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute(
    'position',
    new Float32BufferAttribute(
      stars.flatMap((s) => {
        const p = starPositionLy(s);
        return [...p, ...footOnPlane(p)];
      }),
      3,
    ),
  );
  return g;
}

function starColor(s: Star): [number, number, number] {
  return blackbodyRgb(s.temperatureK ?? temperatureFromSpectralType(s.spectralType) ?? SUN_TEMPERATURE_K);
}

/** Round dot with a soft edge, shared by every point. */
function dotTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.55, 'rgba(255,255,255,0.95)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function points(
  positions: readonly Vec3[],
  colors: readonly [number, number, number][],
  sizePx: number,
  texture: CanvasTexture,
): Points {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions.flat(), 3));
  g.setAttribute('color', new Float32BufferAttribute(colors.flat(), 3));
  const m = new PointsMaterial({
    size: sizePx,
    sizeAttenuation: false,
    vertexColors: true,
    map: texture,
    transparent: true,
    alphaTest: 0.05,
    depthWrite: false,
  });
  return new Points(g, m);
}

interface MapLabel {
  readonly el: HTMLElement;
  readonly positionLy: Vec3;
  /** Placed first, never hidden by another label. */
  readonly priority: number;
  /** The distance label sits centred on its point; star names to the right of their dot. */
  readonly centred: boolean;
  /** Places tried in order around the dot (the Sun's name first left of the line's end, the star's off the line). */
  readonly sides: readonly Side[];
  width: number;
  height: number;
  shown: boolean;
  transform: string;
}

/** The star clicked on the map: its stalk, foot and dashed distance line, drawn brighter. */
interface Picked {
  readonly star: Star;
  readonly objects: (Line | LineSegments | Points)[];
}

/** What the open map shows; released when the dialog closes. */
interface Session {
  readonly renderer: WebGLRenderer;
  readonly controls: QuaternionOrbitControls;
  readonly perspective: PerspectiveCamera;
  readonly orthographic: OrthographicCamera;
  readonly scene: Scene;
  readonly labels: MapLabel[];
  /** Everything drawn but the picked star's objects, disposed on release. */
  readonly objects: (Line | LineSegments | Points)[];
  /** Dashed Sun–star lines, their dashes resized to the zoom. */
  readonly dashed: Line[];
  readonly texture: CanvasTexture;
  readonly gizmo: ViewGizmo;
  readonly ratio: number;
  picked: Picked | undefined;
  ortho: boolean;
  readonly resize: ResizeObserver;
  frame: number;
  lastMs: number;
}

/** Galactic axes of the gizmo: X towards the galactic centre, Y the direction of rotation, Z galactic north. */
function galacticAxes(): GizmoAxis[] {
  const x = normalize(footOnPlane(GALACTIC_CENTRE_EQJ));
  return [
    { label: 'X', dir: x, color: '#ff6b6b' },
    { label: 'Y', dir: cross(GALACTIC_NORTH_EQJ, x), color: '#7ddc6f' },
    { label: 'Z', dir: GALACTIC_NORTH_EQJ, color: '#5aa8ff' },
  ];
}

/** Camera looking along an axis from one of its ends: galactic north up, or the galactic centre for Z views. */
export function axisOrientation(back: Vec3, northEqj: Vec3, centreEqj: Vec3): Quat {
  const up = Math.abs(dot(back, northEqj)) > 0.99 ? centreEqj : northEqj;
  const x = normalize(cross(up, back));
  return quatFromBasis(x, cross(back, x), back);
}

const faint = (color: number, opacity: number): LineBasicMaterial =>
  new LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });

function dashedLine(to: Vec3, color: number): Line {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([0, 0, 0, ...to], 3));
  // Dash and gap sizes follow the zoom (draw()).
  const line = new Line(g, new LineDashedMaterial({ color, transparent: true, opacity: 0.9 }));
  line.computeLineDistances();
  return line;
}

class StarMapDialog {
  readonly element: HTMLDialogElement;
  private readonly title = h('h2', { id: 'star-map-title', tabindex: -1 });
  private readonly stage = h('div', { class: 'star-map-stage' });
  private readonly labelLayer = h('div', { class: 'star-map-labels', 'aria-hidden': 'true' });
  private readonly caption = h('p', { class: 'muted small' });
  private readonly close = h('button', { type: 'button', class: 'btn' });
  /** Embed mode: the full app showing the same map. */
  private readonly fullApp = h('a', { class: 'btn', target: '_blank', rel: 'noopener', hidden: true });
  private star: Star | undefined;
  private session: Session | undefined;
  private options: StarMapOptions = {};

  constructor(private readonly i18n: I18n) {
    this.close.addEventListener('click', () => this.element.close());
    // The URL follows the picked star: the link is read when it is followed.
    for (const type of ['pointerdown', 'focus', 'click'] as const)
      this.fullApp.addEventListener(type, () => (this.fullApp.href = fullAppHref()));
    this.stage.append(this.labelLayer);
    this.element = h('dialog', { class: 'panel about star-map', 'aria-labelledby': 'star-map-title' }, [
      this.title,
      this.stage,
      this.caption,
      h('div', { class: 'dialog-actions' }, [this.fullApp, this.close]),
    ]);
    scrollingDialog(this.element);
    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) this.element.close();
    });
    this.element.addEventListener('close', () => {
      this.release();
      this.options.onClose?.();
    });
    // Embedded, the map is the whole page: Escape does not close it.
    this.element.addEventListener('cancel', (e) => {
      if (this.options.embedded) e.preventDefault();
    });
    i18n.onChange(() => {
      this.renderText();
      if (this.star && this.session) this.buildLabels(this.session, this.star);
    });
    let down: { x: number; y: number } | undefined;
    this.stage.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    this.stage.addEventListener('click', (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP_PX) return;
      this.pick(e);
    });
    this.stage.addEventListener('dblclick', (e) => this.centreOn(e));
  }

  open(star: Star, options: StarMapOptions): void {
    this.star = star;
    this.options = {};
    this.release();
    this.options = options;
    const embedded = options.embedded ?? false;
    this.element.classList.toggle('is-embedded', embedded);
    this.close.hidden = embedded;
    this.fullApp.hidden = !embedded;
    this.renderText();
    if (!this.element.open) this.element.showModal();
    this.session = this.build(star);
    const pick = STARS.find((o) => o.id === options.pick && o.id !== star.id);
    if (this.session && pick) {
      this.setPicked(this.session, pick);
      // Opened on a link with a star to compare: zoomed out until it fits too (its distance within the frame's
      // shorter half, whatever its direction).
      const { controls } = this.session;
      const tanHalf =
        Math.tan(((FOV_Y_DEG / 2) * Math.PI) / 180) * Math.min(1, this.session.perspective.aspect);
      const home = {
        ...controls.state,
        distanceKm: Math.max(controls.state.distanceKm, pick.distanceLy / (HOME_STAR_X * tanHalf)),
      };
      controls.setHome(home);
      controls.setState(home);
    }
    this.title.focus({ preventScroll: true });
  }

  private renderText(): void {
    const { i18n } = this;
    this.close.textContent = i18n.t('about.close');
    this.fullApp.textContent = i18n.t('embed.open');
    this.fullApp.href = fullAppHref();
    if (!this.star) return;
    const name = this.star.name[i18n.lang];
    this.title.textContent = i18n.format('starMap.title', { star: name });
    // Embedded, the frame is small: a one-line caption.
    this.caption.textContent = i18n.t(this.options.embedded ? 'starMap.captionShort' : 'starMap.caption');
    this.stage.setAttribute(
      'aria-label',
      i18n.format('starMap.alt', { star: name, ly: i18n.number(this.star.distanceLy, 2) }),
    );
  }

  private camera(s: Session): PerspectiveCamera | OrthographicCamera {
    return s.ortho ? s.orthographic : s.perspective;
  }

  private build(star: Star): Session | undefined {
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      this.caption.textContent = this.i18n.t('starMap.noWebgl');
      return undefined;
    }
    const canvas = renderer.domElement;
    canvas.setAttribute('role', 'img');
    this.stage.prepend(canvas);
    // Point sizes are in device pixels: the dots are scaled by the same ratio.
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    renderer.setPixelRatio(ratio);
    const scene = new Scene();
    const texture = dotTexture();
    const others = STARS.filter((s) => s.id !== star.id);
    const target = starPositionLy(star);
    // Every star's stalk and foot, faint; the followed star's in the accent colour.
    const objects: (Line | LineSegments | Points)[] = [
      new LineSegments(ringGeometry(), faint(0x5ad7ff, 0.14)),
      new LineSegments(stalkGeometry(others), faint(0xe8dcb8, FADED_STALK_OPACITY)),
      points(
        others.map((o) => footOnPlane(starPositionLy(o))),
        others.map(() => FADED_FOOT_RGB),
        2 * ratio,
        texture,
      ),
      new LineSegments(stalkGeometry([star]), faint(0x5ad7ff, 0.7)),
      points([footOnPlane(target)], [[0.35, 0.84, 1]], 4 * ratio, texture),
      points(others.map(starPositionLy), others.map(starColor), DOT_PX * ratio, texture),
      points(
        [[0, 0, 0], target],
        [blackbodyRgb(SUN_TEMPERATURE_K), starColor(star)],
        HIGHLIGHT_DOT_PX * ratio,
        texture,
      ),
    ];
    const line = dashedLine(target, 0x5ad7ff);
    objects.push(line);
    scene.add(...objects);

    const aspect = this.stage.clientWidth / Math.max(1, this.stage.clientHeight) || 1.5;
    const controls = new QuaternionOrbitControls(canvas, {
      // Units are light-years here (the controller's "km" names are only units).
      // No surface to skim (the Sun is a dot here): turning keeps its speed when zoomed in close (the default
      // body radius, minDistance / 1.02, made it crawl at the closest zoom).
      limits: { minDistanceKm: 0.05, maxDistanceKm: 2e4, pivotMinDistanceKm: 0.05, surfaceRadiusKm: 0 },
      home: homeState(target, aspect),
      fovYRad: (FOV_Y_DEG * Math.PI) / 180,
    });
    const axes = galacticAxes();
    const gizmo = new ViewGizmo(
      axes,
      (end) =>
        this.i18n.t(`starMap.from.${end.axis.label.toLowerCase()}${end.positive ? '+' : '-'}` as MessageKey),
      (end) => {
        const back = end.positive ? end.axis.dir : scale(end.axis.dir, -1);
        controls.flyTo({
          ...controls.state,
          orientation: axisOrientation(back, GALACTIC_NORTH_EQJ, axes[0]?.dir ?? GALACTIC_CENTRE_EQJ),
        });
      },
      () => {
        if (this.session) this.session.ortho = !this.session.ortho;
      },
    );
    this.stage.append(gizmo.element);
    const resize = new ResizeObserver(() => this.resize());
    resize.observe(this.stage);
    const session: Session = {
      renderer,
      controls,
      perspective: new PerspectiveCamera(FOV_Y_DEG, aspect, 0.001, 1e5),
      orthographic: new OrthographicCamera(-1, 1, 1, -1, -1e5, 1e5),
      scene,
      labels: [],
      objects,
      dashed: [line],
      texture,
      gizmo,
      ratio,
      picked: undefined,
      ortho: false,
      resize,
      frame: 0,
      lastMs: performance.now(),
    };
    this.session = session;
    this.buildLabels(session, star);
    this.resize();
    const tick = (nowMs: number): void => {
      if (this.session !== session) return;
      const dtS = Math.min(0.1, (nowMs - session.lastMs) / 1000);
      session.lastMs = nowMs;
      controls.update(dtS);
      this.draw(session);
      session.frame = requestAnimationFrame(tick);
    };
    session.frame = requestAnimationFrame(tick);
    return session;
  }

  /**
   * The Sun's and the star's names with their distance at the line's middle, and the clicked star's name with its
   * own distance to the Sun.
   */
  private buildLabels(s: Session, star: Star): void {
    const { i18n } = this;
    for (const l of s.labels) l.el.remove();
    s.labels.length = 0;
    const add = (
      text: string,
      positionLy: Vec3,
      priority: number,
      cls: string,
      centred = false,
      sides: readonly Side[] = SIDES,
    ): void => {
      const el = h('span', { class: `star-map-label ${cls}` }, [text]);
      this.labelLayer.append(el);
      s.labels.push({
        el,
        positionLy,
        priority,
        centred,
        sides,
        width: 0,
        height: 0,
        shown: true,
        transform: '',
      });
    };
    const distance = (o: Star): string =>
      i18n.format('star.distanceShort', { ly: i18n.number(o.distanceLy, 2) });
    add(i18n.t('sun.name'), [0, 0, 0], 0, 'is-highlight', false, ['left', 'right', 'above', 'below']);
    add(star.name[i18n.lang], starPositionLy(star), 0, 'is-highlight', false, [
      'right',
      'above',
      'below',
      'left',
    ]);
    add(distance(star), scale(starPositionLy(star), 0.5), 1, 'is-distance', true);
    const picked = s.picked?.star;
    if (picked) {
      add(picked.name[i18n.lang], starPositionLy(picked), 1, 'is-picked');
      add(distance(picked), scale(starPositionLy(picked), 0.5), 1, 'is-distance is-picked', true);
    }
    for (const l of s.labels) {
      l.width = l.el.offsetWidth;
      l.height = l.el.offsetHeight;
    }
  }

  /** The star (or the Sun, `null`) whose dot is nearest the pointer, within PICK_PX. */
  private starAt(s: Session, e: MouseEvent): Star | null | undefined {
    const rect = this.stage.getBoundingClientRect();
    const camera = this.camera(s);
    const v = new Vector3();
    let best: Star | null | undefined;
    let bestPx = PICK_PX;
    for (const candidate of [null, ...STARS]) {
      const p = candidate ? starPositionLy(candidate) : [0, 0, 0];
      v.set(p[0], p[1], p[2]).project(camera);
      if (v.z <= -1 || v.z >= 1) continue;
      const px = Math.hypot(
        ((v.x + 1) / 2) * rect.width - (e.clientX - rect.left),
        ((1 - v.y) / 2) * rect.height - (e.clientY - rect.top),
      );
      if (px < bestPx) {
        bestPx = px;
        best = candidate;
      }
    }
    return best;
  }

  /**
   * Click: picks the star under the pointer (one at a time): its name, its stalk and foot drawn brighter and a dashed
   * line to the Sun with its distance, to compare with the followed star; a click beside every dot clears it.
   */
  private pick(e: MouseEvent): void {
    const s = this.session;
    if (!s || !this.star) return;
    const hit = this.starAt(s, e);
    const star = hit && hit.id !== this.star.id ? hit : undefined;
    if (star === s.picked?.star) return;
    this.setPicked(s, star);
    this.options.onPick?.(star?.id);
  }

  private setPicked(s: Session, star: Star | undefined): void {
    if (!this.star) return;
    if (s.picked) this.disposeObjects(s, s.picked.objects);
    s.picked = undefined;
    if (star) {
      const p = starPositionLy(star);
      const line = dashedLine(p, 0xe8dcb8);
      const objects = [
        new LineSegments(stalkGeometry([star]), faint(0xe8dcb8, 0.75)),
        points([footOnPlane(p)], [[0.91, 0.86, 0.72]], 4 * s.ratio, s.texture),
        line,
      ];
      s.scene.add(...objects);
      s.dashed.push(line);
      s.picked = { star, objects };
    }
    this.buildLabels(s, this.star);
  }

  private disposeObjects(s: Session, objects: readonly (Line | LineSegments | Points)[]): void {
    for (const o of objects) {
      s.scene.remove(o);
      o.geometry.dispose();
      (o.material as Material).dispose();
      const i = s.dashed.indexOf(o as Line);
      if (i >= 0) s.dashed.splice(i, 1);
    }
  }

  /** Double click: the star (or the Sun) under the pointer becomes the pivot, at the same distance. */
  private centreOn(e: MouseEvent): void {
    const s = this.session;
    if (!s) return;
    const hit = this.starAt(s, e);
    if (hit === undefined) return;
    s.controls.flyTo({ ...s.controls.state, targetKm: hit ? starPositionLy(hit) : [0, 0, 0] });
  }

  private resize(): void {
    const s = this.session;
    if (!s) return;
    const w = this.stage.clientWidth;
    const hPx = this.stage.clientHeight;
    if (w === 0 || hPx === 0) return;
    s.renderer.setSize(w, hPx, false);
    s.perspective.aspect = w / hPx;
    s.perspective.updateProjectionMatrix();
  }

  private draw(s: Session): void {
    const { controls } = s;
    const distance = controls.state.distanceKm;
    const eye = controls.cameraPositionKm;
    const p = s.perspective;
    controls.applyTo(p);
    p.position.set(eye[0], eye[1], eye[2]);
    p.near = Math.max(1e-4, distance * 1e-3);
    p.far = distance * 10 + 1e4;
    p.updateProjectionMatrix();
    p.updateMatrixWorld();
    // Orthographic: the same view, the visible height at the pivot kept (the zoom still sets the scale).
    const o = s.orthographic;
    controls.applyTo(o);
    o.position.set(eye[0], eye[1], eye[2]);
    const halfH = distance * Math.tan(((FOV_Y_DEG / 2) * Math.PI) / 180);
    o.top = halfH;
    o.bottom = -halfH;
    o.left = -halfH * p.aspect;
    o.right = halfH * p.aspect;
    o.updateProjectionMatrix();
    o.updateMatrixWorld();
    // Dashes of a constant size on screen, whatever the zoom.
    for (const line of s.dashed) {
      const dashes = line.material as LineDashedMaterial;
      dashes.dashSize = distance * 0.025;
      dashes.gapSize = distance * 0.018;
    }
    s.renderer.render(s.scene, this.camera(s));
    this.placeLabels(s);
    const { i18n } = this;
    s.gizmo.draw(
      controls.orientation,
      i18n.t(s.ortho ? 'starMap.ortho' : 'starMap.persp'),
      i18n.t(s.ortho ? 'starMap.toPersp' : 'starMap.toOrtho'),
    );
  }

  /**
   * Greedy placement, in priority order: each label takes the first place beside its dot (right, left, above,
   * below) that stays inside the map and overlaps no label placed before it; a star's name with no such place is
   * hidden, while the Sun, the selected star and their distance keep their first place inside the map.
   */
  private placeLabels(s: Session): void {
    const w = this.stage.clientWidth;
    const hPx = this.stage.clientHeight;
    const camera = this.camera(s);
    const placed: [number, number, number, number][] = [];
    const g = LABEL_GAP_PX;
    type Box = readonly [number, number, number, number];
    const free = (b: Box): boolean =>
      placed.every((p) => !(b[0] < p[2] + g && b[2] + g > p[0] && b[1] < p[3] + g && b[3] + g > p[1]));
    const inside = (b: Box): boolean => b[0] >= 0 && b[1] >= 0 && b[2] <= w && b[3] <= hPx;
    const v = new Vector3();
    for (const l of s.labels) {
      v.set(l.positionLy[0], l.positionLy[1], l.positionLy[2]).project(camera);
      let show = v.z > -1 && v.z < 1;
      const px = ((v.x + 1) / 2) * w;
      const py = ((1 - v.y) / 2) * hPx;
      const { width: lw, height: lh } = l;
      // Above or below the dot, a label slides sideways to stay inside the map.
      const cx = Math.min(Math.max(px - lw / 2, 0), Math.max(0, w - lw));
      const at: Record<Side, [number, number]> = {
        right: [px + LABEL_DX, py - lh / 2],
        left: [px - LABEL_DX - lw, py - lh / 2],
        above: [cx, py - lh - LABEL_DX / 2],
        below: [cx, py + LABEL_DX / 2],
      };
      const corners: [number, number][] = l.centred
        ? [
            [cx, py - lh - 4],
            [cx, py + 4],
          ]
        : l.sides.map((side) => at[side]);
      const boxes = corners.map(([x, y]) => [x, y, x + lw, y + lh] as [number, number, number, number]);
      const box =
        boxes.find((b) => inside(b) && free(b)) ?? (l.priority <= 1 ? boxes.find(inside) : undefined);
      if (!box) show = false;
      const [x, y] = box ?? [0, 0];
      if (show && box) placed.push(box);
      if (show !== l.shown) {
        l.shown = show;
        l.el.hidden = !show;
      }
      if (!show) continue;
      // Sub-pixel, not rounded: a dot sitting on a half pixel (the Sun at the centre) made a rounded label jitter
      // by one pixel while the view turned.
      const transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      if (transform !== l.transform) {
        l.transform = transform;
        l.el.style.transform = transform;
      }
    }
  }

  private release(): void {
    const s = this.session;
    if (!s) return;
    this.session = undefined;
    cancelAnimationFrame(s.frame);
    s.resize.disconnect();
    s.controls.dispose();
    s.gizmo.element.remove();
    for (const l of s.labels) l.el.remove();
    if (s.picked) this.disposeObjects(s, s.picked.objects);
    this.disposeObjects(s, s.objects);
    s.texture.dispose();
    s.renderer.dispose();
    s.renderer.forceContextLoss();
    s.renderer.domElement.remove();
  }
}

let dialog: StarMapDialog | undefined;

/** This page in the full app: the embed's own parameters removed (as the embed's corner link). */
function fullAppHref(): string {
  const url = new URL(window.location.href);
  for (const key of ['embed', 'ui', 'e2e']) url.searchParams.delete(key);
  return url.href;
}

export interface StarMapOptions {
  /** Catalogue id of the star picked for comparison at the opening. */
  readonly pick?: string | undefined;
  /** Embed mode: the map fills the frame, with a link to the full app instead of Close. */
  readonly embedded?: boolean;
  /** The picked star changed (undefined: none), and the map closed: the view mirrors them in the URL. */
  readonly onPick?: (id: string | undefined) => void;
  readonly onClose?: () => void;
}

/** Opens the 3D map of a catalogue star and the Sun (the dialog is created on first use). */
export function openStarMap(i18n: I18n, starId: string, options: StarMapOptions = {}): void {
  const star = STARS.find((s) => s.id === starId);
  if (!star) return;
  if (!dialog) {
    dialog = new StarMapDialog(i18n);
    (document.getElementById('app') ?? document.body).append(dialog.element);
  }
  dialog.open(star, options);
}
