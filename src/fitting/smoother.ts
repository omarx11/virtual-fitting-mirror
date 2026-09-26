/**
 * Time-aware smoothing of the garment pose (not of raw landmarks): what the viewer sees is what
 * is filtered. One Euro filters give low jitter at rest and little lag during motion.
 */
import type { Point } from '../rendering/matrix';
import type { ArmEstimate, TorsoEstimate } from './interpreter';
import { AngleOneEuroFilter, OneEuroFilter, type OneEuroParams, wrapAngle } from './oneEuro';

export interface GarmentPose {
  center: Point;
  shoulderWidth: number;
  torsoLength: number;
  angle: number;
  /** Outward angle of each upper arm from the torso "down" axis (radians), null when unknown. */
  leftArmOutward: number | null;
  rightArmOutward: number | null;
}

export interface SmootherParams {
  /** Position is filtered in units of the source frame's longest side. */
  position: OneEuroParams;
  logSize: OneEuroParams;
  angle: OneEuroParams;
  arm: OneEuroParams;
}

export const DEFAULT_SMOOTHER_PARAMS: SmootherParams = {
  position: { minCutoff: 1.5, beta: 12, dCutoff: 1 },
  logSize: { minCutoff: 1.0, beta: 1.5, dCutoff: 1 },
  angle: { minCutoff: 1.2, beta: 0.6, dCutoff: 1 },
  arm: { minCutoff: 2.0, beta: 0.8, dCutoff: 1 },
};

/**
 * Outward angle of the upper arm relative to the torso's down axis: 0 = hanging along the torso,
 * π/2 = raised sideways to horizontal, negative = across the body. Works for either side.
 */
export function armOutwardAngle(
  torsoAngle: number,
  arm: ArmEstimate | null,
  side: 'left' | 'right',
): number | null {
  if (!arm?.elbow) return null;
  const dir = Math.atan2(arm.elbow.y - arm.shoulder.y, arm.elbow.x - arm.shoulder.x);
  const down = torsoAngle + Math.PI / 2;
  const rel = wrapAngle(dir - down);
  // Wearer's left arm is on the image's right (+x) in an unmirrored front view.
  return side === 'left' ? -rel : rel;
}

export class PoseSmoother {
  private cx: OneEuroFilter;
  private cy: OneEuroFilter;
  private logW: OneEuroFilter;
  private logL: OneEuroFilter;
  private angle: AngleOneEuroFilter;
  private leftArm: AngleOneEuroFilter;
  private rightArm: AngleOneEuroFilter;

  constructor(
    params: SmootherParams = DEFAULT_SMOOTHER_PARAMS,
    /** Source frame's longest side, used to normalise positions. */
    private scaleRef = 1000,
  ) {
    this.cx = new OneEuroFilter(params.position);
    this.cy = new OneEuroFilter(params.position);
    this.logW = new OneEuroFilter(params.logSize);
    this.logL = new OneEuroFilter(params.logSize);
    this.angle = new AngleOneEuroFilter(params.angle);
    this.leftArm = new AngleOneEuroFilter(params.arm);
    this.rightArm = new AngleOneEuroFilter(params.arm);
  }

  setScaleReference(longSide: number): void {
    if (longSide > 0 && longSide !== this.scaleRef) {
      this.scaleRef = longSide;
      this.reset();
    }
  }

  reset(): void {
    for (const f of [this.cx, this.cy, this.logW, this.logL, this.angle, this.leftArm, this.rightArm])
      f.reset();
  }

  update(torso: TorsoEstimate, timeSeconds: number): GarmentPose {
    const s = this.scaleRef;
    const left = armOutwardAngle(torso.angle, torso.arms.left, 'left');
    const right = armOutwardAngle(torso.angle, torso.arms.right, 'right');
    return {
      center: {
        x: this.cx.filter(torso.center.x / s, timeSeconds) * s,
        y: this.cy.filter(torso.center.y / s, timeSeconds) * s,
      },
      shoulderWidth: Math.exp(this.logW.filter(Math.log(torso.shoulderWidth), timeSeconds)),
      torsoLength: Math.exp(this.logL.filter(Math.log(torso.torsoLength), timeSeconds)),
      angle: this.angle.filter(torso.angle, timeSeconds),
      leftArmOutward: left === null ? null : this.leftArm.filter(left, timeSeconds),
      rightArmOutward: right === null ? null : this.rightArm.filter(right, timeSeconds),
    };
  }
}
