/**
 * The shared body of the three minigame slots that are not built yet.
 *
 * A placeholder is a REAL runtime, not a stub: it enters and leaves the scene
 * symmetrically, draws something honest (its own cones, in its own arrangement,
 * lit by the shell), resets cleanly and reports a truthful snapshot — score 0,
 * because nobody has scored anything. What it deliberately does NOT do is
 * pretend to be playable: `handleInput` is inert and the catalog marks the game
 * `playable: false`, so the menu offers a preview rather than a run.
 *
 * That honesty is the point. The sibling tickets replace the body of one of
 * these files each; because the shell only ever talks through the contract,
 * none of them has to touch `main.ts`, the HUD, the store or the test API.
 */
import {
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  Mesh,
  type Scene,
} from 'three';
import type { ArcadeSnapshot, GameId } from '../../game/arcade/contracts.ts';
import { FRIEND_TINTS } from '../../theme.ts';
import { sharedStandard } from '../../render/materials.ts';
import type {
  ArcadeGameRuntime,
  CameraPose,
  FrameContext,
} from '../runtime.ts';

/**
 * Where the turntable stands in world space. Every slot shares it, so walking
 * the select grid never makes the subject jump across the screen — only the
 * arrangement on the stage changes.
 */
const STAGE_X = 1.5;

/** Where one placeholder cone stands, and how big it is. */
export interface PlaceholderCone {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Height in world units. Radius is derived, so the silhouette stays a cone. */
  readonly height: number;
  /** Index into FRIEND_TINTS. */
  readonly tint: number;
}

export interface PlaceholderSpec {
  readonly id: GameId;
  /** The arrangement of cones that says what this game will be, at a glance. */
  readonly cones: readonly PlaceholderCone[];
  /** The idle camera pose. Every placeholder holds one composed shot. */
  readonly camera: { readonly position: CameraPose['position']; readonly look: CameraPose['look'] };
  /** The instrument label this game will eventually fill (see ArcadeMetric). */
  readonly metricLabel: string;
}

/**
 * A slot runtime built from a spec. Shared implementation, because three
 * identical files would be three places to fix the same lifecycle bug.
 */
export class PlaceholderRuntime implements ArcadeGameRuntime {
  readonly id: GameId;
  readonly root = new Group();

  /** The turntable. Everything that rotates lives here; the lights do not. */
  private readonly stage = new Group();
  private readonly spec: PlaceholderSpec;
  private readonly pieces: Mesh[] = [];
  /** Local clock, so the idle turn restarts from rest on every reset. */
  private elapsed = 0;
  private reducedMotion = false;

  constructor(spec: PlaceholderSpec) {
    this.spec = spec;
    this.id = spec.id;

    // A dark disc under the arrangement, so the cones sit on something rather
    // than floating in the fog.
    // Sized just past the widest arrangement. A larger disc read as a dark
    // floor filling the frame rather than as a plinth the cast stands on.
    const plinth = new Mesh(
      new CylinderGeometry(1.9, 2.05, 0.22, 40),
      sharedStandard({ color: 0x1b1b2a, roughness: 0.85 }),
    );
    plinth.position.y = -0.11;
    // The stage stands where the composed shot aims (see the camera comment in
    // tower.ts): right of frame, clear of the left-docked panel. Cone
    // coordinates in a spec stay stage-local, so a spec never has to know
    // about the panel.
    this.stage.position.x = STAGE_X;
    this.root.add(this.stage);
    this.stage.add(plinth);

    // Its own lighting, for the same reason the highway carries its own: the
    // shell contributes only a dim neutral fill, so a runtime that lit nothing
    // would present its cast as silhouettes in the dark. A warm key from the
    // camera side models them, a cool rim separates them from the background.
    // They hang off `root` and NOT off the turntable, so the key stays on the
    // camera side while the arrangement turns under it. Parented to the
    // rotating stage they would orbit with it, and the cast would fall into
    // shadow for half of every revolution.
    const key = new DirectionalLight(0xffe6c4, 1.9);
    key.position.set(4, 6, 7);
    const rim = new DirectionalLight(0x7d95ff, 0.85);
    rim.position.set(-5, 3, -4);
    this.root.add(key, rim);

    for (const cone of spec.cones) {
      const radius = cone.height * 0.34;
      const mesh = new Mesh(
        new ConeGeometry(radius, cone.height, 24),
        sharedStandard({
          color: FRIEND_TINTS[cone.tint % FRIEND_TINTS.length],
          roughness: 0.5,
        }),
      );
      mesh.position.set(cone.x, cone.y + cone.height / 2, cone.z);
      this.pieces.push(mesh);
      this.stage.add(mesh);
    }
  }

  enter(scene: Scene): void {
    scene.add(this.root);
  }

  leave(scene: Scene): void {
    scene.remove(this.root);
  }

  reset(): void {
    this.elapsed = 0;
    this.stage.rotation.y = 0;
    for (let i = 0; i < this.pieces.length; i++) {
      const cone = this.spec.cones[i];
      this.pieces[i].position.set(cone.x, cone.y + cone.height / 2, cone.z);
      this.pieces[i].rotation.set(0, 0, 0);
    }
  }

  update(ctx: FrameContext): void {
    this.reducedMotion = ctx.reducedMotion;
    if (ctx.reducedMotion) {
      // Held still, but at a three-quarter angle rather than face-on, so the
      // arrangement still reads as three-dimensional without any motion.
      this.stage.rotation.y = 0.5;
      return;
    }
    this.elapsed += ctx.dt;
    // A slow turntable. It is the only thing moving, which is exactly the
    // message: this cabinet slot is powered up and waiting for its game.
    this.stage.rotation.y = this.elapsed * 0.35;
  }

  handleInput(): void {
    // Deliberately inert. There is no game here yet, and a placeholder that
    // silently swallowed input while appearing to respond would be worse than
    // one that plainly does nothing.
  }

  snapshot(): ArcadeSnapshot {
    return {
      game: this.id,
      score: 0,
      entities: this.pieces.length,
      metric: { label: this.spec.metricLabel, value: 0 },
    };
  }

  cameraTarget(): CameraPose {
    return {
      position: this.spec.camera.position,
      look: this.spec.camera.look,
      lambda: this.reducedMotion ? 1e3 : 2.6,
      shake: null,
    };
  }
}
