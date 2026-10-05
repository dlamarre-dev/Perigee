/**
 * 3D model preview at the top of the info panel: the model's PBR materials lit by a "Sun" and a dim room
 * environment (specular highlights), turning slowly; drag to turn it. Hidden when the selected object has no
 * model.
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
} from 'three';
import type { ModelEntry } from '../data/schemas';
import type { I18n } from '../i18n';
import { ensureEnvironment, loadModel } from '../render/models';
import { h } from './dom';

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
  /** Model id currently in the pivot. */
  shownId: string | undefined;
}

let shared: Shared | undefined | null;

function getShared(): Shared | undefined {
  if (shared !== undefined) return shared ?? undefined;
  try {
    const renderer = new WebGLRenderer({ antialias: true, alpha: true });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    const scene = new Scene();
    const sun = new DirectionalLight(0xffffff, 3);
    sun.position.set(3, 2, 4);
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
  private readonly size = new Vector2();
  private current: string | undefined;
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

  /** Shows `entry` (or hides the preview). */
  show(entry: ModelEntry | undefined): void {
    if (!entry) {
      this.element.hidden = true;
      this.current = undefined;
      this.update();
      return;
    }
    this.element.hidden = false;
    this.caption.textContent = this.i18n.format('model.credit', { credit: entry.credit });
    this.current = entry.id;
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

  private load(s: Shared, id: string): void {
    s.shownId = id;
    s.pivot.clear();
    void loadModel(this.baseUrl, id).then((obj) => {
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
