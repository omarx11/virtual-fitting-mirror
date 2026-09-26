// Uses SYNTHETIC landmarks (tests/unit/syntheticPose.ts): verifies interpretation logic only.
import { describe, expect, it } from 'vitest';
import { TRACKING_CONFIG } from '../../src/config/tracking';
import { TrackingInterpreter } from '../../src/fitting/interpreter';
import { feed, type SyntheticPoseOptions, syntheticPose } from './syntheticPose';

function run(interp: TrackingInterpreter, opts: SyntheticPoseOptions, from: number, to: number) {
  return feed(
    (o, t) => interp.update(o, t),
    () => [syntheticPose(opts)],
    from,
    to,
  );
}

describe('TrackingInterpreter', () => {
  it('uses shoulder + hip geometry when both are reliable', () => {
    const it0 = new TrackingInterpreter(TRACKING_CONFIG);
    const r = run(it0, { shoulderWidth: 200, torsoRatio: 1.5 }, 0, 500);
    expect(r.phase).toBe('full');
    expect(r.torso?.source).toBe('full');
    expect(r.torso?.torsoLength).toBeCloseTo(300, 0);
    expect(r.torso?.shoulderWidth).toBeCloseTo(200, 0);
    expect(r.targetOpacity).toBeCloseTo(1);
  });

  it('starts directly in upper-body mode on a chest-up view (no calibration frame)', () => {
    const it0 = new TrackingInterpreter(TRACKING_CONFIG);
    const r = run(it0, { hipsVisible: false }, 0, 400);
    expect(r.phase).toBe('upper');
    expect(r.torso?.source).toBe('upper');
    expect(r.torso?.torsoLength).toBeCloseTo(200 * TRACKING_CONFIG.defaultTorsoRatio, 0);
  });

  it('ignores hips that are reported inside the bottom edge band', () => {
    const it0 = new TrackingInterpreter(TRACKING_CONFIG);
    // Hips at ~99% of the frame height: "visible" but not trustworthy anchors.
    const r = run(it0, { cy: 720 * 0.99 - 1.4 * 200, torsoRatio: 1.4 }, 0, 400);
    expect(r.phase).toBe('upper');
  });

  it('reuses the learned torso ratio after the hips leave the frame', () => {
    const it0 = new TrackingInterpreter(TRACKING_CONFIG);
    run(it0, { torsoRatio: 1.7 }, 0, 3000);
    const r = run(it0, { torsoRatio: 1.7, hipsVisible: false }, 3033, 3400);
    expect(r.phase).toBe('upper');
    expect(r.diagnostics.learnedRatio).toBe(true);
    expect(r.torso?.torsoLength).toBeGreaterThan(200 * 1.6);
  });

  it('bridges one briefly unreliable shoulder, then fades out', () => {
    const it0 = new TrackingInterpreter(TRACKING_CONFIG);
    run(it0, {}, 0, 500);
    const during = run(it0, { rightShoulderVisibility: 0.1 }, 533, 600);
    expect(during.torso).not.toBeNull();
    expect(during.torso?.source).toBe('bridged');
    expect(during.torso?.shoulderWidth).toBeCloseTo(200, 0);
    const after = run(it0, { rightShoulderVisibility: 0.1 }, 633, 1500);
    expect(after.torso).toBeNull();
    expect(after.targetOpacity).toBe(0);
  });

  it('holds briefly when the person disappears, then reports lost (no frozen shirt)', () => {
    const it0 = new TrackingInterpreter(TRACKING_CONFIG);
    run(it0, {}, 0, 500);
    const brief = it0.update([], 533);
    expect(brief.phase).toBe('holding');
    expect(brief.targetOpacity).toBeGreaterThan(0);
    let last = brief;
    for (let t = 566; t <= 1500; t += 33) last = it0.update([], t);
    expect(last.phase).toBe('lost');
    expect(last.torso).toBeNull();
  });

  it('says "searching" (not lost) before anyone was tracked', () => {
    const it0 = new TrackingInterpreter(TRACKING_CONFIG);
    expect(it0.update([], 0).phase).toBe('searching');
  });

  it('requires consistent observations before showing (hysteresis)', () => {
    const it0 = new TrackingInterpreter(TRACKING_CONFIG);
    const first = it0.update([syntheticPose()], 0);
    expect(first.torso).toBeNull();
    const flicker = it0.update([], 33);
    expect(flicker.phase).toBe('searching');
  });

  it('does not flicker between full and upper when hip visibility hovers near threshold', () => {
    const it0 = new TrackingInterpreter(TRACKING_CONFIG);
    run(it0, {}, 0, 500);
    const phases = new Set<string>();
    for (let i = 0; i < 30; i++) {
      // Alternate hips visible / invisible every frame: the displayed phase must not follow.
      const r = it0.update([syntheticPose({ hipsVisible: i % 2 === 0 })], 533 + i * 33);
      phases.add(r.phase);
    }
    expect(phases.size).toBe(1);
  });

  it('resets filters and history when the person reappears after an absence', () => {
    const it0 = new TrackingInterpreter(TRACKING_CONFIG);
    run(it0, { cx: 300 }, 0, 500);
    for (let t = 533; t < 2000; t += 33) it0.update([], t);
    let sawReset = false;
    for (let t = 2000; t < 2400; t += 33) {
      const r = it0.update([syntheticPose({ cx: 900 })], t);
      if (r.resetFilters) sawReset = true;
      if (r.torso) expect(r.torso.center.x).toBeCloseTo(900, 0);
    }
    expect(sawReset).toBe(true);
  });

  it('does not hop to a far-away person; acquires them fresh once the old subject is forgotten', () => {
    const it0 = new TrackingInterpreter(TRACKING_CONFIG);
    run(it0, { cx: 300 }, 0, 500);
    // Immediately: the far person is not accepted; we hold/fade at the old place instead.
    const r = it0.update([syntheticPose({ cx: 1100 })], 533);
    expect(r.torso === null || Math.abs(r.torso.center.x - 300) < 1).toBe(true);
    // After the subject memory expires, the new person is acquired with reset smoothing.
    let sawReset = false;
    let last = r;
    for (let t = 566; t < 3000; t += 33) {
      last = it0.update([syntheticPose({ cx: 1100 })], t);
      if (last.resetFilters) sawReset = true;
    }
    expect(sawReset).toBe(true);
    expect(last.torso?.center.x).toBeCloseTo(1100, 0);
  });

  it('keeps the same subject when a second person appears', () => {
    const it0 = new TrackingInterpreter(TRACKING_CONFIG);
    run(it0, { cx: 400 }, 0, 500);
    const r = feed(
      (o, t) => it0.update(o, t),
      () => [syntheticPose({ cx: 1000, shoulderWidth: 260 }), syntheticPose({ cx: 405 })],
      533,
      800,
    );
    expect(r.subjectIndex).toBe(1);
    expect(r.torso?.center.x).toBeCloseTo(405, 0);
  });

  it('hides the garment for a back view', () => {
    const it0 = new TrackingInterpreter(TRACKING_CONFIG);
    const r = run(it0, { backView: true }, 0, 500);
    expect(r.phase).toBe('turned');
    expect(r.torso).toBeNull();
  });

  it('hides the garment when the face is not visible (back view with front-ordered shoulders)', () => {
    const it0 = new TrackingInterpreter(TRACKING_CONFIG);
    const r = run(it0, { faceVisibility: 0.2 }, 0, 500);
    expect(r.phase).toBe('turned');
    expect(r.diagnostics.limitReason).toBe('back-view');
  });

  it('fades for a moderate turn and hides for a strong side view', () => {
    const moderate = run(new TrackingInterpreter(TRACKING_CONFIG), { shoulderDepth: 1.0 }, 0, 500); // ~45°
    expect(moderate.torso).not.toBeNull();
    expect(moderate.targetOpacity).toBeGreaterThan(0);
    expect(moderate.targetOpacity).toBeLessThan(1);
    const side = run(new TrackingInterpreter(TRACKING_CONFIG), { shoulderDepth: 4 }, 0, 500); // ~76°
    expect(side.phase).toBe('turned');
    expect(side.torso).toBeNull();
  });

  it('rejects a foreshortened torso (bending) instead of drawing a full-length shirt', () => {
    const it0 = new TrackingInterpreter(TRACKING_CONFIG);
    run(it0, {}, 0, 500);
    const r = run(it0, { torsoRatio: 0.5 }, 533, 900);
    expect(r.torso).toBeNull();
    expect(r.diagnostics.limitReason).toBe('foreshortened');
  });

  it('rejects implausible shoulder tilt', () => {
    const r = run(new TrackingInterpreter(TRACKING_CONFIG), { tiltDeg: 60 }, 0, 500);
    expect(r.torso).toBeNull();
  });

  it('asks to move back when very close', () => {
    const r = run(
      new TrackingInterpreter(TRACKING_CONFIG),
      { shoulderWidth: 1000, hipsVisible: false, cy: 300 },
      0,
      500,
    );
    expect(r.phase).toBe('too-close');
  });

  it('applies a paused (still) frame immediately', () => {
    const it0 = new TrackingInterpreter(TRACKING_CONFIG);
    const r = it0.update([syntheticPose()], 0, true);
    expect(r.phase).toBe('full');
    expect(r.torso).not.toBeNull();
  });

  it('treats time going backwards (seek) as a discontinuity', () => {
    const it0 = new TrackingInterpreter(TRACKING_CONFIG);
    run(it0, { cx: 300 }, 5000, 5500);
    const r = it0.update([syntheticPose({ cx: 300 })], 100);
    // Fresh timeline: needs re-acquisition, no stale state carried over.
    expect(r.torso).toBeNull();
    expect(r.phase).toBe('searching');
  });
});
