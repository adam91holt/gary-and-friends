/**
 * The visual layer for oncoming traffic. Rendering-side only: it owns geometry
 * and materials, and every frame it *reads* the pure `EntityField` and places
 * one mesh per live entity. It decides nothing — lane, Z and variant all come
 * from the simulation (src/game/entities/traffic.ts), so what you see is
 * exactly what the collision sweep tested.
 *
 * Design: these are night-highway vehicles coming the other way, so the read is
 * carried by light, not by body colour — white headlamp pairs rushing at you,
 * red tails receding. Bodies are deliberately desaturated cool greys so the one
 * owned accent (Gary orange, from theme.ts) stays his alone and never competes
 * for attention with an obstacle. One InstancedMesh per silhouette keeps the
 * whole field at three draw calls.
 */
import {
  BoxGeometry,
  type BufferGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Entity } from '../game/entities/entity.ts';
import { laneToX } from '../game/entities/lanes.ts';
import {
  TRAFFIC_CAPACITY,
  TRAFFIC_KIND,
  TRAFFIC_VARIANTS,
} from '../game/entities/traffic.ts';

/**
 * Body shells: cool and low-saturation so they read as mass rather than colour,
 * but light enough to catch the streetlights and separate from the asphalt
 * (0x181826). Pure-dark bodies vanish into the road at night, which is unfair
 * as well as ugly — an obstacle you cannot see is not a difficulty curve.
 */
const BODY_COLORS = [0x515a75, 0x455070, 0x5a5468] as const;

function translated(
  geometry: BufferGeometry,
  x: number,
  y: number,
  z: number,
): BufferGeometry {
  const copy = geometry.clone();
  copy.applyMatrix4(new Matrix4().makeTranslation(x, y, z));
  return copy;
}

function merged(geometries: BufferGeometry[]): BufferGeometry {
  const geometry = mergeGeometries(geometries, true);
  if (geometry === null) throw new Error('Could not merge traffic geometry');
  return geometry;
}

/**
 * Build one vehicle silhouette. Dimensions are derived from the SAME
 * half-extents the collision test uses, so a car can never be drawn bigger or
 * smaller than the box that kills you.
 */
function vehicleGeometry(variant: number): BufferGeometry {
  const { halfWidth, halfDepth } = TRAFFIC_VARIANTS[variant];
  const width = halfWidth * 2;
  const depth = halfDepth * 2;
  const isTruck = variant === 2;
  const bodyHeight = isTruck ? 1.15 : 0.62;
  const cabinHeight = isTruck ? 0.7 : 0.46;

  const parts: BufferGeometry[] = [
    // 0 — chassis
    translated(
      new BoxGeometry(width, bodyHeight, depth),
      0,
      bodyHeight / 2 + 0.12,
      0,
    ),
    // 1 — cabin / greenhouse. On the truck it sits forward over the nose (+Z),
    // giving it a cab-over silhouette that reads as "big vehicle" head-on.
    translated(
      new BoxGeometry(width * 0.86, cabinHeight, depth * (isTruck ? 0.42 : 0.5)),
      0,
      bodyHeight + cabinHeight / 2 + 0.1,
      isTruck ? depth * 0.24 : 0,
    ),
  ];

  // Lamp placement follows the fiction: this is ONCOMING traffic, driving in
  // +Z while Gary holds z=0. So a vehicle's nose points at Gary (+Z) and its
  // tail points away (-Z). The chase camera sits behind Gary looking down -Z,
  // which means the face it sees is the +Z one — the nose. Headlights
  // therefore belong on +Z. (They were on -Z first, which showed Gary red
  // taillights rushing at him: the exact opposite of the road-sense the player
  // needs to read a lane.)
  //
  // Sized generously and stood proud of the bumper so the pair still resolves
  // as two distinct points — "a vehicle, in that lane" — from the far end of
  // the reaction window instead of merging into one blob.
  const lampY = bodyHeight * (isTruck ? 0.62 : 0.7);

  // 2 — headlights on the +Z nose: what Gary sees coming.
  for (const side of [-1, 1]) {
    parts.push(
      translated(
        new BoxGeometry(width * 0.3, 0.2, 0.12),
        side * width * 0.33,
        lampY,
        depth / 2 + 0.06,
      ),
    );
  }
  // 3 — taillights on the -Z tail, glimpsed only as one recedes up the road.
  for (const side of [-1, 1]) {
    parts.push(
      translated(
        new BoxGeometry(width * 0.22, 0.12, 0.06),
        side * width * 0.33,
        lampY,
        -depth / 2 - 0.02,
      ),
    );
  }

  // 4 — reflective side striping down both flanks. Without this the bodies are
  // near-black slabs against near-black asphalt when they're beside Gary rather
  // than facing him (lamps only read head-on). Real highway vehicles carry
  // exactly this tape, and it rhymes with Gary's own reflective bands — so the
  // fix for the readability problem is also the thing that ties traffic into
  // the world's visual language instead of looking bolted on.
  const stripeY = bodyHeight * 0.45 + 0.12;
  for (const side of [-1, 1]) {
    parts.push(
      translated(
        new BoxGeometry(0.04, 0.16, depth * 0.8),
        side * (halfWidth + 0.02),
        stripeY,
        0,
      ),
    );
  }

  return merged(parts);
}

export class Traffic {
  readonly group = new Group();

  private readonly meshes: InstancedMesh[] = [];
  private readonly dummy = new Object3D();
  private readonly counts: number[] = [];

  constructor() {
    this.group.name = 'Traffic';

    // Emissive lamps — the entire visual read at night, and the thing that
    // makes traffic *fair*: you have to see it coming in time to pick a lane.
    //
    // `fog: false` is the load-bearing detail. The scene fog fades out to
    // nothing by ~92 units, which is roughly the reaction window; without this
    // a car spends its approach as an invisible grey smudge and only resolves
    // when it is too late to dodge. Exempting the lamps means headlights punch
    // through the murk — physically what headlights do, and it turns the fog
    // into atmosphere rather than an unfair occluder.
    const headlight = new MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xfff4d6,
      emissiveIntensity: 6,
      roughness: 0.3,
      fog: false,
    });
    const taillight = new MeshStandardMaterial({
      color: 0xff4d5e,
      emissive: 0xff2233,
      emissiveIntensity: 3,
      roughness: 0.4,
      fog: false,
    });

    // Side reflectors: a cool white so they read as retroreflective tape under
    // the streetlights, and pointedly NOT the accent — orange stays Gary's.
    const reflector = new MeshStandardMaterial({
      color: 0xeef3ff,
      emissive: 0xc9d8f5,
      emissiveIntensity: 2.2,
      roughness: 0.35,
      metalness: 0.05,
      fog: false,
    });

    for (let variant = 0; variant < TRAFFIC_VARIANTS.length; variant++) {
      // Low metalness on purpose. There is no environment map in this scene,
      // and a metallic PBR surface with nothing to reflect renders essentially
      // black — which is exactly how these read at metalness 0.55. Treating the
      // paint as a dielectric lets the key/hemisphere lights actually model the
      // form, so a car is a readable solid rather than a hole in the road.
      const body = new MeshStandardMaterial({
        color: BODY_COLORS[variant],
        roughness: 0.5,
        metalness: 0.05,
      });
      const glass = new MeshStandardMaterial({
        color: 0x1b2030,
        roughness: 0.25,
        metalness: 0.1,
      });
      // Material order matches the geometry groups built above.
      const mesh = new InstancedMesh(
        vehicleGeometry(variant),
        [
          body,
          glass,
          headlight,
          headlight,
          taillight,
          taillight,
          reflector,
          reflector,
        ],
        TRAFFIC_CAPACITY,
      );
      mesh.name = `Traffic-${variant}`;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      // Start empty; `sync` sets the real count each frame.
      mesh.count = 0;
      this.meshes.push(mesh);
      this.counts.push(0);
      this.group.add(mesh);
    }
  }

  /**
   * Project the simulation's live entities onto instances. Called once a frame
   * with `field.entities`; entities are the source of truth, meshes follow.
   */
  sync(entities: readonly Entity[]): void {
    this.counts.fill(0);

    for (const entity of entities) {
      if (!entity.active || entity.kind !== TRAFFIC_KIND) continue;
      const variant = entity.variant;
      const mesh = this.meshes[variant];
      if (!mesh) continue;
      const index = this.counts[variant];
      if (index >= TRAFFIC_CAPACITY) continue;

      this.dummy.position.set(laneToX(entity.lane), 0, entity.z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(index, this.dummy.matrix);
      this.counts[variant] = index + 1;
    }

    for (let i = 0; i < this.meshes.length; i++) {
      const mesh = this.meshes[i];
      mesh.count = this.counts[i];
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
