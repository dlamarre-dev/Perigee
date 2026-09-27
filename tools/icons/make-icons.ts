/**
 * Generates the app icons (PWA manifest, favicon) from one SVG drawing: a dark disc, an orbit ellipse in the
 * interface cyan and a satellite at perigee. Run with `npm run icons` (offline, output committed).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '..', 'public', 'icons');

/** `safe` shrinks the drawing into the maskable safe zone (80 % circle). */
function svg(safe: boolean): string {
  const s = safe ? 0.72 : 1;
  const t = (512 * (1 - s)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#02050a"/>
  <g transform="translate(${t} ${t}) scale(${s})">
    <circle cx="256" cy="256" r="232" fill="#08121e" stroke="#1d3a52" stroke-width="6"/>
    <circle cx="256" cy="256" r="74" fill="#2f6fa8"/>
    <circle cx="232" cy="236" r="74" fill="#5ad7ff" opacity="0.22"/>
    <ellipse cx="256" cy="256" rx="196" ry="92" fill="none" stroke="#5ad7ff" stroke-width="12"
      transform="rotate(-28 256 256)"/>
    <circle cx="86" cy="348" r="22" fill="#ffd27a"/>
  </g>
</svg>`;
}

await mkdir(out, { recursive: true });
await writeFile(join(out, 'favicon.svg'), svg(false));
for (const size of [192, 512]) {
  await sharp(Buffer.from(svg(false)))
    .resize(size, size)
    .png()
    .toFile(join(out, `icon-${size}.png`));
  await sharp(Buffer.from(svg(true)))
    .resize(size, size)
    .png()
    .toFile(join(out, `maskable-${size}.png`));
}
await sharp(Buffer.from(svg(false)))
  .resize(180, 180)
  .png()
  .toFile(join(out, 'apple-touch-icon.png'));
console.log(`icons written to ${out}`);
