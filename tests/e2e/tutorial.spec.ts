import { expect, test, type Page } from '@playwright/test';

const card = (page: Page) => page.locator('.tutorial .tutorial-card');
const ring = (page: Page) => page.locator('.tutorial .tutorial-ring');

test('the welcome window shows once; "Explore freely" remembers it', async ({ page }) => {
  // Automated browsers never get it unasked (navigator.webdriver): ?welcome=1 forces it.
  await page.goto('./?lang=en&welcome=1');
  const welcome = page.locator('dialog.welcome');
  // It opens once the first view has loaded.
  await expect(welcome).toBeVisible({ timeout: 30_000 });
  await expect(welcome.getByRole('heading')).toHaveText('Welcome to Perigee');
  await welcome.getByRole('button', { name: 'Explore freely' }).click();
  await expect(welcome).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('perigee-welcome'))).toBe('1');
  await expect(page.locator('.tutorial')).toHaveCount(0);
});

test('the guided tour lights one control at a time and can be quit', async ({ page }) => {
  await page.goto('./?lang=en&welcome=1');
  await page
    .locator('dialog.welcome')
    .getByRole('button', { name: 'Take the tour' })
    .click({ timeout: 30_000 });
  await expect(card(page)).toContainText('Guided tour · 1 /');
  await expect(card(page)).toContainText('Tick the International Space Station', { timeout: 30_000 });
  // A click outside the lit control does nothing: no Moon view, no selection.
  await page.locator('.view-tabs button[data-view="moon"]').click({ force: true });
  await expect(page).not.toHaveURL(/view=moon/);
  // Playwright refuses a click whose point is covered: the lit control must be reachable.
  await page.locator('#f-science-25544').click();
  await expect(page.locator('#f-science-25544')).toBeChecked();
  await expect(card(page)).toContainText('Only the ISS is left');
  await page.locator('button.result[data-norad="25544"]').click();
  await expect(page).toHaveURL(/sel=25544/);
  // Observe: free camera, Next.
  await expect(card(page)).toContainText('follows the ISS');
  await expect(ring(page)).toBeHidden();
  // The top bar's way-out controls stay disabled while the camera is free, until a step asks for one.
  for (const control of ['.view-tabs button[data-view="moon"]', '.favorites-button', '.settings-button'])
    await expect(page.locator(control)).toBeDisabled();
  await card(page).getByRole('button', { name: 'Next' }).click();
  await expect(card(page)).toContainText('open the Moon view');
  await expect(ring(page)).toBeVisible();
  await expect(page.locator('.view-tabs button[data-view="moon"]')).toBeEnabled();
  await expect(page.locator('.view-tabs button[data-view="mars"]')).toBeDisabled();
  await page.locator('.view-tabs button[data-view="moon"]').click();
  await expect(page).toHaveURL(/view=moon/);
  await card(page).getByRole('button', { name: 'Quit the tour' }).click();
  await expect(page.locator('.tutorial')).toHaveCount(0);
  // The page is usable again.
  await page.locator('.view-tabs button[data-view="mars"]').click();
  await expect(page).toHaveURL(/view=mars/);
});

test('the settings window replays the tour', async ({ page }) => {
  await page.goto('./?lang=fr');
  await page.getByRole('button', { name: /^Réglages/ }).click();
  await page.locator('dialog.settings .settings-tutorial').click();
  await expect(page.locator('dialog.settings')).toBeHidden();
  await expect(card(page)).toContainText('Visite guidée · 1 /');
  await card(page).getByRole('button', { name: 'Quitter la visite' }).click();
  await expect(page.locator('.tutorial')).toHaveCount(0);
});
