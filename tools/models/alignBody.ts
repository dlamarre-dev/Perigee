/**
 * Natural-body models (Phobos, Deimos): the NASA meshes come in an undocumented frame and unit. Their axes are
 * found by matching the mesh to P. Thomas's PDS radius grid (IAU body frame: x towards the prime meridian,
 * z north; west longitudes): among the 24 axis-aligned rotations, the one whose binned radii best fit the grid
 * (after a common scale) wins. The mesh is then baked into that frame, in metres.
 */
import type { Document, mat4 } from '@gltf-transform/core';

type M3 = [number, number, number, number, number, number, number, number, number];

/** The 24 proper rotations mapping axes to (signed) axes. */
function axisRotations(): M3[] {
  const perms = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ];
  const out: M3[] = [];
  for (const p of perms) {
    for (let signs = 0; signs < 8; signs++) {
      const m: M3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (let row = 0; row < 3; row++) m[row * 3 + (p[row] ?? 0)] = signs & (1 << row) ? -1 : 1;
      const det =
        m[0] * (m[4] * m[8] - m[5] * m[7]) -
        m[1] * (m[3] * m[8] - m[5] * m[6]) +
        m[2] * (m[3] * m[7] - m[4] * m[6]);
      if (det > 0) out.push(m);
    }
  }
  return out;
}

/** Radius grid "lat lon radius" (km, longitude positive west) → lookup by (lat, east lon) cell. */
export function parseThomasGrid(text: string): {
  stepDeg: number;
  radiusKm: (latDeg: number, lonEastDeg: number) => number;
} {
  const rows: [number, number, number][] = [];
  for (const line of text.split(/\r?\n/)) {
    const p = line.trim().split(/\s+/).map(Number);
    if (p.length >= 3 && p.every((v) => !Number.isNaN(v))) rows.push([p[0] ?? 0, p[1] ?? 0, p[2] ?? 0]);
  }
  const lons = [...new Set(rows.map((r) => r[1]))].sort((a, b) => a - b);
  const stepDeg = (lons[1] ?? 0) - (lons[0] ?? 0) || 5;
  const map = new Map<string, number>();
  for (const [lat, lonW, r] of rows)
    map.set(`${Math.round(lat)}|${Math.round(((-lonW % 360) + 360) % 360)}`, r);
  return {
    stepDeg,
    radiusKm: (lat, lonE) => {
      const la = Math.round(lat / stepDeg) * stepDeg;
      const lo = (((Math.round(lonE / stepDeg) * stepDeg) % 360) + 360) % 360;
      return map.get(`${la}|${lo}`) ?? Number.NaN;
    },
  };
}

/** Vertex positions in model space (node transforms applied). */
function worldPositions(doc: Document): number[][] {
  const out: number[][] = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const w = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        const [x, y, z] = [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
        out.push([
          (w[0] ?? 1) * x + (w[4] ?? 0) * y + (w[8] ?? 0) * z + (w[12] ?? 0),
          (w[1] ?? 0) * x + (w[5] ?? 1) * y + (w[9] ?? 0) * z + (w[13] ?? 0),
          (w[2] ?? 0) * x + (w[6] ?? 0) * y + (w[10] ?? 1) * z + (w[14] ?? 0),
        ]);
      }
    }
  }
  return out;
}

/**
 * Best axis rotation and scale (model units → km) against the grid, with the fit residual (km RMS).
 * Returned as a column-major 4×4 matrix for transformMesh (rotation then scale to metres).
 */
export function alignToGrid(
  doc: Document,
  gridText: string,
): { matrix: mat4; rmsKm: number; scaleKmPerUnit: number } {
  const grid = parseThomasGrid(gridText);
  const verts = worldPositions(doc);
  // Centre of the vertices (the mesh may not be centred on the body centre).
  const c = [0, 1, 2].map((k) => verts.reduce((a, v) => a + (v[k] ?? 0), 0) / Math.max(1, verts.length));
  let best = { m: axisRotations()[0] as M3, rms: Infinity, s: 1 };
  for (const m of axisRotations()) {
    const cells = new Map<string, number>();
    for (const v of verts) {
      const x0 = (v[0] ?? 0) - (c[0] ?? 0);
      const y0 = (v[1] ?? 0) - (c[1] ?? 0);
      const z0 = (v[2] ?? 0) - (c[2] ?? 0);
      const x = m[0] * x0 + m[1] * y0 + m[2] * z0;
      const y = m[3] * x0 + m[4] * y0 + m[5] * z0;
      const z = m[6] * x0 + m[7] * y0 + m[8] * z0;
      const r = Math.hypot(x, y, z);
      if (r === 0) continue;
      const lat = Math.round((Math.asin(z / r) * 180) / Math.PI / grid.stepDeg) * grid.stepDeg;
      const lon =
        (((Math.round((Math.atan2(y, x) * 180) / Math.PI / grid.stepDeg) * grid.stepDeg) % 360) + 360) % 360;
      const key = `${lat}|${lon}`;
      cells.set(key, Math.max(cells.get(key) ?? 0, r));
    }
    const pairs: [number, number][] = [];
    for (const [key, r] of cells) {
      const [lat, lon] = key.split('|').map(Number);
      const ref = grid.radiusKm(lat ?? 0, lon ?? 0);
      if (Number.isFinite(ref) && Math.abs(lat ?? 0) < 80) pairs.push([r, ref]);
    }
    if (pairs.length < 50) continue;
    const ratios = pairs.map(([r, ref]) => ref / r).sort((a, b) => a - b);
    const s = ratios[ratios.length >> 1] ?? 1;
    const rms = Math.sqrt(pairs.reduce((a, [r, ref]) => a + (r * s - ref) ** 2, 0) / pairs.length);
    if (rms < best.rms) best = { m, rms, s };
  }
  const k = best.s * 1000; // model units → metres
  const m = best.m;
  // Translation: recentre on the vertex centroid before rotating.
  const t = [0, 1, 2].map(
    (row) =>
      -k *
      ((m[row * 3] ?? 0) * (c[0] ?? 0) +
        (m[row * 3 + 1] ?? 0) * (c[1] ?? 0) +
        (m[row * 3 + 2] ?? 0) * (c[2] ?? 0)),
  );
  const matrix: mat4 = [
    k * m[0],
    k * m[3],
    k * m[6],
    0,
    k * m[1],
    k * m[4],
    k * m[7],
    0,
    k * m[2],
    k * m[5],
    k * m[8],
    0,
    t[0] ?? 0,
    t[1] ?? 0,
    t[2] ?? 0,
    1,
  ];
  return { matrix, rmsKm: best.rms, scaleKmPerUnit: best.s };
}
