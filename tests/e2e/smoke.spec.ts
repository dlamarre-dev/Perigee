import { expect, test, type Page } from '@playwright/test';
import { setRate } from './helpers';
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
  const png = await page.locator('#viewport canvas').screenshot();
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
  await expect(page.locator('#viewport canvas')).toBeVisible();
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
  await setRate(page, 100);
  await expect(page).toHaveURL(/rate=100/);
  await page.getByRole('button', { name: 'Now' }).click();
  await expect(page).not.toHaveURL(/rate=/);
});

test('about panel shows the build version and the data refresh date', async ({ page }) => {
  await page.goto('./?lang=en');
  await page.getByRole('button', { name: 'About' }).click();
  const about = page.locator('dialog.about:not(.report)');
  await expect(about).toContainText(/Version: \w+/);
  await expect(about).toContainText(/Data last refreshed: satellites \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
});

test('report form sends to Web3Forms with the type, message and optional e-mail', async ({ page }) => {
  let sent: Record<string, unknown> | undefined;
  await page.route('https://api.web3forms.com/**', async (route) => {
    sent = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
  });
  await page.goto('./?lang=en');
  await page.getByRole('button', { name: 'Report', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Report a problem' });
  await expect(dialog).toBeVisible();
  // Empty description: the browser blocks the submission.
  await dialog.getByRole('button', { name: 'Send' }).click();
  expect(sent).toBeUndefined();
  await dialog.getByText('Wrong data', { exact: true }).click();
  await expect(dialog.getByLabel('Wrong data', { exact: true })).toBeChecked();
  await dialog.getByLabel('Description').fill('The ISS label is on the wrong side.');
  await dialog.getByLabel('E-mail (optional)').fill('visitor@example.com');
  await dialog.getByRole('button', { name: 'Send' }).click();
  await expect(dialog.locator('.report-status')).toHaveText('Thank you, your report was sent.');
  expect(sent).toMatchObject({
    type: 'data',
    message: 'The ISS label is on the wrong side.',
    email: 'visitor@example.com',
  });
});

test('report form shows an error when the service fails', async ({ page }) => {
  await page.route('https://api.web3forms.com/**', (route) => route.fulfill({ status: 500, body: '{}' }));
  await page.goto('./?lang=fr');
  await page.getByRole('button', { name: 'Signaler', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Signaler un problème' });
  await dialog.getByLabel('Description').fill('Un problème quelconque à signaler.');
  await dialog.getByRole('button', { name: 'Envoyer' }).click();
  await expect(dialog.locator('.report-status')).toHaveAttribute('data-state', 'error');
});

test('the top and bottom bars shrink step by step instead of wrapping', async ({ page }) => {
  await page.goto('./?lang=fr');
  await expect(page.getByRole('button', { name: 'Recentrer' })).toBeVisible();
  const fit = (sel: string) => page.locator(sel).getAttribute('data-fit');
  const height = async (sel: string) => (await page.locator(sel).boundingBox())?.height ?? 0;
  const seen = { toolbar: new Set<string | null>(), time: new Set<string | null>() };
  for (const width of [1600, 1250, 1100, 950, 760]) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(300);
    seen.toolbar.add(await fit('.toolbar'));
    seen.time.add(await fit('.time-control'));
    // One row of buttons for the top bar; one row for the bottom bar until the phone layout.
    expect(await height('.toolbar'), `top bar at ${width}px`).toBeLessThan(70);
    if ((await fit('.time-control')) !== 'phone') {
      expect(await height('.time-control'), `bottom bar at ${width}px`).toBeLessThan(70);
    }
  }
  expect([...seen.toolbar]).toEqual(expect.arrayContaining(['full', 'short', 'menu']));
  expect([...seen.time]).toEqual(expect.arrayContaining(['full', 'calendar', 'select', 'phone']));
});

test('a long dialog scrolls its body, its frame stays put', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 500 });
  await page.goto('./?lang=en');
  await page.locator('.toolbar button[aria-label="About"]').click();
  const dialog = page.locator('dialog.about:not(.report)');
  const body = dialog.locator('.dialog-body');
  await expect(body).toBeVisible();
  const scrolls = await body.evaluate((e) => e.scrollHeight > e.clientHeight);
  expect(scrolls).toBe(true);
  expect(await dialog.evaluate((e) => getComputedStyle(e).overflow)).toBe('hidden');
});
