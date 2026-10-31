import { expect, test } from '@playwright/test';

// Landing pages (src/landing/): static content, live values from the engine over the fixtures, the place, the
// language banner and the dashboard. The fixtures are frozen around 2026-09-26 12:00 UTC: so is the page clock.
const FROZEN = new Date('2026-09-26T12:00:00Z');

test.use({ geolocation: { latitude: 45.50171, longitude: -73.56732 }, permissions: ['geolocation'] });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FROZEN);
  // Replies of the 3D view to the page's `set { observer }` calls.
  await page.addInitScript(() => {
    const w = window as unknown as { observerReplies: unknown[] };
    w.observerReplies = [];
    addEventListener('message', (e: MessageEvent) => {
      const m = e.data as { id?: string } | null;
      if (m?.id === 'observer') w.observerReplies.push(m);
    });
  });
});

test('a satellite page shows the live position, the ground track and the passes over the visitor', async ({
  page,
}) => {
  // Engine, map, passes, then a reload: over the default 30 s on CI runners.
  test.slow();
  await page.goto('./en/where-is-the-iss/');
  await expect(page).toHaveTitle('Where is the International Space Station now? | Perigee');
  await expect(page.locator('link[hreflang="fr"]')).toHaveAttribute(
    'href',
    'https://perigee.info/fr/ou-est-la-station-spatiale/',
  );
  await expect(page.locator('#lp-answer-text')).toContainText(
    /International Space Station .* km up, moving at/,
    {
      timeout: 30_000,
    },
  );
  await expect(page.locator('.lp-card')).not.toHaveCount(0);
  await expect(page.locator('#lp-map-svg .gt-future')).toHaveAttribute('d', /^M/, { timeout: 30_000 });
  await expect(page.locator('#lp-provenance')).toContainText('CelesTrak');
  // The capture first, then the 3D view once the page has loaded and the frame is in sight.
  await expect(page.locator('.lp-view iframe')).toHaveAttribute('src', /embed=1/, { timeout: 30_000 });
  await expect(page.locator('.lp-view')).toHaveClass(/lp-view-live/, { timeout: 30_000 });

  await page.locator('#lp-locate').click();
  await expect(page.locator('#lp-place-status')).toContainText('45.500° N, 73.570° W');
  await expect(page.locator('#lp-place-out')).toContainText(/Next passes over you/, { timeout: 30_000 });
  await expect(page.locator('#lp-map-svg .gt-you')).toBeVisible();
  // The 3D view got the place through the embed API.
  await expect
    .poll(
      () =>
        page.evaluate(() => (window as unknown as { observerReplies: { ok: boolean }[] }).observerReplies),
      {
        timeout: 30_000,
      },
    )
    .toContainEqual(expect.objectContaining({ ok: true }));
  expect(await page.evaluate(() => localStorage.getItem('perigee-observer'))).toBe(
    '{"latDeg":45.5,"lonDeg":-73.57}',
  );
  expect(page.url()).not.toContain('45.5');

  // Kept in this browser, until forgotten.
  await page.reload();
  await expect(page.locator('#lp-place-status')).toContainText('45.500° N');
  await page.locator('#lp-forget').click();
  await expect(page.locator('#lp-place-status')).toHaveText('');
  expect(await page.evaluate(() => localStorage.getItem('perigee-observer'))).toBeNull();
});

test('a probe page gives its live distance; the dashboard hides the article', async ({ page }) => {
  await page.goto('./fr/distance-voyager-1/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.locator('#lp-answer-text')).toContainText(/Voyager 1 est à .* de la Terre/, {
    timeout: 30_000,
  });
  await expect(page.locator('#lp-locate')).toHaveCount(0);
  await page.locator('#lp-dashboard').click();
  await expect(page.locator('html')).toHaveClass(/lp-dashboard/);
  // The dashboard does not wait for the 3D view to scroll into sight.
  await expect(page.locator('.lp-view iframe')).toHaveAttribute('src', /embed=1/);
  await expect(page.locator('.lp-faq')).toBeHidden();
  expect(page.url()).toContain('dashboard=1');
});

test.describe('in a French browser', () => {
  test.use({ locale: 'fr-CA' });

  test('the English page suggests the French one, and the hub lists every guide', async ({ page }) => {
    await page.goto('./en/moon-phase-today/');
    const banner = page.locator('#lp-lang-banner');
    await expect(banner).toBeVisible();
    await expect(banner.locator('a')).toHaveAttribute('href', /\/fr\/phase-de-la-lune-aujourdhui\/$/);
    await expect(page.locator('#lp-answer-text')).toContainText(/Moon phase: .* lit/, { timeout: 30_000 });
    await banner.getByRole('button').click();
    await expect(banner).toBeHidden();
    await page.goto('./fr/');
    await expect(page.locator('#lp-lang-banner')).toBeHidden();
    await expect(page.locator('.lp-hub-list a')).not.toHaveCount(0);
    expect(await page.locator('.lp-hub-list a').count()).toBeGreaterThanOrEqual(40);
  });
});
