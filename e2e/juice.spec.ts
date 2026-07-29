import { expect, test, type Page } from '@playwright/test';

/**
 * Juice e2e — the feel layer, in a real browser against the production bundle.
 *
 * Proves the things a screenshot alone can't: particles actually spawn on the
 * events that claim to spawn them, the squash-and-stretch death *plays* (rather
 * than the state merely flipping), the record survives a reload, and the sound
 * toggle works. Captures the three taste-review frames — menu, mid-game with
 * particles in flight, and the game-over card with a squashed Gary — always
 * asserting zero console errors.
 */

/** The storage key `src/game/highScore.ts` owns. Pinned here on purpose: if it
 *  changes, this test should fail loudly rather than silently stop testing
 *  persistence. */
const HIGH_SCORE_KEY = 'gary.highScore.v1';

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

test('menu shows the title and the persisted best', async ({ page }) => {
  // Seed a record before the app boots, so the menu has to READ it rather than
  // us watching it write one.
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key as string, value as string),
    [HIGH_SCORE_KEY, '4242'],
  );
  const consoleErrors = await boot(page);

  await expect(page.locator('#hud')).toHaveAttribute('data-screen', 'menu');
  await expect(page.locator('#hud .screen.menu')).toHaveCSS('opacity', '1');

  // The title screen uses the ticket's full game name.
  await expect(page.locator('#hud .screen.menu .hero')).toHaveText(
    'GARY AND HIS FRIENDS',
  );

  // The seeded best is on the card and on the test API.
  await expect(page.locator('#menu-best-n')).toHaveText('4242');
  expect(await page.evaluate(() => window.__GARY__?.highScore)).toBe(4242);
  await expect(page.locator('#menu-best')).not.toHaveClass(/empty/);

  // The sound toggle is reachable from the title screen.
  await expect(page.locator('#soundBtn')).toBeVisible();

  await page.screenshot({ path: 'test-results/juice-menu.png', fullPage: true });
  expect(consoleErrors).toEqual([]);
});

test('a fresh player sees no record rather than a zero', async ({ page }) => {
  const consoleErrors = await boot(page);

  await expect(page.locator('#hud')).toHaveAttribute('data-screen', 'menu');
  expect(await page.evaluate(() => window.__GARY__?.highScore)).toBe(0);
  await expect(page.locator('#menu-best')).toHaveClass(/empty/);
  await expect(page.locator('#menu-best-n')).toHaveText('—');
  // ...and the playbar drops the Best instrument entirely rather than parking
  // a permanent zero in the middle of the telemetry.
  await expect(page.locator('#ro-best')).toBeHidden();

  expect(consoleErrors).toEqual([]);
});

test('particles fire on hops and pickups, and the road kicks up dust', async ({
  page,
}) => {
  const consoleErrors = await boot(page);

  // Nothing in flight before a run.
  expect(await page.evaluate(() => window.__GARY__?.particles)).toBe(0);

  await page.evaluate(() => window.__GARY__?.start());
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('playing');

  // Road dust: emitted continuously while moving, so it appears on its own.
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.particles ?? 0), {
      timeout: 5_000,
    })
    .toBeGreaterThan(0);

  // Hop dust: a lane change throws a much bigger puff than the trickle of road
  // dust, so the count jumps well clear of the idle plume.
  const beforeHop = await page.evaluate(() => window.__GARY__?.particles ?? 0);
  await page.keyboard.press('ArrowLeft');
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.particles ?? 0))
    .toBeGreaterThan(beforeHop);

  // Collect pop: spawn a friend, let the real pickup path collect it, and the
  // burst lands with it.
  await page.evaluate(() => window.__GARY__?.__spawnFriend());
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.friends ?? 0), {
      timeout: 5_000,
    })
    .toBeGreaterThan(0);
  expect(
    await page.evaluate(() => window.__GARY__?.particles ?? 0),
  ).toBeGreaterThan(0);

  // Mid-game capture with particles genuinely in frame.
  await page.evaluate(() => window.__GARY__?.__spawnFriend());
  await page.waitForTimeout(400);
  await page.screenshot({
    path: 'test-results/juice-playing.png',
    fullPage: true,
  });

  expect(consoleErrors).toEqual([]);
});

test('the death animation plays into gameover and throws debris', async ({
  page,
}) => {
  const consoleErrors = await boot(page);

  await page.evaluate(() => window.__GARY__?.start());
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('playing');
  expect(await page.evaluate(() => window.__GARY__?.dying)).toBe(false);

  // Let the run bank a little distance so the card has a real score on it.
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__GARY__?.__forceCollision());
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('gameover');

  // The squash-and-stretch is *running*, not just a state flip, and the crash
  // threw debris.
  expect(await page.evaluate(() => window.__GARY__?.dying)).toBe(true);
  expect(
    await page.evaluate(() => window.__GARY__?.particles ?? 0),
  ).toBeGreaterThan(0);

  // ...and it finishes, leaving him settled rather than mid-bounce forever.
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.dying), {
      timeout: 5_000,
    })
    .toBe(false);
  expect(await page.evaluate(() => window.__GARY__?.state)).toBe('gameover');

  // The game-over card shows the best alongside the run, and this run set it
  // (it is the first run in a fresh profile).
  await expect(page.locator('#over-best')).toHaveClass(/new/);
  await expect(page.locator('#gameover-title')).toHaveText('New record!');
  const score = await page.evaluate(() => window.__GARY__?.score ?? 0);
  expect(score).toBeGreaterThan(0);
  await expect(page.locator('#over-best-n')).toHaveText(String(score));

  // The payoff declutters live telemetry and keeps breathing after the one-shot
  // crash debris has expired: at this age, any live particles are the smoulder.
  await expect(page.locator('#hud .playbar')).toHaveCSS('opacity', '0');
  await expect(page.locator('#hud .roster')).toHaveCSS('opacity', '0');
  await page.waitForTimeout(1_600);
  expect(
    await page.evaluate(() => window.__GARY__?.particles ?? 0),
  ).toBeGreaterThan(0);
  await page.screenshot({
    path: 'test-results/juice-gameover.png',
    fullPage: true,
  });

  // A restart clears the wreck: Gary is upright again and the debris is gone.
  // Read in the SAME evaluate that restarts — the very next frame legitimately
  // starts kicking up fresh road dust, and that is not the old crash.
  const restarted = await page.evaluate(() => {
    window.__GARY__?.start();
    return {
      dying: window.__GARY__?.dying,
      particles: window.__GARY__?.particles,
    };
  });
  expect(restarted).toEqual({ dying: false, particles: 0 });

  expect(consoleErrors).toEqual([]);
});

test('the high score persists across a reload and only rises', async ({
  page,
}) => {
  const consoleErrors = await boot(page);

  // ── Run one: set a record from nothing ──────────────────────────────────
  expect(await page.evaluate(() => window.__GARY__?.highScore)).toBe(0);
  await page.evaluate(() => window.__GARY__?.start());
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('playing');
  await page.waitForTimeout(900);
  const first = await page.evaluate(() => {
    window.__GARY__?.__forceCollision();
    return window.__GARY__?.score ?? 0;
  });
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('gameover');
  expect(first).toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.highScore))
    .toBe(first);

  // It went to storage, not just to memory.
  expect(
    await page.evaluate(
      (key) => window.localStorage.getItem(key),
      HIGH_SCORE_KEY,
    ),
  ).toBe(String(first));

  // ── Run two: end it early, well short of the record ─────────────────────
  await page.evaluate(() => window.__GARY__?.start());
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('playing');
  const second = await page.evaluate(() => {
    window.__GARY__?.__forceCollision();
    return window.__GARY__?.score ?? 0;
  });
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('gameover');
  expect(second).toBeLessThan(first);

  // A worse run must not overwrite the record, and the card must not claim one.
  expect(await page.evaluate(() => window.__GARY__?.highScore)).toBe(first);
  await expect(page.locator('#over-best')).not.toHaveClass(/new/);
  await expect(page.locator('#gameover-title')).toHaveText('Wrecked!');
  await expect(page.locator('#over-best-n')).toHaveText(String(first));

  // ── And it survives a full reload ───────────────────────────────────────
  await page.reload();
  await page.waitForFunction(() => window.__GARY__?.ready === true, null, {
    timeout: 15_000,
  });
  expect(await page.evaluate(() => window.__GARY__?.highScore)).toBe(first);
  await expect(page.locator('#menu-best-n')).toHaveText(String(first));

  expect(consoleErrors).toEqual([]);
});

test('passing the stored best announces a record mid-run', async ({ page }) => {
  // A tiny seeded best, so a short run blows straight past it.
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key as string, value as string),
    [HIGH_SCORE_KEY, '5'],
  );
  const consoleErrors = await boot(page);

  await page.evaluate(() => window.__GARY__?.start());
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('playing');

  // The in-play readout carries the standing best, then lights when passed.
  await expect(page.locator('#ro-best')).toBeVisible();
  await expect(page.locator('#ro-best .val')).toHaveText('5');
  await expect(page.locator('#ro-best')).toHaveClass(/beaten/, {
    timeout: 5_000,
  });
  await expect(page.locator('#record')).toHaveClass(/show/);

  expect(consoleErrors).toEqual([]);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('keeps the information and drops the motion', async ({ page }) => {
    const consoleErrors = await boot(page);

    await page.evaluate(() => window.__GARY__?.start());
    await expect
      .poll(() => page.evaluate(() => window.__GARY__?.state))
      .toBe('playing');
    await page.waitForTimeout(600);
    await page.evaluate(() => window.__GARY__?.__forceCollision());
    await expect
      .poll(() => page.evaluate(() => window.__GARY__?.state))
      .toBe('gameover');

    // The death still resolves — Gary is visibly wrecked, he just doesn't
    // bounce there. Information is never what reduced motion removes.
    await expect
      .poll(() => page.evaluate(() => window.__GARY__?.dying), {
        timeout: 5_000,
      })
      .toBe(false);
    await expect(page.locator('#gameover-title')).toHaveText('New record!');
    await expect(page.locator('#over-best')).toHaveClass(/new/);

    await page.waitForTimeout(500);
    await page.screenshot({
      path: 'test-results/juice-gameover-reduced-motion.png',
      fullPage: true,
    });
    expect(consoleErrors).toEqual([]);
  });
});

test('sound can be muted and unmuted without breaking the run', async ({
  page,
}) => {
  const consoleErrors = await boot(page);

  const button = page.locator('#soundBtn');
  await expect(button).toHaveAttribute('data-muted', 'false');
  await button.click();
  await expect(button).toHaveAttribute('data-muted', 'true');

  // Muted, the game still plays every cue-triggering event without error.
  await page.evaluate(() => window.__GARY__?.start());
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('playing');
  await page.keyboard.press('ArrowLeft');
  await page.evaluate(() => window.__GARY__?.__spawnFriend());
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__GARY__?.__forceCollision());
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('gameover');

  await button.click();
  await expect(button).toHaveAttribute('data-muted', 'false');

  expect(consoleErrors).toEqual([]);
});
