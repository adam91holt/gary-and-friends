/**
 * Renderer / bootstrap. This is the rendering side of the seam: it owns three.js,
 * the canvas, and the animation loop, and it READS from the GameStore. All game
 * logic lives in src/game/*; this file must stay logic-light so the store can be
 * unit-tested without a browser.
 */
import {
  AmbientLight,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';
import { GameStore } from './game/state.ts';
import { createGary } from './scene/gary.ts';
import { installTestApi } from './testApi.ts';

const store = new GameStore();

// `ready` flips true after the first rendered frame. Tests wait on this.
let hasRenderedFrame = false;
installTestApi(store, () => hasRenderedFrame);

const container = document.getElementById('app');
if (!container) {
  throw new Error('#app container not found');
}

const scene = new Scene();

const camera = new PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  100,
);
camera.position.set(0, 2.2, 5);
camera.lookAt(0, 1, 0);

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x1a1a2e, 1);
container.appendChild(renderer.domElement);

// Lighting.
scene.add(new AmbientLight(0xffffff, 0.55));
const sun = new DirectionalLight(0xffffff, 1.4);
sun.position.set(3, 6, 4);
scene.add(sun);

// Ground plane.
const ground = new Mesh(
  new PlaneGeometry(40, 40),
  new MeshStandardMaterial({ color: 0x2f2f4a, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// Gary, slowly rotating.
const gary = createGary();
scene.add(gary);

function onResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

const ROTATION_SPEED = 0.5; // radians/second
let lastTime = performance.now();

function frame(now: number): void {
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  gary.rotation.y += ROTATION_SPEED * dt;

  renderer.render(scene, camera);
  hasRenderedFrame = true;

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
