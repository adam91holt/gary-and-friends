import { expect, test, type Page } from '@playwright/test';

/**
 * Bartholocone's Big Bounce, end to end in a real browser against the
 * production bundle.
 *
 * One lifecycle, in order: select the game from the cabinet, start it, serve,
 * set up a REAL paddle collision and assert the rally and score moved, strike a
 * drum, set up a real miss, run out of lives into game-over, and restart clean.
 *
 * Every situation is set up through the game's own deterministic command
 * (`coneball:place`), which positions the ball and then gets out of the way:
 * the swept solver still has to genuinely carry the ball into the board to
 * score a rally, genuinely into a drum to smash it, and genuinely across the
 * miss line to cost a life. Nothing here races an animation frame, and nothing
 * pokes a result into existence.
 */

/** The storage key `game/highScore.ts` owns for this game. Pinned on purpose. */
const HIGH_SCORE_KEY = 'gary.highScore.coneball.v1';

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

/** The runtime's typed snapshot, as the test API projects it. */
interface Snap {
  readonly game: string;
  readonly score: number;
  readonly entities: number;
  readonly metric: { readonly label: string; readonly value: number } | null;
  readonly rally: number;
  readonly lives: number;
  readonly wave: number;
  readonly targetsRemaining: number;
  readonly targets: ReadonlyArray<{
    readonly id: number;
    readonly x: number;
    readonly z: number;
    readonly active: boolean;
  }>;
  readonly serving: boolean;
  readonly ball: { x: number; z: number; vx: number; vz: number };
  readonly paddleX: number;
  readonly ballSpeed: number;
}

function snapshot(page: Page): Promise<Snap> {
  return page.evaluate(() => window.__GARY__?.snapshot as unknown as Snap);
}

/**
 * A drum that is genuinely still standing, nearest the player in its column —
 * so a ball fired up the court at it meets THAT drum first. Read from the live
 * snapshot rather than assumed, because a rally may already have cleared the
 * column a hardcoded coordinate would have aimed at.
 */
async function standingDrum(page: Page): Promise<{ x: number; z: number }> {
  const { targets } = await snapshot(page);
  const standing = targets
    .filter((t) => t.active)
    .sort((a, b) => b.z - a.z);
  expect(standing.length).toBeGreaterThan(0);
  return { x: standing[0].x, z: standing[0].z };
}

/** Open Big Bounce from the cabinet and start a run. */
async function startRun(page: Page): Promise<void> {
  await page.locator('#gcard-coneball').click();
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('playing');
}

test('select Big Bounce, rally, smash a drum, miss out, and restart', async ({
  page,
}) => {
  const consoleErrors = await boot(page);

  // ── The cabinet offers it as a real game, not a reserved slot ────────────
  await expect(page.locator('#gcard-coneball .soon')).toHaveCount(0);
  await page.evaluate(() => window.__GARY__?.selectGame('coneball'));
  await expect(page.locator('#startBtn')).toHaveAttribute(
    'aria-disabled',
    'false',
  );

  // WebGL is genuinely running behind the panel: one canvas, with a context.
  expect(
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return false;
      return (
        canvas.getContext('webgl2') !== null ||
        canvas.getContext('webgl') !== null
      );
    }),
  ).toBe(true);

  await startRun(page);
  expect(await page.evaluate(() => window.__GARY__?.game)).toBe('coneball');

  // ── A fresh court: three lives, no rally, a full wall, ball in hand ──────
  const fresh = await snapshot(page);
  expect(fresh.game).toBe('coneball');
  expect(fresh.lives).toBe(3);
  expect(fresh.rally).toBe(0);
  expect(fresh.wave).toBe(1);
  expect(fresh.targetsRemaining).toBe(15);
  expect(fresh.serving).toBe(true);
  expect(fresh.ballSpeed).toBe(0);
  expect(fresh.metric).toEqual({ label: 'Rally  ●●●', value: 0 });
  // The generic HUD slot really is showing this game's instrument.
  await expect(page.locator('#ro-friends .lbl')).toHaveText('Rally ●●●');

  // ── The serve ───────────────────────────────────────────────────────────
  // Through the real primary action, exactly as a player's Space does.
  await page.evaluate(() => window.__GARY__?.input('primary'));
  await expect.poll(async () => (await snapshot(page)).serving).toBe(false);
  const served = await snapshot(page);
  expect(served.ballSpeed).toBeGreaterThan(0);
  // It is coming at the player, or it is not a serve.
  expect(served.ball.vz).toBeGreaterThan(0);

  // ── Left/right slides the board, and it clamps at the barrier ───────────
  const centred = (await snapshot(page)).paddleX;
  await page.evaluate(() => window.__GARY__?.input('right'));
  await expect
    .poll(async () => (await snapshot(page)).paddleX)
    .toBeGreaterThan(centred + 0.4);
  for (let i = 0; i < 12; i++) {
    await page.evaluate(() => window.__GARY__?.input('right'));
  }
  await page.waitForTimeout(400);
  const clamped = (await snapshot(page)).paddleX;
  // The whole board stays inside the court (half-width 1.05, half-court 4.2).
  expect(clamped).toBeLessThanOrEqual(4.2 - 1.05 + 0.01);
  await page.evaluate(() => window.__GARY__?.input('left'));
  await expect
    .poll(async () => (await snapshot(page)).paddleX)
    .toBeLessThan(clamped);

  // ── A REAL paddle collision ─────────────────────────────────────────────
  // Put the ball above the board, moving at it, with the board underneath, and
  // watch from inside the page. Placing and watching in one page-side call is
  // load-bearing twice over: the ball served a moment ago is genuinely in play
  // and may bank a rally of its own between two round trips, and a returned
  // ball can reach the drum wall and be on its way back before the test could
  // sample it. The sweep still has to carry the ball into the board; nothing
  // here says "you scored".
  const returned = await page.evaluate(async () => {
    const api = window.__GARY__;
    if (!api) return null;
    const read = (): { rally: number; score: number; vz: number } => {
      const s = api.snapshot as unknown as {
        rally: number;
        score: number;
        ball: { vz: number };
      };
      return { rally: s.rally, score: s.score, vz: s.ball.vz };
    };
    const before = read();
    const placed = api.command('coneball:place', {
      x: 0,
      z: 0.6,
      vx: 0,
      vz: 6.5,
      paddleX: 0,
    });
    const deadline = performance.now() + 5_000;
    while (performance.now() < deadline) {
      const now = read();
      if (now.rally > before.rally) return { placed, before, after: now };
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    return { placed, before, after: null };
  });

  expect(returned).not.toBeNull();
  if (!returned?.after) throw new Error('the board never returned the ball');
  expect(returned.placed).toBe(true);
  // Exactly one return was credited for one contact — not one per frame.
  expect(returned.after.rally).toBe(returned.before.rally + 1);
  // The ball actually turned around and is heading back up the court.
  expect(returned.after.vz).toBeLessThan(0);
  expect(returned.after.score).toBeGreaterThan(returned.before.score);
  // ...and the HUD instrument followed.
  await expect(page.locator('#ro-friends .val')).toHaveText(
    String(returned.after.rally),
  );

  // ── A REAL target strike ────────────────────────────────────────────────
  // Line the ball up under a drum that is genuinely still standing and fire it
  // up the court. The sweep still has to carry it into the drum; nothing here
  // marks anything as smashed.
  const beforeDrums = await snapshot(page);
  const drum = await standingDrum(page);
  await page.evaluate(
    (target) =>
      window.__GARY__?.command('coneball:place', {
        x: target.x,
        z: target.z + 2,
        vx: 0,
        vz: -8,
        paddleX: target.x,
      }),
    drum,
  );
  await expect
    .poll(async () => (await snapshot(page)).targetsRemaining, {
      timeout: 5_000,
    })
    .toBeLessThan(beforeDrums.targetsRemaining);
  const smashed = await snapshot(page);
  expect(smashed.score).toBeGreaterThan(beforeDrums.score);

  // The gameplay artifact, with the ball in flight and a drum just gone.
  await page.waitForTimeout(120);
  await page.screenshot({ path: 'test-results/coneball.png', fullPage: true });

  // ── A REAL miss: the ball gets past the board and costs a life ──────────
  const beforeMiss = await snapshot(page);
  await page.evaluate(() =>
    window.__GARY__?.command('coneball:place', {
      x: 3.4,
      z: 2.6,
      vx: 0,
      vz: 9,
      // Board parked at the far side, so nothing is in the ball's way.
      paddleX: -3.2,
    }),
  );
  await expect
    .poll(async () => (await snapshot(page)).lives, { timeout: 5_000 })
    .toBe(beforeMiss.lives - 1);
  // A miss returns the ball to Coneelia for the next serve.
  await expect.poll(async () => (await snapshot(page)).serving).toBe(true);
  expect(await page.evaluate(() => window.__GARY__?.state)).toBe('playing');

  // ── Out of lives -> gameover ────────────────────────────────────────────
  for (let attempt = 0; attempt < 6; attempt++) {
    const before = await snapshot(page);
    if (before.lives === 0) break;
    await page.evaluate(() =>
      window.__GARY__?.command('coneball:place', {
        x: 3.4,
        z: 2.6,
        vx: 0,
        vz: 9,
        paddleX: -3.2,
      }),
    );
    await expect
      .poll(async () => (await snapshot(page)).lives, { timeout: 5_000 })
      .toBeLessThan(before.lives);
  }

  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state), { timeout: 5_000 })
    .toBe('gameover');
  const over = await snapshot(page);
  expect(over.lives).toBe(0);
  expect(over.score).toBeGreaterThan(0);

  // Game over stops the world: the ball is frozen and the score is final.
  await page.waitForTimeout(500);
  const settled = await snapshot(page);
  expect(settled.score).toBe(over.score);
  expect(settled.ball.x).toBeCloseTo(over.ball.x, 6);
  expect(settled.ball.z).toBeCloseTo(over.ball.z, 6);

  // The card names this game, and banks the run under this game's own key.
  await expect(page.locator('#gameover-eyebrow')).toHaveText(
    'Big Bounce · Run ended',
  );
  await expect(page.locator('#final-metric-k')).toContainText('Rally');
  expect(
    await page.evaluate(
      (key) => window.localStorage.getItem(key),
      HIGH_SCORE_KEY,
    ),
  ).toBe(String(over.score));
  expect(await page.evaluate(() => window.__GARY__?.highScores)).toMatchObject({
    coneball: over.score,
  });

  await page.screenshot({
    path: 'test-results/coneball-gameover.png',
    fullPage: true,
  });

  // ── Restart is clean ────────────────────────────────────────────────────
  // Read in the SAME evaluate that restarts, so no frame can tick between them.
  const restarted = await page.evaluate(() => {
    window.__GARY__?.start();
    const s = window.__GARY__?.snapshot as unknown as Snap | undefined;
    return {
      state: window.__GARY__?.state,
      game: window.__GARY__?.game,
      score: window.__GARY__?.score,
      lives: s?.lives,
      rally: s?.rally,
      wave: s?.wave,
      targets: s?.targetsRemaining,
      serving: s?.serving,
      paddleX: s?.paddleX,
    };
  });
  expect(restarted).toEqual({
    state: 'playing',
    game: 'coneball',
    score: 0,
    lives: 3,
    rally: 0,
    wave: 1,
    targets: 15,
    serving: true,
    paddleX: 0,
  });

  // ...and it is genuinely playable again, not merely reset.
  await page.evaluate(() => window.__GARY__?.input('primary'));
  await expect.poll(async () => (await snapshot(page)).serving).toBe(false);
  expect((await snapshot(page)).ballSpeed).toBeGreaterThan(0);

  // ── Back to the cabinet ─────────────────────────────────────────────────
  await page.evaluate(() =>
    window.__GARY__?.command('coneball:place', {
      x: 3.4,
      z: 2.6,
      vx: 0,
      vz: 9,
      paddleX: -3.2,
    }),
  );
  await expect
    .poll(async () => (await snapshot(page)).lives, { timeout: 5_000 })
    .toBe(2);

  expect(consoleErrors).toEqual([]);
});

test('the ball cannot tunnel through the board at full speed', async ({
  page,
}) => {
  const consoleErrors = await boot(page);
  await startRun(page);

  // Drive the ball straight at the board as fast as the game ever gets it. In
  // the browser this rides real animation frames, so the substep solver is
  // being exercised against whatever dt the machine happens to deliver.
  await page.evaluate(() =>
    window.__GARY__?.command('coneball:place', {
      x: 0,
      z: -2.5,
      vx: 0,
      vz: 15.5,
      paddleX: 0,
    }),
  );

  await expect
    .poll(async () => (await snapshot(page)).rally, { timeout: 5_000 })
    .toBeGreaterThanOrEqual(1);
  // It was RETURNED, not lost: a tunnelled ball would have cost a life.
  expect((await snapshot(page)).lives).toBe(3);

  expect(consoleErrors).toEqual([]);
});

test('the rally survives a long real exchange without leaving the court', async ({
  page,
}) => {
  // Ten seconds of real play plus boot; the default 30s budget is too tight.
  test.setTimeout(60_000);
  const consoleErrors = await boot(page);
  await startRun(page);

  await page.evaluate(() =>
    window.__GARY__?.command('coneball:place', {
      x: 0,
      z: 0,
      vx: 4,
      vz: -7,
      paddleX: 0,
    }),
  );

  // Play it properly for a few seconds: track the ball with the board using the
  // SHIPPING input verbs, exactly as a player does. Nothing is teleported.
  const played = await page.evaluate(async () => {
    const api = window.__GARY__;
    if (!api) return null;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const deadline = performance.now() + 10_000;
    let maxAbsX = 0;
    let maxSpeed = 0;
    while (performance.now() < deadline && api.state === 'playing') {
      const s = api.snapshot as unknown as {
        ball: { x: number; z: number };
        paddleX: number;
        serving: boolean;
        ballSpeed: number;
        rally: number;
      };
      // Track the ball with the board using the SHIPPING verbs, exactly as a
      // player does — the same clamped, damped one-step-per-press slide. A
      // press only commands 1.15 units, so a wide ball takes several: issue as
      // many as the gap actually needs, which is what a player mashing the key
      // does and what keeps the tracking honest under a loaded CI machine.
      if (s.serving) {
        api.input('primary');
      } else {
        const gap = s.ball.x - s.paddleX;
        const presses = Math.min(3, Math.floor(Math.abs(gap) / 0.6));
        for (let i = 0; i < presses; i++) {
          api.input(gap > 0 ? 'right' : 'left');
        }
      }
      maxAbsX = Math.max(maxAbsX, Math.abs(s.ball.x));
      maxSpeed = Math.max(maxSpeed, s.ballSpeed);
      await sleep(16);
    }
    const final = api.snapshot as unknown as {
      rally: number;
      lives: number;
      targetsRemaining: number;
    };
    return {
      maxAbsX,
      maxSpeed,
      rally: final.rally,
      lives: final.lives,
      targetsRemaining: final.targetsRemaining,
    };
  });

  expect(played).not.toBeNull();
  if (!played) return;
  // The exchange was real: the ball came back and was returned more than once,
  // and drums went down along the way.
  expect(played.rally).toBeGreaterThan(1);
  expect(played.targetsRemaining).toBeLessThan(15);
  // It never escaped the court (half-width 4.2 minus the ball's 0.3 radius)...
  expect(played.maxAbsX).toBeLessThanOrEqual(3.9 + 0.01);
  // ...and it never exceeded the tested speed ceiling.
  expect(played.maxSpeed).toBeLessThanOrEqual(15.5 + 0.01);

  expect(consoleErrors).toEqual([]);
});

test('a phone-sized player can slide the board with swipes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const consoleErrors = await boot(page);
  await startRun(page);

  // Real Touch/TouchEvent sequences on the canvas — the same events the
  // shell's handlers read. Same dispatcher shape as e2e/touch.spec.ts.
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('canvas missing');
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const fire = (type: string, x: number, y: number): void => {
      const t = new Touch({
        identifier: 1,
        target: canvas,
        clientX: x,
        clientY: y,
      });
      canvas.dispatchEvent(
        new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          touches: type === 'touchend' ? [] : [t],
          changedTouches: [t],
        }),
      );
    };
    (window as unknown as { __gesture: (dx: number, dy: number) => void }).__gesture =
      (dx, dy) => {
        fire('touchstart', cx, cy);
        for (let i = 1; i <= 6; i++) {
          fire('touchmove', cx + (dx * i) / 6, cy + (dy * i) / 6);
        }
        fire('touchend', cx + dx, cy + dy);
      };
  });
  const gesture = (dx: number, dy: number): Promise<void> =>
    page.evaluate(
      ([x, y]) =>
        (
          window as unknown as { __gesture: (dx: number, dy: number) => void }
        ).__gesture(x, y),
      [dx, dy] as const,
    );

  // A tap is the serve verb.
  await gesture(0, 0);
  await expect.poll(async () => (await snapshot(page)).serving).toBe(false);

  // Swipe right slides the board right; swipe left brings it back.
  const start = (await snapshot(page)).paddleX;
  await gesture(90, 0);
  await expect
    .poll(async () => (await snapshot(page)).paddleX)
    .toBeGreaterThan(start + 0.4);
  const right = (await snapshot(page)).paddleX;
  await gesture(-90, 0);
  await expect
    .poll(async () => (await snapshot(page)).paddleX)
    .toBeLessThan(right - 0.4);

  await page.screenshot({
    path: 'test-results/coneball-phone.png',
    fullPage: true,
  });
  expect(consoleErrors).toEqual([]);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('keeps the rally, the lives and the hit feedback legible', async ({
    page,
  }) => {
    const consoleErrors = await boot(page);
    await startRun(page);

    // The game is fully playable with motion stilled: serve, return, score.
    await page.evaluate(() => window.__GARY__?.input('primary'));
    await expect.poll(async () => (await snapshot(page)).serving).toBe(false);

    await page.evaluate(() =>
      window.__GARY__?.command('coneball:place', {
        x: 0,
        z: 0.6,
        vx: 0,
        vz: 6.5,
        paddleX: 0,
      }),
    );
    await expect
      .poll(async () => (await snapshot(page)).rally, { timeout: 5_000 })
      .toBe(1);

    // The instruments still say what happened — reduced motion removes motion,
    // never information.
    await expect(page.locator('#ro-friends .lbl')).toHaveText('Rally ●●●');
    await expect(page.locator('#ro-friends .val')).toHaveText('1');
    const scored = await snapshot(page);
    expect(scored.score).toBeGreaterThan(0);
    expect(scored.lives).toBe(3);

    // A drum still smashes with motion stilled — the pop is a fade rather than
    // a tumble, but the hit itself is the same rule and still lands.
    const before = (await snapshot(page)).targetsRemaining;
    const drum = await standingDrum(page);
    await page.evaluate(
      (target) =>
        window.__GARY__?.command('coneball:place', {
          x: target.x,
          z: target.z + 2,
          vx: 0,
          vz: -8,
          paddleX: target.x,
        }),
      drum,
    );
    await expect
      .poll(async () => (await snapshot(page)).targetsRemaining, {
        timeout: 5_000,
      })
      .toBeLessThan(before);

    await page.screenshot({
      path: 'test-results/coneball-reduced-motion.png',
      fullPage: true,
    });
    expect(consoleErrors).toEqual([]);
  });
});

test('walking in and out of Big Bounce leaves nothing behind', async ({
  page,
}) => {
  const consoleErrors = await boot(page);

  // In and out of every slot, twice through Big Bounce, proving enter/leave is
  // symmetric now that it owns a real scene subtree.
  for (const id of ['coneball', 'highway', 'coneball', 'tower'] as const) {
    await page.evaluate((game) => window.__GARY__?.selectGame(game), id);
    await expect
      .poll(() => page.evaluate(() => window.__GARY__?.snapshot.game))
      .toBe(id);
  }

  // A run, a miss, back to the cabinet, and in again — the court must come back
  // fresh rather than showing the last run's smashed wall.
  await page.evaluate(() => window.__GARY__?.selectGame('coneball'));
  await startRun(page);
  const beforeDrums = (await snapshot(page)).targetsRemaining;
  const drum = await standingDrum(page);
  await page.evaluate(
    (target) =>
      window.__GARY__?.command('coneball:place', {
        x: target.x,
        z: target.z + 2,
        vx: 0,
        vz: -8,
        paddleX: target.x,
      }),
    drum,
  );
  await expect
    .poll(async () => (await snapshot(page)).targetsRemaining, {
      timeout: 5_000,
    })
    .toBeLessThan(beforeDrums);

  for (let attempt = 0; attempt < 6; attempt++) {
    if ((await snapshot(page)).lives === 0) break;
    const before = (await snapshot(page)).lives;
    await page.evaluate(() =>
      window.__GARY__?.command('coneball:place', {
        x: 3.4,
        z: 2.6,
        vx: 0,
        vz: 9,
        paddleX: -3.2,
      }),
    );
    await expect
      .poll(async () => (await snapshot(page)).lives, { timeout: 5_000 })
      .toBeLessThan(before);
  }
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state), { timeout: 5_000 })
    .toBe('gameover');

  await page.evaluate(() => window.__GARY__?.backToMenu());
  await expect
    .poll(() => page.evaluate(() => window.__GARY__?.state))
    .toBe('menu');
  const back = await snapshot(page);
  expect(back.targetsRemaining).toBe(15);
  expect(back.lives).toBe(3);
  expect(back.serving).toBe(true);

  expect(consoleErrors).toEqual([]);
});
