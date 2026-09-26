/**
 * Cloth-mode types shared by the engine, diagnostics and the (lazily loaded) simulation module.
 * Kept free of Jolt/three imports so the skeletal path never pulls in the physics bundle.
 */
export type MotionMode = 'skeletal' | 'cloth';

export type ClothState =
  | 'off'
  | 'loading'
  | 'running'
  | 'frozen' // paused video: simulation clock stopped
  | 'settling' // just reset; showing the skinned pose while the solver warms up
  | 'degraded' // sustained overload: fewer substeps
  | 'disabled' // overload or repeated instability: skeletal mode continues
  | 'error';

export interface ClothTuning {
  /** Multiplier on every particle's allowed deviation from its skinned position. */
  deviationScale: number;
  stretchCompliance: number;
  bendCompliance: number;
  linearDamping: number;
  iterations: number;
  gravityFactor: number;
  /** Fixed solver step (s). */
  fixedStep: number;
  /** Most solver steps per rendered frame; excess time is dropped, never caught up. */
  maxSubsteps: number;
  /** Colliders on/off (debugging). */
  colliders: boolean;
}

export interface ClothStats {
  state: ClothState;
  engine: string;
  particles: number;
  edges: number;
  colliders: number;
  /** Median/p95 wall time of the solver per rendered frame (ms). */
  stepMs: { median: number | null; p95: number | null };
  /** Proxy→render mapping + normals (ms, median). */
  mapMs: number | null;
  substepsLastFrame: number;
  droppedTimeMs: number;
  resets: number;
  lastResetReason: string | null;
  /** Largest particle distance from its skinned target in the last frame (m). */
  maxDeviationM: number;
  /** Largest free-edge stretch ratio in the last frame (vs. max(rest, skinned) length). */
  maxStretch: number;
  /** 99th percentile of the same ratio (robust against a few very short boundary edges). */
  stretchP99: number;
  message: string | null;
}

export const DEFAULT_CLOTH_STATS: ClothStats = {
  state: 'off',
  engine: '—',
  particles: 0,
  edges: 0,
  colliders: 0,
  stepMs: { median: null, p95: null },
  mapMs: null,
  substepsLastFrame: 0,
  droppedTimeMs: 0,
  resets: 0,
  lastResetReason: null,
  maxDeviationM: 0,
  maxStretch: 1,
  stretchP99: 1,
  message: null,
};
