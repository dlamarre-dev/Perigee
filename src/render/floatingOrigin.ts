/**
 * Camera-relative rendering (CLAUDE.md §5.4). Positions are kept in Float64 km on the CPU; before reaching
 * the GPU (Float32) the camera position is subtracted, so precision is spent where the viewer is.
 * The Three.js camera therefore always sits at the render-space origin.
 */
import type { Vector3 } from 'three';
import type { Vec3 } from '../astro/vec3';

/** out ← positionKm − originKm (computed in Float64, stored in Three's Vector3). */
export function toRenderSpace(positionKm: Vec3, originKm: Vec3, out: Vector3): Vector3 {
  return out.set(positionKm[0] - originKm[0], positionKm[1] - originKm[1], positionKm[2] - originKm[2]);
}

/** Batched version for packed xyz buffers (e.g. satellite positions in M1). */
export function writeRenderSpace(positionsKm: Float64Array, originKm: Vec3, out: Float32Array): void {
  const [ox, oy, oz] = originKm;
  for (let i = 0; i + 2 < positionsKm.length; i += 3) {
    out[i] = (positionsKm[i] ?? 0) - ox;
    out[i + 1] = (positionsKm[i + 1] ?? 0) - oy;
    out[i + 2] = (positionsKm[i + 2] ?? 0) - oz;
  }
}
