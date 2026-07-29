# Gary and Friends

A three.js browser game — **shared foundation + test harness**. It renders the
game core: a scrolling 3-lane night highway, "Gary" the googly-eyed road cone
lerping between lanes, a chase camera, and the menu → playing → gameover →
restart state machine with a telemetry HUD. Gameplay (traffic, friends, scoring
rules) gets built on top of this by the factory.

The point of this repo is a **green-gated, browser-testable canvas-game
architecture**: game logic is kept separable from rendering, and a runtime test
API (`window.__GARY__`) lets real-browser Playwright tests drive and assert on a
WebGL game that has no DOM to inspect.

## Stack

- **Vite** + **TypeScript** (strict) + **three.js**
- **Vitest** — fast unit tests for pure game logic (no browser)
- **Playwright** — real-browser end-to-end tests (Chromium); how the factory
  iterates on the game

## Scripts

| Script              | What it does                                             |
| ------------------- | -------------------------------------------------------- |
| `npm run dev`       | Vite dev server                                          |
| `npm run build`     | `tsc -b && vite build` (type-check project + prod bundle)|
| `npm run typecheck` | `tsc -b --noEmit` (strict type-check, no emit)           |
| `npm run test`      | `vitest run` (unit tests)                                |
| `npm run test:e2e`  | `playwright test` (builds, previews, drives a browser)   |
| `npm run lint`      | `eslint .`                                               |
| `npm run preview`   | Vite preview of the production build                     |

The Playwright config starts the app itself (`npm run build && npm run preview`)
on **port 5310**, so `npm run test:e2e` needs nothing running beforehand.

## The `window.__GARY__` test-API contract

Canvas/WebGL games expose no DOM to assert on. So the game publishes a small
runtime API on `window` that tests read and poke. **This is a contract — the
factory extends it additively as gameplay lands; existing fields/methods are
load-bearing.**

```ts
interface GaryTestApi {
  readonly state: 'menu' | 'playing' | 'gameover'; // mirrors GameState.status
  readonly score: number;                           // mirrors GameState.score
  readonly friends: number;                         // mirrors GameState.friends
  readonly lane: number;                            // 0..2, mirrors GameState.lane
  readonly speed: number;                           // mirrors GameState.speed
  readonly ready: boolean;                          // true after 1st WebGL frame
  start(): void;                                     // menu|gameover -> playing
  __setLane(n: number): void;                        // move Gary to lane n
  __forceCollision(): void;                          // force -> gameover
  __spawnFriend(): void;                             // spawn a friend (stub: 02)
}

declare global {
  interface Window {
    __GARY__?: GaryTestApi;
  }
}
```

Menu values: `state: 'menu'`, `score: 0`, `friends: 0`, `lane: 1` (centre),
`speed: 0`, `ready: true` once a frame has rendered.

**Deterministic test hooks** (`__`-prefixed) force specific situations so e2e
never depends on random spawns. Their names/signatures are **pinned by the
foundation** — later tickets fill in behaviour without renaming. `__setLane` and
`__forceCollision` are wired now; `__spawnFriend` is a declared no-op stub until
friend-spawning lands (ticket 02).

**Extending it (factory guidance):**

- Add new readable fields as getters that project from the `GameStore` (never a
  separate copy of state).
- Add new methods that call `GameStore` actions.
- Keep it additive. If you rename/remove a field, update every e2e test that
  reads it in the same change.
- Mirror the type in `src/testApi.ts` so `Window.__GARY__` stays accurate.

## Where the logic / rendering seam lives

- **Game logic (pure, unit-tested, no three.js):** `src/game/state.ts` — the
  `GameStore`. Source of truth for `status`, `score`, `lane` (0..2, centre = 1),
  `speed` and `friends`, plus the transitions/subscriptions. Actions: `start`
  (also the restart path), `addScore`, `addFriends`, `setLane` (clamped),
  `setSpeed`, `gameOver`, `reset`. Test: `src/game/state.test.ts`.
- **Test API (the bridge):** `src/testApi.ts` — projects `GameStore` onto
  `window.__GARY__` (getters) and exposes the deterministic `__`-hooks.
- **Rendering (three.js, browser-only):** `src/main.ts` (scene, fog, the two
  camera rigs + animation loop), `src/scene/gary.ts` (procedural googly-eyed cone) and
  `src/scene/road.ts` (`Road`: 3-lane highway with recycled dash/barrier/light
  props scrolled by `speed`). This side *reads* the store and never owns state.
- **DOM overlay:** `src/ui/hud.ts` — menu / telemetry HUD / game-over card and
  the async loading skeleton, a projection of the store like the test API.
- **Browser e2e:** `e2e/smoke.spec.ts`.

Keeping state out of the renderer is what makes the game testable both fast
(Vitest on `GameStore`) and for real (Playwright via `__GARY__`).

## Presentation notes (for anyone extending the visuals)

- **Two camera rigs, one committed idea.** `MENU_RIG` is a low front-quarter
  hero shot that frames Gary beside the docked menu card — you meet the
  character before you play him. `CHASE_RIG` is the over-the-shoulder driving
  pose that tracks his lane. Both position *and* aim are damped every frame, so
  `start()` reads as a continuous camera move rather than a cut, and a menu-only
  hero light cross-fades out on the same easing. Add new framings as rigs here
  rather than mutating the camera ad hoc.
- **Reduced motion is honoured in 3D, not just CSS.** `prefers-reduced-motion`
  snaps the rig transition and stills Gary's idle bob (`reducedMotion` in
  `main.ts`), matching the media query in `hud.ts`.
- **Design tokens live in `index.html` `:root`** — dark surfaces, the single
  owned `--accent` (Gary orange, also reused by the road's edge lines and lamp
  glow), and the type scale. Never hard-code a hex in a component.
- **The display face is self-hosted**, not merely named:
  `@fontsource-variable/space-grotesk` is imported in `main.ts` so Vite bundles
  it (no CDN at runtime) and `--font-display` actually renders in its intended
  voice. `tsconfig.app.json` includes `vite/client` types so the CSS
  side-effect import type-checks under `noUncheckedSideEffectImports`.

## Getting started

```bash
npm install
npx playwright install chromium   # one-time browser download for e2e
npm run test        # unit
npm run test:e2e    # browser
npm run dev         # play with Gary
```
