/**
 * SYNTHETIC landmark builder for deterministic unit tests. These poses are hand-constructed
 * geometry, not model output: they test interpretation logic, never MediaPipe accuracy.
 */
import { type PoseObservation, toObservation } from '../../src/fitting/observation';
import { LANDMARK_COUNT, LANDMARK_STRIDE, LM } from '../../src/tracking/landmarks';

export interface SyntheticPoseOptions {
  frameWidth?: number;
  frameHeight?: number;
  /** Shoulder midpoint in pixels. */
  cx?: number;
  cy?: number;
  shoulderWidth?: number;
  /** Shoulder→hip length ÷ shoulder width. */
  torsoRatio?: number;
  /** Shoulder line rotation in degrees (image coordinates, clockwise positive). */
  tiltDeg?: number;
  hipsVisible?: boolean;
  leftShoulderVisibility?: number;
  rightShoulderVisibility?: number;
  faceVisibility?: number;
  /** Depth difference left − right shoulder, as a multiple of shoulder width. */
  shoulderDepth?: number;
  /** Mirror the anatomical sides (as a back view would appear). */
  backView?: boolean;
  /** Arms raised sideways by this outward angle (degrees). */
  armOutwardDeg?: number;
}

export function syntheticPose(o: SyntheticPoseOptions = {}): PoseObservation {
  const fw = o.frameWidth ?? 1280;
  const fh = o.frameHeight ?? 720;
  const cx = o.cx ?? fw / 2;
  const cy = o.cy ?? fh * 0.35;
  const w = o.shoulderWidth ?? 200;
  const ratio = o.torsoRatio ?? 1.4;
  const tilt = ((o.tiltDeg ?? 0) * Math.PI) / 180;
  const along = { x: Math.cos(tilt), y: Math.sin(tilt) };
  const down = { x: -Math.sin(tilt), y: Math.cos(tilt) };
  const side = o.backView ? -1 : 1;
  const at = (a: number, d: number) => ({
    x: cx + along.x * a * w + down.x * d * w,
    y: cy + along.y * a * w + down.y * d * w,
  });

  const packed = new Float32Array(LANDMARK_COUNT * LANDMARK_STRIDE);
  const set = (i: number, p: { x: number; y: number }, vis: number, z = 0) => {
    const k = i * LANDMARK_STRIDE;
    packed[k] = p.x / fw;
    packed[k + 1] = p.y / fh;
    packed[k + 2] = z / fw;
    packed[k + 3] = vis;
  };
  const face = o.faceVisibility ?? 0.99;
  set(LM.nose, at(0, -0.75), face);
  set(LM.leftEye, at(0.12 * side, -0.85), face);
  set(LM.rightEye, at(-0.12 * side, -0.85), face);
  set(LM.leftEar, at(0.25 * side, -0.8), face);
  set(LM.rightEar, at(-0.25 * side, -0.8), face);
  set(LM.mouthLeft, at(0.07 * side, -0.62), face);
  set(LM.mouthRight, at(-0.07 * side, -0.62), face);
  const dz = (o.shoulderDepth ?? 0) * w;
  set(LM.leftShoulder, at(0.5 * side, 0), o.leftShoulderVisibility ?? 0.99, dz / 2);
  set(LM.rightShoulder, at(-0.5 * side, 0), o.rightShoulderVisibility ?? 0.99, -dz / 2);
  const out = ((o.armOutwardDeg ?? 8) * Math.PI) / 180;
  const arm = (s: number) => {
    const shoulder = at(0.5 * s * side, 0);
    const dir = {
      x: down.x * Math.cos(out) + along.x * s * side * Math.sin(out),
      y: down.y * Math.cos(out) + along.y * s * side * Math.sin(out),
    };
    return {
      elbow: { x: shoulder.x + dir.x * 0.8 * w, y: shoulder.y + dir.y * 0.8 * w },
      wrist: { x: shoulder.x + dir.x * 1.5 * w, y: shoulder.y + dir.y * 1.5 * w },
    };
  };
  const la = arm(1);
  const ra = arm(-1);
  set(LM.leftElbow, la.elbow, 0.95);
  set(LM.leftWrist, la.wrist, 0.95);
  set(LM.rightElbow, ra.elbow, 0.95);
  set(LM.rightWrist, ra.wrist, 0.95);
  const hipVis = o.hipsVisible === false ? 0.05 : 0.97;
  set(LM.leftHip, at(0.35 * side, ratio), hipVis);
  set(LM.rightHip, at(-0.35 * side, ratio), hipVis);
  return toObservation(packed, fw, fh);
}

/** Feeds the same pose repeatedly at a given frame interval; returns the last interpretation. */
export function feed<T>(
  update: (obs: PoseObservation[], t: number) => T,
  make: () => PoseObservation[],
  fromMs: number,
  toMs: number,
  stepMs = 33,
): T {
  let last: T | undefined;
  for (let t = fromMs; t <= toMs; t += stepMs) last = update(make(), t);
  if (last === undefined) throw new Error('empty range');
  return last;
}
