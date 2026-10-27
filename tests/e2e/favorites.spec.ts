import { expect, test } from '@playwright/test';

const FROZEN = 't=2026-09-26T12:00:00Z&rate=0';

test('favorites: examples, save the current view, open it from another view, delete it', async ({ page }) => {
  await page.goto(`./?lang=en&view=solar&${FROZEN}&sel=jupiter`);
  await expect(page.locator('aside.info:visible .panel-title')).toHaveText('Jupiter');
  const dialog = page.locator('dialog.favorites');
  await page.locator('.favorites-button').click();
  await expect(dialog).toBeVisible();
  // The four fixed examples, then the save button.
  await expect(dialog.locator('.favorite:not(.saved)')).toHaveCount(4);
  await expect(dialog.locator('.favorite-name').nth(1)).toHaveText('Apollo 11');
  await expect(dialog.locator('.favorites-list > li').nth(4)).toContainText('Add the current view');
  await dialog.locator('.favorites-save').click();
  await expect(dialog.locator('.favorites-status')).toContainText('added');
  const saved = dialog.locator('.favorite.saved');
  await expect(saved).toHaveCount(1);
  await expect(saved.locator('.favorite-name')).toHaveText('Jupiter');
  await expect(saved.locator('.favorite-detail')).toContainText('Solar system');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();

  // From another view, the saved favorite brings back the view, the date and the selection.
  await page.locator('.view-tabs [data-view="moon"]').click();
  await expect(page).toHaveURL(/view=moon/);
  await page.locator('.favorites-button').click();
  await dialog.locator('.favorite.saved .favorite-link').click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/view=solar/);
  await expect(page).toHaveURL(/sel=jupiter/);
  await expect(page).toHaveURL(/t=2026-09-26T12%3A00%3A00Z|t=2026-09-26T12:00:00Z/);
  await expect(page.locator('aside.info:visible .panel-title')).toHaveText('Jupiter');

  // Deleting asks first; cancelling keeps it.
  await page.locator('.favorites-button').click();
  await dialog.locator('.favorite-delete').click();
  const confirm = page.locator('dialog.favorites-confirm');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(saved).toHaveCount(1);
  await dialog.locator('.favorite-delete').click();
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(saved).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('perigee-favorites'))).toBe('[]');
});

test('favorites: an example opens its view and selection', async ({ page }) => {
  await page.goto(`./?lang=en&${FROZEN}`);
  await page.locator('.favorites-button').click();
  await page.locator('dialog.favorites .favorite-link').nth(3).click();
  await expect(page).toHaveURL(/view=solar/);
  await expect(page).toHaveURL(/sel=voyager-1/);
  // Examples are in real time.
  await expect(page).not.toHaveURL(/t=2026-09-26/);
  await expect(page.locator('aside.info:visible .panel-title')).toHaveText('Voyager 1');
});

test('favorites: 50 at most, the list scrolls, and clear all asks first', async ({ page }) => {
  await page.goto(`./?lang=en&view=solar&${FROZEN}`);
  await page.evaluate(() => {
    const app = new URL('./', window.location.href).href;
    const items = Array.from({ length: 50 }, (_, i) => ({ url: `${app}?view=earth&sel=${i + 1}` }));
    localStorage.setItem('perigee-favorites', JSON.stringify(items));
  });
  const dialog = page.locator('dialog.favorites');
  await page.locator('.favorites-button').click();
  const saved = dialog.locator('.favorite.saved');
  await expect(saved).toHaveCount(50);
  const body = dialog.locator('.dialog-body');
  expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await dialog.locator('.favorites-save').click();
  await expect(dialog.locator('.favorites-status')).toContainText('No room left: 50 favorites at most');
  await expect(saved).toHaveCount(50);

  const confirm = page.locator('dialog.favorites-confirm');
  await dialog.getByRole('button', { name: 'Clear all' }).click();
  await expect(confirm).toContainText('Clear all favorites?');
  await expect(confirm).toContainText('(50)');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(saved).toHaveCount(50);
  await dialog.getByRole('button', { name: 'Clear all' }).click();
  await confirm.getByRole('button', { name: 'Clear all' }).click();
  await expect(saved).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Clear all' })).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('perigee-favorites'))).toBe('[]');
});
