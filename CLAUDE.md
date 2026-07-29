# CLAUDE.md — Gary and Friends

Conventions for anyone (human or factory agent) building the game on this
scaffold. Read before adding gameplay.

## Golden rule: keep game logic separable from three.js rendering

The whole point of this scaffold is testability. Maintain the seam:

- **Game logic is pure and lives in `src/game/*`.** No `three` imports, no DOM,
  no `window` there. It must run and be unit-tested under Vitest (node env)
  without a browser. `src/game/state.ts` (`GameStore`) is the source of truth for
  status and score.
- **Rendering lives in `src/main.ts` and `src/scene/*`.** It owns three.js and
  the animation loop and only *reads* from the store. Never stash game state on
  meshes or module-level renderer variables.
- New gameplay = new/extended pure logic in `src/game/*` first (with a Vitest
  test), then wire the renderer to react to it.

## The `window.__GARY__` test API

This is how Playwright drives the game (canvas has no DOM to assert on). Defined
in `src/testApi.ts`, backed by `GameStore`.

- **Extend it additively.** Existing fields (`state`, `score`, `ready`) and
  methods (`start`) are load-bearing for tests already written.
- New readable fields are **getters that project from `GameStore`** — never a
  duplicated copy of state.
- New methods call `GameStore` actions.
- Keep the `GaryTestApi` interface and the `Window` augmentation in
  `src/testApi.ts` accurate.
- Document contract changes in `README.md`.

## TypeScript

- **Strict mode, no exceptions.** `strict` plus `noUnusedLocals`,
  `noUnusedParameters`, `noImplicitReturns`, `exactOptionalPropertyTypes`,
  `noFallthroughCasesInSwitch` are on. Don't loosen `tsconfig.*.json` to make an
  error go away — fix the type.
- No `any`. Prefer precise types and discriminated unions (see `GameStatus`).
- Bundler module resolution with explicit `.ts` extensions on relative imports.

## Testing

- **Unit (Vitest):** co-locate as `*.test.ts` next to the logic under `src/`.
  Cover `GameStore` transitions and any new pure logic. Must not need a browser.
- **E2E (Playwright):** `e2e/*.spec.ts`, Chromium. Drive via `window.__GARY__`,
  wait on `ready`, assert on WebGL presence and state. Always assert **no console
  errors** and capture a screenshot to `test-results/` for visual review.

## Green gates — all must pass before pushing

`npm run typecheck` · `npm run build` · `npm run test` · `npm run test:e2e` ·
`npm run lint`

Never commit with a red gate. The factory relies on these staying green.

## Ports

Dev/preview and the Playwright `webServer` use **5310** (deliberately not 8787).
`playwright.config.ts` builds + previews the app itself, so e2e is self-contained.
