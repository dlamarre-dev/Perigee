import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { emptyGrid, markPoint, markTriangle, segmentBlocked } from '../src/render/voxelGrid';

describe('voxel occupancy grid', () => {
  // 10 m cube, 1 m cells, one occupied cell at the centre.
  const grid = (): ReturnType<typeof emptyGrid> => {
    const g = emptyGrid([0, 0, 0], [10, 10, 10], 10);
    markPoint(g, 5.5, 5.5, 5.5);
    return g;
  };

  it('blocks a segment crossing an occupied cell', () => {
    expect(segmentBlocked(grid(), [-20, 5.5, 5.5], [30, 5.5, 5.5])).toBe(true);
    expect(segmentBlocked(grid(), [-20, -20, -20], [30, 30, 30])).toBe(true);
  });

  it('lets through segments that miss it or stop before it', () => {
    expect(segmentBlocked(grid(), [-20, 2.5, 5.5], [30, 2.5, 5.5])).toBe(false);
    expect(segmentBlocked(grid(), [-20, 5.5, 5.5], [3, 5.5, 5.5])).toBe(false);
    expect(segmentBlocked(grid(), [-20, 50, 5.5], [30, 50, 5.5])).toBe(false);
  });

  it('blocks a point far behind the model (a planet seen past a probe)', () => {
    expect(segmentBlocked(grid(), [-20, 5.5, 5.5], [3e13, 5.5, 5.5])).toBe(true);
    expect(segmentBlocked(grid(), [-20, 5.5, 5.5], [3e13, 4e12, 5.5])).toBe(false);
  });

  it('does not hide a point by the cell holding it', () => {
    expect(segmentBlocked(grid(), [-20, 5.5, 5.5], [5.6, 5.5, 5.5])).toBe(false);
  });

  it('marks every cell a triangle crosses', () => {
    const g = emptyGrid([0, 0, 0], [10, 10, 10], 10);
    markTriangle(g, new Vector3(0, 0, 5), new Vector3(10, 0, 5), new Vector3(0, 10, 5));
    // A ray along z through the triangle's half is blocked, through the other half not.
    expect(segmentBlocked(g, [2.5, 2.5, -10], [2.5, 2.5, 20])).toBe(true);
    expect(segmentBlocked(g, [8.5, 8.5, -10], [8.5, 8.5, 20])).toBe(false);
  });
});
