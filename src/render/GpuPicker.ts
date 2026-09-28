/**
 * GPU picking by ID (CLAUDE.md §7): renders the pick layer into a tiny off-screen target centred on the
 * pointer, reads it back, and returns the encoded index nearest to the centre. No raycasting over 15k points.
 */
import {
  Color,
  NearestFilter,
  UnsignedByteType,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { pickRadiusPx } from './pointer';
import { applyViewInset } from './viewInset';
import { PICK_LAYER, decodePickId } from './SatellitePoints';

// Odd size, centred on the pointer; larger for touch.
const REGION_PX = pickRadiusPx(11) | 1;

export class GpuPicker {
  private readonly target = new WebGLRenderTarget(REGION_PX, REGION_PX, {
    type: UnsignedByteType,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthBuffer: true,
  });
  private readonly pixels = new Uint8Array(REGION_PX * REGION_PX * 4);
  private readonly savedClear = new Color();

  constructor(private readonly renderer: WebGLRenderer) {}

  /** Coordinates in CSS pixels relative to the canvas. */
  pick(scene: Scene, camera: PerspectiveCamera, xCss: number, yCss: number): number | undefined {
    const canvas = this.renderer.domElement;
    const half = Math.floor(REGION_PX / 2);
    applyViewInset(camera, canvas.clientWidth, canvas.clientHeight, {
      x: Math.round(xCss) - half,
      y: Math.round(yCss) - half,
      width: REGION_PX,
      height: REGION_PX,
    });
    const previousTarget = this.renderer.getRenderTarget();
    const previousAlpha = this.renderer.getClearAlpha();
    this.renderer.getClearColor(this.savedClear);
    camera.layers.set(PICK_LAYER);
    try {
      this.renderer.setRenderTarget(this.target);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear();
      this.renderer.render(scene, camera);
      this.renderer.readRenderTargetPixels(this.target, 0, 0, REGION_PX, REGION_PX, this.pixels);
    } finally {
      camera.layers.set(0);
      applyViewInset(camera, canvas.clientWidth, canvas.clientHeight);
      this.renderer.setRenderTarget(previousTarget);
      this.renderer.setClearColor(this.savedClear, previousAlpha);
    }
    return nearestId(this.pixels, REGION_PX);
  }

  dispose(): void {
    this.target.dispose();
  }
}

/** Index of the non-background pixel closest to the centre of a size×size RGBA block. */
export function nearestId(pixels: Uint8Array, size: number): number | undefined {
  const c = (size - 1) / 2;
  let best: number | undefined;
  let bestD2 = Infinity;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      const id = decodePickId(pixels[o] ?? 0, pixels[o + 1] ?? 0, pixels[o + 2] ?? 0);
      if (id === undefined) continue;
      const d2 = (x - c) ** 2 + (y - c) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = id;
      }
    }
  }
  return best;
}
