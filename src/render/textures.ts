/**
 * Texture loading, abstracted so the switch to KTX2/Basis (M5) stays local to this file.
 * Strategy: return a placeholder immediately, load the 2k derivative, then upgrade to 4k when supported.
 */
import { DataTexture, LinearMipmapLinearFilter, SRGBColorSpace, TextureLoader, type Texture } from 'three';

export type TextureName = 'day' | 'night';

export interface ProgressiveTextureOptions {
  readonly baseUrl: string;
  readonly body: 'earth';
  readonly name: TextureName;
  readonly maxTextureSize: number;
  readonly anisotropy: number;
  /** Placeholder colour (sRGB bytes) shown until the first level loads. */
  readonly placeholderRgb: readonly [number, number, number];
  readonly onUpdate: (texture: Texture) => void;
}

const LEVELS_K = [2, 4] as const;

export function placeholderTexture(rgb: readonly [number, number, number]): Texture {
  const tex = new DataTexture(new Uint8Array([rgb[0], rgb[1], rgb[2], 255]), 1, 1);
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Loads successive resolutions; each finished level replaces the previous one through `onUpdate`. */
export function loadProgressiveTexture(options: ProgressiveTextureOptions): Texture {
  const placeholder = placeholderTexture(options.placeholderRgb);
  const loader = new TextureLoader();
  const levels = LEVELS_K.filter((k) => k * 1024 <= options.maxTextureSize);
  let current: Texture = placeholder;

  const loadLevel = (index: number): void => {
    const k = levels[index];
    if (k === undefined) return;
    const url = `${options.baseUrl}textures/${options.body}/${options.name}-${k}k.webp`;
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = SRGBColorSpace;
        tex.anisotropy = options.anisotropy;
        tex.minFilter = LinearMipmapLinearFilter;
        const previous = current;
        current = tex;
        options.onUpdate(tex);
        previous.dispose();
        loadLevel(index + 1);
      },
      undefined,
      () => console.warn(`Texture unavailable: ${url}`),
    );
  };
  loadLevel(0);
  return placeholder;
}
