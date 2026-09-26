/**
 * Thin wrapper around MediaPipe's PoseLandmarker (Tasks API, VIDEO running mode).
 *
 * Shared by the Web Worker (preferred) and the main-thread fallback so both paths behave
 * identically. Everything here is inference only; interpretation lives in src/fitting/.
 */
import { PoseLandmarker } from '@mediapipe/tasks-vision';
import { type DetectedPose, pairDetections } from './landmarks';
import {
  type DetectOutput,
  type EngineInfo,
  EngineInitError,
  type EngineInitOptions,
  type LoadProgress,
} from './protocol';

async function fetchModel(url: string, onProgress: (p: LoadProgress) => void): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new EngineInitError(
      'model-download',
      `Could not download the tracking model (${url}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const contentType = response.headers.get('content-type') ?? '';
  // Dev servers answer unknown paths with index.html (200 text/html), so check the type as well.
  if (response.status === 404 || contentType.includes('text/html')) {
    throw new EngineInitError(
      'model-missing',
      `Tracking model file not found at ${url}. Run "npm run setup:assets" and reload.`,
    );
  }
  if (!response.ok || !response.body) {
    throw new EngineInitError('model-download', `Model download failed: HTTP ${response.status} for ${url}`);
  }
  const lengthHeader = Number(response.headers.get('content-length'));
  const total = Number.isFinite(lengthHeader) && lengthHeader > 0 ? lengthHeader : null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress({ stage: 'model', loadedBytes: loaded, totalBytes: total });
  }
  const buffer = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}

/** The subset of a PoseLandmarkerResult read here (lets tests pass a plain object). */
export interface LandmarkerResultLike {
  landmarks: ReadonlyArray<ReadonlyArray<{ x: number; y: number; z: number; visibility?: number }>>;
  worldLandmarks?: ReadonlyArray<ReadonlyArray<{ x: number; y: number; z: number; visibility?: number }>>;
  close(): void;
}

/**
 * Copies image AND world landmarks (paired by person index) out of the result, then closes it.
 * Both copies are made before close(), which may free the underlying data.
 */
export function copyResult(result: LandmarkerResultLike): DetectedPose[] {
  try {
    return pairDetections(result.landmarks, result.worldLandmarks);
  } finally {
    result.close();
  }
}

export class PoseEngine {
  private lastTimestamp = -1;
  private closed = false;

  private constructor(
    private landmarker: PoseLandmarker,
    readonly info: EngineInfo,
  ) {}

  /**
   * Loads WASM + model and creates the landmarker. Tries the requested delegate first; a failed
   * GPU initialisation falls back to CPU and records the reason instead of failing outright.
   */
  static async create(
    options: EngineInitOptions,
    onProgress: (p: LoadProgress) => void,
  ): Promise<PoseEngine> {
    const started = performance.now();
    const modelBuffer = await fetchModel(options.modelUrl, onProgress);
    onProgress({ stage: 'runtime', loadedBytes: 0, totalBytes: null });

    const wasmFileset = { wasmLoaderPath: options.wasmLoaderUrl, wasmBinaryPath: options.wasmBinaryUrl };
    const build = (delegate: 'GPU' | 'CPU') =>
      PoseLandmarker.createFromOptions(wasmFileset, {
        // The buffer is copied into the WASM heap; pass a fresh view per attempt.
        baseOptions: { modelAssetBuffer: modelBuffer.slice(), delegate },
        runningMode: 'VIDEO',
        numPoses: options.numPoses,
        minPoseDetectionConfidence: options.minPoseDetectionConfidence,
        minPosePresenceConfidence: options.minPosePresenceConfidence,
        minTrackingConfidence: options.minTrackingConfidence,
        outputSegmentationMasks: false,
      });

    let landmarker: PoseLandmarker;
    let delegate = options.delegate;
    let delegateFallbackReason: string | undefined;
    try {
      landmarker = await build(options.delegate);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (options.delegate !== 'GPU') {
        throw new EngineInitError('runtime', `Could not start the tracking runtime: ${message}`);
      }
      delegateFallbackReason = message;
      delegate = 'CPU';
      try {
        landmarker = await build('CPU');
      } catch (cpuError) {
        const cpuMessage = cpuError instanceof Error ? cpuError.message : String(cpuError);
        throw new EngineInitError(
          'runtime',
          `Could not start the tracking runtime (GPU: ${message}; CPU: ${cpuMessage})`,
        );
      }
    }

    const info: EngineInfo = {
      model: options.model,
      delegate,
      initMs: performance.now() - started,
      modelBytes: modelBuffer.byteLength,
      ...(delegateFallbackReason ? { delegateFallbackReason } : {}),
    };
    return new PoseEngine(landmarker, info);
  }

  /**
   * Runs one VIDEO-mode inference. MediaPipe requires strictly increasing timestamps per
   * landmarker; callers pass a monotonic clock, and we additionally enforce +1 ms here so a
   * seek, loop, or source switch can never trip the check.
   */
  detect(frame: TexImageSource, timestampMs: number): DetectOutput {
    if (this.closed) throw new Error('PoseEngine is closed');
    const ts = Math.max(Math.round(timestampMs), this.lastTimestamp + 1);
    this.lastTimestamp = ts;
    const started = performance.now();
    const result = this.landmarker.detectForVideo(frame, ts);
    const inferenceMs = performance.now() - started;
    return { poses: copyResult(result), inferenceMs };
  }

  /**
   * Clears MediaPipe's internal temporal tracking (the previous-frame region of interest) after a
   * discontinuity such as a seek or source change. setOptions() rebuilds the task graph without
   * reloading WASM or re-downloading the model.
   */
  async reset(): Promise<void> {
    if (this.closed) return;
    await this.landmarker.setOptions({ runningMode: 'VIDEO' });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.landmarker.close();
  }
}
