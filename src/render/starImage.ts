/**
 * Illustration of a star for the info panel (2D canvas, no photograph): a disc in the colour of a black body at
 * the star's surface temperature, with limb darkening and convection cells sized like the star (fine granules on a
 * dwarf, a few giant cells on a red supergiant, as interferometry shows Betelgeuse), a soft glow, and the Sun
 * drawn at the same scale beside it. Only a handful of stars have ever been resolved, in images of very different
 * kinds, so every star is drawn the same way and labelled as an illustration.
 */

/** Effective temperature by spectral class, for stars without a published value (rough mid-class values). */
const CLASS_TEMPERATURE_K: Readonly<Record<string, number>> = {
  O: 35_000,
  B: 15_000,
  A: 9_000,
  F: 6_700,
  G: 5_600,
  K: 4_400,
  M: 3_400,
};

export function temperatureFromSpectralType(spectralType: string): number | undefined {
  return CLASS_TEMPERATURE_K[spectralType.trim().charAt(0).toUpperCase()];
}

/**
 * sRGB colour (0–1) of a black body at `temperatureK`, normalised to its brightest channel: T. Helland's fit of
 * the CIE 1964 10° colour-matching data (accurate to a few percent between 1000 K and 40 000 K).
 */
export function blackbodyRgb(temperatureK: number): [number, number, number] {
  const t = Math.min(40_000, Math.max(1_000, temperatureK)) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g =
    t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = [r, g, b].map((v) => Math.min(255, Math.max(0, v)) / 255) as [number, number, number];
  const max = Math.max(...c);
  return [c[0] / max, c[1] / max, c[2] / max];
}

export interface StarImageOptions {
  readonly temperatureK: number;
  /** Radius in solar radii; undefined when unknown (no Sun drawn for comparison). */
  readonly radiusSun: number | undefined;
  /** Stable per star, so its cells do not change between openings. */
  readonly seed: string;
  /** Drawn under the small Sun. */
  readonly sunLabel: string;
}

/** What the comparison shows, for the caption. */
export type SunComparison = 'none' | 'drawn' | 'too-small';

/** Largest star (solar radii) beside which the Sun is still drawn. */
export const MAX_SUN_DRAWN_RADII = 300;

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Smooth value noise on a lattice, deterministic for a seed. */
function valueNoise(seed: number): (x: number, y: number) => number {
  const lattice = (ix: number, iy: number): number => {
    let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + seed) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  return (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = lattice(ix, iy) + (lattice(ix + 1, iy) - lattice(ix, iy)) * sx;
    const b = lattice(ix, iy + 1) + (lattice(ix + 1, iy + 1) - lattice(ix, iy + 1)) * sx;
    return a + (b - a) * sy;
  };
}

/**
 * Cellular pattern (Worley): for a point in cell units, the gap between its nearest and second-nearest jittered
 * cell centres, 0 on the lanes between cells and up to ~1 in their middle.
 */
function cellular(seed: number): (x: number, y: number) => number {
  const jitter = (ix: number, iy: number, k: number): number => {
    let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(k, 2246822519) + seed) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  return (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let f1 = Infinity;
    let f2 = Infinity;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const px = ix + i + jitter(ix + i, iy + j, 1);
        const py = iy + j + jitter(ix + i, iy + j, 2);
        const d = Math.hypot(px - x, py - y);
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
    return f2 - f1;
  };
}

/**
 * Convection cells across the disc: about 40 granules on a Sun-sized drawing, down to ~4 cells on a red
 * supergiant (a cell spans a growing fraction of the star as its gravity weakens).
 */
function cellsAcross(radiusSun: number | undefined): number {
  const r = radiusSun ?? 10;
  return Math.max(4, Math.min(40, 40 / Math.pow(Math.max(r, 1), 0.38)));
}

/** Draws the star on `canvas` (its own pixel size) and says how the Sun was shown. */
export function drawStar(canvas: HTMLCanvasElement, o: StarImageOptions): SunComparison {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  if (!ctx || w === 0 || h === 0) return 'none';
  const [cr, cg, cb] = blackbodyRgb(o.temperatureK);
  const big = 0.36 * h;
  const r = o.radiusSun;
  // At least the size of the Sun: the star fills the frame and the Sun is scaled down beside it. Smaller (red
  // dwarfs): the Sun fills the frame from the left edge and the star is scaled down.
  const smaller = r !== undefined && r < 1;
  const starPx = smaller ? big * r : big;
  const sunPx = r === undefined || r === 1 ? 0 : smaller ? big : big / r;
  const cx = smaller ? w * 0.62 : w / 2;
  const cy = h / 2;

  const image = ctx.createImageData(w, h);
  const data = image.data;
  const seed = hash(o.seed);
  const cellsOf = cellular(seed);
  const blotches = valueNoise(seed ^ 0x5bd1e995);
  const cells = cellsAcross(r) / (2 * starPx);
  // Larger, fewer cells show more contrast (red supergiants are blotchy; the Sun's granules are subtle at this
  // size).
  const giant = Math.min(1, Math.log10(Math.max(r ?? 10, 1)) / 2.8);
  const contrast = 0.22 + 0.5 * giant;
  const blotchScale = cells * (0.45 + 0.75 * giant);
  // Granules have sharp dark lanes; a giant's few huge cells are seen blurred, as soft bright patches.
  const laneWeight = 0.8 * (1 - giant) + 0.15 * giant;
  const laneSharpness = 1.6 - 0.9 * giant;
  const blotchWeight = 0.5 + 0.8 * giant;
  const glowPx = Math.max(starPx * 0.35, 6);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy) / starPx;
      let k: number;
      if (d < 1) {
        const mu = Math.sqrt(1 - d * d);
        // Quadratic limb darkening (solar-like coefficients).
        const limb = 1 - 0.47 * (1 - mu) - 0.23 * (1 - mu) * (1 - mu);
        // Cells: bright centres, dark lanes; foreshortened and fading towards the limb.
        const gap = Math.min(1, cellsOf(dx * cells, dy * cells) * laneSharpness);
        const lane = gap * gap * (3 - 2 * gap);
        const blotch = blotches(dx * blotchScale + 31, dy * blotchScale - 7);
        const cell = ((lane - 0.6) * laneWeight + (blotch - 0.5) * blotchWeight) * contrast * mu;
        k = limb * (1 + cell);
        // Antialiased edge.
        k *= Math.min(1, (1 - d) * starPx);
      } else {
        const out = (d - 1) * starPx;
        k = 0.22 * Math.exp(-out / glowPx);
      }
      const i = (y * w + x) * 4;
      data[i] = Math.min(255, 255 * k * cr);
      data[i + 1] = Math.min(255, 255 * k * cg);
      data[i + 2] = Math.min(255, 255 * k * cb);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  if (sunPx === 0) return 'none';
  const [sr, sg, sb] = blackbodyRgb(5772);
  const sunColour = `rgb(${Math.round(255 * sr)} ${Math.round(255 * sg)} ${Math.round(255 * sb)})`;
  ctx.fillStyle = sunColour;
  ctx.font = `${Math.round(h * 0.055)}px sans-serif`;
  ctx.textBaseline = 'top';
  if (smaller) {
    // The Sun's limb along the left edge, its centre outside the frame.
    const sx = w * 0.62 - starPx - h * 0.06 - sunPx;
    ctx.beginPath();
    ctx.arc(sx, cy, sunPx, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = 'rgb(0 0 0 / 65%)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(o.sunLabel, Math.max(sx, w * 0.12), cy);
    return 'drawn';
  }
  const sx = w * 0.1;
  const sy = h * 0.82;
  // Up to 300 solar radii the Sun stays a visible dot (at least a pixel, whatever the screen); beyond, the caption
  // says it would not show.
  if ((r ?? 0) > MAX_SUN_DRAWN_RADII) return 'too-small';
  ctx.beginPath();
  ctx.arc(sx, sy, Math.max(sunPx, 1), 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = 'rgb(255 255 255 / 75%)';
  ctx.textAlign = 'left';
  ctx.fillText(o.sunLabel, sx + Math.max(sunPx, 1) + h * 0.03, sy - h * 0.03);
  return 'drawn';
}
