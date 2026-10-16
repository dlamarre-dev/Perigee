/**
 * Offline panel images (catalog/images.json) → public/images/<id>.webp (panel) and <id>-large.webp (enlarged
 * view): each original file downloaded once (cached in tools/images/src/), resized to fit the sizes below and
 * re-encoded as WebP. Images are
 * only resized, never cropped or retouched (CC BY-SA). One request per file, a pause between files, User-Agent,
 * stop on any non-200 response.
 *
 *   npx tsx tools/images/fetch-images.ts [id…]   (default: every image with a WebP missing)
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ImagesCatalogSchema } from '../../src/data/schemas';

const USER_AGENT = 'Perigee image tool (https://github.com/dlamarre-dev/Perigee)';
/** Panel (~320 CSS px wide: twice that for high-density screens) and enlarged view (src/ui/ImageViewer.ts). */
const SIZES = [
  { suffix: '', width: 720, height: 540, quality: 80 },
  { suffix: '-large', width: 1600, height: 1200, quality: 78 },
] as const;
/** Pause between two downloads: Wikimedia answers 429 to a quick series of requests. */
const DOWNLOAD_PAUSE_MS = 3000;

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cacheDir = join(root, 'tools', 'images', 'src');
const outDir = join(root, 'public', 'images');

async function download(url: string, path: string): Promise<Buffer> {
  if (existsSync(path)) return readFile(path);
  await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_PAUSE_MS));
  console.log(`fetch   ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (res.status !== 200) throw new Error(`HTTP ${res.status} for ${url}`);
  const data = Buffer.from(await res.arrayBuffer());
  await writeFile(path, data);
  return data;
}

async function main(): Promise<void> {
  const catalog = ImagesCatalogSchema.parse(
    JSON.parse(await readFile(join(root, 'catalog', 'images.json'), 'utf8')),
  );
  const only = new Set(process.argv.slice(2));
  await mkdir(cacheDir, { recursive: true });
  await mkdir(outDir, { recursive: true });
  for (const image of catalog.images) {
    const outs = SIZES.map((size) => join(outDir, `${image.id}${size.suffix}.webp`));
    if (only.size ? !only.has(image.id) : outs.every((out) => existsSync(out))) continue;
    const ext =
      /\.(jpe?g|png|webp|gif|tiff?)$/i.exec(new URL(image.file).pathname)?.[1]?.toLowerCase() ?? 'bin';
    const source = await download(image.file, join(cacheDir, `${image.id}.${ext}`));
    for (const [i, size] of SIZES.entries()) {
      // Large scans (NASA originals reach 100 Mpixel): no pixel limit, sharp streams them.
      const webp = await sharp(source, { limitInputPixels: false })
        .rotate()
        .resize({ width: size.width, height: size.height, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: size.quality })
        .toBuffer();
      await writeFile(outs[i] ?? '', webp);
      const { width, height } = await sharp(webp).metadata();
      const name = `${image.id}${size.suffix}.webp`;
      console.log(`write   images/${name} ${width}×${height} ${(webp.length / 1024).toFixed(0)} KB`);
    }
  }
}

await main();
