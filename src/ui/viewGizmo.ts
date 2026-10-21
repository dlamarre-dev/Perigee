/**
 * Axis gizmo of the star map (like the scene gizmo of 3D editors): three axes and their opposites as the camera
 * sees them, drawn on a small 2D canvas in the map's top-right corner. A click on an axis end looks along that axis
 * (from its side); the button under it switches between perspective and orthographic projection.
 */
import { quatConjugate, quatRotate, type Quat } from '../astro/quat';
import type { Vec3 } from '../astro/vec3';
import { h } from './dom';

export interface GizmoAxis {
  /** One or two letters drawn on the positive end (the negative end stays unlabelled). */
  readonly label: string;
  /** Unit direction, in the scene's frame. */
  readonly dir: Vec3;
  readonly color: string;
}

/** An axis end: the axis, and whether the camera looks from its positive side. */
export interface GizmoEnd {
  readonly axis: GizmoAxis;
  readonly positive: boolean;
}

const SIZE_PX = 96;
const ARM_PX = 32;
const END_R_PX = 9;

export class ViewGizmo {
  readonly element: HTMLElement;
  private readonly canvas = h('canvas', { class: 'view-gizmo-canvas' });
  readonly toggle = h('button', { type: 'button', class: 'btn view-gizmo-toggle' });
  private ends: { end: GizmoEnd; x: number; y: number }[] = [];
  private drawnKey = '';

  constructor(
    private readonly axes: readonly GizmoAxis[],
    private readonly titleOf: (end: GizmoEnd) => string,
    onEnd: (end: GizmoEnd) => void,
    onToggle: () => void,
  ) {
    this.element = h('div', { class: 'view-gizmo' }, [this.canvas, this.toggle]);
    this.canvas.addEventListener('click', (e) => {
      const hit = this.endAt(e);
      if (hit) onEnd(hit);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const hit = this.endAt(e);
      this.canvas.style.cursor = hit ? 'pointer' : 'default';
      this.canvas.title = hit ? this.titleOf(hit) : '';
    });
    // The map behind must not turn or pick through the gizmo.
    for (const type of ['pointerdown', 'click', 'dblclick', 'wheel'] as const)
      this.element.addEventListener(type, (e) => e.stopPropagation());
    this.toggle.addEventListener('click', onToggle);
  }

  private endAt(e: MouseEvent): GizmoEnd | undefined {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    // Front ends are drawn last: they win a tie.
    for (let i = this.ends.length - 1; i >= 0; i--) {
      const p = this.ends[i];
      if (p && Math.hypot(p.x - x, p.y - y) <= END_R_PX + 2) return p.end;
    }
    return undefined;
  }

  /** Redraws for this camera orientation (only when it changed); `toggleText` names the other projection. */
  draw(orientation: Quat, toggleText: string, toggleTitle: string): void {
    if (this.toggle.textContent !== toggleText) this.toggle.textContent = toggleText;
    if (this.toggle.title !== toggleTitle) {
      this.toggle.title = toggleTitle;
      this.toggle.setAttribute('aria-label', toggleTitle);
    }
    const key = [orientation.x, orientation.y, orientation.z, orientation.w]
      .map((v) => v.toFixed(4))
      .join(',');
    if (key === this.drawnKey) return;
    this.drawnKey = key;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const c = this.canvas;
    if (c.width !== SIZE_PX * ratio) {
      c.width = c.height = SIZE_PX * ratio;
      c.style.width = c.style.height = `${SIZE_PX}px`;
    }
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.clearRect(0, 0, SIZE_PX, SIZE_PX);
    const toCamera = quatConjugate(orientation);
    const centre = SIZE_PX / 2;
    const placed = this.axes
      .flatMap((axis) =>
        [true, false].map((positive) => {
          const d = quatRotate(toCamera, positive ? axis.dir : [-axis.dir[0], -axis.dir[1], -axis.dir[2]]);
          return {
            end: { axis, positive },
            x: centre + d[0] * ARM_PX,
            y: centre - d[1] * ARM_PX,
            depth: d[2],
          };
        }),
      )
      // Far ends first (away from the camera: negative z).
      .sort((a, b) => a.depth - b.depth);
    for (const p of placed) {
      const { axis, positive } = p.end;
      if (positive) {
        g.strokeStyle = axis.color;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(centre, centre);
        g.lineTo(p.x, p.y);
        g.stroke();
      }
      g.beginPath();
      g.arc(p.x, p.y, positive ? END_R_PX : END_R_PX - 3, 0, 2 * Math.PI);
      if (positive) {
        g.fillStyle = axis.color;
        g.fill();
        g.fillStyle = '#03121b';
        g.font = '700 10px Rajdhani, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(axis.label, p.x, p.y + 0.5);
      } else {
        g.fillStyle = 'rgb(3 9 16 / 85%)';
        g.fill();
        g.strokeStyle = axis.color;
        g.lineWidth = 1.5;
        g.stroke();
      }
    }
    this.ends = placed.map(({ end, x, y }) => ({ end, x, y }));
  }
}
