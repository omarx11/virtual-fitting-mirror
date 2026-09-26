/**
 * SYNTHETIC 3D poses for deterministic tests. A body is built in body space (metres, +x wearer's
 * left, +y up, +z toward the camera), rotated, converted to MediaPipe world axes (x, −y, −z), and
 * projected ORTHOGRAPHICALLY into the image. Hand-built geometry, never model output: these prove
 * the math and state handling, not MediaPipe's real tracking quality.
 */
import { Euler, Quaternion, Vector3 } from 'three';
import { type PoseObservation, toObservation } from '../../src/fitting/observation';
import { LANDMARK_COUNT, LANDMARK_STRIDE, LM } from '../../src/tracking/landmarks';

export interface Synthetic3DOptions {
  frameWidth?: number;
  frameHeight?: number;
  /** Image shoulder midpoint (px). */
  cx?: number;
  cy?: number;
  pxPerMetre?: number;
  yawDeg?: number;
  pitchDeg?: number;
  rollDeg?: number;
  shoulderM?: number;
  torsoM?: number;
  /** Unit directions in the UNROTATED body frame (the body rotation is applied afterwards). */
  leftUpper?: Vector3;
  leftLower?: Vector3;
  rightUpper?: Vector3;
  rightLower?: Vector3;
  hipsVisible?: boolean;
  leftElbowVisibility?: number;
  rightElbowVisibility?: number;
  noWorld?: boolean;
}

export const hanging = (side: 'left' | 'right', outDeg = 10) => {
  const a = (outDeg * Math.PI) / 180;
  return new Vector3((side === 'left' ? 1 : -1) * Math.sin(a), -Math.cos(a), 0);
};

export function bodyRotation(o: Synthetic3DOptions): Quaternion {
  const d = Math.PI / 180;
  // Yaw about +y (wearer turns to their left for +), pitch about +x (lean toward camera for +),
  // roll about +z.
  return new Quaternion().setFromEuler(
    new Euler((o.pitchDeg ?? 0) * d, (o.yawDeg ?? 0) * d, (o.rollDeg ?? 0) * d, 'YXZ'),
  );
}

export function synthetic3DPose(o: Synthetic3DOptions = {}): PoseObservation {
  const fw = o.frameWidth ?? 1280;
  const fh = o.frameHeight ?? 720;
  const ppm = o.pxPerMetre ?? 550;
  const cx = o.cx ?? fw / 2;
  const cy = o.cy ?? fh * 0.3;
  const sw = o.shoulderM ?? 0.36;
  const torso = o.torsoM ?? 0.52;
  const q = bodyRotation(o);

  const pts = new Map<number, Vector3>();
  const set = (i: number, x: number, y: number, z: number) => pts.set(i, new Vector3(x, y, z));
  set(LM.leftShoulder, sw / 2, torso, 0);
  set(LM.rightShoulder, -sw / 2, torso, 0);
  set(LM.leftHip, 0.13, 0, 0);
  set(LM.rightHip, -0.13, 0, 0);
  set(LM.leftKnee, 0.13, -0.45, 0.02);
  set(LM.rightKnee, -0.13, -0.45, 0.02);
  set(LM.leftAnkle, 0.13, -0.9, 0);
  set(LM.rightAnkle, -0.13, -0.9, 0);
  set(LM.nose, 0, torso + 0.25, 0.1);
  set(LM.leftEye, 0.035, torso + 0.29, 0.08);
  set(LM.rightEye, -0.035, torso + 0.29, 0.08);
  set(LM.leftEar, 0.075, torso + 0.27, 0);
  set(LM.rightEar, -0.075, torso + 0.27, 0);
  set(LM.mouthLeft, 0.025, torso + 0.2, 0.09);
  set(LM.mouthRight, -0.025, torso + 0.2, 0.09);
  const arm = (side: 'left' | 'right', upper: Vector3, lower: Vector3) => {
    const s = pts.get(side === 'left' ? LM.leftShoulder : LM.rightShoulder) as Vector3;
    const e = s.clone().addScaledVector(upper.clone().normalize(), 0.28);
    const w = e.clone().addScaledVector(lower.clone().normalize(), 0.25);
    pts.set(side === 'left' ? LM.leftElbow : LM.rightElbow, e);
    pts.set(side === 'left' ? LM.leftWrist : LM.rightWrist, w);
  };
  arm('left', o.leftUpper ?? hanging('left'), o.leftLower ?? o.leftUpper ?? hanging('left'));
  arm('right', o.rightUpper ?? hanging('right'), o.rightLower ?? o.rightUpper ?? hanging('right'));

  for (const p of pts.values()) p.applyQuaternion(q);
  const ls = pts.get(LM.leftShoulder) as Vector3;
  const rs = pts.get(LM.rightShoulder) as Vector3;
  const mid = ls.clone().add(rs).multiplyScalar(0.5);

  const image = new Float32Array(LANDMARK_COUNT * LANDMARK_STRIDE);
  const world = new Float32Array(LANDMARK_COUNT * LANDMARK_STRIDE);
  for (const [i, p] of pts) {
    let vis = 0.98;
    if ((i === LM.leftHip || i === LM.rightHip) && o.hipsVisible === false) vis = 0.05;
    if (i === LM.leftElbow || i === LM.leftWrist) vis = o.leftElbowVisibility ?? vis;
    if (i === LM.rightElbow || i === LM.rightWrist) vis = o.rightElbowVisibility ?? vis;
    const k = i * LANDMARK_STRIDE;
    image[k] = (cx + ppm * (p.x - mid.x)) / fw;
    image[k + 1] = (cy - ppm * (p.y - mid.y)) / fh;
    image[k + 2] = (-p.z * ppm) / fw; // toward the camera ⇒ smaller z
    image[k + 3] = vis;
    world[k] = p.x;
    world[k + 1] = -p.y;
    world[k + 2] = -p.z;
    world[k + 3] = vis;
  }
  return toObservation(image, fw, fh, o.noWorld ? null : world);
}
