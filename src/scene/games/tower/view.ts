/**
 * The Stack Attack diorama: everything the player looks at, and nothing they
 * play.
 *
 * Rendering-side only. It reads the pure `TowerGame` every frame and places
 * meshes; it never decides where a cone lands, how wide it ends up or whether
 * the run is over. Lighting is this game's own (a warm site key, a cool rim, a
 * lit gantry) exactly as the highway carries its own — the shell contributes
 * only the neutral fill every game inherits — and materials come from the
 * shared `src/render/materials.ts` cache, so it defines no tone mapping and no
 * post chain of its own.
 *
 * ── Feel ────────────────────────────────────────────────────────────────────
 * Three things carry the game's feel, all of them tied to a state change rather
 * than running continuously:
 *
 *  1. The whole tower SETTLES on a landing — a brief compress-and-release down
 *     the stack, biggest at the top, so a drop is felt through the structure.
 *  2. A perfect landing flashes the piece's own emissive and fires the accent
 *     sparkle, so precision is rewarded in the world and not just in the HUD.
 *  3. The camera cranes upward and eases back as the tower grows, so vertical
 *     progress is legible in a scene whose subject never moves laterally.
 *
 * Every one of them is silenced under reduced motion — the tower does not
 * overshoot, the camera does not swing, the trolley does not sway — while the
 * state, the highlighting and the result feedback stay fully legible: the
 * pieces are still exactly where the simulation put them, the perfect flash
 * still lights (it just does not bounce), and the miss still plays out.
 */
import { DirectionalLight, Group, MathUtils, PointLight } from 'three';
import type { DropOutcome, StackEntry, TowerGame } from '../../../game/games/tower/stack.ts';
import {
  CARRIER_HEIGHT,
  pieceHeight,
} from '../../../game/games/tower/rules.ts';
import { ACCENT, ACCENT_2 } from '../../../theme.ts';
import { TowerDust } from './dust.ts';
import { PiecePool, widthScale, type TowerPiece } from './pieces.ts';
import { createYard, type Yard } from './yard.ts';

/** How long the settle wobble runs after a landing (seconds). */
const SETTLE_DURATION = 0.42;
/** Peak vertical compression of the top piece on a landing (world units). */
const SETTLE_DEPTH = 0.1;
/** How much of the wobble reaches each piece further down the stack. */
const SETTLE_FALLOFF = 0.62;

/** How long a perfect landing's emissive flash lasts. */
const FLASH_DURATION = 0.55;

/** Base emissive on the gantry key light; a perfect drop adds to it. */
const KEY_BASE = 1.7;
const GANTRY_LIGHT_BASE = 1.6;

/**
 * The play rig: how far the camera sits back from the tower at ground level.
 * Offset right of centre so the growing stack reads against the left scaffold
 * rather than dead-centre and symmetrical.
 */
const CAM_BASE = { x: 0.5, y: 2.2, z: 6.2 } as const;

/**
 * The menu rig — the hero shot, matching every other cabinet slot's framing:
 * the HUD panel docks LEFT, so the stage is composed off to the RIGHT of frame
 * and walking the select grid never makes the subject jump across the screen.
 * It is a lower, closer three-quarter view than the play rig, because on the
 * menu you are meeting the machine rather than reading its state.
 */
const MENU_RIG = {
  pos: { x: -2.6, y: 2.2, z: 6.4 },
  look: { x: 1.5, y: 2.4, z: 0 },
} as const;

/**
 * The wreck rig. The play camera aims at the top of the tower, which at the
 * moment of a miss is exactly the wrong place: the punchline is the cone that
 * sailed past and the stack it failed to reach. So game-over eases down and
 * back to take in the whole tower at once — the thing you built, with the gap
 * where the last one should have gone.
 */
const WRECK_LIFT = 0.42;
const WRECK_PULLBACK = 0.55;
/**
 * How the shot reframes per world unit of tower.
 *
 * The camera rises slightly LESS than the tower does and eases back as it
 * goes, so the growing stack fills more of the frame the higher it gets — the
 * reward is that your tower becomes visually bigger, not that it stays the same
 * size in a receding shot. It aims at a point below the top so the tower you
 * built stays in frame under the thing you are about to drop.
 */
const CAM_RISE = 0.92;
const CAM_PULLBACK = 0.22;
/** Ceiling on the reframing, so a very tall tower doesn't sail off into space. */
const CAM_FRAME_MAX = 16;

/** One piece currently drawn in the tower. */
interface DrawnPiece {
  readonly entry: StackEntry;
  readonly piece: TowerPiece;
  /** Seconds since the perfect flash started, or null. */
  flash: number | null;
}

export class TowerView {
  readonly root = new Group();

  private readonly yard: Yard;
  private readonly dust = new TowerDust();
  private readonly stackGroup = new Group();
  private readonly pool: PiecePool;
  private readonly key: DirectionalLight;
  private readonly rim: DirectionalLight;
  private readonly gantryLight: PointLight;

  private readonly drawn: DrawnPiece[] = [];
  /** The cone in the air, or the one the trolley is holding. */
  private carried: TowerPiece | null = null;

  /** Seconds since the last landing, or null. Drives the settle wobble. */
  private settle: number | null = null;
  /** Warm flash added to the key light after a landing. */
  private landingFlash = 0;
  /** Extra light on a perfect drop. Distinct from `landingFlash`. */
  private perfectFlash = 0;
  /** Damped tower height, so the camera crane never jumps a whole piece. */
  private framedHeight = 0;
  private reducedMotion = false;
  private time = 0;

  constructor(private readonly game: TowerGame) {
    this.root.name = 'TowerView';
    this.yard = createYard();
    this.pool = new PiecePool(this.stackGroup);

    // This game's own lighting. A warm site key from the camera side models the
    // cast; a cool rim peels the tower off the night behind it; a point light
    // riding the gantry makes the trolley the brightest thing in frame, which
    // is exactly where the player has to be looking.
    this.key = new DirectionalLight(0xffe3bd, KEY_BASE);
    this.key.position.set(5, 9, 7);
    this.rim = new DirectionalLight(0x7d95ff, 0.95);
    this.rim.position.set(-6, 4, -5);
    this.gantryLight = new PointLight(ACCENT_2, GANTRY_LIGHT_BASE, 14, 2);

    this.root.add(
      this.key,
      this.rim,
      this.yard.group,
      this.stackGroup,
      this.dust.group,
    );
    this.yard.gantry.add(this.gantryLight);
    this.gantryLight.position.set(0, -0.6, 0.6);
  }

  /** Live particles, for the runtime's entity count. */
  get particleCount(): number {
    return this.dust.liveCount;
  }

  /**
   * Back to a clean, drawable yard: every stacked piece returned to the pool,
   * the carried cone rebuilt, the dust wiped and every feel value at rest. A
   * restart can never leave a ghost piece or last run's debris hanging over a
   * fresh tower.
   */
  reset(): void {
    for (const drawn of this.drawn) this.pool.release(drawn.piece);
    this.drawn.length = 0;
    if (this.carried) {
      this.pool.release(this.carried);
      this.carried = null;
    }
    this.dust.clear();
    this.settle = null;
    this.landingFlash = 0;
    this.perfectFlash = 0;
    this.framedHeight = 0;
    this.yard.trolley.rotation.z = 0;
    this.yard.hook.rotation.z = 0;
    this.syncStack();
  }

  /**
   * React to a drop the SIMULATION resolved. Told, never inferred: the view
   * gets the outcome and decides how it feels, exactly like the highway's
   * near-miss and pickup callbacks.
   */
  onDrop(outcome: DropOutcome): void {
    if (!outcome.landed) {
      // The cone the player just lost, coming apart on the deck below.
      this.dust.collapse(outcome.x, outcome.variant);
      this.landingFlash = 1;
      return;
    }

    this.settle = 0;
    this.landingFlash = 1;
    this.dust.landing(outcome.x, outcome.y, Math.max(0.4, outcome.trimmed + 0.6));

    if (outcome.perfect) {
      this.perfectFlash = 1;
      this.dust.perfect(outcome.x, outcome.y, outcome.combo);
    } else if (outcome.trimmed > 0.01) {
      // Debris off the side the cone actually hung over.
      this.dust.trim(outcome.x, outcome.y, outcome.variant, outcome.offset);
    }
  }

  update(dt: number, time: number, reducedMotion: boolean): void {
    this.reducedMotion = reducedMotion;
    this.time = time;

    this.syncStack();
    this.syncCarried(dt);
    this.syncGantry(dt);
    this.applySettle(dt);
    this.applyLights(dt);
    this.dust.update(dt);

    // Damp the framing height so the crane glides between levels instead of
    // stepping. Reduced motion snaps, which is the same deal the shell's camera
    // damping makes.
    const target = Math.min(this.game.towerTop, CAM_FRAME_MAX);
    this.framedHeight = reducedMotion
      ? target
      : MathUtils.damp(this.framedHeight, target, 3.4, dt);
  }

  /**
   * Where the camera wants to be, in world space. The shell damps toward it, so
   * every one of these transitions reads as a continuous move rather than a cut
   * — and the crane that follows a growing tower IS the reward made visible.
   */
  cameraPose(framing: 'menu' | 'playing' | 'gameover'): {
    position: { x: number; y: number; z: number };
    look: { x: number; y: number; z: number };
  } {
    if (framing === 'menu') {
      return { position: { ...MENU_RIG.pos }, look: { ...MENU_RIG.look } };
    }

    const lift = this.framedHeight;
    // Game over pulls back and drops its aim to take in the whole tower, so the
    // last shot of a run is what you built rather than the empty air above it.
    const wreck = framing === 'gameover';
    return {
      position: {
        x: CAM_BASE.x,
        y: CAM_BASE.y + lift * (wreck ? CAM_RISE * WRECK_LIFT : CAM_RISE),
        z: CAM_BASE.z + lift * (CAM_PULLBACK + (wreck ? WRECK_PULLBACK : 0)),
      },
      look: {
        // Aim between the top of the stack and the gantry above it, so BOTH
        // are in the shot: the gantry is where the decision is made, the top of
        // the stack is where you read the last one. Sitting on either alone
        // puts the other under the playbar or off the bottom of the frame.
        x: 0,
        y: wreck ? lift * 0.45 + 0.6 : lift * CAM_RISE + CARRIER_HEIGHT * 0.55,
        z: 0,
      },
    };
  }

  /* ── Internals ─────────────────────────────────────────────────────────── */

  /** Make the drawn tower match the simulation's stack, piece for piece. */
  private syncStack(): void {
    const entries = this.game.stackEntries;
    // The pad (entry 0) is part of the yard, not a pooled piece.
    const wanted = entries.length - 1;

    while (this.drawn.length > wanted) {
      const removed = this.drawn.pop();
      if (removed) this.pool.release(removed.piece);
    }
    for (let i = this.drawn.length; i < wanted; i++) {
      const entry = entries[i + 1];
      const piece = this.pool.take(entry.variant);
      this.drawn.push({
        entry,
        piece,
        // A piece that just arrived perfect lights up; one being redrawn after
        // an `enter` does not.
        flash: entry.perfect && i === wanted - 1 ? 0 : null,
      });
    }

    for (let i = 0; i < this.drawn.length; i++) {
      const drawn = this.drawn[i];
      const entry = entries[i + 1];
      const group = drawn.piece.group;
      group.position.set(entry.x, entry.y, 0);
      // Lateral only: the character keeps their own height, so a trimmed tower
      // tapers into a spindle rather than shrinking into a toy.
      setFootprint(drawn.piece, entry.width);
    }
  }

  /**
   * Place the cone the trolley is holding, or the one in the air.
   *
   * Both are the same object as far as the player is concerned — it is being
   * carried, then it is falling — so it is the same mesh, moved. Rebuilding it
   * on release would make the drop read as a swap.
   */
  private syncCarried(dt: number): void {
    const falling = this.game.fallingCone;
    const variant = falling ? falling.variant : this.game.carriedVariant;

    if (this.carried === null || this.carried.variant !== variant) {
      if (this.carried) this.pool.release(this.carried);
      this.carried = this.pool.take(variant);
    }

    const group = this.carried.group;
    setFootprint(this.carried, falling ? falling.width : this.game.carriedWidth);

    if (falling) {
      group.position.set(falling.x, falling.y, 0);
      // A falling cone leans very slightly into its travel — a static object
      // dropping dead straight reads as a teleport at these speeds.
      group.rotation.z = this.reducedMotion ? 0 : Math.sin(this.time * 22) * 0.03;
      return;
    }

    // Held: it hangs under the trolley, so it rides the trolley's sway.
    const hangY = this.game.towerTop + CARRIER_HEIGHT;
    group.position.set(this.game.carrierX, hangY, 0);
    group.rotation.z = this.reducedMotion
      ? 0
      : MathUtils.damp(group.rotation.z, this.yard.hook.rotation.z, 6, dt);
  }

  /**
   * Drive the gantry: slide it up to hang above the tower, run the trolley
   * along it, and sway the hook against the direction of travel.
   */
  private syncGantry(dt: number): void {
    // The hook hangs ~1 unit below the beam (see yard.ts), so the beam sits
    // exactly that far above where the carried cone's underside needs to be.
    const gantryY = this.game.towerTop + CARRIER_HEIGHT + 1.05;
    this.yard.gantry.position.y = this.reducedMotion
      ? gantryY
      : MathUtils.damp(this.yard.gantry.position.y, gantryY, 6, dt);
    this.yard.trolley.position.x = this.game.carrierX;

    if (this.reducedMotion || this.game.fallingCone !== null) {
      // Nothing swings while a cone is in the air, and nothing swings at all
      // under reduced motion — the trolley's POSITION is the information, and
      // that stays exact either way.
      this.yard.hook.rotation.z = this.reducedMotion
        ? 0
        : MathUtils.damp(this.yard.hook.rotation.z, 0, 5, dt);
      this.yard.trolley.rotation.z = 0;
      return;
    }

    // Pendulum lag: the hook trails the trolley's travel, harder the faster it
    // is going. It is the only cue that says how quick this level has become
    // before you have watched a full sweep.
    const lean =
      -this.game.carrierDirection * (this.game.carrierSpeed / 6.5) * 0.22;
    this.yard.hook.rotation.z = MathUtils.damp(
      this.yard.hook.rotation.z,
      lean,
      7,
      dt,
    );
    this.yard.trolley.rotation.z = this.yard.hook.rotation.z * 0.18;
  }

  /**
   * The settle: a compress-and-release travelling down the stack after a
   * landing, biggest at the top. It is what makes a drop feel like weight
   * arriving rather than a mesh appearing.
   */
  private applySettle(dt: number): void {
    if (this.reducedMotion || this.settle === null) {
      // Reduced motion: pieces sit exactly where the simulation put them.
      for (const drawn of this.drawn) drawn.piece.group.scale.y = 1;
      if (this.settle !== null) this.settle = null;
      return;
    }

    this.settle += dt;
    if (this.settle > SETTLE_DURATION) {
      this.settle = null;
      for (const drawn of this.drawn) drawn.piece.group.scale.y = 1;
      return;
    }

    const t = this.settle / SETTLE_DURATION;
    // A single decaying half-wave: down, back up, done. No second bounce, or
    // a tall tower would look like jelly.
    const wave = Math.sin(t * Math.PI) * (1 - t);
    for (let i = 0; i < this.drawn.length; i++) {
      // Distance from the top, so the newest piece takes the most of it.
      const depth = this.drawn.length - 1 - i;
      const amount = wave * SETTLE_DEPTH * Math.pow(SETTLE_FALLOFF, depth);
      const height = pieceHeight(this.drawn[i].entry.variant);
      this.drawn[i].piece.group.scale.y = 1 - amount / Math.max(height, 0.2);
    }
  }

  /** Landing/perfect light response, and the per-piece perfect flash. */
  private applyLights(dt: number): void {
    this.landingFlash =
      this.landingFlash > 0.001 ? this.landingFlash * Math.exp(-5 * dt) : 0;
    this.perfectFlash =
      this.perfectFlash > 0.001 ? this.perfectFlash * Math.exp(-2.6 * dt) : 0;

    // Reduced motion still LIGHTS — the flash is result feedback, and removing
    // it would cost information. It just doesn't animate the whole rig.
    this.key.intensity = KEY_BASE + this.landingFlash * 0.9 + this.perfectFlash * 1.3;
    this.gantryLight.intensity = GANTRY_LIGHT_BASE + this.perfectFlash * 2.4;
    this.gantryLight.color.set(this.perfectFlash > 0.2 ? ACCENT : ACCENT_2);

    // The pad ring brightens with the combo, so the target you are aiming at is
    // itself the readout of how well you are doing.
    const glowMaterial = this.yard.padGlow.material;
    if ('emissiveIntensity' in glowMaterial) {
      glowMaterial.emissiveIntensity =
        1.2 + Math.min(this.game.combo, 8) * 0.22 + this.perfectFlash * 1.6;
    }

    for (const drawn of this.drawn) {
      if (drawn.flash === null) {
        drawn.piece.shell.emissiveIntensity = 0;
        drawn.piece.shell.emissive.set(0x000000);
        continue;
      }
      drawn.flash += dt;
      if (drawn.flash > FLASH_DURATION) {
        drawn.flash = null;
        drawn.piece.shell.emissiveIntensity = 0;
        drawn.piece.shell.emissive.set(0x000000);
        continue;
      }
      const t = 1 - drawn.flash / FLASH_DURATION;
      drawn.piece.shell.emissive.set(ACCENT_2);
      // Reduced motion holds a steady, lower glow rather than a decaying pulse:
      // still unmistakably "that one was perfect", without the animation.
      drawn.piece.shell.emissiveIntensity = this.reducedMotion ? 0.5 : t * 1.4;
    }
  }
}

/**
 * Squeeze a piece to the footprint the simulation gave it, and counter-squeeze
 * its eyes back out.
 *
 * The eyes are the character; the cone is the block. A narrowed piece must read
 * as a narrowed cone that is still visibly Big Dave, not as Big Dave with his
 * face crushed sideways — so the shell takes the lateral scale and the eyes are
 * divided back out of it.
 */
function setFootprint(piece: TowerPiece, width: number): void {
  const scale = widthScale(width);
  piece.group.scale.set(scale, 1, scale);
  const inverse = scale > 0.001 ? 1 / scale : 1;
  // Clamped: on a very narrow tower a full counter-scale would leave the eyes
  // hanging out past the cone entirely.
  const eyeScale = Math.min(inverse, 1.6);
  piece.eyes.scale.set(eyeScale, 1, eyeScale);
}
