/**
 * Body texture loading: a placeholder immediately, then successive levels from src/render/textureLevels.ts.
 * KTX2 (Basis, GPU-compressed) is preferred once `configureKtx2` has run; WebP is the fallback (no transcoder
 * support, or a failed KTX2 load). Levels above BASE_MAX_LEVEL_K wait for `requestDetail()` (camera close).
 */
import {
  DataTexture,
  LinearMipmapLinearFilter,
  NoColorSpace,
  SRGBColorSpace,
  TextureLoader,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { BASE_MAX_LEVEL_K, textureLevels } from './textureLevels';
import { assetUrl } from './assetUrl';

/** Texture file stem, e.g. "day", "night", "color". */
export type TextureName = string;

export interface ProgressiveTextureOptions {
  readonly baseUrl: string;
  readonly body: string;
  readonly name: TextureName;
  readonly maxTextureSize: number;
  readonly anisotropy: number;
  /** Placeholder colour (sRGB bytes) shown until the first level loads. */
  readonly placeholderRgb: readonly [number, number, number];
  /** Data rather than colour (normal maps): no sRGB decoding. */
  readonly linear?: boolean;
  readonly onUpdate: (texture: Texture) => void;
}

export interface ProgressiveTexture {
  /** Placeholder, replaced through `onUpdate` as levels arrive. */
  readonly initial: Texture;
  /** Allows the high-detail levels (above 4k) to load; idempotent. */
  requestDetail(): void;
}

let ktx2Loader: KTX2Loader | undefined;

/** The shell's KTX2 loader (models with KHR_texture_basisu textures), once configured. */
export function getKtx2Loader(): KTX2Loader | undefined {
  return ktx2Loader;
}

/** Enables KTX2 textures (called once by the shell, with the page renderer). */
export function configureKtx2(renderer: WebGLRenderer, baseUrl: string): void {
  ktx2Loader = new KTX2Loader().setTranscoderPath(`${baseUrl}basis/`).detectSupport(renderer);
}

export function placeholderTexture(rgb: readonly [number, number, number], linear = false): Texture {
  const tex = new DataTexture(new Uint8Array([rgb[0], rgb[1], rgb[2], 255]), 1, 1);
  tex.colorSpace = linear ? NoColorSpace : SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function progressiveTexture(options: ProgressiveTextureOptions): ProgressiveTexture {
  const placeholder = placeholderTexture(options.placeholderRgb, options.linear);
  const levels = textureLevels(options.body, options.name);
  const fits = (k: number): boolean => k * 1024 <= options.maxTextureSize;
  let useKtx2 = ktx2Loader !== undefined && (levels?.ktx2.length ?? 0) > 0;
  let current: Texture = placeholder;
  let loadedK = 0;
  let detailAllowed = false;
  let busy = false;

  const pending = (): number | undefined => {
    const list = (useKtx2 ? levels?.ktx2 : levels?.webp) ?? [];
    return list.find((k) => k > loadedK && fits(k) && (detailAllowed || k <= BASE_MAX_LEVEL_K));
  };

  const accept = (tex: Texture, k: number): void => {
    tex.colorSpace = options.linear ? NoColorSpace : SRGBColorSpace;
    tex.anisotropy = options.anisotropy;
    tex.minFilter = LinearMipmapLinearFilter;
    const previous = current;
    current = tex;
    loadedK = k;
    options.onUpdate(tex);
    previous.dispose();
  };

  const next = (): void => {
    const k = pending();
    if (k === undefined || busy) return;
    busy = true;
    const stem = `textures/${options.body}/${options.name}-${k}k`;
    const done = (tex: Texture): void => {
      busy = false;
      accept(tex, k);
      next();
    };
    if (useKtx2 && ktx2Loader) {
      ktx2Loader.load(assetUrl(options.baseUrl, `${stem}.ktx2`), done, undefined, () => {
        console.warn(`KTX2 texture unavailable, falling back to WebP: ${stem}.ktx2`);
        busy = false;
        useKtx2 = false;
        next();
      });
    } else {
      new TextureLoader().load(assetUrl(options.baseUrl, `${stem}.webp`), done, undefined, () => {
        busy = false;
        console.warn(`Texture unavailable: ${stem}.webp`);
      });
    }
  };
  next();

  return {
    initial: placeholder,
    requestDetail: () => {
      if (detailAllowed) return;
      detailAllowed = true;
      next();
    },
  };
}

/** Base levels only (no detail request); returns the placeholder. */
export function loadProgressiveTexture(options: ProgressiveTextureOptions): Texture {
  return progressiveTexture(options).initial;
}
