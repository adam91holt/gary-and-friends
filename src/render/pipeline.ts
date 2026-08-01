/**
 * The render pipeline: the one thing the shell calls to put a frame on screen.
 *
 * A pre-wired contract. Today `render()` is a direct `renderer.render(scene,
 * camera)` — the honest implementation of "no post-processing yet". The
 * graphics child swaps the body for an EffectComposer chain (three's bundled
 * addons, no new dependency) behind these exact names, and `src/main.ts` does
 * not change: it already asks the pipeline for a frame rather than the renderer.
 *
 * `resize` and `dispose` exist for the same reason — a composer owns
 * render targets that must be resized with the viewport and freed on teardown,
 * and the shell should already be calling both before either matters.
 */
import type { Camera, Scene, WebGLRenderer } from 'three';
import type { QualitySettings } from './quality.ts';

export interface RenderPipeline {
  /** Draw one frame of `scene` through `camera`. */
  render(scene: Scene, camera: Camera): void;
  /** Match internal buffers to a new viewport size (CSS px). */
  resize(width: number, height: number): void;
  /** Whether post-processing is actually running right now. */
  readonly postProcessing: boolean;
  /** Free GPU resources this pipeline owns. The renderer is NOT disposed here. */
  dispose(): void;
}

/**
 * Build the pipeline for a renderer at a given quality.
 *
 * `quality.postProcessing` is already threaded through so the graphics child
 * has its off-switch on day one: a `low`-tier device must be able to skip the
 * chain entirely, and that decision belongs to quality.ts, not to whatever
 * effects get added later.
 */
export function createPipeline(
  renderer: WebGLRenderer,
  quality: QualitySettings,
): RenderPipeline {
  // No effect chain yet — a direct render IS the pipeline, and pretending
  // otherwise with an empty composer would cost a full-screen blit per frame
  // for nothing.
  const usePost = false;

  return {
    render(scene, camera) {
      renderer.render(scene, camera);
    },
    resize(width, height) {
      renderer.setSize(width, height);
      renderer.setPixelRatio(
        Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio),
      );
    },
    get postProcessing() {
      return usePost;
    },
    dispose() {
      // Nothing GPU-side is owned yet; the renderer outlives this object.
    },
  };
}
