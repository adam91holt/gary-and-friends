import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CENTER_LANE, LANE_COUNT } from '../game/state.ts';
import { ACCENT, ACCENT_2 } from '../theme.ts';

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

/** Map a lane index to world-space X using the shared lane contract. */
export function laneToX(lane: number): number {
  const rounded = Math.round(lane);
  const clamped = Number.isNaN(rounded)
    ? 0
    : Math.max(0, Math.min(LANE_COUNT - 1, rounded));
  return (clamped - CENTER_LANE) * LANE_WIDTH;
}

/** Props wrap once they scroll past this Z (just behind the chase camera). */
const NEAR_Z = 14;

interface Scroller {
  readonly mesh: InstancedMesh;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  /** Total length of this prop family's cycle; wrapping subtracts it. */
  readonly span: number;
}

function translated(geometry: BufferGeometry, x: number, y: number, z: number): BufferGeometry {
  const copy = geometry.clone();
  copy.applyMatrix4(new Matrix4().makeTranslation(x, y, z));
  return copy;
}

function merged(geometries: BufferGeometry[]): BufferGeometry {
  const geometry = mergeGeometries(geometries, true);
  if (geometry === null) throw new Error('Could not merge procedural road geometry');
  return geometry;
}

export class Road {
  readonly group = new Group();
  private readonly scrollers: Scroller[] = [];
  private readonly instanceMatrix = new Matrix4();

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
    color: ACCENT,
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
    color: ACCENT_2,
    emissive: ACCENT,
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

  /** Scroll each instanced prop family, then upload one matrix buffer per family. */
  update(dt: number, speed: number): void {
    const dz = speed * dt;
    if (dz === 0) return;
    for (const scroller of this.scrollers) {
      for (let i = 0; i < scroller.z.length; i++) {
        let z = scroller.z[i] + dz;
        if (z > NEAR_Z) z -= scroller.span;
        scroller.z[i] = z;
        this.instanceMatrix.makeTranslation(scroller.x[i], scroller.y[i], z);
        scroller.mesh.setMatrixAt(i, this.instanceMatrix);
      }
      scroller.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private addScroller(
    mesh: InstancedMesh,
    x: Float32Array,
    y: Float32Array,
    z: Float32Array,
    span: number,
  ): void {
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    for (let i = 0; i < z.length; i++) {
      this.instanceMatrix.makeTranslation(x[i], y[i], z[i]);
      mesh.setMatrixAt(i, this.instanceMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    this.scrollers.push({ mesh, x, y, z, span });
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
    const geometry = new BoxGeometry(0.14, 0.02, 1.6);
    const perLane = 40;
    const spacing = 4;
    const total = perLane * 2;
    const x = new Float32Array(total);
    const y = new Float32Array(total);
    const z = new Float32Array(total);
    let instance = 0;
    for (const laneX of [-LANE_WIDTH / 2, LANE_WIDTH / 2]) {
      for (let i = 0; i < perLane; i++) {
        x[instance] = laneX;
        y[instance] = 0.011;
        z[instance] = NEAR_Z - i * spacing;
        instance++;
      }
    }
    const mesh = new InstancedMesh(geometry, this.marking, total);
    mesh.name = 'LaneDashes';
    this.addScroller(mesh, x, y, z, perLane * spacing);
  }

  private buildBarriers(): void {
    const spacing = 3.2;
    const geometry = merged([
      translated(new BoxGeometry(0.16, 0.5, 2.6), 0, 0.55, 0),
      translated(new BoxGeometry(0.16, 0.7, 0.16), 0, 0.35, -spacing / 2),
    ]);
    const perSide = 34;
    const total = perSide * 2;
    const x = new Float32Array(total);
    const y = new Float32Array(total);
    const z = new Float32Array(total);
    let instance = 0;
    for (const side of [-1, 1]) {
      for (let i = 0; i < perSide; i++) {
        x[instance] = side * (ROAD_HALF + 0.35);
        z[instance] = NEAR_Z - i * spacing;
        instance++;
      }
    }
    const mesh = new InstancedMesh(
      geometry,
      [this.railMetal, this.poleMetal],
      total,
    );
    mesh.name = 'Barriers';
    this.addScroller(mesh, x, y, z, perSide * spacing);
  }

  private buildStreetlights(): void {
    const geometry = merged([
      translated(new CylinderGeometry(0.09, 0.11, 5, 8), 0, 2.5, 0),
      translated(new BoxGeometry(2.4, 0.1, 0.1), 0, 4.9, 0),
      translated(new BoxGeometry(0.5, 0.16, 0.3), -1.15, 4.82, 0),
      translated(new BoxGeometry(0.5, 0.16, 0.3), 1.15, 4.82, 0),
    ]);
    const perSide = 7;
    const spacing = 22;
    const total = perSide * 2;
    const x = new Float32Array(total);
    const y = new Float32Array(total);
    const z = new Float32Array(total);
    let instance = 0;
    for (const side of [-1, 1]) {
      for (let i = 0; i < perSide; i++) {
        x[instance] = side * (ROAD_HALF + 1.1);
        z[instance] = NEAR_Z - i * spacing;
        instance++;
      }
    }
    const mesh = new InstancedMesh(
      geometry,
      [this.poleMetal, this.poleMetal, this.lampGlow, this.lampGlow],
      total,
    );
    mesh.name = 'Streetlights';
    this.addScroller(mesh, x, y, z, perSide * spacing);
  }
}
