/**
 * DOM labels for a handful of objects (missions, sites), placed each frame by projecting scene-frame positions,
 * with collision avoidance:
 * - labels are laid out by priority (selected > objects in orbit > ground sites); each tries four positions
 *   around its anchor and is hidden when none is free;
 * - low-priority labels also avoid obstacles (e.g. the markers of orbiting objects);
 * - hysteresis prevents flicker: a label keeps its position while it fits, and a hidden label only comes back
 *   after staying free for several consecutive frames.
 * Labels behind the camera, off-screen or occluded by the central body (ray–sphere test) are hidden.
 */
import { Vector3, type PerspectiveCamera } from 'three';
import { dot, sub, type Vec3 } from '../astro/vec3';

export interface LabelItem {
  readonly id: string;
  readonly text: string;
  readonly className?: string;
}

/** Priorities used by the views. */
export const LabelPriority = { Site: 10, Orbiting: 50, Selected: 100 } as const;

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

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export function rectsOverlap(a: Rect, b: Rect, margin = 2): boolean {
  return (
    a.x < b.x + b.w + margin &&
    b.x < a.x + a.w + margin &&
    a.y < b.y + b.h + margin &&
    b.y < a.y + a.h + margin
  );
}

/** Offsets of the label's top-left corner relative to its anchor: right-below, right-above, left-below, left-above. */
export function candidateRects(ax: number, ay: number, w: number, h: number, gap = 9): Rect[] {
  return [
    { x: ax + gap, y: ay + gap * 0.4, w, h },
    { x: ax + gap, y: ay - h - gap * 0.4, w, h },
    { x: ax - w - gap, y: ay + gap * 0.4, w, h },
    { x: ax - w - gap, y: ay - h - gap * 0.4, w, h },
  ];
}

interface LabelState {
  offset: number;
  shown: boolean;
  freeFrames: number;
}

interface Candidate {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly priority: number;
  readonly order: number;
}

/** Frames a hidden label must stay unobstructed before it reappears. */
const SHOW_AFTER_FREE_FRAMES = 10;

export interface LayoutInput {
  readonly id: string;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly w: number;
  readonly h: number;
  readonly priority: number;
}

export interface LayoutResult {
  readonly id: string;
  readonly rect: Rect | undefined;
}

/**
 * Pure layout step (exported for tests): greedy placement by priority with hysteresis.
 * `states` is mutated to carry offsets and visibility across frames.
 */
export function layoutLabels(
  inputs: readonly LayoutInput[],
  obstacles: readonly (Rect & { readonly priority: number })[],
  states: Map<string, LabelState>,
  widthCss: number,
  heightCss: number,
): LayoutResult[] {
  const sorted = inputs
    .map((input, order) => ({ input, order }))
    .sort((a, b) => b.input.priority - a.input.priority || a.order - b.order);
  const placed: Rect[] = [];
  const results: LayoutResult[] = [];
  for (const { input } of sorted) {
    let state = states.get(input.id);
    if (!state) {
      state = { offset: 0, shown: false, freeFrames: SHOW_AFTER_FREE_FRAMES };
      states.set(input.id, state);
    }
    const rects = candidateRects(input.anchorX, input.anchorY, input.w, input.h);
    const order = [state.offset, ...[0, 1, 2, 3].filter((i) => i !== state.offset)];
    const blockers = obstacles.filter((o) => o.priority > input.priority);
    let chosen: number | undefined;
    for (const i of order) {
      const r = rects[i];
      if (!r) continue;
      const onScreen = r.x >= 0 && r.y >= 0 && r.x + r.w <= widthCss && r.y + r.h <= heightCss;
      if (!onScreen) continue;
      if (placed.some((p) => rectsOverlap(p, r)) || blockers.some((b) => rectsOverlap(b, r, 0))) continue;
      chosen = i;
      break;
    }
    if (chosen === undefined) {
      state.shown = false;
      state.freeFrames = 0;
      results.push({ id: input.id, rect: undefined });
      continue;
    }
    if (!state.shown) {
      state.freeFrames++;
      if (state.freeFrames < SHOW_AFTER_FREE_FRAMES) {
        results.push({ id: input.id, rect: undefined });
        continue;
      }
      state.shown = true;
    }
    state.offset = chosen;
    const rect = rects[chosen];
    if (rect) placed.push(rect);
    results.push({ id: input.id, rect });
  }
  return results;
}

export class LabelLayer {
  readonly element: HTMLElement;
  private readonly labels = new Map<string, HTMLElement>();
  private readonly sizes = new Map<string, { w: number; h: number }>();
  private readonly states = new Map<string, LabelState>();
  private candidates: Candidate[] = [];
  private obstacles: (Rect & { priority: number })[] = [];
  private readonly v = new Vector3();

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'label-layer';
    this.element.setAttribute('aria-hidden', 'true');
    // Web fonts change label sizes once loaded.
    void document.fonts?.ready.then(() => this.sizes.clear());
  }

  setItems(items: readonly LabelItem[]): void {
    const keep = new Set(items.map((i) => i.id));
    for (const [id, el] of this.labels) {
      if (!keep.has(id)) {
        el.remove();
        this.labels.delete(id);
        this.sizes.delete(id);
        this.states.delete(id);
      }
    }
    for (const item of items) {
      let el = this.labels.get(item.id);
      if (!el) {
        el = document.createElement('span');
        el.dataset['shown'] = 'false';
        this.labels.set(item.id, el);
        this.element.append(el);
      }
      const className = `label ${item.className ?? ''}`;
      if (el.className !== className || el.textContent !== item.text) {
        el.className = className;
        el.textContent = item.text;
        this.sizes.delete(item.id);
      }
    }
  }

  /** Starts a frame: forget last frame's candidates and obstacles. */
  begin(): void {
    this.candidates = [];
    this.obstacles = [];
  }

  /** Screen-space obstacle (CSS px) that labels of lower priority must not cover. */
  obstacle(xCss: number, yCss: number, radiusPx: number, priority: number): void {
    this.obstacles.push({
      x: xCss - radiusPx,
      y: yCss - radiusPx,
      w: 2 * radiusPx,
      h: 2 * radiusPx,
      priority,
    });
  }

  /** Projects a scene point to CSS pixels, or undefined when hidden (behind, off-screen, occluded). */
  project(
    renderKm: Vec3,
    sceneKm: Vec3,
    camera: PerspectiveCamera,
    cameraKm: Vec3,
    bodyRadiusKm: number,
    widthCss: number,
    heightCss: number,
  ): { x: number; y: number } | undefined {
    if (occludedBySphere(cameraKm, sceneKm, bodyRadiusKm)) return undefined;
    this.v.set(renderKm[0], renderKm[1], renderKm[2]).project(camera);
    if (this.v.z > 1 || Math.abs(this.v.x) > 1.05 || Math.abs(this.v.y) > 1.05) return undefined;
    return { x: ((this.v.x + 1) / 2) * widthCss, y: ((1 - this.v.y) / 2) * heightCss };
  }

  /**
   * Registers a label anchor for this frame. `renderKm` is the point relative to the camera, `sceneKm` the
   * point in the scene frame, `cameraKm` the camera in the scene frame; the body is at the scene origin.
   * Undefined positions hide the label.
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
    priority: number = LabelPriority.Site,
  ): void {
    if (!renderKm || !sceneKm) return;
    const p = this.project(renderKm, sceneKm, camera, cameraKm, bodyRadiusKm, widthCss, heightCss);
    if (p) this.candidates.push({ id, x: p.x, y: p.y, priority, order: this.candidates.length });
  }

  /** Resolves collisions and writes positions. Call once per frame after all `place` calls. */
  layout(widthCss: number, heightCss: number): void {
    const inputs: LayoutInput[] = [];
    for (const c of this.candidates) {
      const size = this.measure(c.id);
      if (size)
        inputs.push({ id: c.id, anchorX: c.x, anchorY: c.y, w: size.w, h: size.h, priority: c.priority });
    }
    const results = new Map(
      layoutLabels(inputs, this.obstacles, this.states, widthCss, heightCss).map((r) => [r.id, r.rect]),
    );
    for (const [id, el] of this.labels) {
      const rect = results.get(id);
      if (!rect) {
        el.dataset['shown'] = 'false';
        // Not a candidate this frame (occluded, off-screen): must earn its way back.
        if (!results.has(id)) {
          const s = this.states.get(id);
          if (s) {
            s.shown = false;
            s.freeFrames = 0;
          }
        }
        continue;
      }
      el.dataset['shown'] = 'true';
      el.style.transform = `translate(${rect.x.toFixed(1)}px, ${rect.y.toFixed(1)}px)`;
    }
  }

  dispose(): void {
    this.element.remove();
    this.labels.clear();
  }

  private measure(id: string): { w: number; h: number } | undefined {
    const cached = this.sizes.get(id);
    if (cached) return cached;
    const el = this.labels.get(id);
    if (!el) return undefined;
    // Labels are always laid out (visibility, not display, hides them), so their size is measurable.
    const size = { w: el.offsetWidth, h: el.offsetHeight };
    if (size.w === 0) return undefined;
    this.sizes.set(id, size);
    return size;
  }
}
