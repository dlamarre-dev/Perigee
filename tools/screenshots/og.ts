/**
 * Captures of each guide page's 3D view (src/landing/topics.ts), 1200 × 630: the page's Open Graph image and the
 * poster shown before the view loads (src/landing/render.ts `topicCapture`). One per topic and language, since the
 * view's labels follow the language. Needs the dev server (`npm run dev`), fresh data (`npm run data:pull`) and a GPU
 * (Chromium with ANGLE/D3D11 here). One page at a time. Re-run for a topic whose view changes.
 *
 *   npx tsx tools/screenshots/og.ts [topic,topic…]
 */
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { viewQuery } from '../../src/landing/render';
import { TOPICS } from '../../src/landing/topics';

const BASE = 'http://localhost:5173/Perigee/';
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
    await page.goto(`${BASE}${viewQuery(topic.view, lang, true)}`, { timeout: 120_000 });
    // Textures, data and the follow glide.
    await page.waitForTimeout(topic.view.follow ? 12_000 : 9_000);
    await page.mouse.move(1199, 315);
    await page.waitForTimeout(800);
    const path = `${OUT}/${lang}/${topic.id}.jpg`;
    await page.screenshot({ path, type: 'jpeg', quality: 82 });
    console.log('shot', path);
    await page.close();
  }
}
await browser.close();
