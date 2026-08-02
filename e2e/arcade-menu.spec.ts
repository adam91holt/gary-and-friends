import { expect, test, type Page } from '@playwright/test';

/**
 * The arcade shell, end to end in a real browser against the production bundle.
 *
 * Covers the whole journey the cabinet exists for: boot into the select grid,
 * arrow-navigate all four cards with the keyboard only, open a placeholder slot
 * and come back, then open the highway, play it, crash, and restart — proving
 * the runtime lifecycle is symmetric and that the pre-arcade highway still
 * behaves exactly as it did. Always asserts zero console errors.
 */

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

test('the cabinet boots to a four-card select grid pointed at the highway', async ({
  page,
}) => {
  const consoleErrors = await boot(page);

  // The pre-arcade boot contract is unchanged.
  expect(
    await page.evaluate(() => ({
      state: window.__GARY__?.state,
      lane: window.__GARY__?.lane,
      speed: window.__GARY__?.speed,
      score: window.__GARY__?.score,
      game: window.__GARY__?.game,
    })),
  ).toEqual({ state: 'menu', lane: 1, speed: 0, score: 0, game: 'highway' });

  // Four cards, in catalog order, each a real button inside a grid cell.
  const cards = page.locator('#game-grid .gcard');
  await expect(cards).toHaveCount(4);
  expect(
    await cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-game'))),
  ).toEqual(['highway', 'tower', 'coneball', 'royal-roll']);
  expect(await page.evaluate(() => window.__GARY__?.games)).toEqual([
    'highway',
    'tower',
    'coneball',
    'royal-roll',
  ]);

  // Layout-grid semantics (NOT role="menu"), with row wrappers for AT.
  await expect(page.locator('#game-grid')).toHaveAttribute('role', 'grid');
  expect(await page.locator('#game-grid [role="row"]').count()).toBe(2);
  expect(await page.locator('#game-grid [role="gridcell"]').count()).toBe(4);
  expect(await page.locator('#game-grid [role="menu"]').count()).toBe(0);

  // Roving tabindex: exactly one card is in the tab order.
  expect(
    await cards.evaluateAll((els) =>
      els.map((e) => (e as HTMLButtonElement).tabIndex),
    ),
  ).toEqual([0, -1, -1, -1]);

  // Each card carries its own preview image, and the URL is base-RELATIVE —
  // production is served from the /gary-and-friends/ GitHub Pages subpath, so a
  // root-absolute src would 404 there while working fine locally.
  const shots = page.locator('#game-grid .gcard .shot img');
  await expect(shots).toHaveCount(4);
  const srcs = await shots.evaluateAll((els) =>
    els.map((e) => e.getAttribute('src') ?? ''),
  );
  for (const src of srcs) {
    expect(src.startsWith('/')).toBe(false);
    // Vite inlines the smallest previews as data URIs and emits the rest as
    // hashed files. Both are subpath-safe; a root-absolute path is what is not.
    expect(src).toMatch(/^data:image\/webp;base64,|\.webp$/);
  }
  expect(new Set(srcs).size).toBe(4);
  // ...and they genuinely decoded, rather than 404ing into a broken-image box.
  expect(
    await shots.evaluateAll((els) =>
      els.every((e) => (e as HTMLImageElement).naturalWidth > 0),
    ),
  ).toBe(true);

  // The cabinet visual for the taste reviewer.
  await expect(page.locator('#hud .screen.menu')).toHaveCSS('opacity', '1');
  await page.screenshot({
    path: 'test-results/arcade-menu.png',
    fullPage: true,
  });

  expect(consoleErrors).toEqual([]);
});

test('arrow keys reach all four cards and selection follows the cursor', async ({
  page,
}) => {
  const consoleErrors = await boot(page);

  const focused = () =>
    page.evaluate(() => document.activeElement?.getAttribute('data-game'));
  const selected = () => page.evaluate(() => window.__GARY__?.game);

  // Tab into the grid: the roving tabindex means one stop, not four.
  await page.locator('#gcard-highway').focus();
  expect(await focused()).toBe('highway');

  // Walk the whole 2×2 in both axes. Selection must track focus every step, so
  // the live 3D behind the panel is always the game under the cursor.
  await page.keyboard.press('ArrowRight');
  expect(await focused()).toBe('tower');
  expect(await selected()).toBe('tower');

  await page.keyboard.press('ArrowDown');
  expect(await focused()).toBe('royal-roll');
  expect(await selected()).toBe('royal-roll');

  await page.keyboard.press('ArrowLeft');
  expect(await focused()).toBe('coneball');
  expect(await selected()).toBe('coneball');

  await page.keyboard.press('ArrowUp');
  expect(await focused()).toBe('highway');
  expect(await selected()).toBe('highway');

  // Both axes wrap, rather than dead-ending at an edge.
  await page.keyboard.press('ArrowLeft');
  expect(await focused()).toBe('tower');
  await page.keyboard.press('ArrowUp');
  expect(await focused()).toBe('royal-roll');

  // The launch strip names whatever is under the cursor.
  await expect(page.locator('#launch-name')).toHaveText('Royal Roll');
  // ...and the tab order rove followed along.
  expect(
    await page
      .locator('#game-grid .gcard')
      .evaluateAll((els) =>
        els.map((e) => (e as HTMLButtonElement).tabIndex),
      ),
  ).toEqual([-1, -1, -1, 0]);

  expect(consoleErrors).toEqual([]);
});

test('a keyboard-only player can open a placeholder slot and come back', async ({
  page,
}) => {
  const consoleErrors = await boot(page);

  // Reach Royal Roll — the last remaining reserved slot — with arrows alone and
  // activate it with Space, a native <button>, so the browser's own activation
  // fires. Crucially it must fire ONCE: if the shell also read the Space as a
  // `primary` action we would both select the card and start a run from it.
  // The cabinet is a 2-column grid, so reaching the far corner exercises both
  // axes of the roving tabindex rather than just the row.
  await page.locator('#gcard-highway').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(() => window.__GARY__?.game)).toBe('royal-roll');
  await page.keyboard.press('Space');

  // Royal Roll is a reserved slot, so it is shown but never started: the shell
  // must not fabricate a run for a game that does not exist yet.
  expect(await page.evaluate(() => window.__GARY__?.game)).toBe('royal-roll');
  expect(await page.evaluate(() => window.__GARY__?.state)).toBe('menu');

  // The additive legacy API must use that same launch guard; it cannot create a
  // placeholder run that the shipping controls refuse to create.
  await page.evaluate(() => window.__GARY__?.start());
  expect(await page.evaluate(() => window.__GARY__?.state)).toBe('menu');

  // JavaScript callers are not protected by the TypeScript GameId union. Junk is
  // rejected before it reaches the store, leaving the valid selection intact.
  const invalidSelection = await page.evaluate(() => {
    try {
      window.__GARY__?.selectGame('pinball' as never);
      return { threw: false, game: window.__GARY__?.game };
    } catch {
      return { threw: true, game: window.__GARY__?.game };
    }
  });
  expect(invalidSelection).toEqual({ threw: true, game: 'royal-roll' });

  await expect(page.locator('#startBtn')).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(page.locator('#gcard-royal-roll .soon')).toBeVisible();
  // ...and the slots that ARE built carry no "Soon" badge.
  await expect(page.locator('#gcard-coneball .soon')).toHaveCount(0);
  await expect(page.locator('#gcard-tower .soon')).toHaveCount(0);

  // Its runtime is genuinely on screen and reporting its own snapshot — the
  // placeholder entered, not merely got selected.
  expect(await page.evaluate(() => window.__GARY__?.snapshot)).toEqual({
    game: 'royal-roll',
    score: 0,
    entities: 4,
    metric: { label: 'Distance', value: 0 },
  });

  // The reserved slot as the player actually sees it: its own arrangement of
  // cones turning behind the panel, with the card marked and the CTA disabled.
  await page.waitForTimeout(500);
  await page.screenshot({
    path: 'test-results/arcade-placeholder.png',
    fullPage: true,
  });

  // Every slot enters and leaves cleanly, in and out, twice over — a runtime
  // that leaked meshes or listeners would surface here as an error or a stale
  // snapshot from the previous game.
  for (const id of ['tower', 'royal-roll', 'highway', 'coneball'] as const) {
    await page.evaluate((game) => window.__GARY__?.selectGame(game), id);
    await expect
      .poll(() => page.evaluate(() => window.__GARY__?.snapshot.game))
      .toBe(id);
  }

  expect(consoleErrors).toEqual([]);
});

test('select the highway, run it, crash, restart, and return to the cabinet', async ({
  page,
}) => {
  const consoleErrors = await boot(page);

  // Come at the highway from another card, so this exercises a real runtime
  // switch rather than the boot default.
  await page.evaluate(() => window.__GARY__?.selectGame('tower'));
  expect(await page.evaluate(() => window.__GARY__?.game)).toBe('tower');

  await page.locator('#gcard-highway').click();
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('playing');
  expect(await page.evaluate(() => window.__GARY__?.game)).toBe('highway');

  // The highway plays exactly as it always did: it moves, it scores, and the
  // lane hook steers.
  expect(await page.evaluate(() => window.__GARY__?.speed ?? 0)).toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.score ?? 0), {
      timeout: 5_000,
    })
    .toBeGreaterThan(0);
  await page.evaluate(() => window.__GARY__?.input('left'));
  await expect.poll(() => page.evaluate(() => window.__GARY__?.lane)).toBe(0);

  // The snapshot describes the running game, and agrees with the store.
  const playing = await page.evaluate(() => ({
    snapshot: window.__GARY__?.snapshot,
    score: window.__GARY__?.score,
    friends: window.__GARY__?.friends,
  }));
  expect(playing.snapshot?.game).toBe('highway');
  expect(playing.snapshot?.score).toBe(playing.score);
  expect(playing.snapshot?.metric).toEqual({
    label: 'Friends',
    value: playing.friends,
  });

  await page.screenshot({
    path: 'test-results/arcade-highway.png',
    fullPage: true,
  });

  // Crash through the real collision path.
  await page.evaluate(() => window.__GARY__?.__forceCollision());
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('gameover');

  // Restart replays the SAME game, from a clean run.
  const restarted = await page.evaluate(() => {
    window.__GARY__?.start();
    return {
      state: window.__GARY__?.state,
      game: window.__GARY__?.game,
      score: window.__GARY__?.score,
      lane: window.__GARY__?.lane,
    };
  });
  expect(restarted).toEqual({
    state: 'playing',
    game: 'highway',
    score: 0,
    lane: 1,
  });

  // Back to the cabinet from game-over — and only from game-over.
  await page.evaluate(() => window.__GARY__?.backToMenu());
  expect(await page.evaluate(() => window.__GARY__?.state)).toBe('playing');

  await page.evaluate(() => window.__GARY__?.__forceCollision());
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('gameover');
  await page.locator('#menuBtn').click();
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('menu');
  // The grid re-opens on the game just played, with focus on its card so a
  // keyboard player is never dropped at the top of the document.
  expect(await page.evaluate(() => window.__GARY__?.game)).toBe('highway');
  await expect(page.locator('#gcard-highway')).toBeFocused();
  // ...and the run is genuinely over, not merely hidden behind the panel.
  expect(
    await page.evaluate(() => ({
      score: window.__GARY__?.score,
      speed: window.__GARY__?.speed,
      lane: window.__GARY__?.lane,
    })),
  ).toEqual({ score: 0, speed: 0, lane: 1 });

  expect(consoleErrors).toEqual([]);
});

test('Escape leaves a finished run but never abandons a live one', async ({
  page,
}) => {
  const consoleErrors = await boot(page);

  await page.evaluate(() => window.__GARY__?.start());
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('playing');

  // Escape mid-run must not dump the player out of a run they are winning.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  expect(await page.evaluate(() => window.__GARY__?.state)).toBe('playing');

  await page.evaluate(() => window.__GARY__?.__forceCollision());
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('gameover');

  // From the game-over card it IS the way out.
  await page.keyboard.press('Escape');
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('menu');

  expect(consoleErrors).toEqual([]);
});

test('each game keeps its own record, and the highway keeps the legacy key', async ({
  page,
}) => {
  // A record written before the arcade existed, under the un-namespaced key.
  await page.addInitScript(() =>
    window.localStorage.setItem('gary.highScore.v1', '4242'),
  );
  const consoleErrors = await boot(page);

  // It survived the upgrade, and it belongs to the highway alone.
  expect(await page.evaluate(() => window.__GARY__?.highScore)).toBe(4242);
  expect(await page.evaluate(() => window.__GARY__?.highScores)).toEqual({
    highway: 4242,
    tower: 0,
    coneball: 0,
    'royal-roll': 0,
  });
  await expect(page.locator('#gbest-highway')).toHaveText('4242');
  await expect(page.locator('#gbest-tower')).toHaveText('—');
  await expect(page.locator('#menu-best-n')).toHaveText('4242');

  // `highScore` tracks the SELECTED game, so walking to an unplayed slot shows
  // no record rather than the highway's.
  await page.evaluate(() => window.__GARY__?.selectGame('tower'));
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.highScore))
    .toBe(0);
  await expect(page.locator('#menu-best-n')).toHaveText('—');

  // ...and back again.
  await page.evaluate(() => window.__GARY__?.selectGame('highway'));
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.highScore))
    .toBe(4242);

  expect(consoleErrors).toEqual([]);
});

test('the per-game command channel reports unhandled commands honestly', async ({
  page,
}) => {
  const consoleErrors = await boot(page);

  // No game implements a command yet, so the reserved hook must report false
  // rather than swallowing the call — a sibling filling this in needs to be
  // able to tell "not handled" from "handled and did nothing".
  expect(
    await page.evaluate(() => window.__GARY__?.command('shell:noop', undefined)),
  ).toBe(false);

  expect(consoleErrors).toEqual([]);
});
