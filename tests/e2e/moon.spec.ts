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
  const box = await page.locator('#viewport canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  await expect(async () => {
    const ok = await page.evaluate(() =>
      (window as unknown as { __perigeeTest: { lookAt(id: string): boolean } }).__perigeeTest.lookAt('lro'),
    );
    expect(ok).toBe(true);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('aside.info .panel-title')).toHaveText('Lunar Reconnaissance Orbiter (LRO)', {
      timeout: 1000,
    });
  }).toPass({ timeout: 20_000 });
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

test('missions can be hidden one by one or all at once, and the choice is kept in the URL', async ({
  page,
}) => {
  // Labels fade in over several frames; on software WebGL that takes a while, twice, plus a reload.
  test.setTimeout(90_000);
  await page.goto(`./?lang=en&view=moon&${FROZEN}&e2e`);
  await expect(page.locator('.notice')).toBeHidden({ timeout: 20_000 });
  const label = page.locator('.label', { hasText: 'Lunar Reconnaissance Orbiter (LRO)' });
  // Look at LRO from above so its label is on screen.
  await expect(async () => {
    const ok = await page.evaluate(() =>
      (window as unknown as { __perigeeTest: { lookAt(id: string): boolean } }).__perigeeTest.lookAt('lro'),
    );
    expect(ok).toBe(true);
    await expect(label).toHaveAttribute('data-shown', 'true', { timeout: 1500 });
  }).toPass({ timeout: 15_000 });
  const box = page.locator('#side-panel input[data-toggle="lro"]');
  await box.uncheck();
  await expect(page).toHaveURL(/hide=lro/);
  await expect(label).toHaveAttribute('data-shown', 'false');
  await page.getByRole('button', { name: 'Show all' }).click();
  await expect(box).toBeChecked();
  await expect(page).not.toHaveURL(/hide=/);
  await expect(label).toHaveAttribute('data-shown', 'true', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Hide all' }).click();
  await expect(page).toHaveURL(/hide=[^&]*lro/);
  // A fresh load of the shared URL (page.reload can race the page's own history updates in CI).
  await page.goto(page.url());
  await expect(page.locator('#side-panel input[data-toggle="lro"]')).not.toBeChecked();
});

test('a shared link to a spacecraft frames it once its ephemeris has loaded', async ({ page }) => {
  type Hook = { camera(): { positionKm: number[] } };
  const cameraDir = () =>
    page.evaluate(() => {
      const p = (window as unknown as { __perigeeTest: Hook }).__perigeeTest.camera().positionKm;
      const n = Math.hypot(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);
      return p.map((v) => v / n);
    });
  // Home viewpoint, without a selection.
  await page.goto(`./?lang=en&view=moon&${FROZEN}&e2e`);
  await expect(page.locator('.notice')).toBeHidden({ timeout: 20_000 });
  const home = await cameraDir();
  await page.goto(`./?lang=en&view=moon&${FROZEN}&sel=lro&e2e`);
  await expect(page.locator('.notice')).toBeHidden({ timeout: 20_000 });
  await expect
    .poll(
      async () => {
        const d = await cameraDir();
        return Math.acos(
          Math.min(
            1,
            d.reduce((s, v, i) => s + v * (home[i] ?? 0), 0),
          ),
        );
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0.05);
});

test('switching views quickly leaves exactly one view', async ({ page }) => {
  await page.goto(`./?lang=en&view=earth&${FROZEN}`);
  await page.getByRole('button', { name: 'Moon', exact: true }).click();
  await page.getByRole('button', { name: 'Mars', exact: true }).click();
  await expect(page).toHaveURL(/view=mars/);
  await expect(page.locator('#side-panel')).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator('#side-panel')).toContainText('Around Mars');
  await page.waitForTimeout(3000);
  await expect(page.locator('#side-panel')).toHaveCount(1);
  await expect(page.locator('aside.side-panel')).toHaveCount(2);
});

test('site notes follow the interface language', async ({ page }) => {
  await page.goto(`./?lang=fr&view=moon&${FROZEN}&sel=site:apollo-11`);
  const info = page.locator('aside.info');
  await expect(info).toContainText('Étage de descente du module lunaire');
  await expect(info).toContainText('0,674° N; 23,473° E');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(info).toContainText('Lunar Module descent stage');
});

test('the details panel collapses to its header and back, keeping the selection', async ({ page }) => {
  await page.goto(`./?lang=en&view=moon&${FROZEN}&sel=site:apollo-11`);
  const info = page.locator('aside.info');
  const sources = info.locator('.sources');
  await expect(sources).toBeVisible();
  const toggle = info.locator('.panel-minimize');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(sources).toBeHidden();
  await expect(info.locator('.panel-title')).toHaveText('Apollo 11');
  await expect(page).toHaveURL(/sel=site%3Aapollo-11|sel=site:apollo-11/);
  await toggle.click();
  await expect(sources).toBeVisible();
});

test('dragging the altimeter zooms the camera', async ({ page }) => {
  await page.goto(`./?lang=en&view=moon&${FROZEN}&e2e`);
  const altimeter = page.getByRole('slider');
  await expect(altimeter).toBeVisible();
  await expect(altimeter).toHaveAttribute('aria-valuetext', /km$/);
  const distance = (): Promise<number> =>
    page.evaluate(
      () =>
        (
          window as unknown as { __perigeeShell: { camera(): { distanceKm: number } } }
        ).__perigeeShell.camera().distanceKm,
    );
  const before = await distance();
  const box = await page.locator('.altimeter-scale').boundingBox();
  if (!box) throw new Error('no altimeter');
  await page.mouse.move(box.x + 20, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + box.height * 0.95, { steps: 8 });
  await page.mouse.up();
  await expect.poll(distance).toBeLessThan(before * 0.5);
});

test('the arrow keys on the altimeter zoom too', async ({ page }) => {
  await page.goto(`./?lang=en&view=moon&${FROZEN}&e2e`);
  const altimeter = page.getByRole('slider');
  await expect(altimeter).toBeVisible();
  // The altimeter scales the height above the surface (mean lunar radius 1737.4 km). The camera rests at its
  // home distance after loading: no easing in flight to race with (software WebGL draws few frames on CI).
  const altitude = (): Promise<number> =>
    page.evaluate(
      () =>
        (
          window as unknown as { __perigeeShell: { camera(): { distanceKm: number } } }
        ).__perigeeShell.camera().distanceKm - 1737.4,
    );
  const before = await altitude();
  await altimeter.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  // Two steps of exp(-0.15): about ×0.74.
  await expect.poll(altitude).toBeLessThan(before * 0.85);
  const lower = await altitude();
  await page.keyboard.press('PageUp');
  await expect.poll(altitude).toBeGreaterThan(lower * 1.5);
});
