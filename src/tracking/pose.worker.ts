/// <reference lib="webworker" />
/**
 * Pose inference worker. Owns one PoseEngine. Messages are handled strictly in order, so a
 * `reset` sent after a `detect` is applied after it. The main thread guarantees at most one detect
 * in flight, so no queue can build up here.
 */
import { installLocalOnlyFetch } from './networkGuard';
import { PoseEngine } from './poseEngine';
import { EngineInitError, type WorkerRequest, type WorkerResponse } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

// Before MediaPipe runs: no requests may leave this origin (blocks MediaPipe usage metrics).
installLocalOnlyFetch();

let engine: PoseEngine | null = null;
let queue: Promise<void> = Promise.resolve();

function post(message: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer);
}

async function handle(request: WorkerRequest): Promise<void> {
  switch (request.type) {
    case 'init': {
      engine?.close();
      engine = null;
      try {
        engine = await PoseEngine.create(request.options, (progress) =>
          post({ type: 'progress', id: request.id, progress }),
        );
        post({ type: 'ready', id: request.id, info: engine.info });
      } catch (error) {
        const kind = error instanceof EngineInitError ? error.kind : 'unknown';
        post({
          type: 'init-error',
          id: request.id,
          kind,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    case 'detect': {
      try {
        if (!engine) throw new Error('Tracking engine is not initialised');
        const output = engine.detect(request.frame, request.timestampMs);
        post(
          { type: 'result', id: request.id, output },
          output.poses.map((p) => p.buffer as ArrayBuffer),
        );
      } catch (error) {
        post({
          type: 'detect-error',
          id: request.id,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        request.frame.close();
      }
      return;
    }
    case 'reset': {
      try {
        await engine?.reset();
      } finally {
        post({ type: 'reset-done', id: request.id });
      }
      return;
    }
    case 'dispose': {
      engine?.close();
      engine = null;
      self.close();
      return;
    }
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  queue = queue.then(() => handle(request)).catch((error: unknown) => console.error('[pose worker]', error));
};
