# Gary and Friends

A three.js browser game. Gary the googly-eyed road cone weaves a 3-lane night
highway, dodging oncoming traffic; the score climbs with distance, the speed
ramps as the run goes on, and one hit flattens him. Threading a gap tight pays
a near-miss bonus, so the optimal line is the risky one.

Out on the road are five named cone-friends — **Coneelia, Bartholocone, Sir
Cones-a-lot, Tiny** and **Big Dave**. Drive into one and they join a conga line
trailing Gary, pay a bonus that grows with the convoy, and light up in the HUD's
roster rail. The camera cranes back and up as the line grows, so the reward
literally reframes the shot.

Keyboard: **←/→** or **A/D** to change lane, **Space** to start or restart.

Under it sits a **shared foundation + test harness**: the scrolling highway, the
chase camera, the menu → playing → gameover → restart state machine, a telemetry
HUD, and a reusable pure-logic entity layer that both traffic and friends ride.

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
  readonly entities: number;              // live world entities (traffic + friends)
  readonly nearestAhead: { distance, lane } | null;  // next vehicle ahead
  readonly nearMisses: number;                      // gaps threaded this run
  readonly conga: number;                           // friends trailing Gary now
  start(): void;                                     // menu|gameover -> playing
  __setLane(n: number): void;                        // move Gary to lane n
  __forceCollision(): void;                          // force -> gameover
  __spawnFriend(): void;                             // spawn a collectible friend
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
foundation** — later tickets fill in behaviour without renaming. All three are
wired, and all three go through the *real* game rules rather than poking state:
`__forceCollision` injects a vehicle onto Gary and lets the collision predicate
end the run, and `__spawnFriend` injects a friend into Gary's lane just ahead of
him and lets the same predicate collect it (cycling the roster, so repeated
calls introduce different characters). `__spawnFriend` is a no-op outside a run.

`entities` / `nearestAhead` / `nearMisses` / `conga` project the live gameplay
simulation, letting e2e assert that traffic really spawns, that restart clears
the road, that a screenshot is taken with a vehicle actually in frame, and that
the near-miss rule fired — without racing a 0.6s CSS animation. `conga` is
deliberately distinct from `friends`: the latter is the store's count for the
run, the former is how many cones are actually in the world behind Gary, so
asserting both catches a counter that rises without the line growing.

`nearestAhead` reports **traffic only**. A friend is something to aim *for*, so
folding it in would make every steering bot in the e2e suite swerve away from
the reward.

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
- **Gameplay simulation (pure):** `src/game/gameplay/` — `run.ts` (`Run`: ticks
  the world, owns distance/score/collision/near-misses/friend-collection and
  talks to the world only through store actions) and `difficulty.ts` (the speed
  ramp and score-by-distance rules as plain functions of distance travelled).
- **Entities (pure, reusable):** `src/game/entities/` — see below.
- **Friends (pure):** `src/game/friends/` — `roster.ts` (the five named cones as
  data: name, silhouette, hitbox, tint; indexed by `variant` on both sides of
  the seam) and `conga.ts` (`CongaLine`: the path-following tail behaviour).
- **Test API (the bridge):** `src/testApi.ts` — projects `GameStore` onto
  `window.__GARY__` (getters) and exposes the deterministic `__`-hooks.
- **Rendering (three.js, browser-only):** `src/main.ts` (scene, fog, the two
  camera rigs + animation loop), `src/scene/gary.ts` (procedural googly-eyed cone) and
  `src/scene/road.ts` (`Road`: 3-lane highway with instanced, recycled
  dash/barrier/light families scrolled by visual speed) and
  `src/scene/traffic.ts` (`Traffic`: one instanced mesh per vehicle silhouette,
  placed each frame from the simulation's entities) and `src/scene/friends.ts`
  (`Friends`: pooled cone groups for the collectibles on the road and for the
  conga line — pooled rather than instanced precisely so each member can hop,
  lean and pop in independently). `src/audio.ts` owns the
  gesture-unlocked synth feedback, and `src/theme.ts` pins the 3D brand tokens to
  their CSS counterparts. This side *reads* the store and never owns state.
- **DOM overlay:** `src/ui/hud.ts` — menu / telemetry HUD / convoy roster rail /
  game-over card and the async loading skeleton, a projection of the store like
  the test API.
- **Browser e2e:** `e2e/smoke.spec.ts`, `e2e/gameplay.spec.ts`,
  `e2e/friends.spec.ts`.

Keeping state out of the renderer is what makes the game testable both fast
(Vitest on `GameStore`) and for real (Playwright via `__GARY__`).

## The reusable entity layer (`src/game/entities/`)

Everything that travels down the highway toward Gary rides on one pooled,
pure-logic abstraction. **Traffic was its first consumer and friends are its
second — a third kind of world object should be another `EntityField`, not a
parallel implementation.**

| Module         | What it owns                                                       |
| -------------- | ------------------------------------------------------------------ |
| `entity.ts`    | The `Entity` shape: lane, `z`/`prevZ`, size, kind, variant, active |
| `field.ts`     | `EntityField` — the pool: spawn cadence, movement, recycling        |
| `collision.ts` | Swept lane/AABB hit tests + `findHit(entities, collider, kind)`     |
| `lanes.ts`     | `LANE_WIDTH` / `laneToX` (world geometry, needed without three.js)  |
| `rng.ts`       | Seeded `createRng` — gameplay never calls `Math.random()`           |
| `traffic.ts`   | The traffic *rules* built on the above (spawn lane, cadence, sizes) |
| `friends.ts`   | The friend *rules*: cadence, lane choice, hitboxes, pickup scoring   |

To add a new kind of world object:

```ts
const friends = new EntityField({
  capacity: 12,
  rngFactory: () => createRng(seed),         // clear() replays this seed
  interval: (speed) => 90 / speed,           // cadence scales with speed
  spawn: (rng, occupiedLanes) => ({ kind: 'friend', lane, z, ... } | null),
});

// External entities participate in occupancy, so friends cannot spawn in cars.
friends.update(dt, state.speed, traffic.entities);
const hit = findHit(friends.entities, garyCollider, 'friend', laneToX);
if (hit) { friends.despawn(hit); store.addFriends(); }
```

Tick it inside `Run.update()` and render it by reading the field's entities (see
`src/scene/traffic.ts` for the instanced-mesh pattern). A friend is collected by
the *same* predicate that flattens Gary — only the `kind` and the consequence
differ. `EntityField.inject()` places an entity with exact values, which is how
both `__forceCollision()` and `__spawnFriend()` work.

Three invariants are load-bearing and worth not breaking:

- **Collision is swept, not sampled.** Traffic closes at up to ~65 units/sec —
  further per frame than a hitbox is deep. `Entity.prevZ` records the start of
  each tick and the tests use the interval `[prevZ, z]`, so nothing tunnels
  through Gary at speed.
- **There is always a passable lane.** `pickSpawnLane` refuses to take the last
  free lane, and all traffic shares one closing speed (`TRAFFIC_APPROACH`) so
  nothing overtakes and gaps present at spawn survive to the player.
- **Friends close at the same speed, on purpose.** `FRIEND_APPROACH` is pinned
  to `TRAFFIC_APPROACH` so the no-overtaking rule above still holds across both
  fields. If a friend moved at its own rate a car could catch up to one, which
  turns a collectible into *bait* — a reward dangled inside a hitbox. Friends
  *may* take the last free lane (unlike traffic), because a reward on the only
  open line is a gift, never a wall.

## Friends: the collectible cast

`src/game/friends/roster.ts` is the single source of truth for the five named
cones — name, radius, height, hitbox, tint and banding — indexed by `variant`.
The simulation reads the half-extents, `src/scene/friends.ts` reads the
geometry, and `src/ui/hud.ts` reads the names, so a friend can never be drawn as
a different cone from the one you collided with. Their tints live at the token
layer in both places at once (`FRIEND_TINTS` in `src/theme.ts` ↔ `--friend-1..5`
in `index.html`), the same pinning the accent already uses.

`src/game/friends/conga.ts` is the follow behaviour, and it is a **path** follow
rather than a chain of springs. Gary drops breadcrumbs of `{distance, x}`; each
member samples the point on that path a fixed distance back and eases onto it.
A spring chain low-passes the leader's motion once per link, so by the fifth
friend a lane change is a barely visible wobble; sampling a shared history makes
every member perform the *same* swerve Gary did, just later — which is what a
conga line actually looks like. Gaps compress as the line grows
(`congaSpacing`) so a long convoy stays in frame, floored so cones never
interpenetrate.

## Presentation notes (for anyone extending the visuals)

- **Two camera rigs, one committed idea.** `MENU_RIG` is a low front-quarter
  hero shot that frames Gary beside the docked menu card — you meet the
  character before you play him. `CHASE_RIG` is the over-the-shoulder driving
  pose that tracks his lane. Both position *and* aim are damped every frame, so
  `start()` reads as a continuous camera move rather than a cut, and a menu-only
  hero light cross-fades out on the same easing. Add new framings as rigs here
  rather than mutating the camera ad hoc.
- **Traffic is read by light, not by colour, and that is a fairness rule.** The
  lamps and side reflectors set `fog: false` so headlights punch through the
  scene fog: an obstacle you cannot see in time isn't difficulty, it's a bad
  screen. Vehicle bodies are low-`metalness` on purpose — there is no
  environment map here, so a metallic PBR surface reflects nothing and renders
  black. Bodies stay desaturated cool greys and the reflectors are cool white,
  because the one owned accent is Gary's and must never compete with an
  obstacle.
- **The convoy reframes the shot, and the lift matters more than the pull-back.**
  As the conga line grows the chase rig cranes up and back and its aim drifts
  toward Gary (`CONGA_LIFT` / `CONGA_PULLBACK` / `CONGA_AIM_BACK` in `main.ts`).
  From the default low pose you look straight *down* the line and every cone
  hides behind the one in front, so a six-friend convoy reads as one lumpy mass;
  rising turns it into a legible queue of characters. `CONGA_PULLBACK` is
  deliberately > 1 because the tail grows toward the camera — retreating
  one-for-one would hold the newest arrival exactly at the frame edge, and the
  newest arrival is the one the player most wants to see. `scene/friends.ts`
  also weaves the line a few centimetres either side of Gary's path
  (presentation only; collision never sees it) for the same readability reason.
- **Reduced motion is honoured in 3D, not just CSS.** `prefers-reduced-motion`
  snaps the rig transition, stills Gary's idle bob, and stops the friends'
  hover/spin/hop and pop-in (`reducedMotion` in `main.ts`), matching the media
  query in `hud.ts`. What it never removes is *information*: the pickup halo
  stays lit at a fixed opacity and the collect flourish still names the friend —
  it just fades instead of travelling.
- **Design tokens are shared across DOM and WebGL.** CSS tokens live in
  `index.html` `:root`; `src/theme.ts` mirrors `--accent`, `--accent-2`, and
  `--bg` as numeric three.js colors used by Gary, the road, fog, and renderer.
  Keep the two token layers pinned rather than hard-coding a component color.
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
