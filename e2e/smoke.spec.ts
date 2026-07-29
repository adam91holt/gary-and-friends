import { expect, test } from '@playwright/test';

/**
 * Scaffold smoke test — the shape the factory extends for real gameplay e2e.
 * Proves the harness end to end: page loads, WebGL renders, the __GARY__ test
 * API reports ready in the menu state, and nothing errored to the console.
 */
test('loads, renders WebGL, exposes __GARY__, no console errors', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(err.message);
  });

  await page.goto('/');

  // Wait for the game to signal it has rendered at least one frame.
  await page.waitForFunction(() => window.__GARY__?.ready === true, null, {
    timeout: 15_000,
  });

  // The canvas exists and is visible.
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();

  // A real WebGL context exists on that canvas.
  const hasWebGL = await page.evaluate(() => {
    const el = document.querySelector('canvas');
    if (!el) return false;
    const gl =
      el.getContext('webgl2') ??
      el.getContext('webgl') ??
      el.getContext('experimental-webgl');
    return gl !== null;
  });
  expect(hasWebGL).toBe(true);

  // Test API contract: menu state, zero score, ready.
  const api = await page.evaluate(() => ({
    state: window.__GARY__?.state,
    score: window.__GARY__?.score,
    ready: window.__GARY__?.ready,
  }));
  expect(api.state).toBe('menu');
  expect(api.score).toBe(0);
  expect(api.ready).toBe(true);

  // Visual review artifact.
  await page.screenshot({ path: 'test-results/smoke-menu.png', fullPage: true });

  // No console errors the whole time.
  expect(consoleErrors).toEqual([]);
});
