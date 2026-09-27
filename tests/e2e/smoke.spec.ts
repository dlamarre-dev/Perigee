import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

/** Fraction of pixels that are not background-black (decoded in Node, not in the page). */
async function nonBlackFraction(page: Page): Promise<number> {
  const png = await page.locator('canvas').screenshot();
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let lit = 0;
  const pixels = info.width * info.height;
  for (let i = 0; i < data.length; i += 3) {
    if ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0) > 60) lit++;
  }
  return lit / pixels;
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
  await page.getByRole('button', { name: '×100', exact: true }).click();
  await expect(page).toHaveURL(/rate=100/);
  await page.getByRole('button', { name: 'Now' }).click();
  await expect(page).not.toHaveURL(/rate=/);
});
