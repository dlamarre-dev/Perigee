import { expect, test } from '@playwright/test';

const FROZEN = 't=2026-09-26T12:00:00Z&rate=0';

test('shows planets with distances and light time', async ({ page }) => {
  await page.goto(`./?lang=en&view=solar&${FROZEN}`);
  const panel = page.locator('#side-panel');
  await expect(panel).toContainText('Solar system');
  await panel.locator('button[data-planet="jupiter"]').click();
  const info = page.locator('aside.info:visible');
  await expect(info.locator('.panel-title')).toHaveText('Jupiter');
  await expect(info).toContainText('Distance to the Sun');
  await expect(info).toContainText('light time');
  // How the position is computed, as for the moons.
  await expect(info.locator('.freshness')).toContainText('VSOP87');
  await expect(info.locator('.freshness')).toHaveAttribute('data-state', 'fresh');
  await expect(page).toHaveURL(/view=solar/);
  await expect(page).toHaveURL(/sel=jupiter/);
});

test('logarithmic scale is flagged as not to scale and kept in the URL', async ({ page }) => {
  await page.goto(`./?lang=fr&view=solar&${FROZEN}&sel=neptune`);
  await page.getByLabel('Distances logarithmiques (pas à l’échelle)').check();
  await expect(page).toHaveURL(/log=1/);
  await expect(page.locator('aside.info:visible .freshness')).toContainText('pas à l’échelle');
});

test('picking selects the planet under the pointer', async ({ page }) => {
  await page.goto(`./?lang=en&view=solar&${FROZEN}&e2e`);
  const box = await page.locator('#viewport canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  await expect(async () => {
    const ok = await page.evaluate(() =>
      (window as unknown as { __perigeeTest: { lookAt(id: string): boolean } }).__perigeeTest.lookAt('mars'),
    );
    expect(ok).toBe(true);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('aside.info:visible .panel-title')).toHaveText('Mars', { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
});

test('spacecraft show heliocentric distance and interpolated provenance', async ({ page }) => {
  await page.goto(`./?lang=en&view=solar&${FROZEN}`);
  await expect(page.locator('.notice')).toBeHidden({ timeout: 20_000 });
  await page.locator('#side-panel [data-mission="voyager-1"]').click();
  const info = page.locator('aside.info:visible');
  await expect(info.locator('.freshness')).toHaveAttribute('data-state', 'fresh');
  await expect(info).toContainText('Distance to the Sun');
  await expect(info).toContainText('AU');
});

test('a body hides the labels of objects behind it', async ({ page }) => {
  await page.goto(`./?lang=en&view=solar&${FROZEN}&e2e`);
  const pluto = page.locator('.label', { hasText: /^Pluto$/ });
  type Hook = { lookThrough: (f: string, b: string, d: number, o: number) => boolean };
  const look = (offsetRadii: number) =>
    page.evaluate(
      (o) =>
        (window as unknown as { __perigeeTest: Hook }).__perigeeTest.lookThrough('saturn', 'pluto', 1.2e6, o),
      offsetRadii,
    );
  // Pluto just outside Saturn's disc: labelled.
  await expect(async () => {
    expect(await look(1.6)).toBe(true);
    await expect(pluto).toHaveAttribute('data-shown', 'true', { timeout: 1500 });
  }).toPass({ timeout: 15_000 });
  // Pluto behind Saturn's disc: hidden.
  await expect(async () => {
    expect(await look(0.6)).toBe(true);
    await expect(pluto).toHaveAttribute('data-shown', 'false', { timeout: 1500 });
  }).toPass({ timeout: 15_000 });
});

test('moons unfold under the selected planet, fold again, and F toggles follow', async ({ page }) => {
  await page.goto(`./?lang=en&view=solar&${FROZEN}`);
  const panel = page.locator('#side-panel');
  const moons = panel.locator('ul.moon-list[data-planet="jupiter"]');
  await expect(moons).toBeHidden();
  await panel.locator('button[data-planet="jupiter"]').click();
  await expect(moons).toBeVisible();
  await expect(panel.locator('button[data-planet="jupiter"]')).toHaveAttribute('aria-expanded', 'true');
  await moons.locator('[data-moon="europa"]').click();
  const info = page.locator('aside.info:visible');
  await expect(info.locator('.panel-title')).toHaveText('Europa');
  await expect(info).toContainText('Jupiter');
  await expect(page).toHaveURL(/sel=moon(:|%3A)europa/);
  await expect(moons).toBeVisible();
  const follow = info.getByRole('button', { name: 'Follow' });
  await page.locator('#viewport canvas').focus();
  await page.keyboard.press('f');
  await expect(info.locator('button[aria-pressed="true"]')).toBeVisible();
  await page.keyboard.press('f');
  await expect(follow).toHaveAttribute('aria-pressed', 'false');
  await panel.locator('button[data-planet="saturn"]').click();
  await expect(moons).toBeHidden();
  await expect(panel.locator('ul.moon-list[data-planet="saturn"]')).toBeVisible();
});

test('F follows a moon selected a moment ago, even before the next frame (slow devices)', async ({
  page,
}) => {
  await page.goto(`./?lang=en&view=solar&${FROZEN}`);
  const panel = page.locator('#side-panel');
  await panel.locator('button[data-planet="jupiter"]').click();
  await expect(panel.locator('[data-moon="callisto"]')).toBeVisible();
  // Selection and key in one task, so no frame runs in between (what a slow device does): Callisto, too small
  // to show from here, has not been solved yet.
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('[data-moon="callisto"]')?.click();
    const canvas = document.querySelector('#viewport canvas');
    canvas?.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
  });
  await expect(
    page.locator('aside.info:visible').getByRole('button', { name: 'Stop following' }),
  ).toBeVisible();
});

test('a moon with Horizons vectors says so; the others keep their model', async ({ page }) => {
  await page.goto(`./?lang=en&view=solar&${FROZEN}&sel=moon:titan`);
  const info = page.locator('aside.info:visible');
  await expect(info.locator('.panel-title')).toHaveText('Titan');
  await expect(info.locator('.freshness')).toContainText('JPL Horizons');
  await expect(info.locator('.freshness')).toHaveAttribute('data-state', 'fresh');
  await expect(info.locator('.sources a[href="https://ssd.jpl.nasa.gov/horizons/"]')).toHaveCount(1);
  // Rhea has no vectors in the fixture data: approximate, from mean elements.
  await page.goto(`./?lang=en&view=solar&${FROZEN}&sel=moon:rhea`);
  await expect(info.locator('.freshness')).toContainText('mean orbital elements');
});

test('the Sun can be selected: figures, Carrington rotation and where the sunspots come from', async ({
  page,
}) => {
  await page.goto(`./?lang=en&view=solar&${FROZEN}`);
  await page.locator('#side-panel button[data-sun]').click();
  const info = page.locator('aside.info:visible');
  await expect(info.locator('.panel-title')).toHaveText('Sun');
  await expect(info).toContainText('G2V');
  await expect(info).toContainText('Carrington rotation');
  await expect(info).toContainText('NOAA');
  await expect(page).toHaveURL(/sel=sun/);
  await page.reload();
  await expect(page.locator('aside.info:visible .panel-title')).toHaveText('Sun');
});

test("a followed body's label gives way to its disc and comes back when zooming out", async ({ page }) => {
  await page.goto(`./?lang=en&view=solar&sel=saturn&${FROZEN}`);
  const saturn = page.locator('.label', { hasText: /^Saturn$/ });
  await page.locator('#viewport canvas').focus();
  await page.keyboard.press('f');
  // Framed at ten radii: the disc spans far more than 10 px.
  await expect(saturn).toHaveAttribute('data-shown', 'false', { timeout: 15_000 });
  // Still following, far enough for the disc to shrink under 10 px.
  for (let i = 0; i < 40; i++) await page.keyboard.press('Minus');
  await expect(saturn).toHaveAttribute('data-shown', 'true', { timeout: 15_000 });
});
