import { expect, test, type Page } from '@playwright/test';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

/** Fraction of sampled pixels that are not background-black. */
async function nonBlackFraction(page: Page): Promise<number> {
  const png = await page.locator('canvas').screenshot();
  return page.evaluate(
    async (bytes) => {
      const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d');
      if (!ctx) return 0;
      ctx.drawImage(bmp, 0, 0);
      const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
      let lit = 0;
      let total = 0;
      for (let i = 0; i < data.length; i += 4 * 97) {
        total++;
        if ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0) > 60) lit++;
      }
      return lit / total;
    },
    [...png],
  );
}

test('renders the Earth in English', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./?lang=en');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recenter' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  // Let textures load and a few frames render.
  await page.waitForTimeout(1500);
  expect(await nonBlackFraction(page)).toBeGreaterThan(0.05);
  expect(errors).toEqual([]);
});

test('renders in French and switches language live', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./?lang=fr');
  await expect(page.getByRole('button', { name: 'Recentrer' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Recenter' })).toBeVisible();
  await expect(page).toHaveURL(/lang=en/);
  expect(errors).toEqual([]);
});

test('time controls update the URL', async ({ page }) => {
  await page.goto('./?lang=en');
  await page.getByRole('button', { name: '×100' }).click();
  await expect(page).toHaveURL(/rate=100/);
  await page.getByRole('button', { name: 'Now' }).click();
  await expect(page).not.toHaveURL(/rate=/);
});
