/**
 * Thumbnails of the guide pages for the guides' index (src/landing/render.ts `renderHub`): the centre of each
 * topic's English capture (public/landing/og/en/<id>.jpg, tools/screenshots/og.ts), cropped to its central 4:3 part
 * so the subject fills more of it, 224 × 168 WebP (twice the displayed size). One set for both languages: labels are
 * unreadable at that size. No GPU or server needed; og.ts runs it after new captures.
 *
 *   npx tsx tools/screenshots/thumbs.ts [topic,topic…]
 */
import { existsSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { TOPICS } from '../../src/landing/topics';

export const THUMB_WIDTH = 224;
export const THUMB_HEIGHT = 168;
const CROP_WIDTH = 640;
const CROP_HEIGHT = 480;
const CAPTURES = 'public/landing/og/en';
const OUT = 'public/landing/thumbs';

/** Writes the thumbnails of the given topics (all by default). */
export async function writeThumbnails(only?: readonly string[]): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  for (const topic of TOPICS) {
    if (only && !only.includes(topic.id)) continue;
    const source = `${CAPTURES}/${topic.id}.jpg`;
    if (!existsSync(source)) {
      console.warn('no capture', source);
      continue;
    }
    const path = `${OUT}/${topic.id}.webp`;
    // 1200 × 630 → the central 640 × 480 (the followed object or the body sits in the middle), then down.
    await sharp(source)
      .extract({
        left: (1200 - CROP_WIDTH) / 2,
        top: (630 - CROP_HEIGHT) / 2,
        width: CROP_WIDTH,
        height: CROP_HEIGHT,
      })
      .resize(THUMB_WIDTH, THUMB_HEIGHT)
      .webp({ quality: 80 })
      .toFile(path);
    console.log('thumb', path);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await writeThumbnails(process.argv[2]?.split(','));
}
