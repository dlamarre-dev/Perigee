/**
 * Texture derivatives shipped in public/textures/<body>/<name>-<k>k.<ext>, shared by the offline tool
 * (tools/textures/fetch-textures.ts writes exactly these) and the client loader. Widths in units of 1024 px,
 * smallest first; height is width / 2 (equirectangular).
 *
 * - WebP: universal fallback, at most 4k (an uncompressed 8k map is 256 MB of GPU memory with mipmaps).
 * - KTX2 (Basis ETC1S, sRGB, with mipmaps): transcoded to a GPU-compressed format (BC1/ETC2/ASTC…), ~8× less
 *   GPU memory. Levels above 4k are loaded only on demand, when the camera is close (`requestDetail`).
 * Procedural maps (flat colours, bands) gain nothing from KTX2 and ship as WebP only.
 * 8k exists only where the source is at least that large (Earth, Moon, Mars), and only as KTX2, in UASTC (BC7/ASTC
 * after transcoding, ~20 MB): seen magnified, ETC1S would show blocks.
 */
export interface TextureLevels {
  readonly webp: readonly number[];
  readonly ktx2: readonly number[];
}

/** Largest level loaded without an explicit detail request. */
export const BASE_MAX_LEVEL_K = 4;

const photo = (webp: readonly number[], ktx2: readonly number[] = webp): TextureLevels => ({ webp, ktx2 });
const procedural = (k: number): TextureLevels => ({ webp: [k], ktx2: [] });

export const TEXTURE_LEVELS: Readonly<Record<string, Readonly<Record<string, TextureLevels>>>> = {
  earth: { day: photo([2, 4], [2, 4, 8]), night: photo([2, 4], [2, 4, 8]) },
  moon: { color: photo([2, 4], [2, 4, 8]) },
  mars: { color: photo([2, 4], [2, 4, 8]) },
  mercury: { color: photo([2]) },
  venus: { color: photo([2, 4]) },
  jupiter: { color: photo([2, 4]) },
  saturn: { color: photo([2, 4]) },
  uranus: { color: photo([2]) },
  neptune: { color: photo([2]) },
  pluto: { color: photo([2]) },
  ceres: { color: photo([2]) },
  io: { color: photo([2]) },
  europa: { color: photo([2]) },
  ganymede: { color: photo([2]) },
  callisto: { color: photo([2]) },
  amalthea: { color: photo([2]) },
  mimas: { color: photo([2]) },
  enceladus: { color: photo([2]) },
  tethys: { color: photo([2]) },
  dione: { color: photo([2]) },
  rhea: { color: photo([2]) },
  titan: { color: photo([2]) },
  hyperion: { color: photo([2]) },
  iapetus: { color: photo([2]) },
  phoebe: { color: photo([2]) },
  triton: { color: photo([2]) },
  charon: { color: photo([2]) },
  phobos: { color: photo([2]) },
  deimos: { color: photo([2]) },
  miranda: { color: procedural(0.5) },
  ariel: { color: procedural(0.5) },
  umbriel: { color: procedural(0.5) },
  titania: { color: procedural(0.5) },
  oberon: { color: procedural(0.5) },
  proteus: { color: procedural(0.5) },
  nereid: { color: procedural(0.5) },
  nix: { color: procedural(0.5) },
  hydra: { color: procedural(0.5) },
  eris: { color: procedural(0.5) },
  haumea: { color: procedural(0.5) },
  makemake: { color: procedural(0.5) },
};

export function textureLevels(body: string, name: string): TextureLevels | undefined {
  return TEXTURE_LEVELS[body]?.[name];
}
