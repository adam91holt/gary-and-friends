import { test } from '@playwright/test';

// TEMPORARY verification-only spec (deleted after capture).
test('skeleton', async ({ page }) => {
  // Freeze rAF before the module boots so `ready` never flips.
  await page.addInitScript(() => {
    window.requestAnimationFrame = (() => 0) as unknown as typeof requestAnimationFrame;
  });
  await page.goto('/');
  await page.waitForSelector('#hud[data-screen="loading"]');
  await page.waitForTimeout(400);
  await page.screenshot({
    path: 'test-results/tmp-skeleton.png',
    fullPage: true,
  });
});
