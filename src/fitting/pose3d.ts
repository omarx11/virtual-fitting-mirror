/**
 * 3D body frames from MediaPipe landmarks.
 *
 * Coordinate spaces (see also docs/RESEARCH.md → "3D coordinate conventions"):
 *
 * | Space            | Units        | Axes                                                      |
 * |------------------|--------------|-----------------------------------------------------------|
 * | MediaPipe world  | metres       | origin hip midpoint; +x image right, +y DOWN, +z AWAY      |
 * | Body / rest      | metres       | +x image right (= wearer's LEFT when facing), +y UP,       |
 * |                  |              | +z TOWARD the camera. Garment rest space uses the same axes |
 * | Source pixels    | px           | +x right, +y DOWN, origin top-left of the video frame      |
 * | Scene (WebGL)    | px           | X = source x, Y = −source y, Z toward the camera           |
 * | Display          | device px    | sourceToCanvas affine (letterbox, DPR, MIRROR) — applied   |
 * |                  |              | once to video and garment when compositing                 |
 *
 * MediaPipe world → body: (x, −y, −z). A person facing an unmirrored camera has their LEFT shoulder
 * on the image right, i.e. +x — the same as a garment's rest +X. Mirroring is never applied here.
 *
 * World landmarks are hip-relative model estimates: they give orientation and proportions, never an
 * absolute distance or camera pose. Screen position and scale come from the image landmarks.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { WorldLandmark } from './observation';

export function worldToBody(w: WorldLandmark, out = new Vector3()): Vector3 {
  return out.set(w.x, -w.y, -w.z);
}

/** Source-pixel point → scene (Y up) coordinates. */
export function sourceToScene(x: number, y: number, out = new Vector3()): Vector3 {
  return out.set(x, -y, 0);
}

export interface BodyFrame {
  /** Rotation from the rest frame (x left-shoulder side, y up, z front) to this frame. */
  quaternion: Quaternion;
  x: Vector3;
  y: Vector3;
  z: Vector3;
}

const UP = new Vector3(0, 1, 0);
const EPS = 1e-4;

/**
 * Orthonormal frame from a lateral vector (right→left shoulder or hip) and an approximate up vector.
 * Robust to near-collinear inputs: when `up` is almost parallel to `lateral`, falls back to camera
 * up, and returns null only if that also fails (degenerate lateral vector).
 */
export function frameFromLateral(lateral: Vector3, up: Vector3 | null): BodyFrame | null {
  const x = lateral.clone();
  if (!(x.lengthSq() > EPS * EPS) || !Number.isFinite(x.x + x.y + x.z)) return null;
  x.normalize();
  const candidates = up && Number.isFinite(up.x + up.y + up.z) ? [up, UP] : [UP];
  for (const u of candidates) {
    const uu = u.clone();
    if (!(uu.lengthSq() > EPS * EPS)) continue;
    uu.normalize();
    const z = new Vector3().crossVectors(x, uu);
    // |x × up| = sin(angle): below ~8° the forward axis is unreliable.
    if (z.length() < 0.14) continue;
    z.normalize();
    const y = new Vector3().crossVectors(z, x).normalize();
    const m = new Matrix4().makeBasis(x, y, z);
    return { quaternion: new Quaternion().setFromRotationMatrix(m), x, y, z };
  }
  return null;
}

/** Yaw (turn about vertical, + = wearer turns to their left), pitch (+ = leaning toward camera). */
export function frameAngles(frame: BodyFrame): { yawDeg: number; pitchDeg: number; rollDeg: number } {
  const toDeg = 180 / Math.PI;
  const z = frame.z;
  const yawDeg = Math.atan2(z.x, z.z) * toDeg;
  const pitchDeg = Math.asin(Math.max(-1, Math.min(1, -z.y))) * toDeg;
  const rollDeg = Math.atan2(frame.x.y, frame.x.x) * toDeg;
  return { yawDeg, pitchDeg, rollDeg };
}

/**
 * Rotation about the view axis (+Z) that turns the projected direction `from` (x, y in scene/body
 * axes, y up) onto `to`. Returns identity when either projection is too short to trust.
 */
export function viewRollCorrection(
  from: { x: number; y: number },
  to: { x: number; y: number },
  minLength = 1e-3,
): Quaternion {
  const lf = Math.hypot(from.x, from.y);
  const lt = Math.hypot(to.x, to.y);
  if (!(lf > minLength) || !(lt > minLength)) return new Quaternion();
  const angle = Math.atan2(to.y, to.x) - Math.atan2(from.y, from.x);
  return new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle);
}

/** Clamps the forward/back lean of a frame to ±maxPitchDeg by rotating about its lateral axis. */
export function clampPitch(frame: BodyFrame, maxPitchDeg: number): Quaternion {
  const { pitchDeg } = frameAngles(frame);
  const excess = Math.abs(pitchDeg) - maxPitchDeg;
  if (excess <= 0) return frame.quaternion.clone();
  const sign = pitchDeg > 0 ? 1 : -1;
  // Positive pitch = forward axis tipped down; rotate back up about the frame's lateral axis.
  const fix = new Quaternion().setFromAxisAngle(frame.x, (-sign * excess * Math.PI) / 180);
  return fix.multiply(frame.quaternion);
}

/**
 * Keeps an arm direction from crossing through the torso: its component along the outward axis
 * (+x of the chest for the left arm, −x for the right) is raised to at least `minOutward`.
 */
export function limitArmDirection(dir: Vector3, outward: Vector3, minOutward: number): Vector3 {
  const d = dir.clone().normalize();
  const along = d.dot(outward);
  if (along >= minOutward) return d;
  d.addScaledVector(outward, minOutward - along);
  return d.normalize();
}
