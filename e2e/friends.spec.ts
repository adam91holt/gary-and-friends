import { expect, test } from '@playwright/test';

/**
 * Friends e2e — the collectible cast in a real browser against the production
 * bundle. Proves the verb the ticket delivers: `__spawnFriend()` puts a named
 * cone on the road, driving into it increments `friends`, grows the conga line
 * and bumps the score; the HUD counter, roster rail and collect flourish
 * follow; a restart clears both the counter and the line; and game over recaps
 * the convoy. Zero console errors throughout, plus explicit screenshots of Gary
 * leading a multi-cone conga line and of the recap card for visual review.
 *
 * Deliberately ONE test covering the whole arc rather than several. Each spec
 * boots its own WebGL context, and the timing-sensitive gameplay specs
 * (near-miss in particular) start to flake when several run in parallel against
 * a software rasteriser. One continuous run is also the truer test: it proves
 * collect → restart → collect again → crash works as a sequence, which three
 * independent fresh-boot tests would never exercise.
 */

/** The cast, mirroring src/game/friends/roster.ts. */
const ROSTER = [
  'Coneelia',
  'Bartholocone',
  'Sir Cones-a-lot',
  'Tiny',
  'Big Dave',
];

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

/**
 * Spawn friends and drive into them until `target` are collected.
 *
 * The hook drops a friend a short way ahead in Gary's current lane, so simply
 * holding the lane collects it — but traffic is live, so this also steers out
 * of the way of anything closing and restarts if a run ends. That keeps the
 * test about friend collection rather than about surviving the highway.
 */
async function collect(
  page: import('@playwright/test').Page,
  target: number,
): Promise<number> {
  return page.evaluate(async (want: number) => {
    const api = window.__GARY__;
    if (!api) return 0;
    const sleep = (ms: number): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, ms));
    const deadline = performance.now() + 25_000;
    let pendingCount: number | null = null;
    let pendingSince = 0;

    while (performance.now() < deadline && api.friends < want) {
      if (api.state !== 'playing') {
        api.start();
        pendingCount = null;
        await sleep(120);
        continue;
      }

      // Keep exactly one deterministic pickup outstanding. Its completion is
      // observed through the live count rather than inferred from stale traffic
      // sampled before the spawn.
      if (pendingCount !== null) {
        if (api.friends > pendingCount) {
          pendingCount = null;
          continue;
        }
        // A natural friend can briefly fill the small pool; retry if the hook had
        // no slot or if the injected pickup was missed after a lane change.
        if (performance.now() - pendingSince > 1_500) pendingCount = null;
        await sleep(32);
        continue;
      }

      // Only leave the current lane when the nearest threat is actually in it.
      // Once a friend is spawned we hold that clear lane until collection.
      const nearest = api.nearestAhead;
      if (nearest && nearest.distance < 34 && nearest.lane === api.lane) {
        api.__setLane((api.lane + 1) % 3);
        await sleep(80);
        continue;
      }
      pendingCount = api.friends;
      pendingSince = performance.now();
      api.__spawnFriend();
      await sleep(32);
    }
    return api.friends;
  }, target);
}

test('friends spawn, are collected, grow the conga line, and reset', async ({
  page,
}) => {
  const consoleErrors = await boot(page);

  await page.evaluate(() => window.__GARY__?.start());
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('playing');

  // A fresh run has nobody in tow.
  expect(await page.evaluate(() => window.__GARY__?.friends)).toBe(0);
  expect(await page.evaluate(() => window.__GARY__?.conga)).toBe(0);

  // ── One friend: the counter rises and the line grows ─────────────────────
  const scoreBefore = await page.evaluate(() => window.__GARY__?.score ?? 0);
  expect(await collect(page, 1)).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => window.__GARY__?.conga ?? 0)).toBeGreaterThan(0);

  // Collecting bumps the score well beyond what distance alone earns in the
  // same handful of frames.
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.score ?? 0))
    .toBeGreaterThan(scoreBefore + 100);

  // The HUD counter is a projection of the same state, not a parallel tally.
  // Both sides are read in ONE evaluate: the count can legitimately move
  // between two round-trips, and comparing across them would test the clock.
  const counter = await page.evaluate(() => ({
    shown: Number(
      document.querySelector('#ro-friends .val')?.textContent ?? '-1',
    ),
    actual: window.__GARY__?.friends ?? -2,
  }));
  expect(counter.shown).toBe(counter.actual);
  expect(counter.shown).toBeGreaterThan(0);

  // ── A real convoy: keep collecting until the line is visibly multi-cone ──
  const collected = await collect(page, 4);
  expect(collected).toBeGreaterThanOrEqual(4);
  // The line and the counter agree: no ghost cones, no phantom count. Sampled
  // in one evaluate so a pickup landing between two round-trips can't fail it.
  const line = await page.evaluate(() => ({
    conga: window.__GARY__?.conga ?? -1,
    friends: window.__GARY__?.friends ?? -2,
  }));
  expect(line.conga).toBeGreaterThanOrEqual(4);
  expect(line.conga).toBe(line.friends);

  // The roster rail has lit chips for the friends actually met.
  await expect(page.locator('#roster .chip.met').first()).toBeVisible();
  expect(
    await page.evaluate(
      () => Number(document.getElementById('roster-met')?.textContent ?? 0),
    ),
  ).toBeGreaterThan(0);

  // ── The collect flourish named whoever just joined ──────────────────────
  // Asserted on the durable text the animation left behind, not its
  // visibility, which is a ~1s animation this would otherwise race.
  const flourish = await page.evaluate(() => ({
    name: document.getElementById('collect-name')?.textContent ?? '',
    points: document.getElementById('collect-pts')?.textContent ?? '',
  }));
  expect(ROSTER).toContain(flourish.name);
  expect(flourish.points).toMatch(/^\+[1-9]\d*$/);
  expect(Number(flourish.points.slice(1))).toBeGreaterThanOrEqual(120);

  // ── Visual artifact: Gary leading his conga line, with the HUD counter ───
  // Let the roster chips finish their 0.25s light-up transition first, or the
  // capture freezes the most recent chip mid-fade and reads as a bug.
  await page.waitForTimeout(400);
  // Hold the collect flourish at its visible peak so the capture shows the
  // name callout as well as the line (it is a ~1s animation otherwise).
  await page.evaluate(() => {
    const el = document.getElementById('collect');
    if (!el) return;
    el.classList.remove('show');
    void el.offsetWidth;
    el.style.animationPlayState = 'paused';
    el.style.animationDelay = '-0.4s';
    el.classList.add('show');
  });
  await page.screenshot({
    path: 'test-results/friends-conga.png',
    fullPage: true,
  });

  // ── Restart clears the line and zeroes the counter ──────────────────────
  // Exercise the real gameover -> playing transition. Collision resolution may
  // land on a later simulation frame, so do not race start() against it.
  await page.evaluate(() => window.__GARY__?.__forceCollision());
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('gameover');
  // Read the reset state in the SAME evaluate that restarts, so no animation
  // frame can collect something between the two and make this flaky.
  const restarted = await page.evaluate(() => {
    const api = window.__GARY__;
    api?.start();
    return {
      state: api?.state,
      friends: api?.friends,
      conga: api?.conga,
      score: api?.score,
    };
  });
  expect(restarted.state).toBe('playing');
  expect(restarted.friends).toBe(0);
  expect(restarted.conga).toBe(0);
  expect(restarted.score).toBe(0);

  // And it stays cleared — the previous run's cones do not drift back in.
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__GARY__?.conga)).toBe(0);
  expect(
    await page.evaluate(() =>
      Number(document.querySelector('#ro-friends .val')?.textContent ?? '-1'),
    ),
  ).toBe(0);
  // The roster rail resets with it.
  expect(await page.locator('#roster .chip.met').count()).toBe(0);

  // ── The restarted run collects again from zero ──────────────────────────
  const second = await collect(page, 2);
  expect(second).toBeGreaterThanOrEqual(2);

  // ── Game over recaps who came along ─────────────────────────────────────
  const crashed = await page.evaluate(() => {
    const api = window.__GARY__;
    api?.__forceCollision();
    return api?.friends ?? -1;
  });
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('gameover');

  // Friends survive the crash on the card — the run you just had is the point.
  expect(crashed).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => window.__GARY__?.friends ?? 0)).toBe(crashed);
  await expect(page.locator('#convoy .co').first()).toBeVisible();

  // The counted-up final tally settles on the real number.
  await expect
    .poll(() =>
      page.evaluate(
        () => Number(document.getElementById('final-friends')?.textContent ?? -1),
      ),
    )
    .toBe(crashed);

  await page.screenshot({
    path: 'test-results/friends-gameover.png',
    fullPage: true,
  });

  expect(consoleErrors).toEqual([]);
});
