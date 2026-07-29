# Gary and Friends

A three.js browser game scaffold — **foundation and test harness only**. Right now
it renders "Gary", a slowly rotating orange road cone, on a ground plane with
basic lighting. The real game gets built on top of this by the factory.

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
  readonly ready: boolean;                          // true after 1st WebGL frame
  start(): void;                                     // menu|gameover -> playing
}

declare global {
  interface Window {
    __GARY__?: GaryTestApi;
  }
}
```

Scaffold values: `state: 'menu'`, `score: 0`, `ready: true` once a frame has
rendered.

**Extending it (factory guidance):**

- Add new readable fields as getters that project from the `GameStore` (never a
  separate copy of state).
- Add new methods that call `GameStore` actions.
- Keep it additive. If you rename/remove a field, update every e2e test that
  reads it in the same change.
- Mirror the type in `src/testApi.ts` so `Window.__GARY__` stays accurate.

## Where the logic / rendering seam lives

- **Game logic (pure, unit-tested, no three.js):** `src/game/state.ts` — the
  `GameStore` (status, score, transitions, subscriptions). Test:
  `src/game/state.test.ts`.
- **Test API (the bridge):** `src/testApi.ts` — projects `GameStore` onto
  `window.__GARY__`.
- **Rendering (three.js, browser-only):** `src/main.ts` (scene, camera, lights,
  animation loop) and `src/scene/gary.ts` (procedural cone geometry). This side
  *reads* the store and never owns game state.
- **Browser e2e:** `e2e/smoke.spec.ts`.

Keeping state out of the renderer is what makes the game testable both fast
(Vitest on `GameStore`) and for real (Playwright via `__GARY__`).

## Getting started

```bash
npm install
npx playwright install chromium   # one-time browser download for e2e
npm run test        # unit
npm run test:e2e    # browser
npm run dev         # play with Gary
```
