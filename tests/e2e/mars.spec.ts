import { expect, test } from '@playwright/test';

// Fixture data (tests/e2e/prepare-data.ts): synthetic ephemerides for "mro" and "phobos".
const FROZEN = 't=2026-09-26T12:00:00Z&rate=0';

test('lists Mars missions and natural satellites, with honest provenance', async ({ page }) => {
  await page.goto(`./?lang=en&view=mars&${FROZEN}`);
  const panel = page.locator('#side-panel');
  await expect(panel).toContainText('Around Mars');
  await expect(page.locator('.notice')).toBeHidden({ timeout: 20_000 });
  await panel.locator('[data-mission="mro"]').click();
  const info = page.locator('aside.info:visible');
  await expect(info.locator('.freshness')).toHaveAttribute('data-state', 'fresh');
  await expect(info).toContainText('-74');
  await panel.locator('[data-mission="tianwen-1"]').click();
  await expect(info.locator('.freshness')).toHaveAttribute('data-state', 'invalid');
  await expect(page).toHaveURL(/view=mars/);
});

test('picking selects Phobos under the pointer', async ({ page }) => {
  await page.goto(`./?lang=fr&view=mars&${FROZEN}&e2e`);
  await expect(page.locator('.notice')).toBeHidden({ timeout: 20_000 });
  const box = await page.locator('#viewport canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  await expect(async () => {
    const ok = await page.evaluate(() =>
      (window as unknown as { __perigeeTest: { lookAt(id: string): boolean } }).__perigeeTest.lookAt(
        'phobos',
      ),
    );
    expect(ok).toBe(true);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('aside.info:visible .panel-title')).toHaveText('Phobos', { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.locator('aside.info:visible')).toContainText('Rayon moyen');
});
