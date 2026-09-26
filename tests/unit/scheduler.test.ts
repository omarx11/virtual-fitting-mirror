// Uses a MOCKED backend: verifies scheduling/backpressure logic only, not inference speed.
import { describe, expect, it } from 'vitest';
import type { DetectOutput } from '../../src/tracking/protocol';
import { type FrameTicket, InferenceScheduler } from '../../src/tracking/scheduler';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const fakeBitmap = () => ({ close() {} }) as unknown as ImageBitmap;
const output: DetectOutput = { poses: [], inferenceMs: 1 };

function setup() {
  const detects: Deferred<DetectOutput>[] = [];
  const resets: Deferred<void>[] = [];
  const results: FrameTicket[] = [];
  let now = 0;
  const scheduler = new InferenceScheduler({
    backend: {
      detect: () => {
        const d = deferred<DetectOutput>();
        detects.push(d);
        return d.promise;
      },
      reset: () => {
        const d = deferred<void>();
        resets.push(d);
        return d.promise;
      },
    },
    capture: async () => fakeBitmap(),
    onResult: (t) => results.push(t),
    onError: () => {},
    now: () => now,
  });
  const frame = (t: number) => ({ frameTimeMs: t, receivedAt: t, sourceWidth: 640, sourceHeight: 480 });
  return { scheduler, detects, resets, results, frame, advance: (ms: number) => (now += ms) };
}

describe('InferenceScheduler', () => {
  it('keeps at most one inference in flight and drops superseded frames', async () => {
    const { scheduler, detects, results, frame } = setup();
    scheduler.offer(frame(0));
    await flush();
    for (let i = 1; i <= 10; i++) scheduler.offer(frame(i * 33));
    await flush();
    expect(detects.length).toBe(1);
    expect(scheduler.stats.superseded).toBe(9);
    detects[0]?.resolve(output);
    await flush();
    await flush();
    // Only the newest waiting frame is submitted next — no backlog.
    expect(detects.length).toBe(2);
    detects[1]?.resolve(output);
    await flush();
    await flush();
    expect(results.map((r) => r.frameTimeMs)).toEqual([0, 330]);
    expect(detects.length).toBe(2);
  });

  it('discards late results from an old generation (seek / source change)', async () => {
    const { scheduler, detects, resets, results, frame } = setup();
    scheduler.offer(frame(1000));
    await flush();
    scheduler.newGeneration();
    detects[0]?.resolve(output);
    await flush();
    expect(results).toHaveLength(0);
    expect(scheduler.stats.stale).toBe(1);
    // Nothing is submitted until the backend's tracking reset has finished.
    scheduler.offer(frame(0));
    await flush();
    expect(detects).toHaveLength(1);
    resets[0]?.resolve();
    await flush();
    await flush();
    expect(detects).toHaveLength(2);
    detects[1]?.resolve(output);
    await flush();
    await flush();
    expect(results.map((r) => r.frameTimeMs)).toEqual([0]);
    expect(results[0]?.generation).toBe(1);
  });

  it('does not re-submit the same frame (paused video renders without duplicate inference)', async () => {
    const { scheduler, detects, frame } = setup();
    scheduler.offer(frame(500));
    await flush();
    detects[0]?.resolve(output);
    await flush();
    await flush();
    scheduler.pump();
    scheduler.pump();
    await flush();
    expect(detects).toHaveLength(1);
  });

  it('respects a minimum interval (reduced-rate fallback)', async () => {
    const { scheduler, detects, frame, advance } = setup();
    scheduler.minIntervalMs = 100;
    scheduler.offer(frame(0));
    await flush();
    detects[0]?.resolve(output);
    await flush();
    advance(40);
    scheduler.offer(frame(40));
    await flush();
    expect(detects).toHaveLength(1);
    advance(70);
    await new Promise((r) => setTimeout(r, 80));
    expect(detects).toHaveLength(2);
    scheduler.dispose();
  });

  it('pauses while hidden and resumes with the latest frame', async () => {
    const { scheduler, detects, frame } = setup();
    scheduler.setPaused(true);
    scheduler.offer(frame(0));
    scheduler.offer(frame(33));
    await flush();
    expect(detects).toHaveLength(0);
    scheduler.setPaused(false);
    await flush();
    expect(detects).toHaveLength(1);
  });

  it('closes a captured frame if disposed mid-capture', async () => {
    let closed = false;
    const gate = deferred<void>();
    const scheduler = new InferenceScheduler({
      backend: { detect: async () => output, reset: async () => {} },
      capture: async () => {
        await gate.promise;
        return {
          close() {
            closed = true;
          },
        } as unknown as ImageBitmap;
      },
      onResult: () => {},
      onError: () => {},
    });
    scheduler.offer({ frameTimeMs: 0, receivedAt: 0, sourceWidth: 1, sourceHeight: 1 });
    scheduler.dispose();
    gate.resolve();
    await flush();
    await flush();
    expect(closed).toBe(true);
  });
});
