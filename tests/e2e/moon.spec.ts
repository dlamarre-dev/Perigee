import { expect, test } from '@playwright/test';

// Fixture data (tests/e2e/prepare-data.ts): a synthetic ephemeris for "lro" around 2026-09-26T12:00Z.
const FROZEN = 't=2026-09-26T12:00:00Z&rate=0';

test('lists lunar missions and shows an interpolated orbiter', async ({ page }) => {
  await page.goto(`./?lang=en&view=moon&${FROZEN}`);
  const panel = page.locator('#side-panel');
  await expect(panel).toContainText('Lunar Reconnaissance Orbiter (LRO)');
  await expect(panel).toContainText("Chang'e-7");
  await expect(page.locator('.notice')).toBeHidden({ timeout: 20_000 });
  await panel.locator('[data-mission="lro"]').click();
  const info = page.locator('aside.info');
  await expect(info.locator('.freshness')).toHaveAttribute('data-state', 'fresh');
  await expect(info).toContainText('JPL Horizons');
  await expect(info).toContainText('-85');
  await expect(page).toHaveURL(/view=moon/);
  await expect(page).toHaveURL(/sel=lro/);
});

test('missions without public ephemeris are listed but flagged', async ({ page }) => {
  await page.goto(`./?lang=fr&view=moon&${FROZEN}`);
  await page.locator('[data-mission="queqiao-2"]').click();
  const info = page.locator('aside.info');
  await expect(info.locator('.freshness')).toHaveAttribute('data-state', 'invalid');
  await expect(info).toContainText('Aucune éphéméride publique');
});

test('landing sites show coordinates and sources, restored from the URL', async ({ page }) => {
  await page.goto(`./?lang=en&view=moon&${FROZEN}&sel=site:apollo-11`);
  const info = page.locator('aside.info');
  await expect(info.locator('.panel-title')).toHaveText('Apollo 11');
  await expect(info).toContainText('0.674° N, 23.473° E');
  await expect(info.locator('.sources a').first()).toHaveAttribute('href', /^https:\/\//);
});

test('picking selects the orbiter under the pointer', async ({ page }) => {
  await page.goto(`./?lang=en&view=moon&${FROZEN}&e2e`);
  await expect(page.locator('.notice')).toBeHidden({ timeout: 20_000 });
  await page.waitForTimeout(500);
  const ok = await page.evaluate(() =>
    (window as unknown as { __perigeeTest: { lookAt(id: string): boolean } }).__perigeeTest.lookAt('lro'),
  );
  expect(ok).toBe(true);
  await page.waitForTimeout(300);
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('aside.info .panel-title')).toHaveText('Lunar Reconnaissance Orbiter (LRO)');
});

test('switching views keeps the time and language', async ({ page }) => {
  await page.goto(`./?lang=fr&${FROZEN}`);
  await page.getByRole('button', { name: 'Lune', exact: true }).click();
  await expect(page).toHaveURL(/view=moon/);
  await expect(page.locator('#side-panel')).toContainText('Autour de la Lune');
  await page.getByRole('button', { name: 'Terre', exact: true }).click();
  await expect(page).not.toHaveURL(/view=/);
  await expect(page).toHaveURL(/t=2026-09-26T12%3A00%3A00Z/);
});
