/**
 * Offline Earth texture pre-processing (run manually with `npm run textures`, never in CI).
 *
 * Downloads NASA public-domain sources into tools/textures/src/ (git-ignored) and writes resampled
 * equirectangular WebP derivatives into public/textures/earth/. KTX2/Basis output replaces WebP in M5.
 *
 * Sources:
 * - Blue Marble Next Generation, August 2004, topography + bathymetry (NASA Earth Observatory, record 73776)
 * - Black Marble 2016, 3 km (NASA Earth Observatory, record 144898)
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

const SOURCES: readonly TextureSource[] = [
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
];

/** Output widths; height is width / 2 (equirectangular). */
const WIDTHS = [2048, 4096] as const;

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, 'src');
const outDir = join(here, '..', '..', 'public', 'textures', 'earth');

async function download(source: TextureSource): Promise<string> {
  const file = join(srcDir, `${source.name}${source.url.slice(source.url.lastIndexOf('.'))}`);
  if (existsSync(file)) {
    console.log(`cached  ${file}`);
    return file;
  }
  console.log(`fetch   ${source.url}`);
  const res = await fetch(source.url, { headers: { 'User-Agent': USER_AGENT } });
  // Stop on any non-200 response: no retries against providers.
  if (res.status !== 200) throw new Error(`HTTP ${res.status} for ${source.url}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

async function main(): Promise<void> {
  await mkdir(srcDir, { recursive: true });
  await mkdir(outDir, { recursive: true });
  for (const source of SOURCES) {
    const file = await download(source);
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

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
