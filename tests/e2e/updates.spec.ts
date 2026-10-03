import { expect, test, type Page } from '@playwright/test';

// Open tabs learn about new deployments and newer data (src/app/updates.ts). The service worker is blocked so
// that page.route sees every request.
test.use({ serviceWorkers: 'block' });

const FROZEN = 't=2026-09-26T12:00:00Z&rate=0';

interface Shell {
  checkUpdates(): Promise<string | undefined>;
  camera(): { distanceKm: number; orientation: { x: number; y: number; z: number; w: number } };
}

const checkUpdates = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => (window as unknown as { __perigeeShell: Shell }).__perigeeShell.checkUpdates());
const camera = (page: Page): Promise<ReturnType<Shell['camera']>> =>
  page.evaluate(() => (window as unknown as { __perigeeShell: Shell }).__perigeeShell.camera());

async function openMoon(page: Page): Promise<void> {
  await page.goto(`./?lang=en&view=moon&${FROZEN}&e2e`);
  await expect(page.locator('.notice')).toBeHidden({ timeout: 20_000 });
}

const newBuild = (page: Page) =>
  page.route('**/version.json', (route) =>
    route.fulfill({ contentType: 'application/json', body: '{"commit":"0000000"}' }),
  );

test('a new build offers a refresh that keeps the view and the camera', async ({ page }) => {
  await openMoon(page);
  const home = await camera(page);
  await page.locator('#viewport canvas').focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('-');
  await page.waitForTimeout(2500);
  const before = await camera(page);
  const gap = (a: typeof home, b: typeof home): number =>
    Math.abs(a.distanceKm - b.distanceKm) / b.distanceKm +
    Math.abs(a.orientation.x - b.orientation.x) +
    Math.abs(a.orientation.y - b.orientation.y) +
    Math.abs(a.orientation.z - b.orientation.z) +
    Math.abs(a.orientation.w - b.orientation.w);
  expect(gap(before, home)).toBeGreaterThan(0.1);

  await newBuild(page);
  expect(await checkUpdates(page)).toBe('app');
  const notice = page.locator('.update-notice');
  await expect(notice).toContainText('A new version of Perigee is available.');
  await Promise.all([page.waitForEvent('load'), notice.getByRole('button', { name: 'Refresh' }).click()]);

  await expect(page).toHaveURL(/view=moon/);
  await expect(page).toHaveURL(/rate=0/);
  await expect(page.locator('.update-notice')).toBeHidden();
  await expect.poll(async () => gap(await camera(page), before)).toBeLessThan(1e-2);
});

test('a tab in the background reloads by itself when it comes back', async ({ page }) => {
  await openMoon(page);
  await newBuild(page);
  const setVisibility = (state: 'hidden' | 'visible') =>
    page.evaluate((s) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);
  await setVisibility('hidden');
  expect(await checkUpdates(page)).toBe('app');
  await expect(page.locator('.update-notice')).toBeHidden();
  await Promise.all([page.waitForEvent('load'), setVisibility('visible')]);
  await expect(page).toHaveURL(/view=moon/);
});

test('newer data for the current view are announced', async ({ page }) => {
  await page.goto(`./?lang=en&${FROZEN}&e2e`);
  await expect(page.locator('.stats')).toContainText('3 shown of 3', { timeout: 20_000 });
  await page.route('**/data/manifest.json', async (route) => {
    const res = await route.fetch();
    const manifest = (await res.json()) as { datasets: Record<string, { sha256: string }> };
    const gp = manifest.datasets['earth.gp'];
    if (gp) gp.sha256 = 'f'.repeat(64);
    await route.fulfill({ response: res, json: manifest });
  });
  expect(await checkUpdates(page)).toBe('data');
  await expect(page.locator('.update-notice')).toContainText('Newer data are available.');
});

test('a view chunk missing after a deployment reloads the page once', async ({ page }) => {
  let loads = 0;
  page.on('load', () => loads++);
  await page.goto(`./?lang=en&${FROZEN}`);
  await expect(page.locator('.stats')).toContainText('3 shown of 3', { timeout: 20_000 });
  await page.route('**/assets/MoonView-*.js', (route) => route.fulfill({ status: 404, body: '' }));
  await page.getByRole('button', { name: 'Moon' }).click();
  await expect.poll(() => loads).toBe(2);
  await expect(page).toHaveURL(/view=moon/);
  // The chunk still fails after the reload: no loop.
  await page.waitForTimeout(3000);
  expect(loads).toBe(2);
});
