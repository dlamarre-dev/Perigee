import { expect, type Page } from '@playwright/test';

/**
 * Sets the simulation speed with whichever control the bottom bar shows: the speed buttons on wide screens, the
 * list once the bar has shrunk (its level depends on the window and the fonts, src/ui/TimeControl.ts).
 */
export async function setRate(page: Page, rate: number): Promise<void> {
  const bar = page.locator('.time-control');
  await expect(bar).toHaveAttribute('data-fit', /.+/);
  const button = bar.locator(`button[data-rate="${rate}"]`);
  if (await button.isVisible()) await button.click();
  else await bar.locator('select.rate-select').selectOption(String(rate));
}
