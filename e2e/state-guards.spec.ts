import { expect, test } from '@playwright/test';

/**
 * Regression coverage for input actions that must be inert outside a run.
 *
 * (Renamed from the scratch-named `tmp-skel.spec.ts`; the assertions are
 * unchanged. Only the setup moved: a direction key on the cabinet screen now
 * navigates the game grid, so reaching a run takes an explicit card click
 * rather than a bare start button — which is exactly the guard being asserted,
 * since navigating the menu must still leave Gary's lane alone.)
 */
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

  // A real gesture exercises the AudioContext unlock path before the crash cue.
  await page.locator('#gcard-highway').click();
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('playing');
  await page.evaluate(() => {
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
