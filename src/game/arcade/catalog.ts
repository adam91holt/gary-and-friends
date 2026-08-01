/**
 * The cabinet's game catalog — pure data describing what is in the arcade.
 *
 * Almost pure: the only non-data import is the Vite asset URL for each preview,
 * which resolves to a hashed, base-relative string at build time. That is a
 * deliberate exception to the "nothing but data under src/game" rule and the
 * ONLY one — it keeps the four card images beside the four card descriptions,
 * and it must never become a root-absolute path (`/assets/...`), because
 * production is served from the /gary-and-friends/ GitHub Pages subpath.
 *
 * Everything else here is inert: no DOM, no `three`, no `window`. The select
 * grid, the HUD and the runtime registry all read this table, so a game can
 * never be advertised with one name and played under another.
 */
import { FRIENDS } from '../friends/roster.ts';
import { GAME_IDS, type GameId } from './contracts.ts';

import coneballPreview from '../../assets/previews/coneball.webp';
import highwayPreview from '../../assets/previews/highway.webp';
import royalRollPreview from '../../assets/previews/royal-roll.webp';
import towerPreview from '../../assets/previews/tower.webp';

/** One line of the card's control summary: the input, and what it does. */
export interface ControlHint {
  /** The key/gesture, e.g. "← →" or "Space". Rendered in the accent weight. */
  readonly keys: string;
  /** What it does, e.g. "Switch lane". Sentence case, no trailing period. */
  readonly action: string;
}

/** Who is in this game, as indexes into FRIENDS plus the Gary flag. */
export interface StarringCast {
  /** True if Gary himself is playable/present. He usually is. */
  readonly gary: boolean;
  /** Indexes into `FRIENDS` (src/game/friends/roster.ts). Order is billing. */
  readonly friends: readonly number[];
}

export interface GameEntry {
  readonly id: GameId;
  /** Full name, shown on the card and in the run HUD. */
  readonly title: string;
  /** Short name for tight surfaces (the playbar chip, the back link). */
  readonly shortTitle: string;
  /** One sentence of what you actually do. Present tense, no marketing. */
  readonly description: string;
  /** Billing block for the card's cast rail. */
  readonly cast: StarringCast;
  /** Two or three lines, most important first. */
  readonly controls: readonly ControlHint[];
  /** Vite-resolved preview image URL (base-relative — see the file header). */
  readonly preview: string;
  /**
   * Whether the runtime is a real game yet. Placeholders still enter, draw and
   * report a snapshot; the card marks them so the menu never promises a run it
   * cannot deliver. Siblings flip this to `true` when they land.
   */
  readonly playable: boolean;
}

/**
 * The cabinet. Declaration order is the grid's reading order (row-major, 2×2)
 * and therefore the order arrow navigation walks — see src/ui/gameSelect.ts.
 */
export const GAMES: readonly GameEntry[] = [
  {
    id: 'highway',
    title: 'Endless Highway',
    shortTitle: 'Highway',
    description:
      'Weave three lanes of oncoming traffic, thread the gaps for bonus points, and pick up a friend or two on the way.',
    cast: { gary: true, friends: [0, 1, 2, 3, 4] },
    controls: [
      { keys: '← →', action: 'Switch lane' },
      { keys: 'Space', action: 'Start / restart' },
      { keys: 'Swipe', action: 'Lane change' },
    ],
    preview: highwayPreview,
    playable: true,
  },
  {
    id: 'tower',
    title: 'Stack Attack',
    shortTitle: 'Stack',
    description:
      'A crane swings the crew over a growing tower. Drop them dead centre or lose the overhang — the stack only ever gets narrower.',
    // Tiny (3) and Big Dave (4) are billed first: they are the two silhouettes
    // the tower is built to show off, and the weighted cast bag agrees.
    cast: { gary: true, friends: [3, 4, 1, 0] },
    controls: [
      { keys: 'Space', action: 'Drop a cone' },
      { keys: 'Tap', action: 'Drop a cone' },
    ],
    preview: towerPreview,
    playable: true,
  },
  {
    id: 'coneball',
    title: 'Coneball',
    shortTitle: 'Coneball',
    description:
      'Two cones, one court, one increasingly quick ball. Return every serve; the rally is the score.',
    cast: { gary: true, friends: [1, 3] },
    controls: [
      { keys: '↑ ↓', action: 'Move paddle' },
      { keys: 'Space', action: 'Serve' },
    ],
    preview: coneballPreview,
    playable: false,
  },
  {
    id: 'royal-roll',
    title: 'Royal Roll',
    shortTitle: 'Royal Roll',
    description:
      'Gary is on his side and the hill is steepening. Steer the roll, collect the crown, and try not to become a plastic pancake.',
    cast: { gary: true, friends: [2, 3] },
    controls: [
      { keys: '← →', action: 'Steer the roll' },
      { keys: 'Space', action: 'Hop' },
    ],
    preview: royalRollPreview,
    playable: false,
  },
];

/** Catalog entries by id, for O(1) lookup from the store/HUD/registry. */
const BY_ID = new Map<GameId, GameEntry>(GAMES.map((game) => [game.id, game]));

/**
 * Look up a game. Throws on an unknown id rather than returning undefined:
 * every caller has already narrowed to `GameId`, so reaching here with junk
 * means the catalog and the id union have drifted apart, which is a bug worth
 * a stack trace instead of a silently blank card.
 */
export function gameEntry(id: GameId): GameEntry {
  const entry = BY_ID.get(id);
  if (!entry) throw new Error(`Unknown game id: ${id}`);
  return entry;
}

/** How many friends are billed on a card, for the "+N more" cap in the rail. */
export function castSize(entry: GameEntry): number {
  return entry.cast.friends.length + (entry.cast.gary ? 1 : 0);
}

/** The grid is 2×2 today; the select UI reads this rather than hardcoding 2. */
export const GRID_COLUMNS = 2;

/** Re-exported so consumers can iterate ids without importing two modules. */
export { GAME_IDS };

/** Total games in the cabinet. */
export const GAME_COUNT = GAMES.length;

/** Guard: FRIENDS is the roster every cast index must land inside. */
export const CAST_ROSTER_SIZE = FRIENDS.length;
