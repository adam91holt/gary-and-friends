/**
 * The roller's trail: a run of fading ghosts marking the line it actually took.
 *
 * Rendering-side only, and deliberately a *record* rather than a decoration —
 * it is sampled from the solver's own positions, so after a throw settles the
 * trail is a drawing of the line that produced the result you are looking at.
 * That is what makes the result camera worth swinging: you see where it went,
 * not just where it ended up.
 *
 * A fixed ring of flat discs rather than a growing line: no allocation per
 * sample, no geometry rebuild per frame, and it fades to nothing on its own.
 */
import { CircleGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { ACCENT, ACCENT_2 } from '../../../theme.ts';
import { DECK_DRESSING_TOP } from './lane.ts';

/** Ghosts in the ring. Enough to cover a full-speed throw at the sample rate. */
const CAPACITY = 46;
/** Seconds between samples. */
const SAMPLE_INTERVAL = 0.035;
/** Seconds a ghost takes to fade out completely. */
const GHOST_LIFE = 1.4;

interface Ghost {
  readonly mesh: Mesh;
  readonly material: MeshBasicMaterial;
  /** Seconds of life remaining, or 0 when the slot is free. */
  life: number;
}

export class RollerTrail {
  readonly group = new Group();

  private readonly ghosts: Ghost[] = [];
  private cursor = 0;
  private timer = 0;

  constructor(radius: number) {
    this.group.name = 'RoyalRollerTrail';
    const geometry = new CircleGeometry(radius * 0.82, 18);
    for (let i = 0; i < CAPACITY; i++) {
      const material = new MeshBasicMaterial({
        color: i % 3 === 0 ? ACCENT_2 : ACCENT,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
      });
      const mesh = new Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      // Just under the aim guide, above the deck dressing: the trail is painted
      // on the road too, and below the dressing it would never be seen.
      mesh.position.y = DECK_DRESSING_TOP + 0.003;
      mesh.visible = false;
      mesh.renderOrder = 1;
      this.ghosts.push({ mesh, material, life: 0 });
      this.group.add(mesh);
    }
  }

  /**
   * Sample the roller's position on a fixed cadence and age every live ghost.
   *
   * @param speed the solver's own speed. A stationary roller lays no trail, so
   *              the settled result shows the path and not a blob at the end.
   */
  update(dt: number, x: number, z: number, speed: number, laying: boolean): void {
    if (laying && speed > 0.4) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = SAMPLE_INTERVAL;
        const ghost = this.ghosts[this.cursor];
        this.cursor = (this.cursor + 1) % CAPACITY;
        ghost.mesh.position.x = x;
        ghost.mesh.position.z = z;
        ghost.life = GHOST_LIFE;
        ghost.mesh.visible = true;
      }
    }

    for (const ghost of this.ghosts) {
      if (ghost.life <= 0) continue;
      ghost.life = Math.max(0, ghost.life - dt);
      const t = ghost.life / GHOST_LIFE;
      ghost.material.opacity = 0.34 * t * t;
      ghost.mesh.scale.setScalar(0.55 + t * 0.45);
      if (ghost.life === 0) ghost.mesh.visible = false;
    }
  }

  /** Wipe the trail — a new throw starts from a clean deck. */
  clear(): void {
    for (const ghost of this.ghosts) {
      ghost.life = 0;
      ghost.material.opacity = 0;
      ghost.mesh.visible = false;
    }
    this.cursor = 0;
    this.timer = 0;
  }
}
