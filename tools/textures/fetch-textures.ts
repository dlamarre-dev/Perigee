/**
 * Offline body texture pre-processing (run manually with `npm run textures [body…]`, never in CI).
 *
 * Downloads public-domain sources into tools/textures/src/ (git-ignored) and writes resampled
 * equirectangular WebP derivatives into public/textures/<body>/.
 *
 * Sources:
 * - Earth day: Blue Marble Next Generation, August 2004, topography + bathymetry (NASA Earth Observatory 73776)
 * - Earth night: Black Marble 2016, 3 km (NASA Earth Observatory 144898)
 * - Moon: CGI Moon Kit, LROC WAC colour mosaic with polar fill (NASA SVS 4720)
 * - Mars: Viking MDIM2.1 colourised global mosaic, 1 km/px (USGS Astrogeology)
 * - Mercury: MESSENGER MDIS global mosaic (NASA Photojournal PIA16298)
 * - Jupiter: Cassini ISS cylindrical colour map (NASA Photojournal PIA07782)
 * - Pluto: New Horizons LORRI global map (NASA Photojournal PIA20658)
 * - Ceres: Dawn FC global mosaic, 20 px/deg (USGS Astrogeology / DLR)
 * - Saturn rings: Voyager 2 ISS I/F profile and PPS occultation optical depth (PDS Rings Node)
 * - Venus cloud tops, Saturn, Uranus, Neptune: Solar System Scope (INOVE), CC BY 4.0 — artist's impressions
 * - Eris, Haumea, Makemake: procedural (see procedural.ts)
 *
 * All outputs follow one convention: equirectangular, north up, planetocentric east longitude increasing to the
 * right, prime meridian at the horizontal centre.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp, { type Sharp } from 'sharp';
import { BASE_MAX_LEVEL_K, textureLevels, type TextureLevels } from '../../src/render/textureLevels';
import { encodeKtx2 } from './basisu';
import { bandedMap, PROCEDURAL } from './procedural';
import { saturnRings, uranusRings, type RingProfile } from './rings';

const USER_AGENT = 'Perigee texture tool (https://github.com/dlamarre-dev/Perigee)';

interface TextureSource {
  readonly name: string;
  readonly url: string;
  readonly quality: number;
  /** Longitude at the source image centre, when not the prime meridian (rolled to 0). */
  readonly centerLonDeg?: number;
  /** Source repeats the edge meridian and both poles (N+1 × M+1 grid): drop the last column and row. */
  readonly dropEdge?: boolean;
}

interface ProceduralSource {
  readonly name: string;
  readonly procedural: string;
}

interface RingSource {
  readonly name: 'rings';
  readonly rings: () => Promise<RingProfile>;
}

type Source = TextureSource | ProceduralSource | RingSource;

const PDS_RINGS = 'https://pds-rings.seti.org/holdings/volumes/VG_28xx';
const SSS_COMMONS = 'https://upload.wikimedia.org/wikipedia/commons';
const PHOTOJOURNAL = 'https://assets.science.nasa.gov/content/dam/science/psd/photojournal/pia';

const BODIES: Record<string, readonly Source[]> = {
  earth: [
    {
      name: 'day',
      url: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73776/world.topo.bathy.200408.3x21600x10800.jpg',
      quality: 85,
    },
    {
      name: 'night',
      url: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg',
      quality: 80,
    },
  ],
  moon: [
    {
      name: 'color',
      url: 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_8k.tif',
      quality: 85,
    },
  ],
  mars: [
    {
      // USGS Astrogeology, Viking MDIM2.1 colourised global mosaic, 1 km/px JPEG (21339×10670, public domain):
      // https://astrogeology.usgs.gov/search/map/mars_viking_colorized_global_mosaic_232m
      name: 'color',
      url: 'https://astrogeology.usgs.gov/ckan/dataset/7131d503-cdc9-45a5-8f83-5126c0fd397e/resource/5ea881c6-01b3-41fa-a7af-42d2131b54f1/download/Mars_Viking_MDIM21_ClrMosaic_1km.jpg',
      quality: 85,
    },
  ],
  mercury: [{ name: 'color', url: `${PHOTOJOURNAL}/pia16/pia16298/PIA16298.jpg`, quality: 85 }],
  // Solar System Scope (INOVE), CC BY 4.0, via the Wikimedia Commons mirror (same licence): artist's impressions
  // based on NASA imagery, used where no public-domain global map exists.
  venus: [
    {
      name: 'color',
      url: `${SSS_COMMONS}/5/57/Solarsystemscope_texture_4k_venus_atmosphere.jpg`,
      quality: 85,
    },
  ],
  jupiter: [
    { name: 'color', url: `${PHOTOJOURNAL}/pia07/pia07782/PIA07782.jpg`, quality: 85, dropEdge: true },
  ],
  saturn: [
    { name: 'color', url: `${SSS_COMMONS}/1/1e/Solarsystemscope_texture_8k_saturn.jpg`, quality: 85 },
    {
      name: 'rings',
      rings: async () =>
        saturnRings(
          await downloadText('saturn', 'is2-iof', `${PDS_RINGS}/VG_2810/DATA/IS2_P0001_V01_KM010.TAB`),
          await downloadText('saturn', 'pps-tau', `${PDS_RINGS}/VG_2801/EASYDATA/KM010/PS1P01.TAB`),
        ),
    },
  ],
  uranus: [
    { name: 'color', url: `${SSS_COMMONS}/9/95/Solarsystemscope_texture_2k_uranus.jpg`, quality: 88 },
    { name: 'rings', rings: () => Promise.resolve(uranusRings()) },
  ],
  neptune: [
    { name: 'color', url: `${SSS_COMMONS}/1/1e/Solarsystemscope_texture_2k_neptune.jpg`, quality: 88 },
  ],
  pluto: [
    {
      name: 'color',
      url: `${PHOTOJOURNAL}/pia20/pia20658/PIA20658.jpg`,
      quality: 85,
      centerLonDeg: 180,
    },
  ],
  ceres: [
    {
      // Dawn team / IAU 2015 longitudes (crater Kait at 0°).
      name: 'color',
      url: 'https://planetarymaps.usgs.gov/mosaic/Ceres_Dawn_FC_DLR_global_20ppd_Oct2015.tif',
      quality: 85,
      centerLonDeg: 180,
    },
  ],
  eris: [{ name: 'color', procedural: 'eris' }],
  haumea: [{ name: 'color', procedural: 'haumea' }],
  makemake: [{ name: 'color', procedural: 'makemake' }],
};

const here = dirname(fileURLToPath(import.meta.url));

async function download(body: string, source: { name: string; url: string }): Promise<string> {
  const file = join(here, 'src', body, `${source.name}${source.url.slice(source.url.lastIndexOf('.'))}`);
  if (existsSync(file)) {
    console.log(`cached  ${file}`);
    return file;
  }
  console.log(`fetch   ${source.url}`);
  const res = await fetch(source.url, { headers: { 'User-Agent': USER_AGENT } });
  // Stop on any non-200 response: no retries against providers.
  if (res.status !== 200) throw new Error(`HTTP ${res.status} for ${source.url}`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

async function downloadText(body: string, name: string, url: string): Promise<string> {
  return readFile(await download(body, { name, url }), 'utf8');
}

/** File suffix of a level, as the client requests it: 2048 → "2k", 512 → "0.5k". */
function levels(body: string, name: string): TextureLevels {
  const found = textureLevels(body, name);
  if (!found) throw new Error(`${body}/${name} is missing from src/render/textureLevels.ts`);
  return found;
}

/** Basis ETC1S KTX2 (see basisu.ts and textureLevels.ts). */
async function writeKtx2(image: Sharp, width: number, out: string): Promise<void> {
  const png = await image
    .clone()
    .resize(width, width / 2, { fit: 'fill', kernel: 'lanczos3' })
    .png()
    .toBuffer();
  await encodeKtx2(png, out, {
    workDir: join(here, 'src', 'tmp'),
    cacheDir: join(here, 'src', 'bin'),
    userAgent: USER_AGENT,
    // Close-up levels are seen magnified: UASTC avoids the ETC1S block artefacts (larger files, on demand only).
    codec: width > BASE_MAX_LEVEL_K * 1024 ? 'uastc' : 'etc1s',
  });
  console.log(`write   ${out}`);
}

function levelName(width: number): string {
  return `${width / 1024}k`;
}

/** Decoded source as raw RGB, cropped and rolled so the prime meridian is at the horizontal centre. */
async function prepared(file: string, source: TextureSource): Promise<Sharp> {
  const raw = await sharp(file, { limitInputPixels: false })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = raw.info.channels;
  const srcWidth = raw.info.width;
  const width = source.dropEdge ? srcWidth - 1 : srcWidth;
  const height = source.dropEdge ? raw.info.height - 1 : raw.info.height;
  // Centre longitude L at x = W/2: content moves left by L/360·W (east increases to the right).
  const shift = ((Math.round(((source.centerLonDeg ?? 0) / 360) * width) % width) + width) % width;
  const out = Buffer.alloc(width * height * ch);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (y * srcWidth + ((x + shift) % width)) * ch;
      raw.data.copy(out, (y * width + x) * ch, from, from + ch);
    }
  }
  return sharp(out, { raw: { width, height, channels: ch }, limitInputPixels: false });
}

async function processBody(body: string, sources: readonly Source[]): Promise<void> {
  const outDir = join(here, '..', '..', 'public', 'textures', body);
  await mkdir(outDir, { recursive: true });
  for (const source of sources) {
    if ('rings' in source) {
      const profile = await source.rings();
      const out = join(outDir, 'rings.png');
      await sharp(profile.rgba, { raw: { width: profile.width, height: 1, channels: 4 } })
        .png()
        .toFile(out);
      console.log(`write   ${out}`);
      continue;
    }
    if ('procedural' in source) {
      const style = PROCEDURAL[source.procedural];
      if (!style) throw new Error(`Unknown procedural style ${source.procedural}`);
      for (const k of levels(body, source.name).webp) {
        const width = k * 1024;
        const out = join(outDir, `${source.name}-${levelName(width)}.webp`);
        await sharp(bandedMap(width, style), { raw: { width, height: width / 2, channels: 3 } })
          .webp({ quality: 88, effort: 6 })
          .toFile(out);
        console.log(`write   ${out}`);
      }
      continue;
    }
    const file = await download(body, source);
    const base = await prepared(file, source);
    const { webp, ktx2 } = levels(body, source.name);
    for (const k of ktx2) {
      await writeKtx2(base, k * 1024, join(outDir, `${source.name}-${levelName(k * 1024)}.ktx2`));
    }
    for (const k of webp) {
      const width = k * 1024;
      const out = join(outDir, `${source.name}-${levelName(width)}.webp`);
      await base
        .clone()
        .resize(width, width / 2, { fit: 'fill', kernel: 'lanczos3' })
        .webp({ quality: source.quality, effort: 6 })
        .toFile(out);
      console.log(`write   ${out}`);
    }
  }
}

async function main(): Promise<void> {
  const requested = process.argv.slice(2);
  const bodies = requested.length > 0 ? requested : Object.keys(BODIES);
  for (const body of bodies) {
    const sources = BODIES[body];
    if (!sources) throw new Error(`Unknown body "${body}" (known: ${Object.keys(BODIES).join(', ')})`);
    await processBody(body, sources);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
