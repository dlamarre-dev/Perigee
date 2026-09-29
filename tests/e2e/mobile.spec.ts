import { expect, test, type Page } from '@playwright/test';

// Runs in the "mobile" Playwright project (phone viewport, touch).
const FROZEN = 't=2026-09-26T12:00:00Z&rate=0';

function viewport(page: Page): { width: number; height: number } {
  const v = page.viewportSize();
  if (!v) throw new Error('no viewport');
  return v;
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('compact toolbar with a menu, view tabs and a docked time bar', async ({ page }) => {
  await page.goto('./?lang=en');
  await expect(page.locator('canvas')).toBeVisible();
  await noHorizontalOverflow(page);
  const toolbar = page.locator('.toolbar');
  const bar = await toolbar.boundingBox();
  if (!bar) throw new Error('no toolbar');
  // Brand + menu button on one row, view tabs on the second: well under a quarter of the screen.
  expect(bar.height).toBeLessThan(viewport(page).height * 0.2);
  await expect(page.getByRole('button', { name: 'Recenter' })).toBeHidden();

  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('button', { name: 'Recenter' })).toBeVisible();
  await page.getByRole('button', { name: 'FR', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  // Choosing an item closes the menu.
  await expect(page.getByRole('button', { name: 'Recentrer' })).toBeHidden();

  await page.getByRole('button', { name: 'Lune' }).click();
  await expect(page).toHaveURL(/view=moon/);

  const time = await page.locator('.time-control').boundingBox();
  if (!time) throw new Error('no time bar');
  expect(time.y + time.height).toBeLessThanOrEqual(viewport(page).height);
  expect(time.x).toBeGreaterThanOrEqual(0);
  expect(time.x + time.width).toBeLessThanOrEqual(viewport(page).width);
});

test('speed select drives the clock', async ({ page }) => {
  await page.goto('./?lang=en&view=solar');
  await page.locator('.rate-select').selectOption('100000');
  await expect(page).toHaveURL(/rate=100000/);
  // The Earth view caps the speed.
  await page.getByRole('button', { name: 'Earth' }).click();
  await expect(page.locator('.rate-select option[value="100000"]')).toBeDisabled();
  await expect(page).toHaveURL(/rate=10000(?!0)/);
});

test('panels are bottom sheets above the time bar, one at a time', async ({ page }) => {
  await page.goto(`./?lang=en&view=solar&${FROZEN}`);
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Missions' }).click();
  const list = page.locator('#side-panel');
  await expect(list).toBeVisible();
  const sheet = await list.boundingBox();
  const time = await page.locator('.time-control').boundingBox();
  if (!sheet || !time) throw new Error('missing boxes');
  expect(sheet.y + sheet.height).toBeLessThanOrEqual(time.y);
  await noHorizontalOverflow(page);

  await list.locator('button[data-planet="jupiter"]').click();
  const info = page.locator('aside.info:visible');
  await expect(info.locator('.panel-title')).toHaveText('Jupiter');
  await expect(list).toBeHidden();

  // The grab bar collapses the sheet to its first lines.
  const before = (await info.boundingBox())?.height ?? 0;
  await info.locator('.sheet-grab').click();
  await expect.poll(async () => (await info.boundingBox())?.height ?? 0).toBeLessThan(before);
});
