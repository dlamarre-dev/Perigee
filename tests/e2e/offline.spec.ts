import { expect, test } from '@playwright/test';

test('works offline after a first visit (service worker)', async ({ page, context }) => {
  // Two full page loads plus the worker's caching, on software WebGL.
  test.setTimeout(90_000);
  // Listen before any page script runs: the "cached" reply can arrive early.
  await page.addInitScript(() => {
    const w = window as unknown as { swCached: boolean };
    w.swCached = false;
    navigator.serviceWorker.addEventListener('message', (e: MessageEvent<{ type?: string }>) => {
      if (e.data.type === 'cached') w.swCached = true;
    });
  });
  await page.goto('./?lang=en');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  // Wait for the worker to take control and cache what the first visit loaded.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { swCached: boolean }).swCached), {
      timeout: 20_000,
    })
    .toBe(true);
  // …including what the view fetched itself (manifest, datasets) and the SGP4 worker script, written
  // asynchronously by the worker (the worker script may only arrive with the page's later hand-off, after 3 s).
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const urls: string[] = [];
          for (const k of await caches.keys())
            for (const r of await (await caches.open(k)).keys()) urls.push(r.url);
          return [
            'data/manifest.json',
            'data/earth/gp-active.json.gz',
            'data/earth/satcat.json.gz',
            'assets/propagation.worker-',
          ].every((p) => urls.some((u) => u.includes(p)));
        }),
      { timeout: 30_000 },
    )
    .toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recenter' })).toBeVisible();
  await expect(page.getByText('Offline — showing cached data')).toBeVisible();
  // Satellites come from the cached data files.
  await expect(page.locator('.notice')).toBeHidden();
  await context.setOffline(false);
});
