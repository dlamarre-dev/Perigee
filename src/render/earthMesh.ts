import { EARTH_EQUATORIAL_RADIUS_KM } from '../astro/constants';
import { BodyMesh } from './BodyMesh';
import { CloudBaker, CloudLayer, createCloudUniforms, type CloudUniforms } from './clouds';
import { effectEnabled, onEffectsChange } from './effects';
import { quality } from './quality';
import { onSimTime } from './simTime';
import type { Renderer } from './Renderer';
import { placeholderTexture, progressiveTexture } from './textures';

/**
 * Textured Earth with city lights and a thin atmosphere (used by the Earth view and seen from the Moon), plus the
 * illustrative cloud layer on the high quality tier (effect `clouds`; its map loads once the effect is on).
 */
export function createEarthMesh(renderer: Renderer, baseUrl: string): BodyMesh {
  const anisotropy = renderer.renderer.capabilities.getMaxAnisotropy();
  const load = (name: 'day' | 'night' | 'clouds', placeholderRgb: [number, number, number]) =>
    progressiveTexture({
      baseUrl,
      body: 'earth',
      name,
      maxTextureSize: renderer.maxTextureSize,
      anisotropy,
      placeholderRgb,
      // Called asynchronously, after `mesh` is assigned.
      onUpdate: (tex) => {
        if (name === 'day') mesh.setDayMap(tex);
        else if (name === 'night') mesh.setNightMap(tex);
        else if (baker && !disposed) baker.setSource(tex);
        else tex.dispose();
      },
    });
  const day = load('day', [22, 52, 110]);
  const night = load('night', [0, 0, 0]);
  let disposed = false;
  const cloudUniforms: CloudUniforms | undefined = quality().immersiveEffects
    ? createCloudUniforms(placeholderTexture([0, 0, 0], true))
    : undefined;
  const baker = cloudUniforms ? new CloudBaker(renderer.renderer, cloudUniforms) : undefined;
  const mesh: BodyMesh = new BodyMesh({
    name: 'earth',
    radiusKm: EARTH_EQUATORIAL_RADIUS_KM,
    dayMap: day.initial,
    nightMap: night.initial,
    nightStrength: 1.4,
    ambient: 0.06,
    atmosphereColor: [0.25, 0.45, 1.0],
    atmosphereStrength: 0.6,
    clouds: cloudUniforms,
  });
  mesh.onDetailRequest(() => {
    day.requestDetail();
    night.requestDetail();
  });
  if (cloudUniforms) {
    const layer = new CloudLayer(EARTH_EQUATORIAL_RADIUS_KM, cloudUniforms, mesh.sunDirectionVector);
    mesh.mesh.add(layer.mesh);
    let requested = false;
    const apply = (): void => {
      const on = effectEnabled('clouds');
      layer.mesh.visible = on;
      // The map (2–4k) is downloaded only once someone wants the clouds.
      if (on && !requested) {
        requested = true;
        load('clouds', [0, 0, 0]);
      }
    };
    apply();
    const off = onEffectsChange(apply);
    // Layers drift and renew with the simulation clock, baked before the frame is drawn.
    const offTime = onSimTime((ms) => {
      if (layer.mesh.visible) baker?.update(ms);
    });
    mesh.addDisposer(() => {
      disposed = true;
      off();
      offTime();
      layer.dispose();
      baker?.dispose();
    });
  }
  return mesh;
}
