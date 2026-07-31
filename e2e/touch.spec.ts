import { expect, test } from '@playwright/test';

/**
 * Touch controls (iPhone / iPad). The game is a 3-lane dodger with no jump/duck,
 * so touch maps exactly two intents onto the same code path as the keyboard:
 *   - a horizontal swipe (>= ~34px, dominant axis) = one lane change, and
 *   - a tap = the Space/Enter intent (start on the menu, restart on game-over).
 * A dominantly-vertical drag must NOT change lanes.
 *
 * Playwright has no high-level swipe, so we dispatch real Touch/TouchEvent
 * sequences on the canvas from the page — the same events the handlers in
 * src/main.ts read. Asserting through window.__GARY__ keeps this driven by the
 * pinned test contract rather than by pixels.
 */
test('swipe changes lanes, a vertical drag does not, and a tap starts a run', async ({
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
  await page.waitForFunction(() => window.__GARY__?.ready === true, null, {
    timeout: 15_000,
  });

  // Install a page-side gesture dispatcher that fires genuine touch events at
  // the centre of the canvas. dx/dy are total travel in CSS px; a zero-travel
  // call is a tap.
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('canvas missing');
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const touch = (x: number, y: number) =>
      new Touch({ identifier: 1, target: canvas, clientX: x, clientY: y });
    const fire = (type: string, x: number, y: number) => {
      const t = touch(x, y);
      canvas.dispatchEvent(
        new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          touches: type === 'touchend' ? [] : [t],
          changedTouches: [t],
        }),
      );
    };
    (window as unknown as { __gesture: (dx: number, dy: number) => void }).__gesture = (
      dx: number,
      dy: number,
    ) => {
      fire('touchstart', cx, cy);
      const steps = 6;
      for (let i = 1; i <= steps; i++) {
        fire('touchmove', cx + (dx * i) / steps, cy + (dy * i) / steps);
      }
      fire('touchend', cx + dx, cy + dy);
    };
  });

  const gesture = (dx: number, dy: number) =>
    page.evaluate(
      ([x, y]) =>
        (window as unknown as { __gesture: (dx: number, dy: number) => void }).__gesture(
          x,
          y,
        ),
      [dx, dy] as const,
    );

  // Tap on the menu starts the run (the Space/Enter intent).
  await gesture(0, 0);
  await expect.poll(() => page.evaluate(() => window.__GARY__?.state)).toBe('playing');
  await expect.poll(() => page.evaluate(() => window.__GARY__?.lane)).toBe(1);

  // Swipe left -> lane 0, swipe right -> lane 1, right again -> lane 2 (clamped).
  await gesture(-80, 0);
  await expect.poll(() => page.evaluate(() => window.__GARY__?.lane)).toBe(0);
  await gesture(80, 0);
  await expect.poll(() => page.evaluate(() => window.__GARY__?.lane)).toBe(1);
  await gesture(80, 0);
  await expect.poll(() => page.evaluate(() => window.__GARY__?.lane)).toBe(2);

  // A dominantly-vertical drag must not change lanes.
  const before = await page.evaluate(() => window.__GARY__?.lane);
  await gesture(0, -90);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__GARY__?.lane)).toBe(before);

  // Tap during play does nothing (start/restart only fires when not playing):
  // force a game-over, then a tap restarts into a clean run.
  await page.evaluate(() => window.__GARY__?.__forceCollision());
  await expect.poll(() => page.evaluate(() => window.__GARY__?.state)).toBe('gameover');
  await page.waitForTimeout(300);
  await gesture(0, 0);
  await expect.poll(() => page.evaluate(() => window.__GARY__?.state)).toBe('playing');
  expect(await page.evaluate(() => window.__GARY__?.lane)).toBe(1);

  expect(consoleErrors).toEqual([]);
});
