/**
 * 3D garment fitting: from one interpreted observation (image + matched world landmarks) to a
 * garment pose, then time-aware smoothing and final placement in scene pixels.
 *
 * Projection model: documented WEAK PERSPECTIVE (orthographic + uniform scale). The garment root
 * has no rotation, only a uniform px-per-metre scale and a translation, so that:
 * - body orientation comes from WORLD landmarks (hip-relative directions), corrected by a rotation
 *   about the view axis so the projected shoulder line matches the IMAGE shoulder line exactly;
 * - screen position comes from the IMAGE shoulder midpoint;
 * - scale comes from image lengths ÷ projected world lengths of the same segments (px per metre).
 * No perspective FOV is assumed; world coordinates are not camera extrinsics.
 */
import { Quaternion, Vector3 } from 'three';
import type { GarmentRigConfig, SidePair } from '../garments/types';
import type { Point } from '../rendering/matrix';
import { LM } from '../tracking/landmarks';
import type { UserFitAdjustment } from './garmentFit';
import type { TorsoEstimate } from './interpreter';
import { type PoseObservation, worldLm } from './observation';
import { OneEuroFilter, type OneEuroParams } from './oneEuro';
import {
  type BodyFrame,
  clampPitch,
  frameAngles,
  frameFromLateral,
  limitArmDirection,
  viewRollCorrection,
  worldToBody,
} from './pose3d';
import type { ArmTarget, BodyPose3D } from './retargeter';

/** Garment geometry the estimator needs (from RigModel). */
export interface GarmentRigMetrics {
  shoulderSpan: number;
  torsoDrop: number;
}

export interface Fit3DTarget {
  /** Image shoulder midpoint (source px). */
  anchor: Point;
  /** Unit image direction "down the torso" (source px axes, y down). */
  down: Point;
  pxPerMetre: number;
  /** Learned shoulder width of the wearer (metres, model estimate). */
  bodyShoulderM: number;
  chest: Quaternion;
  hips: Quaternion;
  arms: SidePair<{ upper: Vector3 | null; lower: Vector3 | null }>;
  torsoLength: number;
  yawDeg: number;
  pitchDeg: number;
  /** 0..1 visibility multiplier (fades toward the supported-turn limit). */
  confidence: number;
  /** 'world': orientation from world landmarks; 'image': 2D fallback (roll only). */
  orientation: 'world' | 'image';
}

export const DEFAULT_SHOULDER_M = 0.36;
const SHOULDER_RANGE_M = [0.24, 0.52] as const;
const RATIO_RANGE = [1.0, 2.0] as const;
/** Time constants (ms of frame time) for learning proportions from reliable samples. */
const SHOULDER_TAU_MS = 1500;
const RATIO_TAU_MS = 1500;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Stateful estimator: learns the wearer's shoulder width and torso ratio slowly, and only from
 * front-facing, reliable samples. Reset it on new subject / discontinuity.
 */
export class BodyEstimator3D {
  private shoulderM: number | null = null;
  private ratio: number | null = null;
  private lastLearnMs: number | null = null;
  private lastPxPerMetre: number | null = null;

  constructor(
    private readonly config: GarmentRigConfig,
    private readonly garment: GarmentRigMetrics,
  ) {}

  reset(): void {
    this.shoulderM = null;
    this.ratio = null;
    this.lastLearnMs = null;
    this.lastPxPerMetre = null;
  }

  get learned(): { shoulderM: number | null; torsoRatio: number | null } {
    return { shoulderM: this.shoulderM, torsoRatio: this.ratio };
  }

  estimate(obs: PoseObservation, torso: TorsoEstimate, timeMs: number): Fit3DTarget | null {
    const v = {
      x: torso.leftShoulder.x - torso.rightShoulder.x,
      y: torso.leftShoulder.y - torso.rightShoulder.y,
    };
    const imgShoulder = Math.hypot(v.x, v.y);
    if (!(imgShoulder > 1)) return null;
    const down = { x: -v.y / imgShoulder, y: v.x / imgShoulder };
    const hipsOk = torso.source === 'full';
    const world = torso.source === 'bridged' ? null : this.worldFrames(obs, hipsOk);

    if (!world) return this.imageFallback(torso, imgShoulder, down, timeMs);

    // --- Align the projected shoulder line with the image shoulder line (rotation about view axis).
    const projected = { x: world.chest.x.x, y: world.chest.x.y };
    const roll = viewRollCorrection(projected, { x: v.x, y: -v.y });
    const chestQ = clampPitch(world.chest, this.config.limits.maxPitchDeg).premultiply(roll);
    const hipsQ = clampPitch(world.hips, this.config.limits.maxPitchDeg).premultiply(roll);
    const angles = frameAngles(world.chest);

    // --- Scale: image lengths ÷ projected world lengths of the same segments. ---------------------
    let imgLen = imgShoulder;
    let worldLen = Math.hypot(world.shoulderVec.x, world.shoulderVec.y);
    if (hipsOk && world.torsoVec) {
      const hipMid = midHipPx(obs);
      if (hipMid) {
        imgLen += Math.hypot(hipMid.x - torso.center.x, hipMid.y - torso.center.y);
        worldLen += Math.hypot(world.torsoVec.x, world.torsoVec.y);
      }
    }
    let pxPerMetre = worldLen > 0.05 ? imgLen / worldLen : (this.lastPxPerMetre ?? Number.NaN);
    if (!Number.isFinite(pxPerMetre)) {
      pxPerMetre = imgShoulder / (this.shoulderM ?? DEFAULT_SHOULDER_M);
    }
    this.lastPxPerMetre = pxPerMetre;

    // --- Learn proportions only from reliable, near-frontal samples. -------------------------------
    const frontal = Math.abs(angles.yawDeg) < 30 && Math.abs(angles.pitchDeg) < 20;
    const dt = this.lastLearnMs === null ? 1e9 : clamp(timeMs - this.lastLearnMs, 0, 200);
    if (frontal) {
      const width = world.shoulderVec.length();
      if (width >= SHOULDER_RANGE_M[0] && width <= SHOULDER_RANGE_M[1]) {
        const k = this.shoulderM === null ? 1 : 1 - Math.exp(-dt / SHOULDER_TAU_MS);
        this.shoulderM = (this.shoulderM ?? width) + k * (width - (this.shoulderM ?? width));
      }
      if (hipsOk && world.torsoVec) {
        const ratio = world.torsoVec.length() / Math.max(1e-3, width);
        if (ratio >= RATIO_RANGE[0] && ratio <= RATIO_RANGE[1]) {
          const k = this.ratio === null ? 1 : 1 - Math.exp(-dt / RATIO_TAU_MS);
          this.ratio = (this.ratio ?? ratio) + k * (ratio - (this.ratio ?? ratio));
        }
      }
      this.lastLearnMs = timeMs;
    }

    // --- Arms (only from landmarks the interpreter trusted in the image). --------------------------
    const chestX = new Vector3(1, 0, 0).applyQuaternion(chestQ);
    const arm = (side: 'left' | 'right') => {
      const est = torso.arms[side];
      const idx =
        side === 'left'
          ? { s: LM.leftShoulder, e: LM.leftElbow, w: LM.leftWrist }
          : { s: LM.rightShoulder, e: LM.rightElbow, w: LM.rightWrist };
      const s = worldLm(obs, idx.s);
      const e = worldLm(obs, idx.e);
      const w = worldLm(obs, idx.w);
      const outward = side === 'left' ? chestX : chestX.clone().negate();
      const min = this.config.limits.armMinOutward;
      let upper: Vector3 | null = null;
      let lower: Vector3 | null = null;
      if (est?.elbow && s && e) {
        upper = worldToBody(e).sub(worldToBody(s)).applyQuaternion(roll);
        upper = upper.lengthSq() > 1e-6 ? limitArmDirection(upper, outward, min) : null;
      }
      if (upper && est?.wrist && e && w) {
        lower = worldToBody(w).sub(worldToBody(e)).applyQuaternion(roll);
        lower = lower.lengthSq() > 1e-6 ? limitArmDirection(lower, outward, min - 0.25) : null;
      }
      return { upper, lower };
    };

    return {
      anchor: { ...torso.center },
      down,
      pxPerMetre,
      bodyShoulderM: this.shoulderM ?? clamp(world.shoulderVec.length(), ...SHOULDER_RANGE_M),
      chest: chestQ,
      hips: hipsQ,
      arms: { left: arm('left'), right: arm('right') },
      torsoLength: this.torsoLengthFactor(),
      yawDeg: angles.yawDeg,
      pitchDeg: angles.pitchDeg,
      confidence: this.yawConfidence(angles.yawDeg),
      orientation: 'world',
    };
  }

  /** Spine stretch so the garment's shoulder→hip drop follows the learned torso ratio. */
  private torsoLengthFactor(): number {
    if (this.ratio === null) return 1;
    const garmentRatio = this.garment.torsoDrop / this.garment.shoulderSpan;
    const f =
      (this.ratio * this.config.fit.lengthScale) / (this.config.fit.shoulderWidthScale * garmentRatio);
    const [lo, hi] = this.config.fit.torsoLengthRange;
    return clamp(f, lo, hi);
  }

  private yawConfidence(yawDeg: number): number {
    const { yawFadeStartDeg: start, yawHideDeg: hide } = this.config.limits;
    const a = Math.abs(yawDeg);
    return a <= start ? 1 : clamp(1 - (a - start) / (hide - start), 0, 1);
  }

  private worldFrames(
    obs: PoseObservation,
    hipsOk: boolean,
  ): { chest: BodyFrame; hips: BodyFrame; shoulderVec: Vector3; torsoVec: Vector3 | null } | null {
    const ls = worldLm(obs, LM.leftShoulder);
    const rs = worldLm(obs, LM.rightShoulder);
    if (!ls || !rs) return null;
    const L = worldToBody(ls);
    const R = worldToBody(rs);
    const shoulderVec = L.clone().sub(R);
    let up: Vector3 | null = null;
    let hipLateral: Vector3 | null = null;
    let torsoVec: Vector3 | null = null;
    const lh = worldLm(obs, LM.leftHip);
    const rh = worldLm(obs, LM.rightHip);
    if (hipsOk && lh && rh) {
      const LH = worldToBody(lh);
      const RH = worldToBody(rh);
      const shoulderMid = L.clone().add(R).multiplyScalar(0.5);
      const hipMid = LH.clone().add(RH).multiplyScalar(0.5);
      torsoVec = shoulderMid.sub(hipMid);
      up = torsoVec.clone();
      hipLateral = LH.sub(RH);
    }
    const chest = frameFromLateral(shoulderVec, up);
    if (!chest) return null;
    const hips = (hipLateral && frameFromLateral(hipLateral, up)) || chest;
    return { chest, hips, shoulderVec, torsoVec };
  }

  /** No usable world landmarks: in-plane rotation from the image only, arms in the image plane. */
  private imageFallback(torso: TorsoEstimate, imgShoulder: number, down: Point, timeMs: number): Fit3DTarget {
    void timeMs;
    const roll = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -torso.angle);
    const shoulderM = this.shoulderM ?? DEFAULT_SHOULDER_M;
    const pxPerMetre = imgShoulder / shoulderM;
    const dir = (a: Point, b: Point) => new Vector3(b.x - a.x, -(b.y - a.y), 0).normalize();
    const chestX = new Vector3(1, 0, 0).applyQuaternion(roll);
    const min = this.config.limits.armMinOutward;
    const arm = (side: 'left' | 'right') => {
      const est = torso.arms[side];
      const outward = side === 'left' ? chestX : chestX.clone().negate();
      const upper = est?.elbow ? limitArmDirection(dir(est.shoulder, est.elbow), outward, min) : null;
      const lower =
        upper && est?.elbow && est.wrist
          ? limitArmDirection(dir(est.elbow, est.wrist), outward, min - 0.25)
          : null;
      return { upper, lower };
    };
    return {
      anchor: { ...torso.center },
      down,
      pxPerMetre,
      bodyShoulderM: shoulderM,
      chest: roll.clone(),
      hips: roll.clone(),
      arms: { left: arm('left'), right: arm('right') },
      torsoLength: this.torsoLengthFactor(),
      yawDeg: torso.yawDeg,
      pitchDeg: 0,
      confidence: this.yawConfidence(torso.yawDeg),
      orientation: 'image',
    };
  }
}

function midHipPx(obs: PoseObservation): Point | null {
  const l = obs.landmarks[LM.leftHip];
  const r = obs.landmarks[LM.rightHip];
  if (!l || !r) return null;
  return { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 };
}

// ---- Smoothing ------------------------------------------------------------------------------------

export interface QuatFilterParams extends OneEuroParams {
  /** Hard bound on angular speed (rad/s). */
  maxSpeed: number;
}

function alpha(cutoffHz: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dt);
}

/**
 * One-Euro-style adaptive slerp for rotations: low jitter at rest, low lag in motion, shortest
 * path, bounded angular velocity. Time-aware (seconds).
 */
export class QuaternionFilter {
  private value: Quaternion | null = null;
  private t: number | null = null;
  private speed = 0;
  private tmp = new Quaternion();

  constructor(readonly params: QuatFilterParams) {}

  reset(): void {
    this.value = null;
    this.t = null;
    this.speed = 0;
  }

  get current(): Quaternion | null {
    return this.value;
  }

  filter(target: Quaternion, timeSeconds: number): Quaternion {
    const q = this.tmp.copy(target).normalize();
    if (this.value === null || this.t === null) {
      this.value = q.clone();
      this.t = timeSeconds;
      return this.value;
    }
    const dt = timeSeconds - this.t;
    if (!(dt > 0) || dt > 1) {
      this.value.copy(q);
      this.t = timeSeconds;
      this.speed = 0;
      return this.value;
    }
    const dot = this.value.dot(q);
    if (dot < 0) q.set(-q.x, -q.y, -q.z, -q.w); // shortest path
    const angle = 2 * Math.acos(Math.min(1, Math.abs(dot)));
    this.speed += alpha(this.params.dCutoff, dt) * (angle / dt - this.speed);
    let a = alpha(this.params.minCutoff + this.params.beta * Math.abs(this.speed), dt);
    const maxStep = this.params.maxSpeed * dt;
    if (angle * a > maxStep && angle > 1e-9) a = maxStep / angle;
    this.value.slerp(q, a).normalize();
    this.t = timeSeconds;
    return this.value;
  }
}

/** Same as QuaternionFilter for unit direction vectors. */
export class DirectionFilter {
  private value: Vector3 | null = null;
  private t: number | null = null;
  private speed = 0;
  private q = new Quaternion();
  private identity = new Quaternion();
  private dir = new Vector3();

  constructor(readonly params: QuatFilterParams) {}

  reset(): void {
    this.value = null;
    this.t = null;
    this.speed = 0;
  }

  get current(): Vector3 | null {
    return this.value;
  }

  filter(target: Vector3, timeSeconds: number): Vector3 {
    const d = this.dir.copy(target).normalize();
    if (this.value === null || this.t === null) {
      this.value = d.clone();
      this.t = timeSeconds;
      return this.value;
    }
    const dt = timeSeconds - this.t;
    if (!(dt > 0) || dt > 1) {
      this.value.copy(d);
      this.t = timeSeconds;
      this.speed = 0;
      return this.value;
    }
    const angle = Math.acos(Math.min(1, Math.max(-1, this.value.dot(d))));
    this.speed += alpha(this.params.dCutoff, dt) * (angle / dt - this.speed);
    let a = alpha(this.params.minCutoff + this.params.beta * Math.abs(this.speed), dt);
    const maxStep = this.params.maxSpeed * dt;
    if (angle * a > maxStep && angle > 1e-9) a = maxStep / angle;
    this.q.setFromUnitVectors(this.value, d);
    this.value.applyQuaternion(this.identity.identity().slerp(this.q, a)).normalize();
    this.t = timeSeconds;
    return this.value;
  }
}

export interface Fit3DSmootherParams {
  position: OneEuroParams;
  logScale: OneEuroParams;
  torso: QuatFilterParams;
  arm: QuatFilterParams;
  /** Missing elbow/wrist: hold the last direction this long (s), then blend to neutral over fadeS. */
  armHoldS: number;
  armFadeS: number;
  /** Outward angle of the neutral hanging arm (radians). */
  neutralArmOutward: number;
}

export function defaultSmootherParams(config: GarmentRigConfig): Fit3DSmootherParams {
  const maxSpeed = (config.limits.maxAngularSpeedDeg * Math.PI) / 180;
  return {
    position: { minCutoff: 1.5, beta: 12, dCutoff: 1 },
    logScale: { minCutoff: 1.0, beta: 1.5, dCutoff: 1 },
    torso: { minCutoff: 1.4, beta: 0.6, dCutoff: 1, maxSpeed },
    arm: { minCutoff: 2.0, beta: 0.8, dCutoff: 1, maxSpeed: maxSpeed * 1.5 },
    armHoldS: 0.3,
    armFadeS: 0.4,
    neutralArmOutward: (12 * Math.PI) / 180,
  };
}

export interface SmoothedFit3D {
  anchor: Point;
  down: Point;
  pxPerMetre: number;
  bodyShoulderM: number;
  pose: BodyPose3D;
  yawDeg: number;
  confidence: number;
  orientation: 'world' | 'image';
  /** Per-side arm tracking state (for diagnostics). */
  armState: SidePair<'tracked' | 'held' | 'neutral'>;
}

interface ArmFilterState {
  upper: DirectionFilter;
  lower: DirectionFilter;
  lastSeen: number | null;
}

export class Fit3DSmoother {
  private cx: OneEuroFilter;
  private cy: OneEuroFilter;
  private logScale: OneEuroFilter;
  private chest: QuaternionFilter;
  private hips: QuaternionFilter;
  private arms: SidePair<ArmFilterState>;
  private torsoLength = 1;
  private lastT: number | null = null;

  constructor(
    private readonly params: Fit3DSmootherParams,
    /** Source frame's longest side, used to normalise positions. */
    private scaleRef = 1000,
  ) {
    this.cx = new OneEuroFilter(params.position);
    this.cy = new OneEuroFilter(params.position);
    this.logScale = new OneEuroFilter(params.logScale);
    this.chest = new QuaternionFilter(params.torso);
    this.hips = new QuaternionFilter(params.torso);
    const arm = (): ArmFilterState => ({
      upper: new DirectionFilter(params.arm),
      lower: new DirectionFilter(params.arm),
      lastSeen: null,
    });
    this.arms = { left: arm(), right: arm() };
  }

  setScaleReference(longSide: number): void {
    if (longSide > 0 && longSide !== this.scaleRef) {
      this.scaleRef = longSide;
      this.reset();
    }
  }

  reset(): void {
    for (const f of [this.cx, this.cy, this.logScale]) f.reset();
    this.chest.reset();
    this.hips.reset();
    for (const side of ['left', 'right'] as const) {
      const a = this.arms[side];
      a.upper.reset();
      a.lower.reset();
      a.lastSeen = null;
    }
    this.torsoLength = 1;
    this.lastT = null;
  }

  /** Neutral hanging arm direction in the (smoothed) chest frame. */
  neutralArm(side: 'left' | 'right', chest: Quaternion): Vector3 {
    const out = this.params.neutralArmOutward;
    const sx = side === 'left' ? 1 : -1;
    return new Vector3(sx * Math.sin(out), -Math.cos(out), 0.04).normalize().applyQuaternion(chest);
  }

  update(target: Fit3DTarget, timeSeconds: number): SmoothedFit3D {
    const s = this.scaleRef;
    const anchor = {
      x: this.cx.filter(target.anchor.x / s, timeSeconds) * s,
      y: this.cy.filter(target.anchor.y / s, timeSeconds) * s,
    };
    const pxPerMetre = Math.exp(this.logScale.filter(Math.log(target.pxPerMetre), timeSeconds));
    const chest = this.chest.filter(target.chest, timeSeconds).clone();
    const hips = this.hips.filter(target.hips, timeSeconds).clone();
    const dt = this.lastT === null ? 0 : clamp(timeSeconds - this.lastT, 0, 0.5);
    this.lastT = timeSeconds;
    // Torso length adapts slowly (it is a learned proportion, not per-frame motion).
    this.torsoLength += (1 - Math.exp(-dt / 0.8)) * (target.torsoLength - this.torsoLength);
    if (dt === 0) this.torsoLength = target.torsoLength;

    const armState = { left: 'neutral', right: 'neutral' } as SmoothedFit3D['armState'];
    const arms = {} as SidePair<ArmTarget>;
    for (const side of ['left', 'right'] as const) {
      const f = this.arms[side];
      const t = target.arms[side];
      const neutral = this.neutralArm(side, chest);
      let upper: Vector3;
      let lower: Vector3;
      if (t.upper) {
        f.lastSeen = timeSeconds;
        upper = f.upper.filter(t.upper, timeSeconds).clone();
        lower = f.lower.filter(t.lower ?? upper, timeSeconds).clone();
        armState[side] = 'tracked';
      } else {
        const age = f.lastSeen === null ? Number.POSITIVE_INFINITY : timeSeconds - f.lastSeen;
        const held = f.upper.current;
        const w = clamp((age - this.params.armHoldS) / this.params.armFadeS, 0, 1);
        if (!held || w >= 1) {
          // Neutral fallback: blend smoothly (the filter bounds the angular speed).
          upper = f.upper.filter(neutral, timeSeconds).clone();
          lower = f.lower.filter(neutral, timeSeconds).clone();
          armState[side] = 'neutral';
        } else {
          upper = slerpDir(held, neutral, w);
          lower = slerpDir(f.lower.current ?? held, neutral, w);
          armState[side] = 'held';
        }
      }
      arms[side] = { upper, lower };
    }

    return {
      anchor,
      down: { ...target.down },
      pxPerMetre,
      bodyShoulderM: target.bodyShoulderM,
      pose: { chest, hips, arms, torsoLength: this.torsoLength },
      yawDeg: target.yawDeg,
      confidence: target.confidence,
      orientation: target.orientation,
      armState,
    };
  }
}

function slerpDir(a: Vector3, b: Vector3, t: number): Vector3 {
  const q = new Quaternion().setFromUnitVectors(a.clone().normalize(), b.clone().normalize());
  return a.clone().normalize().applyQuaternion(new Quaternion().slerp(q, t)).normalize();
}

// ---- Placement --------------------------------------------------------------------------------------

export interface GarmentRootPlacement {
  /** Scene position (px, Y up) of the garment root. */
  position: Vector3;
  /** Uniform px per rest-space metre. */
  scale: number;
  /** Where the garment shoulder anchor lands (source px), for registration checks/diagnostics. */
  anchorPx: Point;
}

/**
 * Root transform so the garment's (retargeted) shoulder anchor lands on the image shoulder
 * midpoint, shifted along the image torso axis by the configured + user offsets.
 */
export function placeGarmentRoot(
  fit: SmoothedFit3D,
  anchorRest: Vector3,
  garment: GarmentRigMetrics,
  config: GarmentRigConfig,
  user: UserFitAdjustment,
): GarmentRootPlacement {
  const facingShoulderPx = fit.pxPerMetre * fit.bodyShoulderM;
  const scale = (facingShoulderPx * config.fit.shoulderWidthScale * user.scale) / garment.shoulderSpan;
  const shift = (config.fit.verticalOffset + user.verticalOffset) * facingShoulderPx;
  const anchorPx = { x: fit.anchor.x + fit.down.x * shift, y: fit.anchor.y + fit.down.y * shift };
  const position = new Vector3(
    anchorPx.x - scale * anchorRest.x,
    -anchorPx.y - scale * anchorRest.y,
    -scale * anchorRest.z,
  );
  return { position, scale, anchorPx };
}
