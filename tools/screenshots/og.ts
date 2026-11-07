/**
 * Captures of each guide page's 3D view (src/landing/topics.ts), 1200 × 630: the page's Open Graph image and the
 * poster shown before the view loads (src/landing/render.ts `topicCapture`). One per topic and language, since the
 * view's labels follow the language. Needs the dev server (`npm run dev`), fresh data (`npm run data:pull`) and a GPU
 * (Chromium with ANGLE/D3D11 here). One page at a time. Re-run for a topic whose view changes.
 *
 * The eclipse page has a map instead of a 3D view: its capture is that map for an example eclipse
 * (`ECLIPSE_EXAMPLE`, the page's clock set just before it so it is the one shown), widened to the image's shape.
 *
 *   npx tsx tools/screenshots/og.ts [topic,topic…]
 */
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { viewQuery } from '../../src/landing/render';
import { TOPICS } from '../../src/landing/topics';

const BASE = 'http://localhost:5173/Perigee/';
/** The eclipse shown in the eclipse page's capture: the total eclipse of 2 August 2027 (6 min 23 s over Egypt). */
export const ECLIPSE_EXAMPLE = { clock: '2027-07-20T00:00:00Z', kind: 'total' } as const;
const OUT = 'public/landing/og';
const only = process.argv[2]?.split(',');
const topics = TOPICS.filter((t) => !only || only.includes(t.id));
if (only && topics.length !== only.length) throw new Error(`Unknown topic in ${only.join(',')}`);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1,
  timezoneId: 'UTC',
});
// The embed's own buttons are not part of the picture: hidden in every document, reloads included.
await context.addInitScript(() => {
  const style = document.createElement('style');
  style.textContent = '.embed-actions { display: none !important; }';
  document.addEventListener('DOMContentLoaded', () => document.head.append(style));
});

for (const lang of ['en', 'fr'] as const) {
  mkdirSync(`${OUT}/${lang}`, { recursive: true });
  for (const topic of topics) {
    const page = await context.newPage();
    page.on('pageerror', (e) => console.log('ERR', topic.id, e.message));
    const path = `${OUT}/${lang}/${topic.id}.jpg`;
    if (topic.focus === 'eclipses') {
      await page.clock.setFixedTime(new Date(ECLIPSE_EXAMPLE.clock));
      await page.goto(`${BASE}${lang}/${topic.slug[lang]}/`, { timeout: 120_000 });
      await page.locator('#lp-eclipse-map .ec-central path').first().waitFor({ timeout: 60_000 });
      // The map alone, filling the image: its frame widened (or heightened) to the image's 1.9:1 around the same centre.
      await page.evaluate(
        ({ w, h }) => {
          const svg = document.querySelector<SVGSVGElement>('#lp-eclipse-map svg');
          if (!svg) return;
          const [x = 0, y = 0, bw = 360, bh = 180] = (svg.getAttribute('viewBox') ?? '')
            .split(' ')
            .map(Number);
          // Wider or taller around the same centre, within the world.
          const nw = Math.min(360, Math.max(bw, (bh * w) / h));
          const nh = Math.min(180, Math.max(bh, (nw * h) / w));
          const nx = Math.max(0, Math.min(360 - nw, x - (nw - bw) / 2));
          const ny = Math.max(0, Math.min(180 - nh, y - (nh - bh) / 2));
          svg.setAttribute('viewBox', `${nx} ${ny} ${nw} ${nh}`);
          // Out of the page's panels (their effects make a containing block for fixed elements), over everything.
          document.body.append(svg);
          for (const [k, v] of Object.entries({
            position: 'fixed',
            inset: '0',
            width: `${w}px`,
            height: `${h}px`,
            'max-width': 'none',
            'max-height': 'none',
            border: '0',
            margin: '0',
            'z-index': '9999',
          }))
            svg.style.setProperty(k, v, 'important');
        },
        { w: 1200, h: 630 },
      );
      await page.waitForTimeout(800);
      await page.screenshot({
        path,
        type: 'jpeg',
        quality: 82,
        clip: { x: 0, y: 0, width: 1200, height: 630 },
      });
      console.log('shot', path);
      await page.close();
      continue;
    }
    await page.goto(`${BASE}${viewQuery(topic.view, lang, true)}`, { timeout: 120_000 });
    // Textures, data and the follow glide.
    await page.waitForTimeout(topic.view.follow ? 12_000 : 9_000);
    await page.mouse.move(1199, 315);
    await page.waitForTimeout(800);
    await page.screenshot({ path, type: 'jpeg', quality: 82 });
    console.log('shot', path);
    await page.close();
  }
}
await browser.close();
