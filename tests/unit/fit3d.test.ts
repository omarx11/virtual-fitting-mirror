import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { trackingConfigFor3D } from '../../src/config/tracking';
import {
  BodyEstimator3D,
  DirectionFilter,
  defaultSmootherParams,
  Fit3DSmoother,
  type Fit3DTarget,
  placeGarmentRoot,
  QuaternionFilter,
} from '../../src/fitting/fit3d';
import { DEFAULT_USER_FIT } from '../../src/fitting/garmentFit';
import { type Interpretation, TrackingInterpreter } from '../../src/fitting/interpreter';
import type { PoseObservation } from '../../src/fitting/observation';
import { frameAngles, frameFromLateral, worldToBody } from '../../src/fitting/pose3d';
import { createBoneTransforms, Retargeter, shoulderAnchor } from '../../src/fitting/retargeter';
import { VNECK_3D } from '../../src/garments/catalogue';
import { computeViewTransform, sourceToCanvasPoint } from '../../src/rendering/viewTransform';
import { LM } from '../../src/tracking/landmarks';
import { loadVneck } from './garmentModel';
import { bodyRotation, type Synthetic3DOptions, synthetic3DPose } from './synthetic3d';

const RIG = VNECK_3D.rig;
const DEG = Math.PI / 180;

function interpret(
  make: () => PoseObservation,
  frames = 12,
): { obs: PoseObservation; result: Interpretation } {
  const interpreter = new TrackingInterpreter(trackingConfigFor3D(RIG.limits));
  let result: Interpretation | null = null;
  let obs = make();
  for (let i = 0; i < frames; i++) {
    obs = make();
    result = interpreter.update([obs], i * 33);
  }
  if (!result) throw new Error('no result');
  return { obs, result };
}

async function estimate(o: Synthetic3DOptions) {
  const model = await loadVneck();
  const estimator = new BodyEstimator3D(RIG, model.rig);
  const { obs, result } = interpret(() => synthetic3DPose(o));
  if (!result.torso) throw new Error(`no torso (phase ${result.phase})`);
  const target = estimator.estimate(obs, result.torso, 400);
  if (!target) throw new Error('no target');
  return { model, target, obs, result };
}

function smoothedOnce(target: Fit3DTarget) {
  const s = new Fit3DSmoother(defaultSmootherParams(RIG), 1280);
  return s.update(target, 1);
}

describe('coordinate conversion', () => {
  it('maps MediaPipe world (y down, z away) to body space (y up, z toward camera)', () => {
    const v = worldToBody({ x: 0.1, y: -0.5, z: -0.2, visibility: 1 });
    expect(v.toArray()).toEqual([0.1, 0.5, 0.2]);
  });

  it('builds an orthonormal torso frame and survives near-collinear / missing-hip input', () => {
    const f = frameFromLateral(new Vector3(0.36, 0, 0), new Vector3(0, 0.5, 0));
    expect(f?.quaternion.angleTo(new Quaternion())).toBeLessThan(1e-6);
    // "up" almost parallel to the shoulders: falls back to camera up instead of a garbage frame.
    const g = frameFromLateral(new Vector3(1, 0, 0), new Vector3(1, 0.01, 0));
    expect(g).not.toBeNull();
    expect(g?.y.y).toBeGreaterThan(0.99);
    // Missing hips (no up vector): camera up.
    const h = frameFromLateral(new Vector3(0.3, 0.05, 0), null);
    expect(h?.z.z).toBeGreaterThan(0.99);
    // Degenerate lateral vector: no frame.
    expect(frameFromLateral(new Vector3(0, 0, 0), new Vector3(0, 1, 0))).toBeNull();
    expect(frameFromLateral(new Vector3(Number.NaN, 0, 0), null)).toBeNull();
  });
});

describe('BodyEstimator3D (synthetic 3D poses)', () => {
  it('front-facing pose → identity torso, anatomical left arm on +X', async () => {
    const { target } = await estimate({});
    expect(target.orientation).toBe('world');
    expect(target.chest.angleTo(new Quaternion())).toBeLessThan(2 * DEG);
    expect(target.arms.left.upper?.x).toBeGreaterThan(0.1);
    expect(target.arms.right.upper?.x).toBeLessThan(-0.1);
    expect(target.pxPerMetre).toBeCloseTo(550, -1);
    expect(target.bodyShoulderM).toBeCloseTo(0.36, 2);
  });

  it('recovers modest turns and leans from world landmarks', async () => {
    for (const yawDeg of [-35, -20, 20, 35]) {
      const { target } = await estimate({ yawDeg });
      expect(target.yawDeg).toBeCloseTo(yawDeg, 0);
      expect(target.confidence).toBe(1);
    }
    const lean = await estimate({ pitchDeg: 15 });
    expect(lean.target.pitchDeg).toBeCloseTo(15, 0);
    // Scale stays tied to image lengths while turning (weak perspective).
    const turned = await estimate({ yawDeg: 35 });
    expect(turned.target.pxPerMetre).toBeCloseTo(550, -1);
  });

  it('fades toward the supported turn limit', async () => {
    const { target } = await estimate({ yawDeg: 62 });
    expect(target.confidence).toBeGreaterThan(0);
    expect(target.confidence).toBeLessThan(1);
  });

  it('missing hips: still a finite frame from shoulders + camera up (upper-body crop)', async () => {
    const { target, result } = await estimate({ hipsVisible: false, rollDeg: 8 });
    expect(result.phase).toBe('upper');
    for (const q of [target.chest, target.hips]) expect(Number.isFinite(q.x + q.y + q.z + q.w)).toBe(true);
  });

  it('without world landmarks falls back to image-only orientation', async () => {
    const { target } = await estimate({ noWorld: true, rollDeg: 10 });
    expect(target.orientation).toBe('image');
    expect(Number.isFinite(target.pxPerMetre)).toBe(true);
  });

  it('low-confidence elbow → no arm target (held/neutral later, never a zero rotation)', async () => {
    const { target } = await estimate({ leftElbowVisibility: 0.2 });
    expect(target.arms.left.upper).toBeNull();
    expect(target.arms.right.upper).not.toBeNull();
  });

  it('never attaches one person’s world pose to another person’s image pose', async () => {
    const model = await loadVneck();
    const interpreter = new TrackingInterpreter(trackingConfigFor3D(RIG.limits));
    const estimator = new BodyEstimator3D(RIG, model.rig);
    // Person A (tracked, centre) faces the camera; person B (edge) is turned 40°.
    const a = () => synthetic3DPose({ cx: 640 });
    const b = () => synthetic3DPose({ cx: 1100, yawDeg: 40, pxPerMetre: 300 });
    let last: Interpretation | null = null;
    let obs: PoseObservation[] = [];
    for (let i = 0; i < 10; i++) {
      obs = i % 2 ? [b(), a()] : [a(), b()]; // result order changes between frames
      last = interpreter.update(obs, i * 33);
    }
    if (!last?.torso || last.subjectIndex === null) throw new Error('not tracking');
    const subject = obs[last.subjectIndex] as PoseObservation;
    const target = estimator.estimate(subject, last.torso, 330);
    expect(Math.abs(target?.yawDeg ?? 99)).toBeLessThan(2);
  });
});

describe('registration: garment shoulders land on the image shoulders', () => {
  it('for turns, tilts, scales, portrait/landscape frames and after the display transform', async () => {
    const model = await loadVneck();
    const retargeter = new Retargeter(model.rig, RIG);
    const bones = createBoneTransforms(model.rig);
    const cases: Synthetic3DOptions[] = [
      {},
      { yawDeg: 30, rollDeg: -12 },
      { pxPerMetre: 300, cx: 300, cy: 200 },
      { frameWidth: 720, frameHeight: 1280, cx: 360, cy: 420, pxPerMetre: 700, pitchDeg: 10 },
    ];
    for (const o of cases) {
      const { target, obs } = await estimate(o);
      const fit = smoothedOnce(target);
      retargeter.solve(fit.pose, bones);
      const { mid, span } = shoulderAnchor(model.rig, bones);
      const user = { ...DEFAULT_USER_FIT };
      const configNoOffset = { ...RIG, fit: { ...RIG.fit, verticalOffset: 0, shoulderWidthScale: 1 } };
      const place = placeGarmentRoot(fit, mid, model.rig, configNoOffset, user);
      // Scene (Y up) → source pixels.
      const toPx = (p: Vector3) => ({
        x: place.position.x + place.scale * p.x,
        y: -(place.position.y + place.scale * p.y),
      });
      const ls = obs.landmarks[LM.leftShoulder] as { x: number; y: number };
      const rs = obs.landmarks[LM.rightShoulder] as { x: number; y: number };
      const gMid = toPx(mid);
      expect(gMid.x).toBeCloseTo((ls.x + rs.x) / 2, 0);
      expect(gMid.y).toBeCloseTo((ls.y + rs.y) / 2, 0);
      // Projected garment shoulder line has the image shoulder line's direction.
      const gSpan = { x: place.scale * span.x, y: -place.scale * span.y };
      const img = { x: ls.x - rs.x, y: ls.y - rs.y };
      const angle = Math.atan2(gSpan.y, gSpan.x) - Math.atan2(img.y, img.x);
      expect(Math.abs(angle)).toBeLessThan(1 * DEG);

      // Composited through the SAME view transform as the video: mirror/contain/cover/DPR.
      for (const mirror of [false, true]) {
        for (const fitMode of ['contain', 'cover'] as const) {
          for (const [vw, vh, dpr] of [
            [1080, 1920, 1],
            [1600, 900, 2],
          ] as const) {
            const view = computeViewTransform({
              sourceWidth: obs.width,
              sourceHeight: obs.height,
              viewportCssWidth: vw,
              viewportCssHeight: vh,
              devicePixelRatio: dpr,
              fit: fitMode,
              mirror,
            });
            const a = sourceToCanvasPoint(view, gMid);
            const b = sourceToCanvasPoint(view, { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 });
            expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1.5 * view.scale);
          }
        }
      }
    }
  });

  it('body rotation used by the generator matches the frame angles convention', () => {
    const q = bodyRotation({ yawDeg: 25 });
    const z = new Vector3(0, 0, 1).applyQuaternion(q);
    const x = new Vector3(1, 0, 0).applyQuaternion(q);
    const f = frameFromLateral(x, new Vector3(0, 1, 0));
    expect(f && frameAngles(f).yawDeg).toBeCloseTo(25, 3);
    expect(z.x).toBeGreaterThan(0);
  });
});

describe('temporal filtering', () => {
  const params = { minCutoff: 1.4, beta: 0.6, dCutoff: 1, maxSpeed: 4 };

  it('quaternion filter takes the shortest path and bounds angular speed', () => {
    const f = new QuaternionFilter(params);
    const a = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 170 * DEG);
    const b = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -170 * DEG);
    f.filter(a, 0);
    // -170° is 20° away from 170° the short way; the double cover (−q) must not cause a 340° spin.
    const neg = b.clone().set(-b.x, -b.y, -b.z, -b.w);
    const out = f.filter(neg, 0.033).clone();
    expect(out.angleTo(a)).toBeLessThan(21 * DEG);
    // A 180° jump in one 33 ms step is limited to maxSpeed·dt.
    const g = new QuaternionFilter({ ...params, minCutoff: 1000 });
    g.filter(new Quaternion(), 0);
    const jump = g.filter(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 179 * DEG), 0.033);
    expect(jump.angleTo(new Quaternion())).toBeLessThanOrEqual(4 * 0.033 + 1e-6);
    expect(Math.abs(jump.length() - 1)).toBeLessThan(1e-9);
  });

  it('direction filter handles opposite directions without NaN', () => {
    const f = new DirectionFilter(params);
    f.filter(new Vector3(0, -1, 0), 0);
    const out = f.filter(new Vector3(0, 1, 0), 0.033);
    expect(Number.isFinite(out.x + out.y + out.z)).toBe(true);
    expect(Math.abs(out.length() - 1)).toBeLessThan(1e-9);
  });

  it('missing elbow: short hold, then smooth fade to a neutral hanging arm', async () => {
    const { target } = await estimate({ leftUpper: new Vector3(1, 0.2, 0) });
    const s = new Fit3DSmoother(defaultSmootherParams(RIG), 1280);
    let t = 0;
    for (; t < 0.5; t += 0.033) s.update(target, t);
    const raised = s.update(target, t).pose.arms.left.upper.clone();
    const lost: Fit3DTarget = { ...target, arms: { ...target.arms, left: { upper: null, lower: null } } };
    const held = s.update(lost, t + 0.1);
    expect(held.armState.left).toBe('held');
    expect(held.pose.arms.left.upper.angleTo(raised)).toBeLessThan(2 * DEG);
    let prev = held.pose.arms.left.upper.clone();
    let maxStep = 0;
    let last = held;
    for (let k = 1; k < 60; k++) {
      last = s.update(lost, t + 0.1 + k * 0.033);
      maxStep = Math.max(maxStep, last.pose.arms.left.upper.angleTo(prev));
      prev = last.pose.arms.left.upper.clone();
    }
    expect(last.armState.left).toBe('neutral');
    expect(last.pose.arms.left.upper.y).toBeLessThan(-0.9); // hanging
    expect(maxStep).toBeLessThan(25 * DEG); // never a sudden snap
  });

  it('reset forgets motion (seek / new subject)', async () => {
    const { target } = await estimate({ yawDeg: 30 });
    const s = new Fit3DSmoother(defaultSmootherParams(RIG), 1280);
    s.update(target, 0);
    s.reset();
    const front = await estimate({});
    const out = s.update(front.target, 10);
    expect(out.pose.chest.angleTo(front.target.chest)).toBeLessThan(1e-6);
  });
});
