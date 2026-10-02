/**
 * 3D model preview at the top of the info panel: its own small WebGL canvas (created on first use), the
 * model's PBR materials lit by a "Sun" and a dim room environment (specular highlights), turning slowly; drag
 * to turn it. Hidden when the selected object has no model.
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

export class ModelPreview {
  readonly element: HTMLElement;
  private readonly canvasBox = h('div', { class: 'model-canvas' });
  private readonly caption = h('p', { class: 'muted small model-credit' });
  private renderer: WebGLRenderer | undefined;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(30, 16 / 10, 0.01, 1000);
  private readonly pivot = new Group();
  private readonly size = new Vector2();
  private current: string | undefined;
  private frame = 0;
  private lastMs = 0;
  private yaw = 0.6;
  private pitch = 0.35;
  private dragging: { x: number; y: number } | undefined;

  constructor(
    private readonly i18n: I18n,
    private readonly baseUrl: string,
  ) {
    this.element = h('figure', { class: 'model-preview', hidden: true }, [this.canvasBox, this.caption]);
    const sun = new DirectionalLight(0xffffff, 3);
    sun.position.set(3, 2, 4);
    this.scene.add(this.pivot, sun, new AmbientLight(0xffffff, 0.15));
  }

  /** Shows `entry` (or hides the preview). */
  show(entry: ModelEntry | undefined): void {
    if (!entry) {
      this.element.hidden = true;
      this.current = undefined;
      this.stop();
      return;
    }
    this.element.hidden = false;
    this.caption.textContent = this.i18n.format('model.credit', { credit: entry.credit });
    if (this.current === entry.id) return;
    this.current = entry.id;
    const renderer = this.ensureRenderer();
    if (!renderer) {
      this.element.hidden = true;
      return;
    }
    this.pivot.clear();
    void loadModel(this.baseUrl, entry.id).then((obj) => {
      if (!obj || this.current !== entry.id) return;
      // Centre and frame the model.
      const box = new Box3().setFromObject(obj);
      const sphere = box.getBoundingSphere(new Sphere());
      obj.position.sub(sphere.center);
      this.pivot.clear();
      this.pivot.add(obj);
      const d = sphere.radius / Math.sin((this.camera.fov * Math.PI) / 360);
      this.camera.position.set(0, 0, d * 1.05);
      this.camera.near = d / 100;
      this.camera.far = d * 10;
      this.camera.updateProjectionMatrix();
      this.start();
    });
  }

  private ensureRenderer(): WebGLRenderer | undefined {
    if (this.renderer) return this.renderer;
    try {
      const r = new WebGLRenderer({ antialias: true, alpha: true });
      r.outputColorSpace = SRGBColorSpace;
      r.toneMapping = ACESFilmicToneMapping;
      r.setPixelRatio(Math.min(2, window.devicePixelRatio));
      this.canvasBox.append(r.domElement);
      ensureEnvironment(r, this.scene, 0.6);
      const el = r.domElement;
      el.addEventListener('pointerdown', (e) => {
        el.setPointerCapture(e.pointerId);
        this.dragging = { x: e.clientX, y: e.clientY };
      });
      el.addEventListener('pointermove', (e) => {
        if (!this.dragging) return;
        this.yaw += (e.clientX - this.dragging.x) * 0.01;
        this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + (e.clientY - this.dragging.y) * 0.01));
        this.dragging = { x: e.clientX, y: e.clientY };
      });
      const end = (): void => {
        this.dragging = undefined;
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', this.i18n.t('model.preview'));
      this.renderer = r;
      return r;
    } catch {
      return undefined;
    }
  }

  private start(): void {
    if (this.frame) return;
    this.lastMs = performance.now();
    const tick = (now: number): void => {
      this.frame = requestAnimationFrame(tick);
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
    const r = this.renderer;
    if (!r || this.element.hidden) return;
    const w = this.canvasBox.clientWidth;
    const hgt = Math.round(w * 0.62);
    if (w === 0) return;
    const size = r.getSize(this.size);
    if (size.x !== w || size.y !== hgt) {
      r.setSize(w, hgt, true);
      this.camera.aspect = w / hgt;
      this.camera.updateProjectionMatrix();
    }
    this.pivot.rotation.set(this.pitch, this.yaw, 0, 'XYZ');
    r.render(this.scene, this.camera);
  }
}
