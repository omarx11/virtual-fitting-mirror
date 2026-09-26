/**
 * Converts packed normalized landmarks to source-pixel observations and answers "can this landmark
 * be trusted?". A returned coordinate alone is not trusted: visibility and image bounds must agree.
 */
import type { TrackingConfig } from '../config/tracking';
import type { Point } from '../rendering/matrix';
import {
  LANDMARK_COUNT,
  LM,
  type PackedPose,
  type PackedWorldPose,
  readLandmark,
} from '../tracking/landmarks';

export interface ObservedLandmark extends Point {
  /** Depth scaled to source pixels (MediaPipe z is roughly in units of image width). */
  z: number;
  visibility: number;
}

/** A MediaPipe world landmark: metres, hip-centred, x image-right, y DOWN, z AWAY from the camera. */
export interface WorldLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface PoseObservation {
  /** Source frame size in pixels (the aspect ratio the landmarks are normalized against). */
  width: number;
  height: number;
  /** Image landmarks converted to SOURCE PIXELS. */
  landmarks: ObservedLandmark[];
  /**
   * World landmarks of the SAME person (same MediaPipe result index), or null. Metres; never mix
   * these with the pixel coordinates above.
   */
  world: WorldLandmark[] | null;
}

export function toObservation(
  pose: PackedPose,
  width: number,
  height: number,
  world: PackedWorldPose | null = null,
): PoseObservation {
  const landmarks: ObservedLandmark[] = [];
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const lm = readLandmark(pose, i);
    landmarks.push({ x: lm.x * width, y: lm.y * height, z: lm.z * width, visibility: lm.visibility });
  }
  let worldLandmarks: WorldLandmark[] | null = null;
  if (world) {
    worldLandmarks = [];
    for (let i = 0; i < LANDMARK_COUNT; i++) worldLandmarks.push(readLandmark(world, i));
  }
  return { width, height, landmarks, world: worldLandmarks };
}

export function worldLm(obs: PoseObservation, index: number): WorldLandmark | null {
  return obs.world?.[index] ?? null;
}

export function lm(obs: PoseObservation, index: number): ObservedLandmark {
  return obs.landmarks[index] ?? { x: Number.NaN, y: Number.NaN, z: 0, visibility: 0 };
}

function finite(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

export function isInFrame(obs: PoseObservation, p: Point, marginFraction = 0): boolean {
  const mx = obs.width * marginFraction;
  const my = obs.height * marginFraction;
  return finite(p) && p.x >= -mx && p.x <= obs.width + mx && p.y >= -my && p.y <= obs.height + my;
}

export function shoulderUsable(
  obs: PoseObservation,
  index: typeof LM.leftShoulder | typeof LM.rightShoulder,
  minVisibility: number,
  config: TrackingConfig,
): boolean {
  const p = lm(obs, index);
  return p.visibility >= minVisibility && isInFrame(obs, p, config.shoulderBoundsMargin);
}

/** Hips are anchors only when visible AND actually inside the image; off-screen estimates are not used. */
export function hipUsable(
  obs: PoseObservation,
  index: typeof LM.leftHip | typeof LM.rightHip,
  minVisibility: number,
  config: TrackingConfig,
): boolean {
  const p = lm(obs, index);
  return (
    p.visibility >= minVisibility &&
    finite(p) &&
    p.x >= 0 &&
    p.x <= obs.width &&
    p.y >= 0 &&
    p.y <= obs.height * (1 - config.hipBottomInset)
  );
}

export function headVisible(obs: PoseObservation, config: TrackingConfig): boolean {
  return [LM.nose, LM.leftEye, LM.rightEye].some((i) => {
    const p = lm(obs, i);
    return p.visibility >= config.headVisibility && isInFrame(obs, p);
  });
}

/** Rough centre and scale used to keep the same subject between frames. */
export function subjectAnchor(obs: PoseObservation): { center: Point; width: number } | null {
  const l = lm(obs, LM.leftShoulder);
  const r = lm(obs, LM.rightShoulder);
  if (finite(l) && finite(r) && Math.min(l.visibility, r.visibility) >= 0.2) {
    return {
      center: { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 },
      width: Math.max(Math.hypot(l.x - r.x, l.y - r.y), obs.width * 0.03),
    };
  }
  const nose = lm(obs, LM.nose);
  if (finite(nose) && nose.visibility >= 0.3) {
    const le = lm(obs, LM.leftEar);
    const re = lm(obs, LM.rightEar);
    const earWidth = finite(le) && finite(re) ? Math.hypot(le.x - re.x, le.y - re.y) : 0;
    return { center: { x: nose.x, y: nose.y }, width: Math.max(earWidth * 2, obs.width * 0.05) };
  }
  return null;
}
