/**
 * A small set of round, screen-sized markers (missions, landing sites). Positions and colours are updated
 * from the CPU; uses PointsMaterial so logarithmic depth and colour management come for free.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Points,
  PointsMaterial,
  type Texture,
} from 'three';

let discTexture: Texture | undefined;

/** Anti-aliased white disc with a dark outline, shared by all marker sets. */
function disc(): Texture {
  if (discTexture) return discTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.stroke();
  }
  discTexture = new CanvasTexture(canvas);
  return discTexture;
}

export class MarkerPoints {
  readonly points: Points<BufferGeometry, PointsMaterial>;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly scratch = new Color();

  constructor(
    readonly count: number,
    sizePx: number,
    options: { depthTest?: boolean } = {},
  ) {
    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3).fill(1);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new BufferAttribute(this.colors, 3));
    this.points = new Points(
      geometry,
      new PointsMaterial({
        size: sizePx,
        sizeAttenuation: false,
        vertexColors: true,
        map: disc(),
        alphaTest: 0.5,
        depthTest: options.depthTest ?? true,
      }),
    );
    this.points.frustumCulled = false;
  }

  setPosition(i: number, x: number, y: number, z: number): void {
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
  }

  /** Moves a marker far away so it is not drawn (clipped). */
  hide(i: number): void {
    this.setPosition(i, 1e12, 1e12, 1e12);
  }

  setColor(i: number, css: string, brightness = 1): void {
    this.scratch.set(css).multiplyScalar(brightness);
    this.colors[i * 3] = this.scratch.r;
    this.colors[i * 3 + 1] = this.scratch.g;
    this.colors[i * 3 + 2] = this.scratch.b;
  }

  /** Call after a batch of setPosition / setColor. */
  commit(): void {
    this.points.geometry.getAttribute('position').needsUpdate = true;
    this.points.geometry.getAttribute('color').needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
