import { EARTH_EQUATORIAL_RADIUS_KM } from '../astro/constants';
import { BodyMesh } from './BodyMesh';
import type { Renderer } from './Renderer';
import { loadProgressiveTexture } from './textures';

/** Textured Earth with city lights and a thin atmosphere (used by the Earth view and seen from the Moon). */
export function createEarthMesh(renderer: Renderer, baseUrl: string): BodyMesh {
  const anisotropy = renderer.renderer.capabilities.getMaxAnisotropy();
  const load = (name: 'day' | 'night', placeholderRgb: [number, number, number]) =>
    loadProgressiveTexture({
      baseUrl,
      body: 'earth',
      name,
      maxTextureSize: renderer.maxTextureSize,
      anisotropy,
      placeholderRgb,
      // Called asynchronously, after `mesh` is assigned.
      onUpdate: (tex) => (name === 'day' ? mesh.setDayMap(tex) : mesh.setNightMap(tex)),
    });
  const mesh: BodyMesh = new BodyMesh({
    name: 'earth',
    radiusKm: EARTH_EQUATORIAL_RADIUS_KM,
    dayMap: load('day', [22, 52, 110]),
    nightMap: load('night', [0, 0, 0]),
    nightStrength: 1.4,
    ambient: 0.06,
    atmosphereColor: [0.25, 0.45, 1.0],
    atmosphereStrength: 0.6,
  });
  return mesh;
}
