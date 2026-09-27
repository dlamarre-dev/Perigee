import { expect, test, type Page } from '@playwright/test';

// Fixture data (tests/e2e/prepare-data.ts): HST, ISS and ELECTRON R/B (NORAD 100830). Time is frozen
// close to the fixture epochs so results do not drift as the calendar moves.
const FROZEN = 't=2026-09-26T12:00:00Z&rate=0';

async function waitForSatellites(page: Page): Promise<void> {
  await expect(page.locator('.stats')).toContainText('3 shown of 3', { timeout: 20_000 });
}

test('loads the catalogue and lists objects', async ({ page }) => {
  await page.goto(`./?lang=en&${FROZEN}`);
  await waitForSatellites(page);
  await expect(page.locator('.result')).toHaveCount(3);
});

test('searches a 6-digit NORAD number and shows its details', async ({ page }) => {
  await page.goto(`./?lang=en&${FROZEN}`);
  await waitForSatellites(page);
  await page.fill('#filter-search', '100830');
  await expect(page.locator('.result')).toHaveCount(1);
  await page.locator('.result').click();
  const info = page.locator('aside.info:visible');
  await expect(info).toBeVisible();
  await expect(info.locator('.panel-title')).toHaveText('ELECTRON R/B');
  await expect(info).toContainText('100830');
  await expect(page).toHaveURL(/sel=100830/);
  await expect(page).toHaveURL(/q=100830/);
});

test('restores filters and selection from the URL, in French', async ({ page }) => {
  await page.goto(`./?lang=fr&${FROZEN}&own=ISS&sel=25544`);
  await expect(page.locator('.stats')).toContainText('1 affichés sur 3', { timeout: 20_000 });
  await expect(page.locator('aside.info:visible .panel-title')).toHaveText('ISS (ZARYA)');
  await expect(page.locator('aside.info:visible')).toContainText('Station spatiale internationale');
  await expect(page.locator('aside.info:visible .freshness')).toHaveAttribute('data-state', 'fresh');
});

test('facet checkboxes filter and update the URL', async ({ page }) => {
  await page.goto(`./?lang=en&${FROZEN}`);
  await waitForSatellites(page);
  await page.locator('details[data-facet="groups"] summary').click();
  await page.getByLabel('Space stations').check();
  await expect(page.locator('.stats')).toContainText('1 shown of 3');
  await expect(page).toHaveURL(/grp=stations/);
});

test('GPU picking selects the object under the pointer', async ({ page }) => {
  await page.goto(`./?lang=en&${FROZEN}&e2e`);
  await waitForSatellites(page);
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  // The first SGP4 propagation reaches the GPU asynchronously (slow on software WebGL): retry until it has.
  await expect(async () => {
    const ok = await page.evaluate(() =>
      (window as unknown as { __perigeeTest: { lookAt(n: number): boolean } }).__perigeeTest.lookAt(20580),
    );
    expect(ok).toBe(true);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('aside.info:visible .panel-title')).toHaveText('HST', { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(page).toHaveURL(/sel=20580/);
});
