/**
 * Stack Attack's snapshot shape and its deterministic command payloads.
 *
 * Pure data. It lives beside the simulation rather than in
 * `src/game/arcade/contracts.ts` for the reason the contracts file states in
 * its own header: a game extends the shared vocabulary from its OWN module, so
 * four sibling tickets never edit the same file.
 */
import type { ArcadeSnapshot } from '../../arcade/contracts.ts';

/**
 * What the tower reports about itself: the generic `ArcadeSnapshot` the HUD and
 * the test API read, plus the two numbers only this game has.
 *
 * `metric` carries height (the headline instrument the HUD draws generically);
 * `height` and `combo` are repeated here as first-class fields so an e2e test
 * can assert on the tower's own state without unpacking a label.
 */
export interface TowerSnapshot extends ArcadeSnapshot {
  readonly game: 'tower';
  /** Pieces the player has actually stacked. The base pad is not one. */
  readonly height: number;
  /** Consecutive perfect landings. Zero after any scruffy or missed drop. */
  readonly combo: number;
  /** Where the trolley is, across the yard. Lets a test verify the hook took. */
  readonly carrierX: number;
  /** Whether a cone is in the air right now. */
  readonly falling: boolean;
}

/**
 * Payload for the `tower:carrier` deterministic command.
 *
 * It parks the trolley and nothing else: the drop that follows goes through the
 * real `drop()` + `update()` path, so the overlap rule decides the outcome.
 */
export interface TowerCarrierCommand {
  /** Where to park it, across the yard. Clamped to the rails. */
  readonly x: number;
  /** Optional travel direction to resume in (+1 right, -1 left). */
  readonly direction?: 1 | -1;
}

declare module '../../arcade/contracts.ts' {
  interface ArcadeCommandMap {
    /** Park the trolley at a known point, so a drop can be timed exactly. */
    'tower:carrier': TowerCarrierCommand;
  }
}
