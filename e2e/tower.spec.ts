import { expect, test, type Page } from '@playwright/test';

/**
 * Stack Attack, end to end in a real browser against the production bundle.
 *
 * One full lifecycle: open the tower from the arcade menu, start it, make
 * several genuinely successful drops, assert the score and the height they
 * earned, set up a real miss, watch the run end, restart, and assert the stack
 * came back empty. Every drop goes through the shipping path — the deterministic
 * hook only parks the carriage, and the real landing rule decides what happens
 * next — which is the same "inject setup, assert durable state" convention the
 * rest of the suite follows.
 *
 * Always asserts a live WebGL context, zero console/page errors, and captures
 * gameplay + game-over screenshots for visual review.
 */

/** The tower's snapshot, as `window.__GARY__.snapshot` reports it. */
interface TowerReading {
  game: string;
  score: number;
  entities: number;
  metric: { label: string; value: number } | null;
  height: number;
  combo: number;
  carrierX: number;
  falling: boolean;
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
  await expect(page.locator('#hud')).toHaveAttribute('data-screen', 'menu');
  return consoleErrors;
}

const reading = (page: Page): Promise<TowerReading> =>
  page.evaluate(() => window.__GARY__?.snapshot as unknown as TowerReading);

/**
 * Park the carriage at `x` and drop, then wait for the cone to actually land.
 *
 * Deliberately only two shipping calls: `command('tower:carrier', …)` sets up
 * the situation, and `input('primary')` is the same routed action a Space press
 * produces. Nothing here forces an outcome — the overlap rule in the simulation
 * decides whether this is a perfect landing, a trimmed one or the end of the
 * run, exactly as it would for a player.
 */
async function dropFrom(page: Page, x: number): Promise<void> {
  // Park and release in the SAME evaluate. They have to share one JS task: the
  // carriage is genuinely running (that is the game), so an animation frame
  // between the two calls would slide it off the mark and this test would be
  // asserting against a position nobody chose. One task, one drop point.
  const placed = await page.evaluate((target) => {
    const api = window.__GARY__;
    if (!api?.command('tower:carrier', { x: target })) return false;
    api.input('primary');
    return true;
  }, x);
  expect(placed).toBe(true);
  // The cone falls in real time; wait for the simulation to resolve it rather
  // than for a fixed number of milliseconds.
  await expect
    .poll(() => reading(page).then((r) => r.falling), { timeout: 5_000 })
    .toBe(false);
}

test('Stack Attack: select, stack, miss, and restart clean', async ({ page }) => {
  const consoleErrors = await boot(page);

  // ── A real WebGL context is behind all of this ───────────────────────────
  await expect(page.locator('canvas')).toBeVisible();
  expect(
    await page.evaluate(() => {
      const el = document.querySelector('canvas');
      if (!el) return false;
      const gl =
        el.getContext('webgl2') ??
        el.getContext('webgl') ??
        el.getContext('experimental-webgl');
      return gl !== null;
    }),
  ).toBe(true);

  // ── Open the tower from the arcade menu, as a player would ───────────────
  await page.locator('#gcard-tower').click();
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('playing');
  expect(await page.evaluate(() => window.__GARY__?.game)).toBe('tower');

  // The card promises a playable game now, not a reserved slot.
  await expect(page.locator('#gcard-tower .soon')).toHaveCount(0);
  await expect(page.locator('#launch-name')).toHaveText('Stack Attack');

  // A fresh run: nothing stacked, nothing in the air, nothing scored, and the
  // HUD's generic metric slot is showing the tower's own instrument.
  const opening = await reading(page);
  expect(opening.game).toBe('tower');
  expect(opening.height).toBe(0);
  expect(opening.combo).toBe(0);
  expect(opening.score).toBe(0);
  expect(opening.falling).toBe(false);
  expect(opening.metric).toEqual({ label: 'Height', value: 0 });

  // ── Several real, successful drops ───────────────────────────────────────
  // Dead centre every time: the landing rule has to call these perfect, trim
  // nothing, and let the combo build. Nothing in the test asserts the result
  // into existence — it drops, then reads what the simulation decided.
  for (let i = 0; i < 5; i++) {
    await dropFrom(page, 0);
    expect(await page.evaluate(() => window.__GARY__?.state)).toBe('playing');
  }

  const stacked = await reading(page);
  expect(stacked.height).toBe(5);
  expect(stacked.metric).toEqual({ label: 'Height', value: 5 });
  expect(stacked.combo).toBe(5); // five centred drops in a row
  expect(stacked.score).toBeGreaterThan(0);
  // The snapshot and the store agree about the score.
  expect(await page.evaluate(() => window.__GARY__?.score)).toBe(stacked.score);
  // Live objects in the yard track the tower.
  expect(await page.evaluate(() => window.__GARY__?.entities)).toBe(5);

  // The playbar is drawing the tower's numbers, not the highway's.
  await expect(page.locator('#ro-friends .lbl')).toHaveText('Height');
  await expect(page.locator('#ro-friends .val')).toHaveText('5');
  await expect(page.locator('#ro-score .val')).toHaveText(String(stacked.score));

  // ── A deliberately sloppy (but legal) drop trims the tower ───────────────
  const beforeTrim = await reading(page);
  await dropFrom(page, 0.55);
  const trimmed = await reading(page);
  expect(await page.evaluate(() => window.__GARY__?.state)).toBe('playing');
  expect(trimmed.height).toBe(beforeTrim.height + 1); // it still landed
  expect(trimmed.combo).toBe(0); // ...but the streak is gone
  expect(trimmed.score).toBeGreaterThan(beforeTrim.score);

  // ── Visual artifact: the tower mid-game ──────────────────────────────────
  await page.screenshot({ path: 'test-results/tower-gameplay.png', fullPage: true });

  // ── A real miss ends the run ─────────────────────────────────────────────
  // Park the carriage right out at the rail. That is genuinely clear of a
  // tower this narrow, so the shipping overlap rule — not the test — ends it.
  const scoreAtMiss = trimmed.score;
  const heightAtMiss = trimmed.height;
  await dropFrom(page, 3.4);
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('gameover');

  // Game over stops the world: the score is frozen at what was banked.
  expect(await page.evaluate(() => window.__GARY__?.score)).toBe(scoreAtMiss);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__GARY__?.score)).toBe(scoreAtMiss);
  const ended = await reading(page);
  expect(ended.height).toBe(heightAtMiss); // the tower it missed is still there

  // The game-over card reads as this game's, with the tower's own metric.
  await expect(page.locator('#gameover-eyebrow')).toHaveText('Stack · Run ended');
  await expect(page.locator('#final-metric-k')).toHaveText('Height');
  await page.screenshot({ path: 'test-results/tower-gameover.png', fullPage: true });

  // The run banked to the tower's OWN record, under its own key.
  expect(await page.evaluate(() => window.__GARY__?.highScore)).toBe(scoreAtMiss);
  expect(
    await page.evaluate(() => window.localStorage.getItem('gary.highScore.tower.v1')),
  ).toBe(String(scoreAtMiss));
  // ...and the highway's record was not touched by it.
  expect(
    await page.evaluate(() => window.__GARY__?.highScores.highway),
  ).toBe(0);

  // ── Restart comes back to a genuinely empty stack ────────────────────────
  // Read the reset state in the SAME evaluate that restarts, so no animation
  // frame can advance anything between the two.
  const restarted = await page.evaluate(() => {
    window.__GARY__?.start();
    const snap = window.__GARY__?.snapshot as unknown as TowerReading;
    return {
      state: window.__GARY__?.state,
      game: window.__GARY__?.game,
      score: window.__GARY__?.score,
      height: snap.height,
      combo: snap.combo,
      entities: snap.entities,
      falling: snap.falling,
    };
  });
  expect(restarted).toEqual({
    state: 'playing',
    game: 'tower',
    score: 0,
    height: 0,
    combo: 0,
    entities: 0,
    falling: false,
  });

  // And it is genuinely playing again, not merely reset: one more real drop
  // lands on the fresh tower.
  await dropFrom(page, 0);
  const replay = await reading(page);
  expect(replay.height).toBe(1);
  expect(replay.score).toBeGreaterThan(0);

  expect(consoleErrors).toEqual([]);
});

test('the carriage sweeps its rails, and dropping is the only input', async ({
  page,
}) => {
  const consoleErrors = await boot(page);

  await page.evaluate(() => window.__GARY__?.selectGame('tower'));
  await page.evaluate(() => window.__GARY__?.start());
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('playing');

  // ── The carriage genuinely moves, and stays on its rails ─────────────────
  const samples: number[] = [];
  for (let i = 0; i < 24; i++) {
    samples.push((await reading(page)).carrierX);
    await page.waitForTimeout(60);
  }
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  expect(max - min).toBeGreaterThan(1); // it swept, it didn't sit still
  expect(min).toBeGreaterThanOrEqual(-3.4001);
  expect(max).toBeLessThanOrEqual(3.4001);

  // ── Direction keys are inert: this is a timing game, not an aiming one ───
  await page.evaluate(() => window.__GARY__?.command('tower:carrier', { x: -1 }));
  await page.evaluate(() => window.__GARY__?.input('left'));
  await page.evaluate(() => window.__GARY__?.input('right'));
  // Nothing may be in the air from a direction key, and nothing may be stacked.
  const afterArrows = await reading(page);
  expect(afterArrows.height).toBe(0);

  // ── Space is the drop, through the real keyboard path ────────────────────
  // The carriage keeps running between the park and the keystroke, so this
  // asserts only that Space DROPS — not where it lands. Whether that drop
  // survives is the landing rule's business, and the lifecycle test above
  // covers a placed drop resolving.
  await page.evaluate(() => window.__GARY__?.command('tower:carrier', { x: 0 }));
  await page.keyboard.press('Space');
  await expect
    .poll(() => reading(page).then((r) => r.height + (r.falling ? 1 : 0)), {
      timeout: 5_000,
    })
    .toBe(1);

  // ── An unknown command is still reported honestly ────────────────────────
  expect(
    await page.evaluate(() => window.__GARY__?.command('shell:noop', undefined)),
  ).toBe(false);

  expect(consoleErrors).toEqual([]);
});

test('reduced motion keeps Stack Attack fully legible', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  const consoleErrors = await boot(page);

  await page.evaluate(() => window.__GARY__?.selectGame('tower'));
  await page.evaluate(() => window.__GARY__?.start());
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('playing');

  // The game is entirely playable and its state is entirely readable with
  // every celebration animation suppressed.
  for (let i = 0; i < 3; i++) await dropFrom(page, 0);
  const stacked = await reading(page);
  expect(stacked.height).toBe(3);
  expect(stacked.combo).toBe(3);
  expect(stacked.score).toBeGreaterThan(0);
  await expect(page.locator('#ro-friends .val')).toHaveText('3');

  await page.screenshot({
    path: 'test-results/tower-reduced-motion.png',
    fullPage: true,
  });

  expect(consoleErrors).toEqual([]);
  await context.close();
});
