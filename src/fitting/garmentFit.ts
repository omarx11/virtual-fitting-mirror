/**
 * Anchor-based garment placement: a per-asset affine transform from garment image pixels to
 * source-frame pixels. Stable by construction (no mesh warp): translate the garment's shoulder
 * midpoint onto the wearer's, scale shoulder span to shoulder width and neck→hem to torso length
 * (with a clamped aspect change), and rotate with the shoulder line.
 */
import type { GarmentDefinition, SleevePart } from '../garments/types';
import {
  applyToPoint,
  compose,
  type Mat2D,
  type Point,
  rotation,
  scaling,
  translation,
} from '../rendering/matrix';
import type { GarmentPose } from './smoother';

export interface UserFitAdjustment {
  /** Multiplier on garment size (1 = catalogue default). */
  scale: number;
  /** Extra shift along the torso axis in shoulder widths (+ = down). */
  verticalOffset: number;
}

export const DEFAULT_USER_FIT: UserFitAdjustment = { scale: 1, verticalOffset: 0 };
export const USER_SCALE_RANGE = { min: 0.8, max: 1.3 } as const;
export const USER_OFFSET_RANGE = { min: -0.3, max: 0.3 } as const;

/** Garment height/width scaling ratio limits relative to the image's own proportions. */
export const ASPECT_CLAMP = { min: 0.8, max: 1.35 } as const;
/** Hard bounds on rotation from upright (radians). */
export const MAX_GARMENT_ROTATION = (40 * Math.PI) / 180;

export interface PartPlacement {
  matrix: Mat2D;
  width: number;
  height: number;
}

export interface GarmentPlacement {
  body: PartPlacement;
  leftSleeve: PartPlacement | null;
  rightSleeve: PartPlacement | null;
  /** Garment outline corners in source pixels (for occlusion tests and diagnostics). */
  bodyQuad: [Point, Point, Point, Point];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function clampUserFit(fit: UserFitAdjustment): UserFitAdjustment {
  return {
    scale: clamp(Number.isFinite(fit.scale) ? fit.scale : 1, USER_SCALE_RANGE.min, USER_SCALE_RANGE.max),
    verticalOffset: clamp(
      Number.isFinite(fit.verticalOffset) ? fit.verticalOffset : 0,
      USER_OFFSET_RANGE.min,
      USER_OFFSET_RANGE.max,
    ),
  };
}

export function computeGarmentPlacement(
  garment: GarmentDefinition,
  pose: GarmentPose,
  userFit: UserFitAdjustment,
): GarmentPlacement {
  const fit = clampUserFit(userFit);
  const { width: gw, height: gh } = garment.body;
  const a = garment.anchors;
  const gL = { x: a.leftShoulder.x * gw, y: a.leftShoulder.y * gh };
  const gR = { x: a.rightShoulder.x * gw, y: a.rightShoulder.y * gh };
  const gMid = { x: (gL.x + gR.x) / 2, y: (gL.y + gR.y) / 2 };
  const garmentSpan = Math.max(1, Math.hypot(gL.x - gR.x, gL.y - gR.y));
  const garmentDrop = Math.max(1, a.hem.y * gh - gMid.y);

  const sx = (pose.shoulderWidth * garment.fit.widthScale * fit.scale) / garmentSpan;
  let sy = (pose.torsoLength * garment.fit.lengthScale * fit.scale) / garmentDrop;
  sy = clamp(sy, sx * ASPECT_CLAMP.min, sx * ASPECT_CLAMP.max);

  const angle = clamp(pose.angle, -MAX_GARMENT_ROTATION, MAX_GARMENT_ROTATION);
  const shift = (garment.fit.verticalOffset + fit.verticalOffset) * pose.shoulderWidth;
  // Shift along the torso's down axis (perpendicular to the shoulder line).
  const target = {
    x: pose.center.x - Math.sin(angle) * shift,
    y: pose.center.y + Math.cos(angle) * shift,
  };

  const bodyMatrix = compose(
    translation(-gMid.x, -gMid.y),
    scaling(sx, sy),
    rotation(angle),
    translation(target.x, target.y),
  );

  const sleeve = (
    part: SleevePart | undefined,
    anchor: Point,
    outward: number | null,
    side: 'left' | 'right',
  ) => {
    if (!part) return null;
    const pivotPx = { x: part.pivot.x * part.width, y: part.pivot.y * part.height };
    const attach = applyToPoint(bodyMatrix, anchor);
    const out = clamp(outward ?? part.restOutward, part.minOutward, part.maxOutward);
    const down = angle + Math.PI / 2;
    const dir = side === 'left' ? down - out : down + out;
    return {
      matrix: compose(
        translation(-pivotPx.x, -pivotPx.y),
        scaling(sx, sx),
        rotation(dir - part.axisAngle),
        translation(attach.x, attach.y),
      ),
      width: part.width,
      height: part.height,
    };
  };

  const corners: [Point, Point, Point, Point] = [
    applyToPoint(bodyMatrix, { x: 0, y: 0 }),
    applyToPoint(bodyMatrix, { x: gw, y: 0 }),
    applyToPoint(bodyMatrix, { x: gw, y: gh }),
    applyToPoint(bodyMatrix, { x: 0, y: gh }),
  ];

  return {
    body: { matrix: bodyMatrix, width: gw, height: gh },
    leftSleeve: sleeve(garment.sleeves?.left, gL, pose.leftArmOutward, 'left'),
    rightSleeve: sleeve(garment.sleeves?.right, gR, pose.rightArmOutward, 'right'),
    bodyQuad: corners,
  };
}
