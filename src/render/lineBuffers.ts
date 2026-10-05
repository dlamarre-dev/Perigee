/**
 * Lines rebuilt often (selected orbit, trajectories, moon orbits): writing a new BufferAttribute each time
 * allocates a new GL buffer and leaves the old one to linger until the geometry is disposed. The positions are
 * copied in place when their length is unchanged (the usual case), otherwise the line gets a fresh geometry
 * and the old one is disposed.
 */
import { BufferAttribute, BufferGeometry } from 'three';

export function setLinePositions(line: { geometry: BufferGeometry }, positions: ArrayLike<number>): void {
  const attr = line.geometry.getAttribute('position') as BufferAttribute | undefined;
  if (attr && attr.array.length === positions.length) {
    (attr.array as Float32Array).set(positions);
    attr.needsUpdate = true;
    return;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3));
  line.geometry.dispose();
  line.geometry = geometry;
}
