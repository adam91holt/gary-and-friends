import { expect, test } from '@playwright/test';

/** Regression coverage for input actions that must be inert outside a run. */
test('menu and game-over preserve Gary lane', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(err.message);
  });

  await page.goto('/');
  await page.waitForFunction(() => window.__GARY__?.ready === true, null, {
    timeout: 15_000,
  });

  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => window.__GARY__?.lane)).toBe(1);

  await page.evaluate(() => {
    window.__GARY__?.start();
    window.__GARY__?.__setLane(2);
    window.__GARY__?.__forceCollision();
  });
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('gameover');

  await page.keyboard.press('ArrowLeft');
  expect(await page.evaluate(() => window.__GARY__?.lane)).toBe(2);

  await page.screenshot({
    path: 'test-results/state-guards.png',
    fullPage: true,
  });
  expect(consoleErrors).toEqual([]);
});
