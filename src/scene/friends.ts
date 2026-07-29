/**
 * The visual layer for the friends: the collectible cones still out on the
 * road, and the conga line already trailing Gary.
 *
 * Rendering-side only. It owns geometry and materials and every frame *reads*
 * the pure simulation (`EntityField` + `CongaLine`), placing one object per
 * live entity or member. It decides nothing — lane, Z, X and variant all come
 * from `src/game/`, so what you see is exactly what the collision sweep tested.
 *
 * ── Design ──────────────────────────────────────────────────────────────────
 * These are Gary's people, so they are built from the SAME procedural cone
 * vocabulary as `gary.ts` — tapered shell, white reflective bands, googly eyes
 * — varied by radius/height/tint per roster entry so each is recognisable in
 * silhouette. Their tints come from the shared token layer (`theme.ts`
 * FRIEND_TINTS ↔ --friend-1..5 in index.html), an accent-family palette of
 * warms that reads as one crew and never competes with the desaturated cool
 * greys of oncoming traffic.
 *
 * Uncollected friends get a soft accent ground-glow and a slow spin so they
 * read as *pickups* rather than as another obstacle to dodge — a collectible
 * you mistake for a hazard is a fairness bug, not a style choice.
 */
import {
  AdditiveBlending,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
} from 'three';
import type { Entity } from '../game/entities/entity.ts';
import { FRIEND_KIND } from '../game/entities/friends.ts';
import { laneToX } from '../game/entities/lanes.ts';
import {
  congaFootprintScale,
  type CongaMember,
} from '../game/friends/conga.ts';
import { FRIENDS, friendProfile } from '../game/friends/roster.ts';
import { ACCENT, ACCENT_2 } from '../theme.ts';

/** How high a friend hovers/bobs while waiting to be collected. */
const HOVER = 0.16;
/** Radians/sec an uncollected friend turns, so it catches the light. */
const IDLE_SPIN = 1.1;
/** Hop height of a friend in the conga line. */
const HOP = 0.09;
/** Hops per second — the line's bounce tempo. */
const HOP_RATE = 3.2;
/**
 * Lateral offset alternated down the conga line (world units). Presentation
 * only — collision and the pure `CongaLine` never see it — and small enough to
 * stay well inside a lane, so a staggered tail can't imply Gary is wider than
 * his hitbox.
 */
const WEAVE = 0.26;
/** Widest rendered base in the cast (the decorative plinth is 1.15× radius). */
const MAX_CONGA_DIAMETER = Math.max(
  ...FRIENDS.map((profile) => profile.baseRadius * 2 * 1.15),
);

const white = new MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.5,
  metalness: 0.05,
});
const eyeWhite = new MeshStandardMaterial({
  color: 0xfdfdfd,
  roughness: 0.3,
});
const pupil = new MeshStandardMaterial({ color: 0x14141f, roughness: 0.35 });
const topperGold = new MeshStandardMaterial({
  color: ACCENT_2,
  roughness: 0.35,
  metalness: 0.2,
});

/** Shared shells, one per roster entry — built once, reused by every instance. */
const shells = FRIENDS.map(
  (profile) =>
    new MeshStandardMaterial({
      color: profile.tint,
      roughness: 0.55,
      metalness: 0.05,
    }),
);

/**
 * Build one friend, in the shape their roster entry describes. Same
 * construction as Gary (tapered shell + bands + googly eyes), parameterised —
 * they are visibly his species, not generic props.
 */
export function createFriend(variant: number): Group {
  const profile = friendProfile(variant);
  const { baseRadius, height } = profile;
  const tipRadius = baseRadius * 0.11;
  const group = new Group();
  group.name = `Friend-${profile.name}`;

  const body = new Mesh(
    new CylinderGeometry(tipRadius, baseRadius, height, 24, 1, true),
    shells[Math.min(shells.length - 1, Math.max(0, Math.round(variant)))],
  );
  body.position.y = height / 2;
  group.add(body);

  const radiusAt = (y: number): number =>
    baseRadius + (tipRadius - baseRadius) * (y / height);

  for (const fraction of profile.bands) {
    const y = height * fraction;
    const r = radiusAt(y) + 0.004;
    const band = new Mesh(
      new CylinderGeometry(r, r, height * 0.11, 24, 1, true),
      white,
    );
    band.position.y = y;
    group.add(band);
  }

  const base = new Mesh(
    new CylinderGeometry(baseRadius * 1.15, baseRadius * 1.15, height * 0.08, 24),
    shells[Math.min(shells.length - 1, Math.max(0, Math.round(variant)))],
  );
  base.position.y = height * 0.04;
  group.add(base);

  // Googly eyes, scaled to the cone. Facing +Z like Gary's, so the whole convoy
  // looks back at the chase camera — that is the shot, and the charm.
  const eyeY = height * 0.64;
  const eyeR = Math.max(0.055, baseRadius * 0.3);
  const surface = radiusAt(eyeY);
  for (const side of [-1, 1]) {
    const eye = new Group();
    eye.position.set(side * eyeR * 1.15, eyeY, surface + eyeR * 0.15);
    const sclera = new Mesh(new SphereGeometry(eyeR, 14, 14), eyeWhite);
    eye.add(sclera);
    const iris = new Mesh(new SphereGeometry(eyeR * 0.5, 12, 12), pupil);
    iris.position.z = eyeR * 0.68;
    eye.add(iris);
    group.add(eye);
  }

  // Sir Cones-a-lot's topper — one character gets one flourish nobody else has.
  if (profile.topper) {
    const topper = new Mesh(new ConeGeometry(baseRadius * 0.7, height * 0.13, 12), topperGold);
    topper.position.y = height + height * 0.06;
    group.add(topper);
  }

  return group;
}

/** Accent halo under an uncollected friend: "this one is for you". */
function createGlow(radius: number): Mesh {
  const glow = new Mesh(
    new CircleGeometry(radius * 2.6, 24),
    new MeshBasicMaterial({
      color: ACCENT,
      transparent: true,
      opacity: 0.3,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.012;
  glow.renderOrder = -1;
  return glow;
}

/** One reusable slot: a cone of a given variant plus its pickup halo. */
interface Slot {
  readonly group: Group;
  readonly glow: Mesh;
}

/**
 * Per-variant pools of ready-made cones. Friends are few (capacity 6 on the
 * road, and a conga line that fits the frame), so a small object pool per
 * variant is simpler and more flexible than instancing — and unlike an
 * InstancedMesh it lets each friend animate independently, which is the whole
 * point of a conga line.
 */
class SlotPool {
  private readonly slots: Slot[][] = FRIENDS.map(() => []);
  private readonly used: number[] = FRIENDS.map(() => 0);

  constructor(
    private readonly parent: Group,
    private readonly withGlow: boolean,
  ) {}

  /** Reset the per-frame cursors. Call before a run of `take()`. */
  begin(): void {
    this.used.fill(0);
  }

  take(variant: number): Slot {
    const v = Math.min(FRIENDS.length - 1, Math.max(0, Math.round(variant)));
    const pool = this.slots[v];
    const index = this.used[v]++;
    let slot = pool[index];
    if (!slot) {
      const group = createFriend(v);
      const glow = createGlow(friendProfile(v).baseRadius);
      if (this.withGlow) group.add(glow);
      this.parent.add(group);
      slot = { group, glow };
      pool[index] = slot;
    }
    slot.group.visible = true;
    return slot;
  }

  /** Hide everything not claimed this frame. Call after the run of `take()`. */
  end(): void {
    for (let v = 0; v < this.slots.length; v++) {
      const pool = this.slots[v];
      for (let i = this.used[v]; i < pool.length; i++) pool[i].group.visible = false;
    }
  }
}

export class Friends {
  readonly group = new Group();

  private readonly roadGroup = new Group();
  private readonly congaGroup = new Group();
  private readonly road: SlotPool;
  private readonly conga: SlotPool;

  constructor() {
    this.group.name = 'Friends';
    this.roadGroup.name = 'FriendsOnRoad';
    this.congaGroup.name = 'FriendsConga';
    this.group.add(this.roadGroup, this.congaGroup);
    this.road = new SlotPool(this.roadGroup, true);
    this.conga = new SlotPool(this.congaGroup, false);
  }

  /**
   * Place the uncollected friends still out on the road.
   *
   * @param time          seconds since boot, for the idle hover/spin
   * @param reducedMotion still the hover and spin (the cones stay fully legible)
   */
  syncField(
    entities: readonly Entity[],
    time: number,
    reducedMotion: boolean,
  ): void {
    this.road.begin();
    for (const entity of entities) {
      if (!entity.active || entity.kind !== FRIEND_KIND) continue;
      const slot = this.road.take(entity.variant);
      const phase = entity.id * 0.7;
      slot.group.position.set(
        laneToX(entity.lane),
        reducedMotion ? HOVER : HOVER + Math.sin(time * 2.6 + phase) * 0.05,
        entity.z,
      );
      slot.group.rotation.y = reducedMotion ? 0 : time * IDLE_SPIN + phase;
      // The halo breathes so a pickup pulls the eye out of the fog, but it is
      // never fully off — reduced motion must not cost you a readable cue.
      const material = slot.glow.material as MeshBasicMaterial;
      material.opacity = reducedMotion
        ? 0.26
        : 0.22 + Math.abs(Math.sin(time * 2.2 + phase)) * 0.2;
    }
    this.road.end();
  }

  /**
   * Place the conga line trailing Gary. Positions come straight from the pure
   * `CongaLine`; only the hop, the yaw and the pop-in are decided here.
   */
  syncConga(
    members: readonly CongaMember[],
    time: number,
    reducedMotion: boolean,
  ): void {
    this.conga.begin();
    const footprintScale = congaFootprintScale(
      members.length,
      MAX_CONGA_DIAMETER,
    );
    for (let i = 0; i < members.length; i++) {
      const member = members[i];
      const slot = this.conga.take(member.variant);
      const g = slot.group;

      // Hop: a travelling wave down the line, phase-offset per member, so the
      // tail visibly ripples rather than bouncing as one block.
      const hop = reducedMotion
        ? 0
        : Math.abs(Math.sin((time * HOP_RATE + member.phase * Math.PI * 2) - i * 0.6)) * HOP;

      // Alternating lateral stagger. Perfectly single-file is the one
      // arrangement a chase camera cannot read: every cone hides behind the one
      // in front, and the reward you earned looks like a single lumpy mass.
      // Weaving the line a few centimetres either side of Gary's path shows
      // every character's silhouette — and reads as a conga line dancing rather
      // than a queue standing still.
      const weave = reducedMotion
        ? (i % 2 === 0 ? 1 : -1) * WEAVE
        : (i % 2 === 0 ? 1 : -1) * WEAVE * (0.75 + Math.sin(time * 1.9 - i * 0.5) * 0.25);
      g.position.set(member.x + weave, hop, member.z);

      // Lean into the turn, exactly like Gary banks (main.ts). The lean is
      // derived from how far this member still is from the one in front, so
      // the whole line leans through a lane change in sequence.
      const aheadX = i === 0 ? member.x : members[i - 1].x;
      g.rotation.z = reducedMotion ? 0 : (aheadX - member.x) * 0.45;
      g.rotation.y = reducedMotion ? 0 : Math.sin(time * 1.6 + i) * 0.12;

      // Pop-in: a new arrival scales up over ~0.3s so a pickup is felt in the
      // world as well as in the HUD. Reduced motion snaps to full size.
      const pop = reducedMotion ? 1 : Math.min(1, member.age / 0.3);
      const eased = 1 - (1 - pop) ** 3;
      // A touch of overshoot at the top of the pop — the squash that sells it.
      const scale = 0.2 + eased * 0.8 + Math.sin(eased * Math.PI) * 0.14;
      // The broadest variant is wider than the compressed gap. Fit the whole
      // cast uniformly to the live spacing so silhouettes stay distinct while
      // retaining every character's relative proportions.
      g.scale.setScalar(footprintScale * (reducedMotion ? 1 : scale));
    }
    this.conga.end();
  }

  /** Hide everything. Used when a run resets before the next sync lands. */
  clear(): void {
    this.road.begin();
    this.road.end();
    this.conga.begin();
    this.conga.end();
  }
}
