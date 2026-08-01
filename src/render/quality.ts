/**
 * Render quality: how hard we are willing to push this device.
 *
 * A pre-wired contract the shell already calls. Today it makes one real
 * decision — the pixel ratio and antialias budget — from the device's own
 * capabilities. The graphics child fills in the rest (shadow resolution, post
 * chain toggles, adaptive downscaling) behind these same names, so no shell
 * code has to move when it does.
 */

/** The named quality tiers. Ordered: each is a superset of the one before. */
export const QUALITY_TIERS = ['low', 'medium', 'high'] as const;
export type QualityTier = (typeof QUALITY_TIERS)[number];

/** The concrete render budget for a tier. */
export interface QualitySettings {
  readonly tier: QualityTier;
  /** Cap on `renderer.setPixelRatio`. Above ~2 the cost stops buying clarity. */
  readonly maxPixelRatio: number;
  /** Whether the WebGL context is created with MSAA. Immutable after creation. */
  readonly antialias: boolean;
  /**
   * Whether post-processing may run at all. False on `low` so a weak GPU never
   * pays for bloom it cannot afford. The graphics child reads this; the shell
   * only passes it through.
   */
  readonly postProcessing: boolean;
  /** Whether recurring (non-event) particle emission is allowed. */
  readonly ambientParticles: boolean;
}

const SETTINGS: Readonly<Record<QualityTier, QualitySettings>> = {
  low: {
    tier: 'low',
    maxPixelRatio: 1,
    antialias: false,
    postProcessing: false,
    ambientParticles: false,
  },
  medium: {
    tier: 'medium',
    maxPixelRatio: 1.5,
    antialias: true,
    postProcessing: true,
    ambientParticles: true,
  },
  high: {
    tier: 'high',
    maxPixelRatio: 2,
    antialias: true,
    postProcessing: true,
    ambientParticles: true,
  },
};

/** Look up a tier's budget. */
export function qualitySettings(tier: QualityTier): QualitySettings {
  return SETTINGS[tier];
}

/** What `detectQuality` needs to know about the device. Injected, so the rule
 *  is testable without a browser. */
export interface DeviceProfile {
  /** `window.devicePixelRatio`. */
  readonly pixelRatio: number;
  /** `navigator.hardwareConcurrency`, or 0 when unreported. */
  readonly cores: number;
  /** Longest viewport edge in CSS px — a proxy for how many pixels we owe. */
  readonly maxEdge: number;
  /** Whether the player asked for reduced motion. */
  readonly reducedMotion: boolean;
}

/**
 * Pick a tier for this device.
 *
 * The rule is deliberately conservative about the thing that actually costs:
 * total pixels. A high-DPI phone with few cores is the classic trap — it
 * *reports* a 3x pixel ratio and will happily try to render nine times the
 * fragments before dropping to 12fps.
 *
 * Reduced motion drops ambient particles but does NOT drop resolution: the
 * preference is about movement, not about how sharp the game looks.
 */
export function detectQuality(device: DeviceProfile): QualityTier {
  const cores = device.cores > 0 ? device.cores : 4;
  // Rough fragment budget: how many device pixels the longest edge implies.
  const edgePixels = device.maxEdge * Math.min(device.pixelRatio, 3);

  if (cores <= 2 || edgePixels > 3400) return 'low';
  if (cores <= 4 || edgePixels > 2200) return 'medium';
  return 'high';
}

/** Read the current device profile from the browser. The only DOM in this file. */
export function readDeviceProfile(): DeviceProfile {
  return {
    pixelRatio: window.devicePixelRatio || 1,
    cores: navigator.hardwareConcurrency ?? 0,
    maxEdge: Math.max(window.innerWidth, window.innerHeight),
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}
