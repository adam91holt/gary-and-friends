import { expect, test, type Page } from '@playwright/test';

/**
 * Royal Roll, end to end in a real browser against the production bundle.
 *
 * One lifecycle, driven entirely through the shipping paths: select the game
 * from the cabinet, start it, set a deterministic aim through the game's own
 * command, LAUNCH through the real `primary` action, and then assert on what
 * the real solver did — the roller genuinely moved, cones genuinely went over,
 * and the score is the one the scoring rules produced. Nothing here forces an
 * outcome: the only deterministic input is the aim angle, and every consequence
 * of it comes out of the game.
 *
 * Always asserts zero console errors and captures screenshots for review.
 */

/** The game's own snapshot, as the runtime reports it. */
interface RoyalSnapshot {
  game: string;
  score: number;
  entities: number;
  metric: { label: string; value: number } | null;
  phase: 'aiming' | 'rolling' | 'settling';
  aimAngle: number;
  throwNumber: number;
  throwLimit: number;
  targetsDown: number;
  standing: number;
  roller: { x: number; z: number; speed: number };
}

/** Wire console/page-error capture and boot the game to its first frame. */
async function boot(page: Page): Promise<string[]> {
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

const snapshot = (page: Page): Promise<RoyalSnapshot> =>
  page.evaluate(() => window.__GARY__?.snapshot as unknown as RoyalSnapshot);

/** Wait for the current throw to resolve back into the aiming phase. */
async function awaitAiming(page: Page): Promise<void> {
  await expect
    .poll(async () => (await snapshot(page)).phase, { timeout: 20_000 })
    .toBe('aiming');
}

/** Play one throw at `angle` through the real launch rule, and let it settle. */
async function throwAt(page: Page, angle: number): Promise<void> {
  expect(
    await page.evaluate(
      (a) => window.__GARY__?.command('royal-roll:aim', { angle: a }),
      angle,
    ),
  ).toBe(true);
  await page.evaluate(() => window.__GARY__?.input('primary'));
  await awaitAiming(page);
}

test('select Royal Roll, aim, launch, knock cones, run out of throws, restart', async ({
  page,
}) => {
  // A ten-throw run is played here at real speed, through the real solver —
  // roughly four seconds a throw. Nothing is fast-forwarded, so the budget is
  // raised rather than the game being hurried.
  test.setTimeout(180_000);
  const consoleErrors = await boot(page);

  // ── Select it from the cabinet, exactly as a player would ────────────────
  await page.locator('#gcard-royal-roll').click();
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('playing');
  expect(await page.evaluate(() => window.__GARY__?.game)).toBe('royal-roll');

  // WebGL is genuinely up: one canvas with a live context.
  expect(
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return false;
      return (
        canvas.getContext('webgl2') !== null || canvas.getContext('webgl') !== null
      );
    }),
  ).toBe(true);

  // ── A fresh run: full rack, throw one, aimed straight, nothing scored ────
  const fresh = await snapshot(page);
  expect(fresh.game).toBe('royal-roll');
  expect(fresh.phase).toBe('aiming');
  expect(fresh.throwNumber).toBe(1);
  expect(fresh.throwLimit).toBe(10);
  expect(fresh.aimAngle).toBe(0);
  expect(fresh.score).toBe(0);
  expect(fresh.targetsDown).toBe(0);
  expect(fresh.standing).toBeGreaterThan(5);
  expect(fresh.metric).toEqual({ label: 'Cones', value: 0 });
  const rackSize = fresh.standing;

  // ── Aim, through the shipping keyboard path ─────────────────────────────
  // Clicking the lane first, the way a player does: the card that launched the
  // run still holds DOM focus, and the shell deliberately lets the grid own
  // arrow keys while focus is inside it (see `GameSelect.ownsEvent`).
  await page.locator('canvas').click({ position: { x: 40, y: 40 } });
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await snapshot(page)).aimAngle).toBeGreaterThan(0);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await snapshot(page)).aimAngle).toBeLessThan(0);

  // The arc is bounded: hammering one direction cannot walk the aim off it.
  for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowLeft');
  const pinned = (await snapshot(page)).aimAngle;
  await page.keyboard.press('ArrowLeft');
  expect((await snapshot(page)).aimAngle).toBe(pinned);
  expect(Math.abs(pinned)).toBeLessThan(0.5);

  // ── Launch, and watch the REAL solver run ───────────────────────────────
  // The aim is the only thing scripted; everything after this is the game.
  expect(
    await page.evaluate(() => window.__GARY__?.command('royal-roll:aim', { angle: 0 })),
  ).toBe(true);
  expect((await snapshot(page)).aimAngle).toBe(0);

  const launchZ = (await snapshot(page)).roller.z;
  await page.evaluate(() => window.__GARY__?.input('primary'));

  // The roller is genuinely moving, not teleporting to a result.
  await expect
    .poll(async () => (await snapshot(page)).roller.speed, { timeout: 5_000 })
    .toBeGreaterThan(1);
  const rolling = await snapshot(page);
  expect(rolling.phase).toBe('rolling');
  expect(rolling.roller.z).toBeGreaterThan(launchZ);

  // Mid-roll the aim is locked: the throw has left your hand.
  await page.keyboard.press('ArrowRight');
  expect((await snapshot(page)).aimAngle).toBe(0);
  // ...and a second commit cannot fire a second roller.
  await page.evaluate(() => window.__GARY__?.input('primary'));
  expect((await snapshot(page)).phase).toBe('rolling');

  // The gameplay hero shot: mid-roll, down the lane.
  await page.screenshot({ path: 'test-results/royal-roll-rolling.png', fullPage: true });

  // ── The throw resolves through the real collision and scoring rules ──────
  await awaitAiming(page);
  const resolved = await snapshot(page);
  expect(resolved.throwNumber).toBe(2);
  // A straight throw down the middle hits the formation. Cones went over...
  expect(resolved.targetsDown).toBeGreaterThan(0);
  expect(resolved.standing).toBeLessThan(rackSize);
  // ...and the score is what the scoring rules paid for them.
  expect(resolved.score).toBeGreaterThan(0);
  // The store, the HUD and the runtime all agree on that number.
  expect(await page.evaluate(() => window.__GARY__?.score)).toBe(resolved.score);
  await expect(page.locator('#ro-score .val')).toHaveText(String(resolved.score));
  await expect(page.locator('#ro-friends .lbl')).toHaveText('Cones');
  await expect(page.locator('#ro-friends .val')).toHaveText(
    String(resolved.targetsDown),
  );
  // Everything came to a genuine stop rather than being cut off mid-roll.
  expect(resolved.roller.speed).toBe(0);

  await page.screenshot({ path: 'test-results/royal-roll-result.png', fullPage: true });

  // ── A throw at the barrier misses the rack, and pays nothing ────────────
  const beforeMiss = await snapshot(page);
  await throwAt(page, 0.36);
  const afterMiss = await snapshot(page);
  expect(afterMiss.throwNumber).toBe(beforeMiss.throwNumber + 1);
  expect(afterMiss.targetsDown).toBe(beforeMiss.targetsDown);
  expect(afterMiss.score).toBe(beforeMiss.score);

  // ── Play the sequence out to the throw limit ────────────────────────────
  const angles = [0, -0.1, 0.1, -0.05, 0.05, 0, -0.15, 0.15];
  for (const angle of angles) {
    const before = await snapshot(page);
    if (before.throwNumber >= before.throwLimit) break;
    await throwAt(page, angle);
    const after = await snapshot(page);
    expect(after.throwNumber).toBe(before.throwNumber + 1);
  }

  // The last throw ends the run.
  const last = await snapshot(page);
  expect(last.throwNumber).toBe(last.throwLimit);
  await page.evaluate(() => window.__GARY__?.command('royal-roll:aim', { angle: 0 }));
  await page.evaluate(() => window.__GARY__?.input('primary'));
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state), { timeout: 20_000 })
    .toBe('gameover');

  const final = await snapshot(page);
  expect(final.score).toBeGreaterThan(0);
  expect(final.targetsDown).toBeGreaterThan(0);
  // The game-over card carries the run, not a placeholder.
  await expect(page.locator('#hud')).toHaveAttribute('data-screen', 'gameover');
  await expect(page.locator('#final-score')).toHaveText(String(final.score));
  await expect(page.locator('#final-metric-k')).toHaveText('Cones');
  await page.screenshot({ path: 'test-results/royal-roll-gameover.png', fullPage: true });

  // The run banked under Royal Roll's own key, and nobody else's.
  const records = await page.evaluate(() => window.__GARY__?.highScores);
  expect(records?.['royal-roll']).toBe(final.score);
  expect(records?.highway).toBe(0);
  expect(
    await page.evaluate(() =>
      window.localStorage.getItem('gary.highScore.royal-roll.v1'),
    ),
  ).toBe(String(final.score));

  // ── Restart restores the whole formation and a clean run ────────────────
  await page.evaluate(() => window.__GARY__?.start());
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('playing');
  const restarted = await snapshot(page);
  expect(restarted.throwNumber).toBe(1);
  expect(restarted.score).toBe(0);
  expect(restarted.targetsDown).toBe(0);
  expect(restarted.standing).toBe(rackSize);
  expect(restarted.aimAngle).toBe(0);
  expect(restarted.phase).toBe('aiming');
  // ...and it still plays: the restored rack can be knocked down again.
  await throwAt(page, 0);
  expect((await snapshot(page)).targetsDown).toBeGreaterThan(0);

  // ── Back to the cabinet ─────────────────────────────────────────────────
  await page.evaluate(() => window.__GARY__?.input('primary')); // last throw armed
  await page.evaluate(() => window.__GARY__?.input('back'));
  // `back` is refused mid-run; the run survives.
  expect(await page.evaluate(() => window.__GARY__?.state)).toBe('playing');

  expect(consoleErrors).toEqual([]);
});

test('the aim command is refused outside the aiming phase, and unknown ones report false', async ({
  page,
}) => {
  const consoleErrors = await boot(page);

  await page.evaluate(() => window.__GARY__?.selectGame('royal-roll'));
  await page.evaluate(() => window.__GARY__?.start());
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('playing');

  // A game that doesn't know a command must say so rather than swallow it.
  expect(
    await page.evaluate(() => window.__GARY__?.command('shell:noop', undefined)),
  ).toBe(false);

  // Mid-roll, the aim command is handled but the game refuses the change —
  // the SAME guard the keyboard hits, not a separate one.
  await page.evaluate(() =>
    window.__GARY__?.command('royal-roll:aim', { angle: 0.2 }),
  );
  await page.evaluate(() => window.__GARY__?.input('primary'));
  await expect
    .poll(async () => (await snapshot(page)).phase)
    .toBe('rolling');
  await page.evaluate(() =>
    window.__GARY__?.command('royal-roll:aim', { angle: -0.3 }),
  );
  expect((await snapshot(page)).aimAngle).toBeCloseTo(0.2, 5);

  expect(consoleErrors).toEqual([]);
});

test('reduced motion keeps the lane legible without sweeping the camera', async ({
  browser,
}) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  const consoleErrors = await boot(page);

  await page.evaluate(() => window.__GARY__?.selectGame('royal-roll'));
  await page.evaluate(() => window.__GARY__?.start());
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('playing');

  // The game plays identically — the preference is about movement, not rules.
  await throwAt(page, 0);
  const after = await snapshot(page);
  expect(after.throwNumber).toBe(2);
  expect(after.targetsDown).toBeGreaterThan(0);
  expect(after.score).toBeGreaterThan(0);

  await page.screenshot({
    path: 'test-results/royal-roll-reduced-motion.png',
    fullPage: true,
  });
  expect(consoleErrors).toEqual([]);
  await context.close();
});
