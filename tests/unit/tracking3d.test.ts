import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { parsePreferences } from '../../src/app/preferences';
import { TRACKING_CONFIG, trackingConfigFor3D } from '../../src/config/tracking';
import { TrackingInterpreter } from '../../src/fitting/interpreter';
import { toObservation } from '../../src/fitting/observation';
import { forearmCutouts } from '../../src/fitting/occlusion';
import { VNECK_3D } from '../../src/garments/catalogue';
import { detectionTransferables, LANDMARK_COUNT, LM, pairDetections } from '../../src/tracking/landmarks';
import { copyResult } from '../../src/tracking/poseEngine';
import type { DetectOutput } from '../../src/tracking/protocol';
import { InferenceScheduler } from '../../src/tracking/scheduler';
import { synthetic3DPose } from './synthetic3d';

const person = (tag: number) =>
  Array.from({ length: LANDMARK_COUNT }, (_, i) => ({ x: tag + i / 100, y: tag, z: -tag, visibility: 0.9 }));

describe('image + world landmark pairing', () => {
  it('pairs by detected-person index and copies both before the result is closed', () => {
    const image = [person(0.1), person(0.2)];
    const world = [person(10), person(20)];
    let closed = false;
    const result = {
      landmarks: image,
      worldLandmarks: world,
      close() {
        closed = true;
        // MediaPipe may free the data on close: the copies must not depend on it.
        image.length = 0;
        world.length = 0;
      },
    };
    const poses = copyResult(result);
    expect(closed).toBe(true);
    expect(poses).toHaveLength(2);
    expect(poses[0]?.image[0]).toBeCloseTo(0.1);
    expect(poses[0]?.world?.[0]).toBeCloseTo(10);
    expect(poses[1]?.image[0]).toBeCloseTo(0.2);
    expect(poses[1]?.world?.[0]).toBeCloseTo(20);
  });

  it('never pairs mismatched arrays: missing or shorter world output ⇒ world = null', () => {
    expect(pairDetections([person(0.1)], undefined)[0]?.world).toBeNull();
    const two = pairDetections([person(0.1), person(0.2)], [person(10)]);
    expect(two.map((p) => p.world)).toEqual([null, null]);
  });

  it('transfers both buffers through postMessage-style cloning and keeps the pairing', () => {
    const output: DetectOutput = {
      poses: pairDetections([person(0.1), person(0.2)], [person(10), person(20)]),
      inferenceMs: 3,
    };
    const transfer = detectionTransferables(output.poses);
    expect(transfer).toHaveLength(4);
    const received = structuredClone(output, { transfer });
    // Transferred: the sender's views are detached (no copy per frame).
    expect(output.poses[0]?.image.length).toBe(0);
    expect(received.poses[1]?.image[0]).toBeCloseTo(0.2);
    expect(received.poses[1]?.world?.[0]).toBeCloseTo(20);
    // Observations keep the metres separate from the pixels.
    const obs = toObservation(
      received.poses[1]?.image as Float32Array,
      640,
      480,
      received.poses[1]?.world ?? null,
    );
    expect(obs.landmarks[0]?.x).toBeCloseTo(0.2 * 640);
    expect(obs.world?.[0]?.x).toBeCloseTo(20);
  });

  it('worker and main-thread fallback produce identical outputs (same copy function)', () => {
    const make = () => ({ landmarks: [person(0.3)], worldLandmarks: [person(30)], close() {} });
    const worker = structuredClone({ poses: copyResult(make()) });
    const main = { poses: copyResult(make()) };
    expect(Array.from(worker.poses[0]?.image ?? [])).toEqual(Array.from(main.poses[0]?.image ?? []));
    expect(Array.from(worker.poses[0]?.world ?? [])).toEqual(Array.from(main.poses[0]?.world ?? []));
  });

  it('stale generations never deliver world data from an old timeline', async () => {
    const results: DetectOutput[] = [];
    let release: (() => void) | null = null;
    const backend = {
      detect: () =>
        new Promise<DetectOutput>((resolve) => {
          release = () => resolve({ poses: pairDetections([person(0.5)], [person(50)]), inferenceMs: 1 });
        }),
      reset: () => Promise.resolve(),
    };
    const scheduler = new InferenceScheduler({
      backend,
      capture: async () => ({ close() {} }) as ImageBitmap,
      onResult: (_t, output) => results.push(output),
      onError: () => undefined,
    });
    scheduler.offer({ frameTimeMs: 0, receivedAt: 0, sourceWidth: 640, sourceHeight: 480 });
    await Promise.resolve();
    await Promise.resolve();
    scheduler.newGeneration(); // seek while the old frame is in flight
    (release as (() => void) | null)?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(results).toHaveLength(0);
    expect(scheduler.stats.stale).toBe(1);
  });
});

describe('turn limits: 3D mode allows modest turns, 2D mode unchanged', () => {
  const run = (config: typeof TRACKING_CONFIG, yawDeg: number, extra = {}) => {
    const interpreter = new TrackingInterpreter(config);
    let r = interpreter.update([synthetic3DPose({ yawDeg, ...extra })], 0);
    for (let i = 1; i < 12; i++) r = interpreter.update([synthetic3DPose({ yawDeg, ...extra })], i * 33);
    return r;
  };
  const config3d = trackingConfigFor3D(VNECK_3D.rig.limits);

  it('a 45° turn is followed in 3D but still rejected for 2D art', () => {
    expect(run(config3d, 45).torso).not.toBeNull();
    expect(run(TRACKING_CONFIG, 45).torso).toBeNull();
  });

  it('extreme side views stay hidden in 3D mode too', () => {
    const r = run(config3d, 85);
    expect(r.torso).toBeNull();
    expect(r.phase).toBe('turned');
  });

  it('switching config does not weaken the 2D thresholds object', () => {
    expect(TRACKING_CONFIG.yawHideDeg).toBe(65);
    expect(TRACKING_CONFIG.yawCompensatedWidth).toBe(false);
    expect(config3d.yawHideDeg).toBe(VNECK_3D.rig.limits.yawHideDeg);
  });
});

describe('foreground-forearm occlusion', () => {
  const cutoutsFor = (lower: Vector3, extra = {}) => {
    const obs = synthetic3DPose({
      leftUpper: new Vector3(0.3, -1, 0.35),
      leftLower: lower,
      ...extra,
    });
    const interpreter = new TrackingInterpreter(trackingConfigFor3D(VNECK_3D.rig.limits));
    let r = interpreter.update([obs], 0);
    for (let i = 1; i < 6; i++) r = interpreter.update([obs], i * 33);
    if (!r.torso) throw new Error('no torso');
    return forearmCutouts(obs, r.torso);
  };

  it('reveals a forearm crossing in FRONT of the torso (depth-gated, starts past the sleeve)', () => {
    const cuts = cutoutsFor(new Vector3(-0.9, 0.1, 0.45));
    expect(cuts).toHaveLength(1);
    const c = cuts[0];
    expect(c?.strength).toBeGreaterThan(0.5);
    // The capsule begins past the elbow (the sleeve end is not cut).
    const obs = synthetic3DPose({
      leftUpper: new Vector3(0.3, -1, 0.35),
      leftLower: new Vector3(-0.9, 0.1, 0.45),
    });
    const elbow = obs.landmarks[LM.leftElbow] as { x: number; y: number };
    expect(Math.hypot((c?.from.x ?? 0) - elbow.x, (c?.from.y ?? 0) - elbow.y)).toBeGreaterThan(5);
  });

  it('does not cut the garment for arms hanging at the side or behind the torso plane', () => {
    expect(cutoutsFor(new Vector3(0.2, -1, 0))).toHaveLength(0);
    expect(cutoutsFor(new Vector3(-0.8, 0, -0.6))).toHaveLength(0);
  });

  it('low-confidence wrists never cut holes', () => {
    expect(cutoutsFor(new Vector3(-0.9, 0.1, 0.45), { leftElbowVisibility: 0.3 })).toHaveLength(0);
  });
});

describe('preferences for the 3D experience', () => {
  it('accepts valid motion/material values and rejects others', () => {
    expect(parsePreferences({ motion: 'cloth', materialId: 'navy' })).toMatchObject({
      motion: 'cloth',
      materialId: 'navy',
    });
    expect(parsePreferences({ motion: 'rotate', materialId: 42 }).motion).toBe('skeletal');
    expect(parsePreferences({}).garmentId).toBe(VNECK_3D.id); // the 3D V-neck is the default
  });
});
