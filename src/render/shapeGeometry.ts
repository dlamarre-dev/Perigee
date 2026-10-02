/**
 * Irregular small moons (Amalthea, Hyperion, Phoebe, Proteus…): the body sphere is displaced radially by a
 * planetocentric radius grid (public/shapes/<id>.json, written by tools/shapes/fetch-shapes.ts from PDS shape
 * models). The UVs stay those of the sphere, so the equirectangular surface maps keep matching latitude and
 * longitude.
 */
import type { BufferGeometry } from 'three';

export interface ShapeGrid {
  readonly id: string;
  readonly stepDeg: number;
  /** Rows from latitude −90° to +90°. */
  readonly nLat: number;
  /** Columns from east longitude 0° (included) to 360° (excluded). */
  readonly nLon: number;
  readonly radiiKm: readonly number[];
  readonly credit: string;
}

/** Radius (km) at a planetocentric direction, bilinear in latitude and longitude. */
export function shapeRadiusKm(grid: ShapeGrid, latRad: number, lonEastRad: number): number {
  const latDeg = (latRad * 180) / Math.PI;
  const lonDeg = ((((lonEastRad * 180) / Math.PI) % 360) + 360) % 360;
  const fi = Math.min(grid.nLat - 1, Math.max(0, (latDeg + 90) / grid.stepDeg));
  const fj = lonDeg / grid.stepDeg;
  const i0 = Math.min(grid.nLat - 2, Math.floor(fi));
  const j0 = Math.floor(fj) % grid.nLon;
  const j1 = (j0 + 1) % grid.nLon;
  const ti = fi - i0;
  const tj = fj - Math.floor(fj);
  const r = (i: number, j: number): number => grid.radiiKm[i * grid.nLon + j] ?? 0;
  const a = r(i0, j0) * (1 - tj) + r(i0, j1) * tj;
  const b = r(i0 + 1, j0) * (1 - tj) + r(i0 + 1, j1) * tj;
  return a * (1 - ti) + b * ti;
}

/**
 * Displaces a body sphere (pole on +Z, prime meridian on +X, see BodyMesh) to the shape, in place, and
 * recomputes smooth normals (shared across the UV seam so it does not show in the lighting).
 */
export function applyShape(geometry: BufferGeometry, grid: ShapeGrid): void {
  const pos = geometry.getAttribute('position');
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k);
    const y = pos.getY(k);
    const z = pos.getZ(k);
    const len = Math.hypot(x, y, z) || 1;
    const r = shapeRadiusKm(grid, Math.asin(Math.max(-1, Math.min(1, z / len))), Math.atan2(y, x));
    pos.setXYZ(k, (x / len) * r, (y / len) * r, (z / len) * r);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  // Vertices duplicated along the seam and at the poles: average their normals.
  const normal = geometry.getAttribute('normal');
  const groups = new Map<string, number[]>();
  for (let k = 0; k < pos.count; k++) {
    const key = `${pos.getX(k).toFixed(3)},${pos.getY(k).toFixed(3)},${pos.getZ(k).toFixed(3)}`;
    const list = groups.get(key);
    if (list) list.push(k);
    else groups.set(key, [k]);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (const k of list) {
      nx += normal.getX(k);
      ny += normal.getY(k);
      nz += normal.getZ(k);
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    for (const k of list) normal.setXYZ(k, nx / l, ny / l, nz / l);
  }
  normal.needsUpdate = true;
  geometry.computeBoundingSphere();
}

const cache = new Map<string, Promise<ShapeGrid | undefined>>();

/** Fetches public/shapes/<id>.json once (undefined when missing). */
export function loadShape(baseUrl: string, id: string): Promise<ShapeGrid | undefined> {
  let p = cache.get(id);
  if (!p) {
    p = fetch(`${baseUrl}shapes/${id}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<ShapeGrid>) : undefined))
      .catch(() => undefined);
    cache.set(id, p);
  }
  return p;
}
