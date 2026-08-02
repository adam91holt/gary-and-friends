# Controls

Every input the cabinet actually implements, derived by reading the
input-handling code — not guessed. Each row cites the `file:line` where the
control is wired, so any entry can be spot-checked against the source.

## How input flows

No game ever sees a key or a gesture. Every device signal is first **mapped**
to one of six normalized actions — `left`, `right`, `up`, `down`, `primary`,
`back` (`src/game/arcade/contracts.ts:38-45`) — and then **routed** by the
current screen (`src/game/arcade/input.ts:109-123`). The shell delivers the
verb; whoever owns the screen right now decides what it means
(`src/main.ts:261-280`).

## Keyboard — the global map

One listener owns the whole keyboard (`src/main.ts:282-291`). It maps
`KeyboardEvent.key` through the table below, ignores keys it doesn't own
(`src/main.ts:283-284`), and calls `preventDefault()` on the ones it does
(`src/main.ts:290`). Letters are lowercased before lookup, so Caps Lock and
Shift never break steering (`src/game/arcade/input.ts:45-47`).

| Key | Action | Source |
| --- | --- | --- |
| `←` / `A` | `left` | `src/game/arcade/input.ts:29-30` |
| `→` / `D` | `right` | `src/game/arcade/input.ts:31-32` |
| `↑` / `W` | `up` | `src/game/arcade/input.ts:33-34` |
| `↓` / `S` | `down` | `src/game/arcade/input.ts:35-36` |
| `Space` (plus legacy `Spacebar`) / `Enter` | `primary` | `src/game/arcade/input.ts:37-39` |
| `Escape` (plus legacy `Esc`) | `back` | `src/game/arcade/input.ts:40-41` |

One exception: when the keypress lands on a focused game card in the select
grid, the global listener stands down so the card's native button behaviour
handles it (`src/main.ts:285-288`, `src/ui/gameSelect.ts:89-91`). See
[The select grid](#the-select-grid) below.

## What each action does, by screen

Routing is status-aware (`src/game/arcade/input.ts:109-123`), dispatched at
`src/main.ts:261-280`:

| Screen | Directions (`←→↑↓` / WASD) | `primary` (Space / Enter) | `back` (Escape) |
| --- | --- | --- | --- |
| **Menu** | Move the grid cursor — wraps within rows and across rows (`src/ui/gameSelect.ts:95-102`, `src/game/arcade/input.ts:136-174`) | Open the focused card (`src/ui/gameSelect.ts:96-98` → `src/main.ts:218-223`) | Inert — there is nowhere above the menu to go (`src/game/arcade/input.ts:114-115`) |
| **Playing** | Forwarded to the active game (below) | Forwarded to the active game (below) | Routed to `returnToMenu`, which the store honours **from gameover only** — so Escape mid-run is a deliberate no-op; you finish the run, then leave (`src/game/arcade/input.ts:116-117`, `src/main.ts:274-276`, `src/game/state.ts:155-157`) |
| **Game over** | Dropped, so a reflexive dodge can't move a game that is no longer running (`src/game/arcade/input.ts:121`) | Restart the run (`src/game/arcade/input.ts:118-119`, `src/main.ts:270-273` → `src/game/state.ts:127-130`) | Return to the cabinet, keeping the game you just played selected (`src/game/arcade/input.ts:120`, `src/game/state.ts:155-161`) |

The game-over card's own legend agrees: **Space** Restart, **Esc** Cabinet
(`src/ui/hud.ts:521-524`).

## Per game, while playing

Directions and `primary` are forwarded to the active runtime
(`src/main.ts:267-269`). Each game claims only what it means:

### Endless Highway

| Control | Effect | Source |
| --- | --- | --- |
| `←` / `→` (or `A` / `D`) | Move Gary one lane; the store clamps to lanes 0–2 | `src/arcade/games/highway.ts:276-290`, `src/game/state.ts:176-181` |
| `↑` `↓` `Space` | Inert mid-run — the highway is a three-lane dodger with nothing to confirm | `src/arcade/games/highway.ts:276-282` |

### Stack Attack

| Control | Effect | Source |
| --- | --- | --- |
| `Space` (or `Enter`) | Drop the cone the carriage is carrying | `src/arcade/games/tower.ts:116-125` |
| Directions | Deliberately inert — the only input is *when*; arrows must not become aiming | `src/arcade/games/tower.ts:117-121` |

### Bartholocone's Big Bounce

| Control | Effect | Source |
| --- | --- | --- |
| `←` / `→` (or `A` / `D`) | Slide the board one step | `src/arcade/games/coneball.ts:198-208` |
| `Space` (or `Enter`) | Serve the ball; inert mid-rally — a live ball can't be served twice | `src/arcade/games/coneball.ts:209-214` |
| `↑` `↓` | No meaning on a court that only slides sideways | `src/arcade/games/coneball.ts:215-221` |

### Royal Roll — not built yet

The slot is a placeholder: its `handleInput` is inert on purpose
(`src/arcade/games/placeholder.ts:158-162`) and the catalog marks it
`playable: false` (`src/game/arcade/catalog.ts:127`). The card's hints — `← →`
steer, `Space` hop (`src/game/arcade/catalog.ts:122-125`) — are the *intended*
scheme, advertised on the card; they are not implemented controls yet.

## Touch — swipes and taps on the canvas

Touch handlers sit on the canvas (`src/main.ts:313-367`). The HUD overlay is
`pointer-events: none` except its own buttons (`src/ui/hud.css:22-27,36,713`),
so while a run is on screen, a touch anywhere that isn't a button falls through
to the game. `touch-action: none` on the canvas stops the browser claiming
gestures for scroll or zoom, so the listeners stay passive
(`index.html:102-109`, `src/main.ts:293-299`).

| Gesture | Effect | Source |
| --- | --- | --- |
| First finger down | Begins tracking; extra fingers are ignored | `src/main.ts:315-327` |
| Drag past 34 px on its dominant axis | A swipe → the matching direction. Resolved on one axis so a sloppy diagonal never fires two, and at most one direction per gesture | `src/main.ts:329-347`, `src/game/arcade/input.ts:50,63-72` |
| Lift with ≤ 10 px travel and no swipe | A tap → `primary` (the same verb as Space/Enter): start/restart on the shell screens, the game's verb while playing | `src/main.ts:349-360`, `src/game/arcade/input.ts:53,75-82` |
| System cancels the gesture | Releases the tracked finger; nothing fires | `src/main.ts:361-367` |

A swipe routes through the exact same status-aware path as a key
(`src/main.ts:341-343`), so on the menu a swipe moves the grid cursor and a tap
opens the focused card, just like arrows and Space.

## Mouse and the select grid

There are no mouse-specific game gestures — the shell binds no mouse listeners
at all (`src/main.ts` handles only `keydown`, touch, and resize). Pointing
works through native buttons:

- **Game card** — click launches that game (`src/ui/gameSelect.ts:56-59`).
  DOM focus moves the cursor; hover deliberately does not, so the mouse merely
  resting somewhere never changes which game is selected
  (`src/ui/gameSelect.ts:63-71`).
- **Arrows on a focused card** — move the cursor within the 2×2 grid and claim
  the event so the grid's scroll container can't scroll out from under it
  (`src/ui/gameSelect.ts:62,117-125,155-160`).
- **Space / Enter on a focused card** — the browser's native button activation
  fires `click`; the shell never re-reads these keys while the grid has focus,
  so one keystroke can't fire twice (`src/ui/gameSelect.ts:17-23,56-59`,
  `src/main.ts:285-288`).
- **Tab** — the grid keeps exactly one card in the tab order (roving
  `tabindex`), so Tab moves *past* the grid rather than through four stops
  (`src/ui/gameSelect.ts:12-15,134-141`).
- **HUD buttons** — Start run (`src/ui/hud.ts:158-161`), Run it back
  (`src/ui/hud.ts:162-165`), Back to cabinet (`src/ui/hud.ts:166-169`), and the
  sound toggle (`src/ui/hud.ts:170-175`, mute handled at `src/main.ts:189-193`).
  Sound has no keyboard shortcut — the toggle button is the only control for it.

## Not player controls: the test API

`window.__GARY__` is how Playwright drives the cabinet, not a player-facing
input scheme — documented here only so it isn't mistaken for one. Its
`input(action)` feeds a normalized action through the very same routing path
as keyboard and touch (`src/testApi.ts:307-312`, `src/main.ts:250`), and
`command(name, payload)` reaches per-game deterministic hooks: `tower:carrier`
parks the carriage (`src/arcade/games/tower.ts:181-193`), `coneball:place` /
`coneball:serve` set up a situation for the real rules to resolve
(`src/arcade/games/coneball.ts:308-326`).
