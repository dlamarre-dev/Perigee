/**
 * Preview at the top of the info panel, turning slowly (drag to turn it):
 * - a spacecraft's 3D model, its PBR materials lit by a "Sun" and a dim room environment (specular highlights);
 * - a celestial body: the view's own BodyMesh (same maps, flattening, moving gas, rings), lit from one side,
 *   spinning about its pole;
 * - a star: a 2D illustration (src/render/starImage.ts), drawn once.
 * Hidden when the selection has none of these.
 *
 * All previews share one small WebGL renderer (created on first use, its canvas moved into whichever preview is
 * showing), so switching views never piles up WebGL contexts. A preview only renders while it is on screen
 * (IntersectionObserver): a collapsed sheet, a scrolled-away panel or a view that was switched away costs
 * nothing.
 */
import {
  AmbientLight,
  Box3,
  DirectionalLight,
  Group,
  PerspectiveCamera,
  Scene,
  Sphere,
  SRGBColorSpace,
  ACESFilmicToneMapping,
  Vector2,
  WebGLRenderer,
  type Texture,
} from 'three';
import type { ModelEntry } from '../data/schemas';
import type { I18n } from '../i18n';
import { assetUrl } from '../render/assetUrl';
import { BodyMesh, bodySphere, type GasProfile } from '../render/BodyMesh';
import { ensureEnvironment, loadModel } from '../render/models';
import { quality } from '../render/quality';
import { RingMesh } from '../render/RingMesh';
import { applyShape, loadShape } from '../render/shapeGeometry';
import { drawStar } from '../render/starImage';
import { placeholderTexture, progressiveTexture } from '../render/textures';
import { h } from './dom';

/** A celestial body drawn as in the 3D view. */
export interface BodyPreview {
  /** Texture folder (public/textures/<id>/) and shape id. */
  readonly id: string;
  readonly radiusKm: number;
  readonly radiiKm?: readonly [number, number, number] | undefined;
  /** Placeholder colour until the map arrives (#rrggbb). */
  readonly color: string;
  /** Map file stem: "color", or "day" for the Earth (with its night lights). */
  readonly map?: 'color' | 'day';
  readonly gasFlow?: GasProfile | undefined;
  readonly rings?:
    { readonly innerKm: number; readonly outerKm: number; readonly tauScale: number } | undefined;
  /** Irregular moon: radius grid of public/shapes/<id>.json. */
  readonly shapeGrid?: boolean;
}

/** A star, illustrated (src/render/starImage.ts). */
export interface StarPreview {
  readonly id: string;
  readonly temperatureK: number;
  readonly radiusSun: number | undefined;
}

export type PreviewSubject =
  | { readonly kind: 'model'; readonly entry: ModelEntry }
  | { readonly kind: 'body'; readonly body: BodyPreview }
  | { readonly kind: 'star'; readonly star: StarPreview };

function subjectKey(subject: PreviewSubject): string {
  if (subject.kind === 'model') return `model:${subject.entry.id}`;
  if (subject.kind === 'body') return `body:${subject.body.id}`;
  return `star:${subject.star.id}`;
}

/** Light direction of the previews (world frame, from the upper right front). */
const PREVIEW_SUN: readonly [number, number, number] = [
  3 / Math.sqrt(29),
  2 / Math.sqrt(29),
  4 / Math.sqrt(29),
];

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const SPIN_RAD_PER_S = 0.35;
/** 30 fps is plenty for a slow spin, and leaves the main view its frame budget. */
let previewFrameMs = 33;

/** Frame interval of the previews (the quality tier lowers it on weak devices). */
export function setPreviewFrameRate(fps: number): void {
  previewFrameMs = 1000 / fps;
}

interface Shared {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly pivot: Group;
  owner: ModelPreview | undefined;
  /** Subject key currently in the pivot. */
  shownId: string | undefined;
  /** Frees what the current subject built (body meshes, textures). */
  release: (() => void) | undefined;
}

let shared: Shared | undefined | null;

/** The shared renderer if it was created (without creating it). */
function getSharedIfAny(): Shared | undefined {
  return shared ?? undefined;
}

function getShared(): Shared | undefined {
  if (shared !== undefined) return shared ?? undefined;
  try {
    const renderer = new WebGLRenderer({ antialias: true, alpha: true });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.setPixelRatio(Math.min(quality().maxPixelRatio, window.devicePixelRatio));
    const scene = new Scene();
    const sun = new DirectionalLight(0xffffff, 3);
    sun.position.set(PREVIEW_SUN[0], PREVIEW_SUN[1], PREVIEW_SUN[2]);
    const pivot = new Group();
    scene.add(pivot, sun, new AmbientLight(0xffffff, 0.15));
    ensureEnvironment(renderer, scene, 0.6);
    const s: Shared = {
      renderer,
      scene,
      camera: new PerspectiveCamera(30, 16 / 10, 0.01, 1000),
      pivot,
      owner: undefined,
      shownId: undefined,
      release: undefined,
    };
    const el = renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      s.owner?.dragStart(e.clientX, e.clientY);
    });
    el.addEventListener('pointermove', (e) => s.owner?.dragMove(e.clientX, e.clientY));
    el.addEventListener('pointerup', () => s.owner?.dragEnd());
    el.addEventListener('pointercancel', () => s.owner?.dragEnd());
    el.setAttribute('role', 'img');
    // The browser may drop the context (memory pressure, GPU reset): previews hide until it comes back.
    el.addEventListener('webglcontextlost', (e) => e.preventDefault());
    shared = s;
    return s;
  } catch {
    shared = null;
    return undefined;
  }
}

export class ModelPreview {
  readonly element: HTMLElement;
  private readonly canvasBox = h('div', { class: 'model-canvas' });
  private readonly caption = h('p', { class: 'muted small model-credit' });
  private readonly starCanvas = h('canvas', { role: 'img' });
  private readonly size = new Vector2();
  private current: string | undefined;
  private subject: PreviewSubject | undefined;
  /** Star drawn at this key and canvas width. */
  private starDrawn = '';
  private onScreen = false;
  private frame = 0;
  private lastMs = 0;
  private yaw = 0.6;
  private pitch = 0.35;
  private dragging: { x: number; y: number } | undefined;
  private readonly observer: IntersectionObserver | undefined;

  constructor(
    private readonly i18n: I18n,
    private readonly baseUrl: string,
  ) {
    this.element = h('figure', { class: 'model-preview', hidden: true }, [this.canvasBox, this.caption]);
    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver((entries) => {
        this.onScreen = entries.some((e) => e.isIntersecting);
        this.update();
      });
      this.observer.observe(this.element);
    } else {
      this.onScreen = true;
    }
  }

  /** Shows a subject (or hides the preview); cheap when the subject is unchanged (live panel refreshes). */
  show(subject: PreviewSubject | undefined): void {
    if (!subject) {
      this.element.hidden = true;
      this.current = undefined;
      this.subject = undefined;
      this.update();
      return;
    }
    const key = subjectKey(subject);
    this.element.hidden = false;
    this.subject = subject;
    if (subject.kind === 'model') {
      this.caption.textContent = this.i18n.format('model.credit', { credit: subject.entry.credit });
    } else if (subject.kind === 'body') {
      this.caption.textContent = this.i18n.t('preview.body');
    }
    if (key !== this.current) {
      this.current = key;
      this.yaw = 0.6;
    }
    this.update();
  }

  dragStart(x: number, y: number): void {
    this.dragging = { x, y };
  }

  dragMove(x: number, y: number): void {
    if (!this.dragging) return;
    this.yaw += (x - this.dragging.x) * 0.01;
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + (y - this.dragging.y) * 0.01));
    this.dragging = { x, y };
  }

  dragEnd(): void {
    this.dragging = undefined;
  }

  /** Runs while showing a model on screen; otherwise stops (and lets another preview take the renderer). */
  private update(): void {
    const active = this.current !== undefined && !this.element.hidden && this.onScreen;
    if (!active) {
      this.stop();
      return;
    }
    if (this.subject?.kind === 'star') {
      this.stop();
      this.drawStar(this.subject.star);
      return;
    }
    this.starCanvas.remove();
    this.starDrawn = '';
    const s = getShared();
    if (!s) {
      this.element.hidden = true;
      return;
    }
    if (s.owner !== this || s.renderer.domElement.parentElement !== this.canvasBox) {
      s.owner = this;
      this.canvasBox.append(s.renderer.domElement);
      s.renderer.domElement.setAttribute('aria-label', this.i18n.t('model.preview'));
    }
    if (s.shownId !== this.current) this.load(s, this.current ?? '');
    this.start();
  }

  /** The star illustration, redrawn when the star, the language or the width changes. */
  private drawStar(star: StarPreview): void {
    const shared = getSharedIfAny();
    if (shared?.owner === this) shared.owner = undefined;
    if (this.starCanvas.parentElement !== this.canvasBox) this.canvasBox.replaceChildren(this.starCanvas);
    const w = this.canvasBox.clientWidth;
    if (w === 0) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const key = `${star.id}|${w}|${ratio}|${this.i18n.lang}`;
    if (key === this.starDrawn) return;
    this.starDrawn = key;
    this.starCanvas.width = Math.round(w * ratio);
    this.starCanvas.height = Math.round(w * 0.62 * ratio);
    const comparison = drawStar(this.starCanvas, {
      temperatureK: star.temperatureK,
      radiusSun: star.radiusSun,
      seed: star.id,
      sunLabel: this.i18n.t('sun.name'),
    });
    const temperature = this.i18n.number(Math.round(star.temperatureK / 10) * 10);
    this.caption.textContent =
      comparison === 'drawn'
        ? this.i18n.format('preview.starWithSun', { t: temperature })
        : comparison === 'too-small'
          ? this.i18n.format('preview.starSunTiny', {
              t: temperature,
              n: this.i18n.number(Math.round(star.radiusSun ?? 0)),
            })
          : this.i18n.format('preview.star', { t: temperature });
    this.starCanvas.setAttribute('aria-label', this.caption.textContent);
  }

  private load(s: Shared, id: string): void {
    s.release?.();
    s.release = undefined;
    s.shownId = id;
    s.pivot.clear();
    const subject = this.subject;
    if (subject?.kind === 'body') {
      this.loadBody(s, id, subject.body);
      return;
    }
    if (subject?.kind !== 'model') return;
    void loadModel(this.baseUrl, subject.entry.id).then((obj) => {
      if (!obj || s.shownId !== id) return;
      // Centre and frame the model.
      const box = new Box3().setFromObject(obj);
      const sphere = box.getBoundingSphere(new Sphere());
      obj.position.sub(sphere.center);
      s.pivot.clear();
      s.pivot.add(obj);
      const d = sphere.radius / Math.sin((s.camera.fov * Math.PI) / 360);
      s.camera.position.set(0, 0, d * 1.05);
      s.camera.near = d / 100;
      s.camera.far = d * 10;
      s.camera.updateProjectionMatrix();
    });
  }

  /** The body as in the 3D view, pole up (its frame is Z-up), lit from the preview's Sun. */
  private loadBody(s: Shared, id: string, b: BodyPreview): void {
    const frame = (radiusKm: number): void => {
      const d = radiusKm / Math.sin((s.camera.fov * Math.PI) / 360);
      s.camera.position.set(0, 0, d * 1.08);
      s.camera.near = d / 100;
      s.camera.far = d * 10;
      s.camera.updateProjectionMatrix();
    };
    const maxTextureSize = 2048;
    const anisotropy = s.renderer.capabilities.getMaxAnisotropy();
    const mesh = new BodyMesh({
      name: b.id,
      radiusKm: b.radiusKm,
      radiiKm: b.radiiKm,
      dayMap: placeholderTexture(hexRgb(b.color)),
      nightMap: placeholderTexture([0, 0, 0]),
      ambient: 0.04,
      gasFlow: b.gasFlow,
      ...(b.map === 'day' && {
        nightStrength: 1.4,
        atmosphereColor: [0.25, 0.45, 1.0] as const,
        atmosphereStrength: 0.6,
      }),
    });
    // The preview renderer tone-maps for the PBR models; the body shaders are already in display range.
    mesh.mesh.material.toneMapped = false;
    mesh.setSunDirection([...PREVIEW_SUN]);
    const texture = (name: string, rgb: [number, number, number], apply: (t: Texture) => void): void => {
      progressiveTexture({
        baseUrl: this.baseUrl,
        body: b.id,
        name,
        maxTextureSize,
        anisotropy,
        placeholderRgb: rgb,
        onUpdate: (tex) => {
          if (s.shownId === id) apply(tex);
          else tex.dispose();
        },
      });
    };
    texture(b.map ?? 'color', hexRgb(b.color), (t) => mesh.setDayMap(t));
    if (b.map === 'day') texture('night', [0, 0, 0], (t) => mesh.setNightMap(t));
    if (b.shapeGrid) {
      void loadShape(this.baseUrl, b.id).then((grid) => {
        if (!grid || s.shownId !== id) return;
        const shaped = bodySphere(b.radiusKm);
        applyShape(shaped, grid);
        mesh.setGeometry(shaped);
        // Frame the shape, which reaches beyond the mean radius.
        shaped.computeBoundingSphere();
        frame(shaped.boundingSphere?.radius ?? b.radiusKm);
      });
    }
    let rings: RingMesh | undefined;
    if (b.rings) {
      rings = new RingMesh({
        url: assetUrl(this.baseUrl, `textures/${b.id}/rings.png`),
        innerKm: b.rings.innerKm,
        outerKm: b.rings.outerKm,
        tauScale: b.rings.tauScale,
        planetRadiusKm: b.radiiKm?.[0] ?? b.radiusKm,
      });
      rings.mesh.material.toneMapped = false;
      rings.setLighting([...PREVIEW_SUN], [0, 0, 0]);
      mesh.mesh.add(rings.mesh);
    }
    const holder = new Group();
    holder.rotation.x = -Math.PI / 2;
    holder.add(mesh.mesh);
    s.pivot.add(holder);
    frame(b.rings ? b.rings.outerKm : mesh.boundingRadiusKm);
    s.release = () => {
      mesh.dispose();
      rings?.dispose();
    };
  }

  private start(): void {
    if (this.frame) return;
    this.lastMs = performance.now();
    const tick = (now: number): void => {
      this.frame = requestAnimationFrame(tick);
      if (now - this.lastMs < previewFrameMs) return;
      const dt = Math.min(0.1, (now - this.lastMs) / 1000);
      this.lastMs = now;
      if (!this.dragging) this.yaw += SPIN_RAD_PER_S * dt;
      this.render();
    };
    this.frame = requestAnimationFrame(tick);
  }

  private stop(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private render(): void {
    const s = shared;
    if (!s || s.owner !== this || s.shownId !== this.current) return;
    const r = s.renderer;
    if (r.getContext().isContextLost()) return;
    const w = this.canvasBox.clientWidth;
    const hgt = Math.round(w * 0.62);
    if (w === 0) return;
    const size = r.getSize(this.size);
    if (size.x !== w || size.y !== hgt) {
      // CSS owns the canvas size (aspect ratio); only the drawing buffer follows it.
      r.setSize(w, hgt, false);
      s.camera.aspect = w / hgt;
      s.camera.updateProjectionMatrix();
    }
    s.pivot.rotation.set(this.pitch, this.yaw, 0, 'XYZ');
    r.render(s.scene, s.camera);
  }
}
