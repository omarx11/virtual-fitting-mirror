/**
 * Quality presets. Switching preset reloads the model (rare, explicit user action); garment
 * selection never does.
 */
export type ModelVariant = 'lite' | 'full';
export type DelegatePreference = 'GPU' | 'CPU';

export interface QualityPreset {
  id: 'fast' | 'balanced';
  label: string;
  model: ModelVariant;
  /** Longest side (px) of the frame sent to inference. The model itself runs at 256×256. */
  processingLongSide: number;
  /** Max inference requests per second (0 = as fast as frames arrive, still one in flight). */
  maxInferenceHz: number;
}

export const QUALITY_PRESETS: Record<QualityPreset['id'], QualityPreset> = {
  fast: { id: 'fast', label: 'Fast (Lite model)', model: 'lite', processingLongSide: 512, maxInferenceHz: 0 },
  balanced: {
    id: 'balanced',
    label: 'Balanced (Full model)',
    model: 'full',
    processingLongSide: 640,
    maxInferenceHz: 0,
  },
};

export const DEFAULT_PRESET: QualityPreset['id'] = 'balanced';

/** Rate for pushing diagnostics / status into React state (low-frequency UI updates). */
export const UI_UPDATE_HZ = 4;

/** Main-thread fallback runs at a reduced rate so the page stays responsive. */
export const MAIN_THREAD_FALLBACK_HZ = 12;

/** Detection settings passed to PoseLandmarker. numPoses=2 lets us keep a stable subject when a
 * second person enters (see src/tracking/subject.ts); the model card targets single-person use. */
export const POSE_OPTIONS = {
  numPoses: 2,
  minPoseDetectionConfidence: 0.5,
  minPosePresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
} as const;
