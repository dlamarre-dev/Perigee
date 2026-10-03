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
  /** 1 = drawn, 0 = hidden (discarded in the vertex shader). */
  private readonly visible: Float32Array;
  private readonly scratch = new Color();

  constructor(
    readonly count: number,
    sizePx: number,
    options: { depthTest?: boolean } = {},
  ) {
    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3).fill(1);
    this.visible = new Float32Array(count).fill(1);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new BufferAttribute(this.colors, 3));
    geometry.setAttribute('aVisible', new BufferAttribute(this.visible, 1));
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
    // Hidden markers are moved outside the clip volume in the shader. (Moving them "far away" is not enough:
    // with the near plane at metres and the far plane at the Sun, the Float32 projection has an effectively
    // infinite far plane and they all showed up at one point of the sky.)
    this.points.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'attribute float aVisible;\nvoid main() {')
        .replace(
          '#include <project_vertex>',
          '#include <project_vertex>\n  if (aVisible < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);',
        );
    };
  }

  setPosition(i: number, x: number, y: number, z: number): void {
    this.visible[i] = 1;
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
  }

  /** Not drawn until its next setPosition. */
  hide(i: number): void {
    this.visible[i] = 0;
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
    this.points.geometry.getAttribute('aVisible').needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
