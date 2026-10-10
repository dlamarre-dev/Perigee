/**
 * Offline body texture pre-processing (run manually with `npm run textures [body…]`, never in CI).
 *
 * Downloads public-domain sources into tools/textures/src/ (git-ignored) and writes resampled
 * equirectangular WebP derivatives into public/textures/<body>/. `npm run textures earth:clouds` processes one
 * map of a body only (the others are left as they are: re-encode only when a source changes).
 *
 * Sources:
 * - Earth day: Blue Marble Next Generation, August 2004, topography + bathymetry (NASA Earth Observatory 73776)
 * - Earth night: Black Marble 2016, 3 km (NASA Earth Observatory 144898)
 * - Earth clouds (illustrative cloud layer): Blue Marble clouds, 2002 composite (NASA Earth Observatory 57747)
 * - Moon: CGI Moon Kit, LROC WAC colour mosaic with polar fill (NASA SVS 4720)
 * - Mars: Viking MDIM2.1 colourised global mosaic, 1 km/px (USGS Astrogeology)
 * - Mercury: MESSENGER MDIS global mosaic (NASA Photojournal PIA16298)
 * - Jupiter: Cassini ISS cylindrical colour map (NASA Photojournal PIA07782)
 * - Pluto: New Horizons LORRI global map (NASA Photojournal PIA20658)
 * - Ceres: Dawn FC global mosaic, 20 px/deg (USGS Astrogeology / DLR)
 * - Saturn rings: Voyager 2 ISS I/F profile and PPS occultation optical depth (PDS Rings Node)
 * - Venus cloud tops, Saturn, Uranus, Neptune: Solar System Scope (INOVE), CC BY 4.0 — artist's impressions
 * - Eris, Haumea, Makemake: procedural (see procedural.ts)
 * - Relief normal maps (see normals.ts): Moon LOLA (CGI Moon Kit `ldem_16`), Mars MOLA MEGDR 16 px/deg (PDS
 *   Geosciences Node), Mercury MESSENGER global DEM 665 m (USGS Astrogeology), Ceres Dawn HAMO DTM 60 px/deg (DLR,
 *   USGS Astrogeology)
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
import { decodeExr } from './exr';
import { normalMap, resampleHeights, rollToPrimeMeridian } from './normals';
import { readTiffGrid } from './tiff';
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
  /** Linear EXR sources: scale before the sRGB encoding. */
  readonly exposure?: number;
}

/** Elevation model turned into a normal map (linear data, UASTC KTX2). */
interface HeightSource {
  readonly name: 'normal';
  readonly heights: string;
  /** Raw big-endian int16 grid (PDS .img) instead of an image file. */
  readonly rawInt16?: { readonly width: number; readonly height: number };
  /** Uncompressed integer GeoTIFF read directly (sharp clips signed samples), with its no-data value. */
  readonly tiff?: { readonly noData?: number };
  /** Metres per stored unit. */
  readonly heightScaleM: number;
  readonly radiusKm: number;
  readonly exaggeration: number;
  readonly centerLonDeg?: number;
  /** Heights above a sphere on an oblate body: drop each row's mean (the flattening, not relief). */
  readonly removeRowMean?: boolean;
}

interface ProceduralSource {
  readonly name: string;
  readonly procedural: string;
}

interface RingSource {
  readonly name: 'rings';
  readonly rings: () => Promise<RingProfile>;
}

type Source = TextureSource | ProceduralSource | RingSource | HeightSource;

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
    {
      // Greyscale cloud cover (white: thick cloud), used as opacity by the cloud layer (src/render/clouds.ts).
      name: 'clouds',
      url: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud_combined_8192.tif',
      quality: 85,
    },
  ],
  moon: [
    {
      name: 'color',
      url: 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_8k.tif',
      quality: 85,
    },
    {
      // LOLA heights in km relative to 1737.4 km, 16 px/deg, same layout as the colour map.
      name: 'normal',
      heights: 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_16.tif',
      heightScaleM: 1000,
      radiusKm: 1737.4,
      exaggeration: 1.5,
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
    {
      // MOLA MEGDR topography, 16 px/deg, metres above the areoid, starting at 0°E (label megt90n000eb.lbl).
      name: 'normal',
      heights:
        'https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.img',
      rawInt16: { width: 5760, height: 2880 },
      heightScaleM: 1,
      radiusKm: 3389.5,
      exaggeration: 1,
      centerLonDeg: 180,
    },
  ],
  mercury: [
    { name: 'color', url: `${PHOTOJOURNAL}/pia16/pia16298/PIA16298.jpg`, quality: 85 },
    {
      name: 'normal',
      // int16, GDAL SCALE 0.5 m, no data −32768. Laid out 0–360°E (as the Ceres model below), whatever the
      // GeoTIFF tie point says: its slopes match the shading of the colour mosaic only when rolled by 180°.
      heights: 'https://planetarymaps.usgs.gov/mosaic/Mercury_Messenger_USGS_DEM_Global_665m_v2.tif',
      tiff: { noData: -32768 },
      heightScaleM: 0.5,
      centerLonDeg: 180,
      radiusKm: 2439.4,
      exaggeration: 1.5,
    },
  ],
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
    {
      name: 'normal',
      // int16 metres above a 470 km sphere (GDAL OFFSET 470000), no data −32768. Laid out 0–360°E despite its
      // GeoTIFF tie point (−180°): rolled by 180° its slopes match the shading of the colour mosaic, whose
      // Occator crater sits at 239°E as it should.
      heights: 'https://planetarymaps.usgs.gov/mosaic/Ceres_Dawn_FC_HAMO_DTM_DLR_Global_60ppd_Oct2016.tif',
      tiff: { noData: -32768 },
      heightScaleM: 1,
      radiusKm: 470,
      exaggeration: 1,
      centerLonDeg: 180,
      removeRowMean: true,
    },
  ],
  // Moons (solar-system view): USGS Astrogeology global mosaics, NASA/JPL products hosted by USGS, and
  // P. Stooke's small-body maps (PDS Small Bodies Node, public domain with credit); see DATA_SOURCES.md.
  io: [
    {
      name: 'color',
      url: 'https://planetarymaps.usgs.gov/mosaic/Io_GalileoSSI-Voyager_Global_Mosaic_ClrMerge_1km.tif',
      quality: 85,
      dropEdge: true,
    },
  ],
  europa: [
    {
      name: 'color',
      url: 'https://planetarymaps.usgs.gov/mosaic/Europa_Voyager_GalileoSSI_global_mosaic_500m.tif',
      quality: 85,
      centerLonDeg: 180,
      dropEdge: true,
    },
  ],
  ganymede: [
    {
      name: 'color',
      url: 'https://planetarymaps.usgs.gov/mosaic/Ganymede_Voyager_GalileoSSI_Global_ClrMosaic_1435m.tif',
      quality: 85,
      centerLonDeg: 180,
    },
  ],
  callisto: [
    {
      name: 'color',
      url: 'https://planetarymaps.usgs.gov/mosaic/Callisto_Voyager_GalileoSSI_global_mosaic_1km.tif',
      quality: 85,
      centerLonDeg: 180,
    },
  ],
  amalthea: [
    {
      name: 'color',
      url: 'https://sbnarchive.psi.edu/pds4/non_mission/small_bodies.stooke.maps/miscellaneous/j5amalthea/amalcyl.jpg',
      quality: 85,
    },
  ],
  mimas: [
    {
      name: 'color',
      url: 'https://asc-pds-services.s3.us-west-2.amazonaws.com/wms_basemaps/Saturn/Mimas/Cassini_DLR/MI_170630_DLR_basemap.tif',
      quality: 85,
    },
  ],
  enceladus: [
    {
      name: 'color',
      url: 'https://planetarymaps.usgs.gov/mosaic/Enceladus_Cassini_mosaic_global_110m.tif',
      quality: 85,
      dropEdge: true,
    },
  ],
  tethys: [
    {
      name: 'color',
      url: 'https://planetarymaps.usgs.gov/mosaic/Tethys_Cassini_mosaic_global_293m.tif',
      quality: 85,
    },
  ],
  dione: [
    {
      name: 'color',
      url: 'https://planetarymaps.usgs.gov/mosaic/Dione_Cassini_Voyager_mosaic_global_154m.tif',
      quality: 85,
    },
  ],
  rhea: [
    {
      name: 'color',
      url: 'https://planetarymaps.usgs.gov/mosaic/Rhea_Cassini_Voyager_mosaic_global_417m.tif',
      quality: 85,
    },
  ],
  titan: [
    {
      name: 'color',
      url: 'https://planetarymaps.usgs.gov/mosaic/Titan_ISS_P19658_Mosaic_Global_4km.tif',
      quality: 85,
      centerLonDeg: 180,
    },
  ],
  hyperion: [
    {
      name: 'color',
      url: 'https://sbnarchive.psi.edu/pds4/non_mission/small_bodies.stooke.maps/miscellaneous/s7hyperion/hyrelcyl.jpg',
      quality: 85,
    },
  ],
  iapetus: [
    {
      name: 'color',
      url: 'https://planetarymaps.usgs.gov/mosaic/Iapetus_Cassini_Voyager_mosaic_global_783m.tif',
      quality: 85,
    },
  ],
  phoebe: [
    {
      name: 'color',
      url: 'https://asc-pds-services.s3.us-west-2.amazonaws.com/wms_basemaps/Saturn/Phoebe/Cassini/Phoebe_PDS_8ppd_dd360.tif',
      quality: 85,
      centerLonDeg: 180,
    },
  ],
  triton: [
    {
      name: 'color',
      url: 'https://planetarymaps.usgs.gov/mosaic/Triton_Voyager2_ClrMosaic_GlobalFill_600m.tif',
      quality: 85,
    },
  ],
  charon: [
    {
      name: 'color',
      url: 'https://planetarymaps.usgs.gov/mosaic/Charon_NewHorizons_Global_Mosaic_300m_Jul2017_8bit.tif',
      quality: 85,
      dropEdge: true,
    },
  ],
  phobos: [
    {
      name: 'color',
      url: 'https://planetarymaps.usgs.gov/mosaic/Phobos_Viking_Mosaic_40ppd_DLRcontrol.tif',
      quality: 85,
    },
  ],
  deimos: [
    {
      name: 'color',
      url: 'https://sbnarchive.psi.edu/pds4/non_mission/small_bodies.stooke.maps/miscellaneous/m2deimos/deimos_cyl_viking_mro.jpg',
      quality: 85,
    },
  ],
  // Moons without a usable global map: uniform colour from their visual geometric albedo.
  miranda: [{ name: 'color', procedural: 'miranda' }],
  ariel: [{ name: 'color', procedural: 'ariel' }],
  umbriel: [{ name: 'color', procedural: 'umbriel' }],
  titania: [{ name: 'color', procedural: 'titania' }],
  oberon: [{ name: 'color', procedural: 'oberon' }],
  proteus: [{ name: 'color', procedural: 'proteus' }],
  nereid: [{ name: 'color', procedural: 'nereid' }],
  nix: [{ name: 'color', procedural: 'nix' }],
  hydra: [{ name: 'color', procedural: 'hydra' }],
  eris: [{ name: 'color', procedural: 'eris' }],
  // Sky background: NASA SVS Deep Star Maps 2020 (Hipparcos-2, Tycho-2, Gaia DR2), J2000 equatorial plate
  // carrée, RA 0h at the centre and increasing to the left (as seen from inside the sphere); not rolled.
  sky: [
    {
      name: 'stars',
      url: 'https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/starmap_2020_8k.exr',
      quality: 90,
      exposure: 1.6,
    },
  ],
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
  const raw = file.endsWith('.exr')
    ? await decodeExr(file, source.exposure).then(({ data, width, height }) => ({
        data,
        info: { width, height, channels: 3 as const },
      }))
    : await sharp(file, { limitInputPixels: false })
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

/** Height grid in metres, prime meridian at the centre, at most `maxWidth` wide (pre-shrunk by sharp). */
async function readHeights(
  body: string,
  source: HeightSource,
  maxWidth: number,
): Promise<{ data: Float32Array; width: number; height: number }> {
  const file = await download(body, { name: 'heights', url: source.heights });
  let data: Float32Array;
  let width: number;
  let height: number;
  if (source.tiff) {
    width = maxWidth;
    height = width / 2;
    data = await readTiffGrid(file, { width, height, scale: source.heightScaleM, ...source.tiff });
  } else if (source.rawInt16) {
    ({ width, height } = source.rawInt16);
    const bytes = await readFile(file);
    if (bytes.byteLength !== width * height * 2) throw new Error(`Unexpected size for ${file}`);
    data = new Float32Array(width * height);
    for (let k = 0; k < data.length; k++) data[k] = bytes.readInt16BE(k * 2) * source.heightScaleM;
  } else {
    const meta = await sharp(file, { limitInputPixels: false }).metadata();
    width = Math.min(meta.width ?? 0, maxWidth);
    height = width / 2;
    const raw = await sharp(file, { limitInputPixels: false })
      .extractChannel(0)
      .resize(width, height, { fit: 'fill', kernel: 'mitchell' })
      .raw({ depth: 'float' })
      .toBuffer({ resolveWithObject: true });
    const channels = raw.info.channels;
    const f = new Float32Array(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength / 4);
    data = new Float32Array(width * height);
    for (let k = 0; k < data.length; k++) data[k] = (f[k * channels] ?? 0) * source.heightScaleM;
  }
  let min = Infinity;
  let max = -Infinity;
  for (const v of data) {
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  console.log(`heights ${body}: ${width}×${height}, ${min.toFixed(0)} to ${max.toFixed(0)} m`);
  if (source.removeRowMean) {
    for (let j = 0; j < height; j++) {
      let mean = 0;
      for (let i = 0; i < width; i++) mean += data[j * width + i] ?? 0;
      mean /= width;
      for (let i = 0; i < width; i++) data[j * width + i] = (data[j * width + i] ?? 0) - mean;
    }
  }
  return { data: rollToPrimeMeridian(data, width, height, source.centerLonDeg ?? 0), width, height };
}

async function processHeights(body: string, source: HeightSource, outDir: string): Promise<void> {
  const { webp, ktx2 } = levels(body, source.name);
  const largest = Math.max(...webp, ...ktx2) * 1024;
  const grid = await readHeights(body, source, 2 * largest);
  const map = (width: number): Sharp => {
    const h = width / 2;
    const heights = resampleHeights(grid.data, grid.width, grid.height, width, h);
    const rgb = normalMap(heights, width, h, source.radiusKm * 1000, source.exaggeration);
    return sharp(rgb, { raw: { width, height: h, channels: 3 } });
  };
  for (const k of ktx2) {
    const width = k * 1024;
    const out = join(outDir, `${source.name}-${levelName(width)}.ktx2`);
    await encodeKtx2(await map(width).png().toBuffer(), out, {
      workDir: join(here, 'src', 'tmp'),
      cacheDir: join(here, 'src', 'bin'),
      userAgent: USER_AGENT,
      // Normals are data: no sRGB curve, and UASTC (ETC1S blocks show as facets in the shading).
      codec: 'uastc',
      srgb: false,
    });
    console.log(`write   ${out}`);
  }
  for (const k of webp) {
    const width = k * 1024;
    const out = join(outDir, `${source.name}-${levelName(width)}.webp`);
    await map(width).webp({ quality: 92, effort: 6 }).toFile(out);
    console.log(`write   ${out}`);
  }
}

async function processBody(body: string, sources: readonly Source[]): Promise<void> {
  const outDir = join(here, '..', '..', 'public', 'textures', body);
  await mkdir(outDir, { recursive: true });
  for (const source of sources) {
    if ('heights' in source) {
      await processHeights(body, source, outDir);
      continue;
    }
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
  for (const request of bodies) {
    const [body = '', only] = request.split(':');
    const sources = BODIES[body];
    if (!sources) throw new Error(`Unknown body "${body}" (known: ${Object.keys(BODIES).join(', ')})`);
    const selected = only ? sources.filter((s) => s.name === only) : sources;
    if (selected.length === 0) throw new Error(`Unknown map "${only}" for ${body}`);
    await processBody(body, selected);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
