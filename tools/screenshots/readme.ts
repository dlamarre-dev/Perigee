/**
 * README screenshots (docs/images): the eight views at 1920 × 1080 and the controls of the settings window for
 * Windows/Linux, macOS and touch screens. Needs the dev server (`npm run dev`), fresh data (`npm run data:pull`) and
 * a GPU (Chromium with ANGLE/D3D11 here, so the high quality tier and its effects are on).
 *
 *   npx tsx tools/screenshots/readme.ts docs/images [name,name…]
 */
import { chromium, type BrowserContextOptions, type Page } from '@playwright/test';

const out = process.argv[2] ?? 'docs/images';
const only = process.argv[3]?.split(',');
const BASE = 'http://localhost:5173/Perigee/';
const T = '2026-10-17T20:30:00Z';

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const ctx = await b.newContext({
  viewport: { width: 1920, height: 1080 },
  timezoneId: 'America/Toronto',
  locale: 'en-US',
});

async function open(params: string, waitMs = 9000, t = T): Promise<Page> {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('ERR', e.message));
  await page.goto(`${BASE}?${params}&lang=en&t=${t}`, { timeout: 120000 });
  await page.waitForTimeout(waitMs);
  return page;
}
async function drag(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 20 });
  await page.mouse.up();
}
async function shot(page: Page, name: string): Promise<void> {
  await page.mouse.move(1919, 540);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 88 });
  console.log('shot', name);
  await page.close();
}

const shots: Record<string, () => Promise<void>> = {
  async hero() {
    const p = await open('view=earth');
    await shot(p, 'hero');
  },
  async moon() {
    const p = await open('view=moon');
    await shot(p, 'moon');
  },
  async mars() {
    const p = await open('view=mars');
    await shot(p, 'mars');
  },
  async solar() {
    const p = await open('view=solar');
    await shot(p, 'solar');
  },
  async saturn() {
    const p = await open('view=solar&sel=saturn');
    await p.keyboard.press('f');
    await p.waitForTimeout(9000);
    await drag(p, 960, 600, 960, 520);
    await p
      .locator('.info:not([hidden]) .panel-minimize')
      .click()
      .catch(() => {});
    await p.waitForTimeout(3000);
    await shot(p, 'saturn');
  },
  async iss() {
    const p = await open('view=earth&sel=25544&rate=0');
    // The filters panel off, as in the earlier picture.
    await p.locator('.toolbar button[aria-controls="side-panel"]').click();
    await p.keyboard.press('f');
    await p.waitForTimeout(9000);
    // Tilt towards the horizon.
    await drag(p, 760, 700, 760, 520);
    await p.waitForTimeout(6000);
    await shot(p, 'iss');
  },
  async mro() {
    const p = await open('view=mars&sel=mro&rate=0');
    await p.keyboard.press('f');
    await p.waitForTimeout(9000);
    await drag(p, 760, 700, 760, 540);
    await p.waitForTimeout(6000);
    await shot(p, 'mro');
  },
  async 'io-jupiter'() {
    // Io just before it crosses Jupiter's disc (seen from the Sun at 01:10 UTC): followed, then the camera turned
    // up around Io until Jupiter and its Great Red Spot are behind it; Juno's trajectory hidden.
    const p = await open('view=solar&sel=moon:io&rate=0&hide=juno', 9000, '2026-10-18T00:45:00Z');
    await p.keyboard.press('f');
    await p.waitForTimeout(10000);
    for (let i = 0; i < 2; i++) await p.mouse.wheel(0, 250);
    await p.waitForTimeout(2500);
    await p.mouse.move(900, 600);
    await p.mouse.down();
    await p.mouse.move(900, 460, { steps: 25 });
    await p.mouse.up();
    await p.waitForTimeout(4000);
    await shot(p, 'io-jupiter');
  },
};

/** The controls part of the settings window, as drawn for a platform. */
async function controls(name: string, contextOptions: BrowserContextOptions, mac = false): Promise<void> {
  const c = await b.newContext({ timezoneId: 'America/Toronto', locale: 'en-US', ...contextOptions });
  if (mac)
    await c.addInitScript(() => Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' }));
  const page = await c.newPage();
  await page.goto(`${BASE}?view=earth&lang=en`, { timeout: 120000 });
  await page.waitForTimeout(6000);
  await page.locator('.settings-button').click();
  await page.locator('dialog.settings[open]').waitFor();
  await page.waitForTimeout(800);
  const box = await page.locator('dialog.settings .controls').boundingBox();
  if (!box) throw new Error('controls not shown');
  // A margin on the sides; little above and below (the section title and the Close button sit there).
  const side = 18;
  const edge = 6;
  await page.screenshot({
    path: `${out}/${name}.jpg`,
    type: 'jpeg',
    quality: 90,
    clip: { x: box.x - side, y: box.y - edge, width: box.width + 2 * side, height: box.height + 2 * edge },
  });
  console.log('shot', name);
  await c.close();
}
Object.assign(shots, {
  'controls-windows': () =>
    controls('controls-windows', { viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 2 }),
  'controls-mac': () =>
    controls(
      'controls-mac',
      {
        viewport: { width: 1280, height: 1100 },
        deviceScaleFactor: 2,
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
      },
      true,
    ),
  'controls-touch': () =>
    controls('controls-touch', {
      viewport: { width: 1180, height: 820 },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
    }),
});

for (const [name, run] of Object.entries(shots)) {
  if (only && !only.includes(name)) continue;
  await run();
}
await b.close();
