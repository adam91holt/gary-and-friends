import { expect, test } from '@playwright/test';

/**
 * Foundation e2e — extends the scaffold smoke pattern to the shared game core.
 * Proves the harness end to end: page loads, WebGL renders, the __GARY__ test
 * API reports the full contract (state/score/friends/lane/speed), the state
 * machine drives menu -> playing -> gameover -> restart deterministically via
 * the pinned hooks, and nothing errors to the console. Screenshots of the menu
 * and an in-play frame are captured for the taste reviewer.
 */
test('boots, exposes the game-core contract, and drives the state machine', async ({
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

  // Full test-API contract present in the menu: centred (lane 1), idle, empty.
  const menu = await page.evaluate(() => ({
    state: window.__GARY__?.state,
    score: window.__GARY__?.score,
    friends: window.__GARY__?.friends,
    lane: window.__GARY__?.lane,
    speed: window.__GARY__?.speed,
    ready: window.__GARY__?.ready,
  }));
  expect(menu).toEqual({
    state: 'menu',
    score: 0,
    friends: 0,
    lane: 1,
    speed: 0,
    ready: true,
  });

  // Wait for the loading-to-menu cross-fade before capturing the visual artifact.
  await expect(page.locator('#hud')).toHaveAttribute('data-screen', 'menu');
  await expect(page.locator('#hud .screen.menu')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: 'test-results/menu.png', fullPage: true });

  // start() -> playing, with the road now moving.
  await page.evaluate(() => window.__GARY__?.start());
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('playing');
  const speed = await page.evaluate(() => window.__GARY__?.speed ?? 0);
  expect(speed).toBeGreaterThan(0);

  // Deterministic lane hook clamps and moves Gary.
  await page.evaluate(() => window.__GARY__?.__setLane(0));
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.lane))
    .toBe(0);
  await page.evaluate(() => window.__GARY__?.__setLane(99));
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.lane))
    .toBe(2);

  // __spawnFriend is a wired (stub) hook: it must exist and not throw.
  await page.evaluate(() => window.__GARY__?.__spawnFriend());

  // Let a few frames pass so the road scrolls. Gameplay scores by distance
  // travelled, so the score climbs off zero once the run is under way.
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__GARY__?.score ?? 0)).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/playing.png', fullPage: true });

  // Deterministic collision -> gameover.
  await page.evaluate(() => window.__GARY__?.__forceCollision());
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('gameover');
  // Let the card's cross-fade finish so the capture isn't a mid-transition frame.
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/gameover.png', fullPage: true });

  // Restart from gameover -> a clean playing run. Read the reset values in the
  // same evaluate as start(), so no frame can tick the distance score up in
  // between; then confirm it is genuinely running.
  const restarted = await page.evaluate(() => {
    window.__GARY__?.start();
    return {
      state: window.__GARY__?.state,
      score: window.__GARY__?.score,
      friends: window.__GARY__?.friends,
      lane: window.__GARY__?.lane,
      speed: window.__GARY__?.speed,
    };
  });
  expect(restarted.state).toBe('playing');
  expect(restarted.score).toBe(0);
  expect(restarted.friends).toBe(0);
  expect(restarted.lane).toBe(1);
  expect(restarted.speed).toBeGreaterThan(0);

  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__GARY__?.state)).toBe('playing');

  // No console errors the whole time.
  expect(consoleErrors).toEqual([]);
});
