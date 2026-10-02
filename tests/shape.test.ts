import { SphereGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { applyShape, shapeRadiusKm, type ShapeGrid } from '../src/render/shapeGeometry';

/** Triaxial ellipsoid sampled on a 5° grid. */
function ellipsoidGrid(a: number, b: number, c: number): ShapeGrid {
  const step = 5;
  const nLat = 37;
  const nLon = 72;
  const radiiKm: number[] = [];
  for (let i = 0; i < nLat; i++) {
    for (let j = 0; j < nLon; j++) {
      const lat = ((-90 + i * step) * Math.PI) / 180;
      const lon = (j * step * Math.PI) / 180;
      const d = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
      radiiKm.push(
        1 / Math.sqrt((d[0] ?? 0) ** 2 / a ** 2 + (d[1] ?? 0) ** 2 / b ** 2 + (d[2] ?? 0) ** 2 / c ** 2),
      );
    }
  }
  return { id: 'test', stepDeg: step, nLat, nLon, radiiKm, credit: '' };
}

describe('shape grids', () => {
  const grid = ellipsoidGrid(125, 73, 64);

  it('interpolates the radius at grid points and across the 0/360° seam', () => {
    expect(shapeRadiusKm(grid, 0, 0)).toBeCloseTo(125, 6);
    expect(shapeRadiusKm(grid, 0, Math.PI / 2)).toBeCloseTo(73, 6);
    expect(shapeRadiusKm(grid, Math.PI / 2, 0)).toBeCloseTo(64, 6);
    expect(shapeRadiusKm(grid, 0, -0.01)).toBeCloseTo(shapeRadiusKm(grid, 0, 2 * Math.PI - 0.01), 9);
  });

  it('displaces a body sphere (pole +Z, prime meridian +X) to the shape', () => {
    const g = new SphereGeometry(83, 96, 48);
    g.rotateX(Math.PI / 2);
    applyShape(g, grid);
    g.computeBoundingBox();
    const box = g.boundingBox;
    expect(box?.max.x).toBeCloseTo(125, 0);
    expect(box?.max.y).toBeCloseTo(73, 0);
    expect(box?.max.z).toBeCloseTo(64, 0);
    // Normals stay unit length.
    const n = g.getAttribute('normal');
    for (let k = 0; k < n.count; k += 97)
      expect(Math.hypot(n.getX(k), n.getY(k), n.getZ(k))).toBeCloseTo(1, 6);
  });
});
