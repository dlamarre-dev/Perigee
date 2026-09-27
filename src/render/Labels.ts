/**
 * DOM labels for a handful of objects (missions, sites), positioned each frame by projecting scene-frame
 * positions. Hidden when behind the camera, off-screen, or occluded by the central body (ray–sphere test).
 */
import { Vector3, type PerspectiveCamera } from 'three';
import { dot, sub, type Vec3 } from '../astro/vec3';

export interface LabelItem {
  readonly id: string;
  readonly text: string;
  readonly className?: string;
}

/** True if the segment camera → point crosses a sphere centred at the scene origin. */
export function occludedBySphere(cameraKm: Vec3, pointKm: Vec3, radiusKm: number): boolean {
  const d = sub(pointKm, cameraKm);
  const len2 = dot(d, d);
  if (len2 === 0) return false;
  // Closest approach of the segment to the origin.
  const t = Math.max(0, Math.min(1, -dot(cameraKm, d) / len2));
  const c: Vec3 = [cameraKm[0] + d[0] * t, cameraKm[1] + d[1] * t, cameraKm[2] + d[2] * t];
  return dot(c, c) < radiusKm * radiusKm * 0.998 && t < 0.999;
}

export class LabelLayer {
  readonly element: HTMLElement;
  private readonly labels = new Map<string, HTMLElement>();
  private readonly v = new Vector3();

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'label-layer';
    this.element.setAttribute('aria-hidden', 'true');
  }

  setItems(items: readonly LabelItem[]): void {
    const keep = new Set(items.map((i) => i.id));
    for (const [id, el] of this.labels) {
      if (!keep.has(id)) {
        el.remove();
        this.labels.delete(id);
      }
    }
    for (const item of items) {
      let el = this.labels.get(item.id);
      if (!el) {
        el = document.createElement('span');
        this.labels.set(item.id, el);
        this.element.append(el);
      }
      el.className = `label ${item.className ?? ''}`;
      el.textContent = item.text;
    }
  }

  /**
   * Positions one label. `renderKm` is the point relative to the camera (render space), `sceneKm` the
   * point in the scene frame, `cameraKm` the camera in the scene frame; the body is at the scene origin.
   */
  place(
    id: string,
    renderKm: Vec3 | undefined,
    sceneKm: Vec3 | undefined,
    camera: PerspectiveCamera,
    cameraKm: Vec3,
    bodyRadiusKm: number,
    widthCss: number,
    heightCss: number,
  ): void {
    const el = this.labels.get(id);
    if (!el) return;
    if (!renderKm || !sceneKm || occludedBySphere(cameraKm, sceneKm, bodyRadiusKm)) {
      el.hidden = true;
      return;
    }
    this.v.set(renderKm[0], renderKm[1], renderKm[2]).project(camera);
    if (this.v.z > 1 || Math.abs(this.v.x) > 1.05 || Math.abs(this.v.y) > 1.05) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const x = ((this.v.x + 1) / 2) * widthCss;
    const y = ((1 - this.v.y) / 2) * heightCss;
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }

  /** Screen position (CSS px) of a visible label's anchor, for picking. */
  anchor(id: string): { x: number; y: number } | undefined {
    const el = this.labels.get(id);
    if (!el || el.hidden) return undefined;
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : undefined;
  }

  dispose(): void {
    this.element.remove();
    this.labels.clear();
  }
}
