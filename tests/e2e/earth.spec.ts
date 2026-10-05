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
  await expect(page.locator('aside.info:visible .panel-title')).toHaveText(
    'Station spatiale internationale (ISS)',
  );
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
  // Loading (up to 20 s) plus picking retries (up to 20 s): more than the default budget on slow CI runners.
  test.setTimeout(60_000);
  await page.goto(`./?lang=en&${FROZEN}&e2e`);
  await waitForSatellites(page);
  const box = await page.locator('#viewport canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  // The first SGP4 propagation reaches the GPU asynchronously (slow on software WebGL): retry until it has.
  await expect(async () => {
    const ok = await page.evaluate(() =>
      (window as unknown as { __perigeeTest: { lookAt(n: number): boolean } }).__perigeeTest.lookAt(20580),
    );
    expect(ok).toBe(true);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('aside.info:visible .panel-title')).toHaveText('Hubble Space Telescope (HST)', {
      timeout: 1000,
    });
  }).toPass({ timeout: 20_000 });
  await expect(page).toHaveURL(/sel=20580/);
});

test('a NASA 3D model previews in the info panel when the object has one', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('./?lang=en&sel=25544');
  const info = page.locator('aside.info:visible');
  await expect(info.locator('.panel-title')).toContainText('ISS', { timeout: 30_000 });
  const preview = info.locator('figure.model-preview');
  await expect(preview).toBeVisible({ timeout: 10_000 });
  await expect(preview).toContainText('3D model: NASA');
  await expect(preview.locator('canvas')).toBeVisible();
  // An object without a model hides it.
  await page.goto('./?lang=en&sel=100830');
  await expect(page.locator('aside.info:visible .panel-title')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('aside.info:visible figure.model-preview')).toBeHidden();
});

test('space and Earth science satellites come first, with their known names, status and sources', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('./?lang=en&sel=25544');
  const section = page.locator('#side-panel details[data-facet]').first();
  await expect(section).toHaveAttribute('data-facet', 'science', { timeout: 30_000 });
  await expect(section).toHaveAttribute('open', '');
  await expect(section).toContainText('International Space Station (ISS)');
  const info = page.locator('aside.info:visible');
  await expect(info.locator('.panel-title')).toHaveText('International Space Station (ISS)', {
    timeout: 30_000,
  });
  await expect(info).toContainText('ISS (ZARYA)');
  await expect(info).toContainText('Checked');
  await expect(info.locator('.sources a').first()).toBeVisible();
});

test('the science section selects or deselects all its satellites in one click', async ({ page }) => {
  await page.goto(`./?lang=en&${FROZEN}`);
  await waitForSatellites(page);
  const section = page.locator('#side-panel details[data-facet="science"]');
  const all = section.getByLabel('Select all');
  const iss = section.getByLabel('International Space Station (ISS)');
  await expect(all).not.toBeChecked();
  await iss.check();
  // Some selected: half-checked.
  await expect(section.getByLabel('Select all')).toHaveJSProperty('indeterminate', true);
  await section.getByLabel('Select all').check();
  // Fixture: two science satellites (ISS, HST); ELECTRON R/B is filtered out.
  await expect(page.locator('.stats')).toContainText('2 shown of 3');
  await expect(section.getByLabel('Hubble Space Telescope (HST)')).toBeChecked();
  await section.getByLabel('Select all').uncheck();
  await expect(page.locator('.stats')).toContainText('3 shown of 3');
  await expect(section.getByLabel('International Space Station (ISS)')).not.toBeChecked();
  await expect(page).toHaveTitle('Perigee - objects in orbit, in real time');
});
