/**
 * BlazePose 33-landmark topology (MediaPipe Pose Landmarker). "Left"/"right" are the subject's
 * anatomical sides, independent of display mirroring. In an unmirrored front-facing image the
 * subject's LEFT shoulder appears on the RIGHT side of the image.
 */
export const LM = {
  nose: 0,
  leftEyeInner: 1,
  leftEye: 2,
  leftEyeOuter: 3,
  rightEyeInner: 4,
  rightEye: 5,
  rightEyeOuter: 6,
  leftEar: 7,
  rightEar: 8,
  mouthLeft: 9,
  mouthRight: 10,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftPinky: 17,
  rightPinky: 18,
  leftIndex: 19,
  rightIndex: 20,
  leftThumb: 21,
  rightThumb: 22,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

export const LANDMARK_COUNT = 33;
/** Floats per landmark in the packed transfer format: x, y, z, visibility. */
export const LANDMARK_STRIDE = 4;

/** One detected pose, packed as Float32Array(33 × 4) of normalized x, y, z, visibility. */
export type PackedPose = Float32Array;

export interface Landmark {
  /** Normalized [0,1] image x (may lie outside when the model extrapolates off-screen). */
  x: number;
  y: number;
  /** Relative depth, roughly the same scale as x; smaller = closer to the camera. */
  z: number;
  /** Model likelihood that the landmark is visible in the image. */
  visibility: number;
}

export function readLandmark(pose: PackedPose, index: number): Landmark {
  const o = index * LANDMARK_STRIDE;
  return {
    x: pose[o] ?? Number.NaN,
    y: pose[o + 1] ?? Number.NaN,
    z: pose[o + 2] ?? Number.NaN,
    visibility: pose[o + 3] ?? 0,
  };
}

export function packLandmarks(
  landmarks: ReadonlyArray<{ x: number; y: number; z: number; visibility?: number }>,
): PackedPose {
  const out = new Float32Array(LANDMARK_COUNT * LANDMARK_STRIDE);
  const n = Math.min(LANDMARK_COUNT, landmarks.length);
  for (let i = 0; i < n; i++) {
    const lm = landmarks[i];
    if (!lm) continue;
    const o = i * LANDMARK_STRIDE;
    out[o] = lm.x;
    out[o + 1] = lm.y;
    out[o + 2] = lm.z;
    out[o + 3] = lm.visibility ?? 0;
  }
  return out;
}

/** Skeleton edges for the diagnostics overlay (upper body + legs). */
export const SKELETON_EDGES: ReadonlyArray<readonly [number, number]> = [
  [LM.leftShoulder, LM.rightShoulder],
  [LM.leftShoulder, LM.leftElbow],
  [LM.leftElbow, LM.leftWrist],
  [LM.rightShoulder, LM.rightElbow],
  [LM.rightElbow, LM.rightWrist],
  [LM.leftShoulder, LM.leftHip],
  [LM.rightShoulder, LM.rightHip],
  [LM.leftHip, LM.rightHip],
  [LM.leftHip, LM.leftKnee],
  [LM.leftKnee, LM.leftAnkle],
  [LM.rightHip, LM.rightKnee],
  [LM.rightKnee, LM.rightAnkle],
  [LM.nose, LM.leftEye],
  [LM.nose, LM.rightEye],
  [LM.leftEye, LM.leftEar],
  [LM.rightEye, LM.rightEar],
];
