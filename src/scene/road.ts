import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
} from 'three';

/**
 * The scrolling highway environment: a 3-lane road, recycled dashed lane
 * markings, guard-rail barriers and streetlights down both shoulders — all
 * procedural boxes/cylinders, no textures or runtime assets.
 *
 * Rendering-side only: it owns geometry and a frame `update(dt, speed)` that
 * translates a pool of props toward the camera and wraps each one back to the
 * far distance when it passes, giving an endless road and a sense of speed. It
 * reads nothing from the game store — `main.ts` feeds it the current speed.
 */

/** Distance between lane centres (world units). */
export const LANE_WIDTH = 2.4;
/** Half-width of the drivable road surface: outer lane centre + half a lane. */
const ROAD_HALF = LANE_WIDTH * 1.5;

/** Map a lane index (0..2) to its world-space X. Centre lane (1) is x=0. */
export function laneToX(lane: number): number {
  return (lane - 1) * LANE_WIDTH;
}

/** Props wrap once they scroll past this Z (just behind the chase camera). */
const NEAR_Z = 14;

interface Scroller {
  readonly node: Object3D;
  /** Total length of this prop family's cycle; wrapping subtracts it. */
  readonly span: number;
}

export class Road {
  readonly group = new Group();
  private readonly scrollers: Scroller[] = [];

  // Shared materials (built once, reused across every pooled prop).
  private readonly asphalt = new MeshStandardMaterial({
    color: 0x181826,
    roughness: 0.95,
    metalness: 0.0,
  });
  private readonly marking = new MeshStandardMaterial({
    color: 0xf4f4f8,
    roughness: 0.6,
    metalness: 0.0,
  });
  private readonly edgeLine = new MeshStandardMaterial({
    color: 0xff7a1a,
    roughness: 0.5,
    metalness: 0.0,
  });
  private readonly railMetal = new MeshStandardMaterial({
    color: 0x3a3a4e,
    roughness: 0.45,
    metalness: 0.6,
  });
  private readonly poleMetal = new MeshStandardMaterial({
    color: 0x2a2a3a,
    roughness: 0.5,
    metalness: 0.5,
  });
  private readonly lampGlow = new MeshStandardMaterial({
    color: 0xffb347,
    emissive: 0xff8c1a,
    emissiveIntensity: 1.6,
    roughness: 0.4,
  });

  constructor() {
    this.group.name = 'Road';
    this.buildSurface();
    this.buildLaneDashes();
    this.buildBarriers();
    this.buildStreetlights();
  }

  /** Scroll the world toward the camera by `speed` units/sec, wrapping props. */
  update(dt: number, speed: number): void {
    const dz = speed * dt;
    if (dz === 0) return;
    for (const s of this.scrollers) {
      let z = s.node.position.z + dz;
      if (z > NEAR_Z) z -= s.span;
      s.node.position.z = z;
    }
  }

  // ── construction ─────────────────────────────────────────────────────────

  private buildSurface(): void {
    // One long slab (static — the markings on top sell the motion).
    const surface = new Mesh(
      new BoxGeometry(ROAD_HALF * 2, 0.1, 480),
      this.asphalt,
    );
    surface.position.set(0, -0.05, -120);
    this.group.add(surface);

    // Solid accent edge lines along both shoulders (also static).
    for (const side of [-1, 1]) {
      const edge = new Mesh(new BoxGeometry(0.12, 0.02, 480), this.edgeLine);
      edge.position.set(side * (ROAD_HALF - 0.15), 0.011, -120);
      this.group.add(edge);
    }
  }

  private buildLaneDashes(): void {
    const geom = new BoxGeometry(0.14, 0.02, 1.6);
    const count = 40;
    const spacing = 4;
    const span = count * spacing;
    // Two separators, at the boundaries between the three lanes.
    for (const x of [-LANE_WIDTH / 2, LANE_WIDTH / 2]) {
      for (let i = 0; i < count; i++) {
        const dash = new Mesh(geom, this.marking);
        dash.position.set(x, 0.011, NEAR_Z - i * spacing);
        this.group.add(dash);
        this.scrollers.push({ node: dash, span });
      }
    }
  }

  private buildBarriers(): void {
    const railGeom = new BoxGeometry(0.16, 0.5, 2.6);
    const postGeom = new BoxGeometry(0.16, 0.7, 0.16);
    const count = 34;
    const spacing = 3.2;
    const span = count * spacing;
    for (const side of [-1, 1]) {
      const x = side * (ROAD_HALF + 0.35);
      for (let i = 0; i < count; i++) {
        const seg = new Group();
        seg.position.set(x, 0, NEAR_Z - i * spacing);

        const rail = new Mesh(railGeom, this.railMetal);
        rail.position.y = 0.55;
        seg.add(rail);

        const post = new Mesh(postGeom, this.poleMetal);
        post.position.y = 0.35;
        post.position.z = -spacing / 2;
        seg.add(post);

        this.group.add(seg);
        this.scrollers.push({ node: seg, span });
      }
    }
  }

  private buildStreetlights(): void {
    const poleGeom = new CylinderGeometry(0.09, 0.11, 5, 8);
    const armGeom = new BoxGeometry(1.2, 0.1, 0.1);
    const lampGeom = new BoxGeometry(0.5, 0.16, 0.3);
    const count = 7;
    const spacing = 22;
    const span = count * spacing;
    for (const side of [-1, 1]) {
      const x = side * (ROAD_HALF + 1.1);
      for (let i = 0; i < count; i++) {
        const light = new Group();
        light.position.set(x, 0, NEAR_Z - i * spacing);

        const pole = new Mesh(poleGeom, this.poleMetal);
        pole.position.y = 2.5;
        light.add(pole);

        const arm = new Mesh(armGeom, this.poleMetal);
        arm.position.set(side * -0.6, 4.9, 0);
        light.add(arm);

        const lamp = new Mesh(lampGeom, this.lampGlow);
        lamp.position.set(side * -1.15, 4.82, 0);
        light.add(lamp);

        this.group.add(light);
        this.scrollers.push({ node: light, span });
      }
    }
  }
}
