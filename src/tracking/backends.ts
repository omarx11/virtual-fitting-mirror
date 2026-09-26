/**
 * Pose inference backends with one shared interface:
 * - WorkerBackend: PoseLandmarker inside a module Web Worker (preferred; keeps the UI thread free).
 * - MainThreadBackend: same engine on the main thread, used only if the worker path fails.
 */
import type { DelegatePreference, ModelVariant } from '../config/performance';
import { POSE_OPTIONS } from '../config/performance';
import { modelUrl, wasmUrls } from './assets';
import type { PoseEngine } from './poseEngine';
import {
  type DetectOutput,
  type EngineInfo,
  EngineInitError,
  type EngineInitOptions,
  type LoadProgress,
  type WorkerRequest,
  type WorkerResponse,
} from './protocol';

export type BackendKind = 'worker' | 'main-thread';

export interface PoseBackend {
  readonly kind: BackendKind;
  init(onProgress: (p: LoadProgress) => void): Promise<EngineInfo>;
  /** Takes ownership of `frame` (it is transferred or closed). */
  detect(frame: ImageBitmap, timestampMs: number): Promise<DetectOutput>;
  /** Clears model-internal temporal tracking after a discontinuity. */
  reset(): Promise<void>;
  dispose(): void;
}

export interface BackendRequest {
  model: ModelVariant;
  delegate: DelegatePreference;
}

function initOptions(req: BackendRequest, target: BackendKind): EngineInitOptions {
  const wasm = wasmUrls(target);
  return {
    modelUrl: modelUrl(req.model),
    model: req.model,
    wasmLoaderUrl: wasm.loader,
    wasmBinaryUrl: wasm.binary,
    delegate: req.delegate,
    ...POSE_OPTIONS,
  };
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  onProgress?: (p: LoadProgress) => void;
}

export class WorkerBackend implements PoseBackend {
  readonly kind = 'worker' as const;
  private worker: Worker | null;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(private readonly request: BackendRequest) {
    this.worker = new Worker(new URL('./pose.worker.ts', import.meta.url), {
      type: 'module',
      name: 'pose-landmarker',
    });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.onMessage(event.data);
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.failAll(
        new EngineInitError('runtime', `Tracking worker crashed: ${event.message || 'unknown error'}`),
      );
    };
  }

  private send<T>(
    message: WorkerRequest,
    transfer: Transferable[] = [],
    onProgress?: (p: LoadProgress) => void,
  ) {
    return new Promise<T>((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Tracking worker has been disposed'));
        return;
      }
      if (message.type !== 'dispose') {
        this.pending.set(message.id, {
          resolve: resolve as (v: unknown) => void,
          reject,
          ...(onProgress ? { onProgress } : {}),
        });
      }
      this.worker.postMessage(message, transfer);
    });
  }

  private onMessage(message: WorkerResponse): void {
    const entry = this.pending.get(message.id);
    if (!entry) return;
    switch (message.type) {
      case 'progress':
        entry.onProgress?.(message.progress);
        return;
      case 'ready':
        this.pending.delete(message.id);
        entry.resolve(message.info);
        return;
      case 'init-error':
        this.pending.delete(message.id);
        entry.reject(new EngineInitError(message.kind, message.message));
        return;
      case 'result':
        this.pending.delete(message.id);
        entry.resolve(message.output);
        return;
      case 'detect-error':
        this.pending.delete(message.id);
        entry.reject(new Error(message.message));
        return;
      case 'reset-done':
        this.pending.delete(message.id);
        entry.resolve(undefined);
        return;
    }
  }

  private failAll(error: Error): void {
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }

  init(onProgress: (p: LoadProgress) => void): Promise<EngineInfo> {
    const id = this.nextId++;
    return this.send<EngineInfo>(
      { type: 'init', id, options: initOptions(this.request, 'worker') },
      [],
      onProgress,
    );
  }

  detect(frame: ImageBitmap, timestampMs: number): Promise<DetectOutput> {
    const id = this.nextId++;
    return this.send<DetectOutput>({ type: 'detect', id, frame, timestampMs }, [frame]);
  }

  reset(): Promise<void> {
    const id = this.nextId++;
    return this.send<void>({ type: 'reset', id });
  }

  dispose(): void {
    if (!this.worker) return;
    this.worker.postMessage({ type: 'dispose' } satisfies WorkerRequest);
    // Give the worker a moment to close the landmarker, then make sure it is gone.
    const worker = this.worker;
    setTimeout(() => worker.terminate(), 500);
    this.worker = null;
    this.failAll(new Error('Tracking worker disposed'));
  }
}

export class MainThreadBackend implements PoseBackend {
  readonly kind = 'main-thread' as const;
  private engine: PoseEngine | null = null;
  private resetting: Promise<void> | null = null;
  private disposed = false;

  constructor(private readonly request: BackendRequest) {}

  async init(onProgress: (p: LoadProgress) => void): Promise<EngineInfo> {
    const { PoseEngine } = await import('./poseEngine');
    const engine = await PoseEngine.create(initOptions(this.request, 'main-thread'), onProgress);
    if (this.disposed) {
      engine.close();
      throw new Error('Backend disposed during initialisation');
    }
    this.engine = engine;
    return engine.info;
  }

  async detect(frame: ImageBitmap, timestampMs: number): Promise<DetectOutput> {
    try {
      // Never run inference while the graph is being rebuilt by reset().
      if (this.resetting) await this.resetting;
      if (!this.engine) throw new Error('Tracking engine is not initialised');
      return this.engine.detect(frame, timestampMs);
    } finally {
      frame.close();
    }
  }

  reset(): Promise<void> {
    const run = (this.resetting ?? Promise.resolve())
      .then(() => this.engine?.reset())
      .finally(() => {
        if (this.resetting === run) this.resetting = null;
      });
    this.resetting = run;
    return run;
  }

  dispose(): void {
    this.disposed = true;
    this.engine?.close();
    this.engine = null;
  }
}
