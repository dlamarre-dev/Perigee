/**
 * Relief shading from normal maps (immersive effect `relief`, high quality tier): bodies with a global elevation
 * model (Moon LOLA, Mars MOLA, Mercury MESSENGER, Ceres Dawn; tools/textures/normals.ts). The Earth has none: its
 * Blue Marble map already carries terrain shading. The map is downloaded once the effect is on.
 */
import type { BodyMesh } from './BodyMesh';
import { effectEnabled, onEffectsChange } from './effects';
import { quality } from './quality';
import type { Renderer } from './Renderer';
import { loadProgressiveTexture } from './textures';
import { textureLevels } from './textureLevels';

/**
 * Slope scale applied in the shader, on top of the exaggeration baked in the map. Ceres is kept low: its Dawn
 * mosaic already shows the light and shadow of its relief (as Mars's Viking mosaic, whose relief is gentler).
 */
const RELIEF_STRENGTH: Readonly<Record<string, number>> = { moon: 1.2, mars: 1.5, mercury: 1, ceres: 0.8 };

/** Strength for a body's `relief` option, or undefined when it has no normal map or the tier has no effects. */
export function reliefStrength(body: string): number | undefined {
  if (!quality().immersiveEffects || !textureLevels(body, 'normal')) return undefined;
  return RELIEF_STRENGTH[body] ?? 1;
}

/** Loads the body's normal map when the effect is (or gets) switched on; the mesh needs the `relief` option. */
export function attachRelief(mesh: BodyMesh, body: string, renderer: Renderer, baseUrl: string): void {
  if (reliefStrength(body) === undefined) return;
  let requested = false;
  const apply = (): void => {
    if (requested || !effectEnabled('relief')) return;
    requested = true;
    loadProgressiveTexture({
      baseUrl,
      body,
      name: 'normal',
      linear: true,
      maxTextureSize: renderer.maxTextureSize,
      anisotropy: renderer.renderer.capabilities.getMaxAnisotropy(),
      placeholderRgb: [128, 128, 255],
      onUpdate: (tex) => mesh.setNormalMap(tex),
    });
  };
  apply();
  mesh.addDisposer(onEffectsChange(apply));
}
