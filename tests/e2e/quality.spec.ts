import { expect, test, type Page } from '@playwright/test';
import { setRate } from './helpers';

// Quality tiers (src/render/quality.ts). Headless Chromium renders with SwiftShader, a software GPU: "auto"
// detects the low tier here.

test('auto detects the low tier on a software GPU; the menu choice is remembered and applied', async ({
  page,
}) => {
  await page.goto('./?lang=en&view=moon');
  await expect(page.locator('html')).toHaveAttribute('data-quality', 'low');
  const select = page.getByLabel('Quality');
  await expect(select.locator('option:checked')).toHaveText('Auto');
  await expect(select).toHaveAttribute('title', /detected: Saver/);
  // Saver: opaque panels, no backdrop blur over the canvas.
  await expect(page.locator('.toolbar')).toHaveCSS('backdrop-filter', 'none');

  await Promise.all([page.waitForEvent('load'), select.selectOption('medium')]);
  await expect(page.locator('html')).toHaveAttribute('data-quality', 'medium');
  await expect(page).toHaveURL(/view=moon/);
  await expect(page.getByLabel('Quality')).toHaveValue('medium');
  await expect(page.locator('.toolbar')).not.toHaveCSS('backdrop-filter', 'none');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-quality', 'medium');
  await Promise.all([page.waitForEvent('load'), page.getByLabel('Quality').selectOption('auto')]);
  await expect(page.locator('html')).toHaveAttribute('data-quality', 'low');
});

test('a forced tier and the perf overlay stay in the URL after user actions', async ({ page }) => {
  await page.goto('./?lang=en&quality=medium&debug=perf');
  await expect(page.locator('.perf-overlay')).toContainText('quality medium');
  await setRate(page, 100);
  await expect(page).toHaveURL(/rate=100/);
  await expect(page).toHaveURL(/quality=medium/);
  await expect(page).toHaveURL(/debug=perf/);
});

for (const view of ['earth', 'moon', 'mars', 'solar']) {
  test(`?quality=low renders the ${view} view`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`./?lang=en&view=${view}&quality=low`);
    await expect(page.locator('html')).toHaveAttribute('data-quality', 'low');
    await expect(page.locator('#viewport canvas')).toBeVisible();
    await page.waitForTimeout(3000);
    expect(errors).toEqual([]);
  });
}

/** Follows the ISS on a large high-density screen (its full-quality model is aborted, never downloaded). */
async function followIss(page: Page, quality: string): Promise<void> {
  await page.route('**/models/iss-high.glb*', (route) => route.abort());
  await page.goto(`./?lang=en&sel=25544&t=2026-09-26T12:00:00Z&rate=0&quality=${quality}`);
  await expect(page.locator('aside.info:visible .panel-title')).toContainText('ISS', { timeout: 30_000 });
  await page.locator('#viewport canvas').focus();
  await page.keyboard.press('f');
}

test.describe('full-quality models', () => {
  test.use({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });

  test('are fetched on the high tier', async ({ page }) => {
    test.setTimeout(90_000);
    const request = page.waitForRequest('**/models/iss-high.glb*', { timeout: 60_000 });
    await followIss(page, 'high');
    await request;
  });

  test('are never fetched on the medium tier', async ({ page }) => {
    test.setTimeout(90_000);
    let requests = 0;
    page.on('request', (r) => {
      if (r.url().includes('/models/iss-high.glb')) requests++;
    });
    await followIss(page, 'medium');
    // The light model is shown (long enough for the high tier to ask for the full one).
    await page.waitForRequest('**/models/iss.glb*', { timeout: 30_000 }).catch(() => undefined);
    await page.waitForTimeout(20_000);
    expect(requests).toBe(0);
  });
});
