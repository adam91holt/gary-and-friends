/**
 * The construction yard: everything in Stack Attack that never moves.
 *
 * Rendering-side only, and entirely procedural — boxes, cylinders and planes,
 * no textures and no runtime asset fetch, matching the rest of the game's
 * no-assets rule.
 *
 * ── The committed idea ──────────────────────────────────────────────────────
 * The HUD's whole visual language is hazard-taped roadside machinery, so the
 * tower is built at night on a roofless site deck: a concrete pad ringed with
 * accent-striped kerbs, scaffold towers marching up both sides of the frame,
 * and a gantry crane overhead whose rails are the trolley's actual travel span.
 * The gantry is the one instrument the player reads — so it is lit, it is
 * accented, and it is the only straight horizontal line in the shot.
 *
 * The scaffold columns exist for a gameplay reason as well as a compositional
 * one: as the tower grows the camera cranes up past them, which is the only
 * cheap way to make vertical progress *legible* in a scene whose subject
 * otherwise stays dead centre of frame.
 */
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  PlaneGeometry,
  TorusGeometry,
} from 'three';
import {
  CARRIER_SPAN,
  TOWER_BASE_HEIGHT,
  TOWER_BASE_WIDTH,
} from '../../../game/games/tower/rules.ts';
import { ownStandard, sharedStandard } from '../../../render/materials.ts';
import { ACCENT, ACCENT_2 } from '../../../theme.ts';

/** How far past the rails the gantry beam overhangs, so it reads as a span. */
const GANTRY_OVERHANG = 0.55;
/** How tall a scaffold column stands. Tall enough to still be there at height. */
const SCAFFOLD_HEIGHT = 26;
/** How far either side of the tower the scaffold columns stand. */
const SCAFFOLD_X = 4.6;

/** The static yard, plus the handful of parts the view animates. */
export interface Yard {
  readonly group: Group;
  /** The gantry beam + rails. The view slides it up as the tower grows. */
  readonly gantry: Group;
  /** The trolley riding the gantry. The view drives its X. */
  readonly trolley: Group;
  /** The hook the carried cone hangs from. Sways with the trolley. */
  readonly hook: Group;
  /** Accent floodlight ring under the pad — pulsed on a perfect landing. */
  readonly padGlow: Mesh;
}

export function createYard(): Yard {
  const group = new Group();
  group.name = 'TowerYard';

  const concrete = sharedStandard({ color: 0x21212f, roughness: 0.95 });
  const darkSteel = sharedStandard({ color: 0x2b2b3c, roughness: 0.5, metalness: 0.55 });
  const brightSteel = sharedStandard({ color: 0x4a4a62, roughness: 0.38, metalness: 0.7 });
  const hazard = sharedStandard({ color: ACCENT, roughness: 0.55 });

  // ── The site deck ────────────────────────────────────────────────────────
  // A wide dark plane so the tower stands on something rather than in fog.
  const deck = new Mesh(new PlaneGeometry(60, 60), sharedStandard({
    color: 0x14141f,
    roughness: 1,
  }));
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = -0.02;
  group.add(deck);

  // ── The pad the tower is built on ────────────────────────────────────────
  const pad = new Mesh(
    new BoxGeometry(TOWER_BASE_WIDTH, TOWER_BASE_HEIGHT, TOWER_BASE_WIDTH),
    concrete,
  );
  pad.position.y = TOWER_BASE_HEIGHT / 2;
  group.add(pad);

  // Hazard kerb around it: the accent, at the one place the player's eye has to
  // return to on every single drop.
  const kerb = new Mesh(
    new BoxGeometry(TOWER_BASE_WIDTH + 0.5, 0.14, TOWER_BASE_WIDTH + 0.5),
    hazard,
  );
  kerb.position.y = 0.07;
  group.add(kerb);

  // The floodlit ring under the pad. Emissive rather than a real light: it is a
  // *mark on the floor* saying "land here", and a light would wash the tower.
  const padGlow = new Mesh(
    new TorusGeometry(TOWER_BASE_WIDTH * 0.92, 0.05, 8, 40),
    ownStandard({
      color: ACCENT_2,
      emissive: ACCENT,
      emissiveIntensity: 1.4,
      roughness: 0.4,
    }),
  );
  padGlow.rotation.x = -Math.PI / 2;
  padGlow.position.y = 0.02;
  group.add(padGlow);

  // ── Scaffold columns ─────────────────────────────────────────────────────
  // Two towers of ladder rungs either side, marching up out of frame. They are
  // the parallax the camera crane reads against.
  for (const side of [-1, 1]) {
    const scaffold = new Group();
    scaffold.name = `Scaffold${side > 0 ? 'Right' : 'Left'}`;
    for (const dz of [-0.9, 0.9]) {
      const post = new Mesh(
        new CylinderGeometry(0.09, 0.09, SCAFFOLD_HEIGHT, 10),
        darkSteel,
      );
      post.position.set(side * SCAFFOLD_X, SCAFFOLD_HEIGHT / 2, dz);
      scaffold.add(post);
    }
    for (let y = 1.2; y < SCAFFOLD_HEIGHT; y += 1.8) {
      const rung = new Mesh(new BoxGeometry(0.07, 0.07, 1.9), darkSteel);
      rung.position.set(side * SCAFFOLD_X, y, 0);
      scaffold.add(rung);
      // A brace every few rungs, so the columns don't read as a repeating
      // texture when the camera cranes past them.
      if (Math.round(y * 10) % 9 === 0) {
        const brace = new Mesh(new BoxGeometry(0.05, 2.1, 0.05), brightSteel);
        brace.position.set(side * SCAFFOLD_X, y + 0.9, 0.9);
        brace.rotation.x = 0.72;
        scaffold.add(brace);
      }
    }
    group.add(scaffold);
  }

  // ── The gantry ───────────────────────────────────────────────────────────
  const gantry = new Group();
  gantry.name = 'TowerGantry';

  const beamSpan = (CARRIER_SPAN + GANTRY_OVERHANG) * 2;
  const beam = new Mesh(new BoxGeometry(beamSpan, 0.3, 0.44), brightSteel);
  gantry.add(beam);

  // Two accent rails under the beam — the trolley's actual travel span, drawn
  // so the player can see exactly how far the drop point can reach.
  for (const dz of [-0.16, 0.16]) {
    const rail = new Mesh(new BoxGeometry(CARRIER_SPAN * 2, 0.07, 0.07), hazard);
    rail.position.set(0, -0.2, dz);
    gantry.add(rail);
  }
  // End stops, so the rails visibly END rather than fading off into the dark.
  for (const side of [-1, 1]) {
    const stop = new Mesh(new BoxGeometry(0.12, 0.34, 0.5), hazard);
    stop.position.set(side * CARRIER_SPAN, -0.1, 0);
    gantry.add(stop);
  }
  // Hangers tying the beam back to the scaffolds, so it isn't floating.
  for (const side of [-1, 1]) {
    const hanger = new Mesh(new BoxGeometry(0.09, 0.09, 0.09), darkSteel);
    hanger.scale.set(1, 1, 1);
    hanger.position.set(side * (CARRIER_SPAN + GANTRY_OVERHANG), 0.18, 0);
    gantry.add(hanger);
  }

  // ── The trolley ──────────────────────────────────────────────────────────
  const trolley = new Group();
  trolley.name = 'TowerTrolley';
  const body = new Mesh(new BoxGeometry(0.62, 0.26, 0.56), brightSteel);
  body.position.y = -0.34;
  trolley.add(body);
  for (const side of [-1, 1]) {
    for (const dz of [-0.16, 0.16]) {
      const wheel = new Mesh(new CylinderGeometry(0.08, 0.08, 0.06, 10), darkSteel);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(side * 0.2, -0.2, dz);
      trolley.add(wheel);
    }
  }
  // A lit strip on the trolley's underside: the drop point, marked.
  const marker = new Mesh(
    new BoxGeometry(0.4, 0.04, 0.16),
    ownStandard({
      color: ACCENT_2,
      emissive: ACCENT_2,
      emissiveIntensity: 1.9,
      roughness: 0.4,
    }),
  );
  marker.position.y = -0.48;
  trolley.add(marker);

  // The hook the carried cone hangs from — a short cable and a ring, so the
  // cone reads as *held* and the release reads as a release.
  const hook = new Group();
  hook.name = 'TowerHook';
  const cable = new Mesh(new CylinderGeometry(0.02, 0.02, 0.5, 6), darkSteel);
  cable.position.y = -0.72;
  hook.add(cable);
  const ring = new Mesh(new TorusGeometry(0.1, 0.025, 6, 14), brightSteel);
  ring.position.y = -0.98;
  ring.rotation.x = Math.PI / 2;
  hook.add(ring);
  trolley.add(hook);

  gantry.add(trolley);
  group.add(gantry);

  return { group, gantry, trolley, hook, padGlow };
}
