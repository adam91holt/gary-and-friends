import { expect, test } from '@playwright/test';

test.use({ reducedMotion: 'reduce' });

test('reduced motion still shows the convoy', async ({ page }) => {
  const errs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(m.text());
  });
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => window.__GARY__?.ready === true, null, {
    timeout: 15000,
  });
  await page.evaluate(async () => {
    const api = window.__GARY__;
    if (!api) return;
    api.start();
    const sleep = (ms: number): Promise<void> =>
      new Promise((r) => setTimeout(() => r(), ms));
    const end = performance.now() + 15000;
    while (performance.now() < end && api.friends < 4) {
      if (api.state !== 'playing') {
        api.start();
        await sleep(120);
        continue;
      }
      const n = api.nearestAhead;
      if (n && n.distance < 34) api.__setLane(n.lane === 0 ? 1 : 0);
      else api.__spawnFriend();
      await sleep(40);
    }
  });
  expect(await page.evaluate(() => window.__GARY__?.conga ?? 0)).toBeGreaterThanOrEqual(3);
  await page.evaluate(() => {
    const el = document.getElementById('collect');
    if (!el) return;
    el.classList.remove('show');
    void el.offsetWidth;
    el.style.animationPlayState = 'paused';
    el.style.animationDelay = '-0.4s';
    el.classList.add('show');
  });
  await page.screenshot({ path: 'test-results/tmp-rm.png', fullPage: true });
  expect(errs).toEqual([]);
});
