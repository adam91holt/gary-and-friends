import { expect, test } from '@playwright/test';

/**
 * Gameplay e2e — the core loop in a real browser against the production bundle.
 * Proves the verbs the ticket delivers: keyboard lane changes move Gary, the
 * score climbs with distance, speed visibly ramps, a forced collision ends the
 * run, game-over stops the world, and restart returns a clean playable state.
 * Always asserts zero console errors and captures a mid-game screenshot.
 */

/** Wire console/page-error capture and boot the game to its first frame. */
async function boot(page: import('@playwright/test').Page): Promise<string[]> {
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
  return consoleErrors;
}

test('lane input, traffic, scoring, speed ramp, collision and restart', async ({
  page,
}) => {
  const consoleErrors = await boot(page);

  // start() -> playing.
  await page.evaluate(() => window.__GARY__?.start());
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('playing');

  // ── Keyboard input moves Gary between lanes (clamped at both edges) ───────
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => page.evaluate(() => window.__GARY__?.lane)).toBe(0);
  // Already in the outermost lane: another left must not wrap or go negative.
  await page.keyboard.press('ArrowLeft');
  expect(await page.evaluate(() => window.__GARY__?.lane)).toBe(0);

  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => window.__GARY__?.lane)).toBe(1);

  // A/D are the same verb as the arrows.
  await page.keyboard.press('d');
  await expect.poll(() => page.evaluate(() => window.__GARY__?.lane)).toBe(2);
  await page.keyboard.press('d'); // clamped at the far edge
  expect(await page.evaluate(() => window.__GARY__?.lane)).toBe(2);
  await page.keyboard.press('a');
  await expect.poll(() => page.evaluate(() => window.__GARY__?.lane)).toBe(1);

  // The deterministic hook agrees with the keyboard path.
  await page.evaluate(() => window.__GARY__?.__setLane(0));
  await expect.poll(() => page.evaluate(() => window.__GARY__?.lane)).toBe(0);

  // ── Score climbs with distance, and speed ramps up ───────────────────────
  const startSpeed = await page.evaluate(() => window.__GARY__?.speed ?? 0);
  expect(startSpeed).toBeGreaterThan(0);

  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.score ?? 0), {
      timeout: 5_000,
    })
    .toBeGreaterThan(0);

  await page.waitForTimeout(1_500);
  const midScore = await page.evaluate(() => window.__GARY__?.score ?? 0);
  const midSpeed = await page.evaluate(() => window.__GARY__?.speed ?? 0);
  expect(midScore).toBeGreaterThan(0);
  expect(midSpeed).toBeGreaterThan(startSpeed); // the ramp is real

  // Score keeps climbing while the run continues.
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__GARY__?.score ?? 0)).toBeGreaterThan(
    midScore,
  );

  // ── Traffic actually populates the road ─────────────────────────────────
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.entities ?? 0), {
      timeout: 5_000,
    })
    .toBeGreaterThan(0);

  // ── Visual artifact: Gary mid-game, threading real traffic ──────────────
  // Steer away from the nearest closing vehicle while waiting for traffic to
  // enter the shot; parking in one lane would make this seed/timing dependent.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const api = window.__GARY__;
          const nearest = api?.nearestAhead;
          if (!api || !nearest) return Infinity;
          if (nearest.distance < 28) {
            api.__setLane(nearest.lane === 0 ? 1 : 0);
          }
          return nearest.distance;
        }),
      { timeout: 10_000, intervals: [50] },
    )
    .toBeLessThan(24);
  await page.screenshot({ path: 'test-results/gameplay.png', fullPage: true });

  // ── Collision ends the run ───────────────────────────────────────────────
  await page.evaluate(() => window.__GARY__?.__forceCollision());
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('gameover');

  // Game over stops the world: speed drops to zero and the score is frozen.
  expect(await page.evaluate(() => window.__GARY__?.speed)).toBe(0);
  const finalScore = await page.evaluate(() => window.__GARY__?.score ?? 0);
  expect(finalScore).toBeGreaterThan(0);
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => window.__GARY__?.score)).toBe(finalScore);

  // Lane input is inert once the run has ended.
  const crashedLane = await page.evaluate(() => window.__GARY__?.lane);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__GARY__?.state)).toBe('gameover');
  expect(await page.evaluate(() => window.__GARY__?.lane)).toBe(crashedLane);

  await page.screenshot({
    path: 'test-results/gameplay-gameover.png',
    fullPage: true,
  });

  // ── Restart returns a clean, playable run ───────────────────────────────
  // Read the reset state in the SAME evaluate that restarts, so no animation
  // frame can tick the score up between the two and make this flaky.
  const restarted = await page.evaluate(() => {
    window.__GARY__?.start();
    return {
      state: window.__GARY__?.state,
      score: window.__GARY__?.score,
      lane: window.__GARY__?.lane,
      friends: window.__GARY__?.friends,
      speed: window.__GARY__?.speed,
      entities: window.__GARY__?.entities,
    };
  });
  expect(restarted.state).toBe('playing');
  expect(restarted.score).toBe(0);
  expect(restarted.lane).toBe(1);
  expect(restarted.friends).toBe(0);
  expect(restarted.speed).toBeGreaterThan(0);
  // Restart wipes the road: no traffic survives from the previous run.
  expect(restarted.entities).toBe(0);

  // And it is genuinely playing again, not merely reset.
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => window.__GARY__?.score ?? 0)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__GARY__?.speed ?? 0)).toBeGreaterThan(0);

  expect(consoleErrors).toEqual([]);
});

test('near-miss feedback fires when Gary threads a gap', async ({ page }) => {
  const consoleErrors = await boot(page);

  await page.evaluate(() => window.__GARY__?.start());
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('playing');

  // A near miss requires Gary to be genuinely tight to a passing vehicle —
  // lane centres are further apart than the threshold, so it only pays while
  // he is mid-lane-change. That IS the skill expression, so the test performs
  // it: swerve toward whichever lane the nearest oncoming vehicle occupies as
  // it arrives, then peel away. Restart if a swerve is mistimed into a crash.
  const toast = page.locator('#nearmiss');

  // Deterministically perform a late dodge: sit in the lane the next vehicle
  // occupies, then peel out only once it is nearly on top of Gary. He is still
  // lerping clear as it draws level — the tight-gap geometry the bonus rewards.
  const credited = await page.evaluate(async () => {
    const api = window.__GARY__;
    if (!api) return false;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const deadline = performance.now() + 15_000;
    let trackedLane: number | null = null;

    while (performance.now() < deadline && (api.nearMisses ?? 0) === 0) {
      if (api.state !== 'playing') {
        api.start();
        trackedLane = null;
        await sleep(80);
        continue;
      }
      const target = api.nearestAhead;
      if (target && target.distance < 60) {
        if (trackedLane === null) trackedLane = target.lane;
        if (target.lane === trackedLane && target.distance >= 11) {
          api.__setLane(trackedLane);
        } else if (target.lane === trackedLane) {
          api.__setLane(trackedLane === 0 ? 1 : trackedLane - 1);
        }
      }
      await sleep(16);
    }
    return (api.nearMisses ?? 0) > 0;
  });
  expect(credited).toBe(true);

  // The simulation credited a threaded gap. Asserted on the durable counter
  // rather than the toast's CSS class, which is a ~0.6s animation and is
  // cleared if the run happens to end shortly afterwards.
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.nearMisses ?? 0), {
      timeout: 20_000,
    })
    .toBeGreaterThan(0);

  // Artifact only: the toast is a ~0.6s animation, so replay it held at its
  // visible peak, or the capture lands after it has already faded out.
  await page.evaluate(() => {
    const el = document.getElementById('nearmiss');
    if (!el) return;
    el.classList.remove('show');
    void el.offsetWidth;
    el.style.animationPlayState = 'paused';
    el.style.animationDelay = '-0.3s';
    el.classList.add('show');
  });
  await expect(toast).toBeVisible();
  await page.screenshot({
    path: 'test-results/gameplay-nearmiss.png',
    fullPage: true,
  });

  expect(consoleErrors).toEqual([]);
});

test('a run survives long enough to prove traffic is dodgeable', async ({
  page,
}) => {
  const consoleErrors = await boot(page);

  await page.evaluate(() => window.__GARY__?.start());
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('playing');

  // Drive with the same finite-rate lane movement as a player: move away from
  // the nearest vehicle once it enters the reaction window.
  await page.evaluate(async () => {
    const api = window.__GARY__;
    if (!api) return;
    const deadline = performance.now() + 6_000;
    while (performance.now() < deadline && api.state === 'playing') {
      const nearest = api.nearestAhead;
      if (nearest && nearest.distance < 32) {
        api.__setLane(nearest.lane === 0 ? 1 : 0);
      }
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
  });
  expect(await page.evaluate(() => window.__GARY__?.state)).toBe('playing');

  // Whatever happened, the game is still responsive: a restart plays again.
  await page.evaluate(() => window.__GARY__?.start());
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('playing');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__GARY__?.score ?? 0)).toBeGreaterThan(0);

  expect(consoleErrors).toEqual([]);
});
