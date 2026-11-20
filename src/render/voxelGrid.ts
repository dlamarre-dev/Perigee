/**
 * Coarse occupancy grid of a 3D model, for cheap occlusion tests (markers and labels behind the selected
 * object's model): built once when the model loads, then each test walks the cells along one segment
 * (Amanatides–Woo traversal) instead of testing every triangle. Cells are conservative (a cell touched by a
 * triangle is full), so the mask is slightly larger than the mesh, by up to one cell.
 */
import { Vector3, type BufferGeometry, type Mesh, type Object3D } from 'three';

export interface VoxelGrid {
  /** Lower corner (model frame, metres). */
  readonly min: readonly [number, number, number];
  /** Cubic cell edge (metres). */
  readonly cell: number;
  readonly n: readonly [number, number, number];
  /** 1 = occupied; index x + nx·(y + ny·z). */
  readonly occupied: Uint8Array;
}

/** Cells along the model's largest dimension. */
const CELLS = 32;
/** Samples per triangle edge at most (large triangles: the dish of an antenna). */
const MAX_SAMPLES = 96;

/** Empty grid over a box (metres), `cells` along its largest side. */
export function emptyGrid(
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  cells = CELLS,
): VoxelGrid {
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1e-6);
  const cell = extent / cells;
  const count = (i: 0 | 1 | 2): number => Math.max(1, Math.ceil((max[i] - min[i]) / cell));
  const n: [number, number, number] = [count(0), count(1), count(2)];
  return { min, cell, n, occupied: new Uint8Array(n[0] * n[1] * n[2]) };
}

/** Marks the cell holding a point (ignored outside the grid). */
export function markPoint(g: VoxelGrid, x: number, y: number, z: number): void {
  const i = Math.floor((x - g.min[0]) / g.cell);
  const j = Math.floor((y - g.min[1]) / g.cell);
  const k = Math.floor((z - g.min[2]) / g.cell);
  // Points on the upper faces belong to the last cell.
  const ci = Math.min(i, g.n[0] - 1);
  const cj = Math.min(j, g.n[1] - 1);
  const ck = Math.min(k, g.n[2] - 1);
  if (ci < 0 || cj < 0 || ck < 0) return;
  g.occupied[ci + g.n[0] * (cj + g.n[1] * ck)] = 1;
}

/** Marks every cell a triangle crosses, by sampling it finer than half a cell. */
export function markTriangle(g: VoxelGrid, a: Vector3, b: Vector3, c: Vector3): void {
  const edge = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
  const steps = Math.min(MAX_SAMPLES, Math.max(1, Math.ceil(edge / (g.cell * 0.5))));
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps - i; j++) {
      const u = i / steps;
      const v = j / steps;
      markPoint(
        g,
        a.x + (b.x - a.x) * u + (c.x - a.x) * v,
        a.y + (b.y - a.y) * u + (c.y - a.y) * v,
        a.z + (b.z - a.z) * u + (c.z - a.z) * v,
      );
    }
  }
}

/**
 * Grid of a loaded model not yet added to the scene, in the frame its bounds were taken in (its parts' world
 * matrices, the root's own transform included).
 */
export function voxelize(
  root: Object3D,
  min: [number, number, number],
  max: [number, number, number],
): VoxelGrid {
  const g = emptyGrid(min, max);
  root.updateMatrixWorld(true);
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry as BufferGeometry;
    const position = geometry.getAttribute('position');
    if (!position) return;
    const toRoot = mesh.matrixWorld;
    const index = geometry.getIndex();
    const count = index ? index.count : position.count;
    for (let t = 0; t + 2 < count; t += 3) {
      const ia = index ? index.getX(t) : t;
      const ib = index ? index.getX(t + 1) : t + 1;
      const ic = index ? index.getX(t + 2) : t + 2;
      a.fromBufferAttribute(position, ia).applyMatrix4(toRoot);
      b.fromBufferAttribute(position, ib).applyMatrix4(toRoot);
      c.fromBufferAttribute(position, ic).applyMatrix4(toRoot);
      markTriangle(g, a, b, c);
    }
  });
  return g;
}

/** Clips the segment's parameter range to the slab lo..hi of one axis; undefined when it misses. */
function clipAxis(
  from: number,
  delta: number,
  lo: number,
  hi: number,
  range: readonly [number, number],
): [number, number] | undefined {
  if (Math.abs(delta) < 1e-12) return from < lo || from > hi ? undefined : [range[0], range[1]];
  const a = (lo - from) / delta;
  const b = (hi - from) / delta;
  const t0 = Math.max(range[0], Math.min(a, b));
  const t1 = Math.min(range[1], Math.max(a, b));
  return t0 < t1 ? [t0, t1] : undefined;
}

/** One axis of the traversal: current cell, step, parameter of the next boundary and per cell, final cell. */
interface Axis {
  cell: number;
  tMax: number;
  readonly last: number;
  readonly step: number;
  readonly tDelta: number;
  readonly end: number;
}

function axis(g: VoxelGrid, from: number, delta: number, i: 0 | 1 | 2, tStart: number): Axis {
  const n = g.n[i];
  const lo = g.min[i];
  const cellAt = (t: number): number =>
    Math.min(n - 1, Math.max(0, Math.floor((from + delta * t - lo) / g.cell)));
  const cell = cellAt(tStart);
  const step = delta > 0 ? 1 : delta < 0 ? -1 : 0;
  const boundary = lo + (cell + (step > 0 ? 1 : 0)) * g.cell;
  return {
    cell,
    tMax: step === 0 ? Infinity : (boundary - from) / delta,
    last: n - 1,
    step,
    tDelta: step === 0 ? Infinity : g.cell / Math.abs(delta),
    end: cellAt(1),
  };
}

/**
 * True when the segment from `from` to `to` (model frame, metres) crosses an occupied cell before reaching `to`.
 * The cell holding `to` itself does not count: a point on the model is not hidden by its own surface.
 */
export function segmentBlocked(
  g: VoxelGrid,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
): boolean {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const top = (i: 0 | 1 | 2): number => g.min[i] + g.n[i] * g.cell;
  let range = clipAxis(from[0], dx, g.min[0], top(0), [0, 1]);
  if (range) range = clipAxis(from[1], dy, g.min[1], top(1), range);
  if (range) range = clipAxis(from[2], dz, g.min[2], top(2), range);
  if (!range) return false;
  const tExit = range[1];
  // Nudged inside the grid relative to its span along the segment: a point billions of km away (a planet seen past
  // a probe) puts the whole grid within t ≈ 1e-12, so a fixed epsilon would skip it.
  const tStart = range[0] + (tExit - range[0]) * 1e-6;
  const x = axis(g, from[0], dx, 0, tStart);
  const y = axis(g, from[1], dy, 1, tStart);
  const z = axis(g, from[2], dz, 2, tStart);
  const limit = g.n[0] + g.n[1] + g.n[2] + 3;
  for (let s = 0; s < limit; s++) {
    if (tExit >= 1 && x.cell === x.end && y.cell === y.end && z.cell === z.end) return false;
    if (g.occupied[x.cell + g.n[0] * (y.cell + g.n[1] * z.cell)]) return true;
    const a = x.tMax < y.tMax ? (x.tMax < z.tMax ? x : z) : y.tMax < z.tMax ? y : z;
    if (a.tMax > tExit) return false;
    const next = a.cell + a.step;
    if (next < 0 || next > a.last) return false;
    a.cell = next;
    a.tMax += a.tDelta;
  }
  return false;
}
