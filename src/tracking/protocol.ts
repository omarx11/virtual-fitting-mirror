import type { DelegatePreference, ModelVariant } from '../config/performance';
import type { PackedPose } from './landmarks';

export interface EngineInitOptions {
  modelUrl: string;
  model: ModelVariant;
  wasmLoaderUrl: string;
  wasmBinaryUrl: string;
  delegate: DelegatePreference;
  numPoses: number;
  minPoseDetectionConfidence: number;
  minPosePresenceConfidence: number;
  minTrackingConfidence: number;
}

export type InitErrorKind = 'model-missing' | 'model-download' | 'runtime' | 'unknown';

export interface EngineInfo {
  model: ModelVariant;
  /** Delegate actually in use (may differ from the request if GPU init failed). */
  delegate: DelegatePreference;
  /** Why GPU was not used, when a GPU request fell back to CPU. */
  delegateFallbackReason?: string;
  initMs: number;
  modelBytes: number;
}

export interface LoadProgress {
  stage: 'model' | 'runtime';
  loadedBytes: number;
  totalBytes: number | null;
}

export interface DetectOutput {
  poses: PackedPose[];
  /** Wall time spent inside detectForVideo (excludes transfer/queueing). */
  inferenceMs: number;
}

// ---- Main thread → worker -------------------------------------------------------------------

export type WorkerRequest =
  | { type: 'init'; id: number; options: EngineInitOptions }
  | { type: 'detect'; id: number; frame: ImageBitmap; timestampMs: number }
  | { type: 'reset'; id: number }
  | { type: 'dispose' };

// ---- Worker → main thread -------------------------------------------------------------------

export type WorkerResponse =
  | { type: 'progress'; id: number; progress: LoadProgress }
  | { type: 'ready'; id: number; info: EngineInfo }
  | { type: 'init-error'; id: number; kind: InitErrorKind; message: string }
  | { type: 'result'; id: number; output: DetectOutput }
  | { type: 'detect-error'; id: number; message: string }
  | { type: 'reset-done'; id: number };

export class EngineInitError extends Error {
  constructor(
    readonly kind: InitErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'EngineInitError';
  }
}
