/**
 * Offline body texture pre-processing (run manually with `npm run textures [body…]`, never in CI).
 *
 * Downloads public-domain sources into tools/textures/src/ (git-ignored) and writes resampled
 * equirectangular WebP derivatives into public/textures/<body>/. KTX2/Basis output replaces WebP in M5.
 *
 * Sources:
 * - Earth day: Blue Marble Next Generation, August 2004, topography + bathymetry (NASA Earth Observatory 73776)
 * - Earth night: Black Marble 2016, 3 km (NASA Earth Observatory 144898)
 * - Moon: CGI Moon Kit, LROC WAC colour mosaic with polar fill (NASA SVS 4720)
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const USER_AGENT = 'Perigee texture tool (https://github.com/dlamarre-dev/Perigee)';

interface TextureSource {
  readonly name: string;
  readonly url: string;
  readonly quality: number;
}

const BODIES: Record<string, readonly TextureSource[]> = {
  earth: [
    {
      name: 'day',
      url: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73776/world.topo.bathy.200408.3x5400x2700.jpg',
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
};

/** Output widths; height is width / 2 (equirectangular). */
const WIDTHS = [2048, 4096] as const;

const here = dirname(fileURLToPath(import.meta.url));

async function download(body: string, source: TextureSource): Promise<string> {
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

async function processBody(body: string, sources: readonly TextureSource[]): Promise<void> {
  const outDir = join(here, '..', '..', 'public', 'textures', body);
  await mkdir(outDir, { recursive: true });
  for (const source of sources) {
    const file = await download(body, source);
    for (const width of WIDTHS) {
      const out = join(outDir, `${source.name}-${width / 1024}k.webp`);
      await sharp(file, { limitInputPixels: false })
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
