/**
 * Tracking interpretation: turns per-frame pose observations into a torso estimate plus an
 * explicit, hysteresis-damped tracking phase. Pure logic (no DOM, no timers): time is the frame
 * time passed in, so it is deterministic and unit-testable.
 *
 * | Condition                                   | Phase        | Garment                          |
 * |---------------------------------------------|--------------|----------------------------------|
 * | Both shoulders + both hips reliable         | full         | shoulders + hips geometry        |
 * | Both shoulders, hips unavailable            | upper        | shoulder width × learned ratio   |
 * | One shoulder / all briefly unreliable       | holding      | bounded bridge, then fade        |
 * | Face visible, shoulders out of the image    | too-close    | hidden, "move back"              |
 * | Strong side/back view or implausible pose   | turned       | faded / hidden                   |
 * | Nobody (never tracked / after tracking)     | searching/lost | hidden                         |
 */
import type { TrackingConfig } from '../config/tracking';
import { distance, midpoint, type Point } from '../rendering/matrix';
import { LM } from '../tracking/landmarks';
import {
  headVisible,
  hipUsable,
  isInFrame,
  lm,
  type ObservedLandmark,
  type PoseObservation,
  shoulderUsable,
} from './observation';
import { wrapAngle } from './oneEuro';
import { type SubjectMemory, selectSubject } from './subject';

export type TrackingPhase = 'searching' | 'full' | 'upper' | 'holding' | 'turned' | 'too-close' | 'lost';

/** Phases in which a garment may be drawn (when a torso estimate exists). */
export const DRAWABLE_PHASES: ReadonlySet<TrackingPhase> = new Set(['full', 'upper', 'holding', 'too-close']);

export interface ArmEstimate {
  shoulder: Point;
  elbow: Point | null;
  wrist: Point | null;
  /** True when the forearm is estimated to be in front of the torso (closer to the camera). */
  forearmInFront: boolean;
}

export interface TorsoEstimate {
  /** Subject's anatomical left/right shoulders in source pixels (possibly bridged). */
  leftShoulder: Point;
  rightShoulder: Point;
  center: Point;
  shoulderWidth: number;
  /** Direction of the right→left shoulder vector; 0 = upright, facing the camera, unmirrored. */
  angle: number;
  /** Shoulder-midpoint → hem-reference length in source pixels (approximate, not a measurement). */
  torsoLength: number;
  source: 'full' | 'upper' | 'bridged';
  /** 0..1 multiplier for partially turned poses. */
  confidence: number;
  yawDeg: number;
  arms: { left: ArmEstimate | null; right: ArmEstimate | null };
}

export interface InterpretationDiagnostics {
  rawPhase: TrackingPhase;
  personCount: number;
  shoulderVisibility: [number, number];
  hipVisibility: [number, number];
  yawDeg: number | null;
  /** Individual yaw cues (degrees): shoulder depth difference, and width vs. recent front width. */
  yawFromDepthDeg: number | null;
  yawFromWidthDeg: number | null;
  torsoRatio: number;
  learnedRatio: boolean;
  /** Why the pose was rejected as "turned" (for diagnostics). */
  limitReason: LimitReason | null;
  /** Measured shoulder→hip length ÷ shoulder width this frame, when hips were usable. */
  measuredRatio: number | null;
  /** Mean visibility of nose, eyes and mouth corners (facing-the-camera cue). */
  faceVisibility: number | null;
}

export interface Interpretation {
  /** Displayed phase (after hysteresis). */
  phase: TrackingPhase;
  /** Geometry to draw, or null when nothing should be drawn. */
  torso: TorsoEstimate | null;
  /** Opacity the renderer should ease toward (0..1). */
  targetOpacity: number;
  /** True when smoothing/history must restart (new subject, reacquisition, discontinuity). */
  resetFilters: boolean;
  subjectIndex: number | null;
  diagnostics: InterpretationDiagnostics;
}

export type LimitReason = 'back-view' | 'tilt' | 'yaw' | 'narrow' | 'head-low' | 'foreshortened';

interface RawAssessment {
  phase: TrackingPhase;
  torso: TorsoEstimate | null;
  reason?: LimitReason;
}

export class TrackingInterpreter {
  private displayed: TrackingPhase = 'searching';
  private candidate: { phase: TrackingPhase; sinceMs: number; count: number } | null = null;
  private everTracked = false;
  private lastTorso: TorsoEstimate | null = null;
  private lastTorsoMs = Number.NEGATIVE_INFINITY;
  private lastShoulderVector: { v: Point; timeMs: number } | null = null;
  private holdStartMs: number | null = null;
  private torsoRatio: number;
  private ratioLearned = false;
  private lastRatioMs: number | null = null;
  private refWidth: number | null = null;
  private lastRefMs: number | null = null;
  private subjectMemory: SubjectMemory | null = null;
  private lastTimeMs: number | null = null;
  private pendingReset = true;
  private cues: { depth: number | null; width: number | null } = { depth: null, width: null };
  private measuredRatio: number | null = null;
  private faceVisibility: number | null = null;

  constructor(private readonly config: TrackingConfig) {
    this.torsoRatio = config.defaultTorsoRatio;
  }

  /** Forget everything (seek, loop, source change, model change). */
  reset(): void {
    this.displayed = 'searching';
    this.candidate = null;
    this.everTracked = false;
    this.clearSubjectHistory();
    this.lastTimeMs = null;
  }

  private clearSubjectHistory(): void {
    this.lastTorso = null;
    this.lastTorsoMs = Number.NEGATIVE_INFINITY;
    this.lastShoulderVector = null;
    this.holdStartMs = null;
    this.torsoRatio = this.config.defaultTorsoRatio;
    this.ratioLearned = false;
    this.lastRatioMs = null;
    this.refWidth = null;
    this.lastRefMs = null;
    this.subjectMemory = null;
    this.pendingReset = true;
  }

  get phase(): TrackingPhase {
    return this.displayed;
  }

  /**
   * @param observations all poses in this frame (source pixels)
   * @param timeMs frame time (monotonic within one continuous playback segment)
   * @param still true for a paused/single frame: apply the result immediately without dwell
   */
  update(observations: readonly PoseObservation[], timeMs: number, still = false): Interpretation {
    const cfg = this.config;
    if (this.lastTimeMs !== null && timeMs < this.lastTimeMs) {
      // Time went backwards without an explicit reset: treat as a discontinuity.
      this.reset();
    }
    this.lastTimeMs = timeMs;

    const subjectIndex = selectSubject(observations, this.subjectMemory, timeMs);
    const obs = subjectIndex === null ? null : (observations[subjectIndex] ?? null);
    const raw = this.assess(obs, timeMs);

    // ---- Bounded hold: bridge short gaps using the last torso, then fade. ---------------------
    let rawPhase = raw.phase;
    let torso = raw.torso;
    const drawableRaw = torso !== null;
    const wasDrawing = DRAWABLE_PHASES.has(this.displayed) && this.lastTorso !== null;
    if (!drawableRaw && wasDrawing && rawPhase !== 'too-close' && rawPhase !== 'turned') {
      this.holdStartMs ??= timeMs;
      if (timeMs - this.holdStartMs <= cfg.holdMs && this.lastTorso) {
        rawPhase = 'holding';
        torso = { ...this.lastTorso, source: 'bridged' };
      }
    } else if (drawableRaw && rawPhase !== 'holding') {
      this.holdStartMs = null;
    }
    if (!torso && (rawPhase === 'searching' || rawPhase === 'lost')) {
      rawPhase = this.everTracked ? 'lost' : 'searching';
    }

    // ---- Hysteresis on the displayed phase. ------------------------------------------------------
    this.applyDwell(rawPhase, timeMs, still);
    const phase = this.displayed;
    const drawNow = DRAWABLE_PHASES.has(phase) && torso !== null;

    // ---- Reacquisition: restart smoothing instead of gliding from an old location. -------------
    let resetFilters = false;
    if (drawNow && torso) {
      const gap = timeMs - this.lastTorsoMs;
      const jumped =
        this.lastTorso !== null &&
        distance(this.lastTorso.center, torso.center) >
          cfg.reacquireJumpWidths * this.lastTorso.shoulderWidth;
      resetFilters = this.pendingReset || gap > cfg.reacquireResetMs || jumped;
      if (resetFilters) {
        // Distance may have changed while we were not tracking.
        this.refWidth = null;
        this.lastRefMs = null;
      }
      if (jumped || gap > cfg.reacquireResetMs * 4) {
        // Probably a different person or a long absence: forget learned proportions.
        this.torsoRatio = cfg.defaultTorsoRatio;
        this.ratioLearned = false;
        this.lastRatioMs = null;
      }
      this.pendingReset = false;
      this.everTracked = true;
      if (torso.source !== 'bridged') {
        this.lastTorso = torso;
        this.lastTorsoMs = timeMs;
        this.subjectMemory = { center: torso.center, width: torso.shoulderWidth, timeMs };
      }
    } else if (!drawNow && !DRAWABLE_PHASES.has(phase) && phase !== 'holding') {
      if (timeMs - this.lastTorsoMs > cfg.reacquireResetMs && !this.pendingReset) {
        // Lost long enough: the next detection is a fresh acquisition (maybe at another distance).
        this.pendingReset = true;
        this.refWidth = null;
        this.lastRefMs = null;
        this.lastShoulderVector = null;
      }
    }

    let targetOpacity = 0;
    if (drawNow && torso) {
      targetOpacity = torso.confidence;
      if (phase === 'holding' && this.holdStartMs !== null) {
        const elapsed = timeMs - this.holdStartMs;
        targetOpacity *= Math.max(0, 1 - elapsed / cfg.holdMs);
      }
    }

    const ls = obs ? lm(obs, LM.leftShoulder) : null;
    const rs = obs ? lm(obs, LM.rightShoulder) : null;
    const lh = obs ? lm(obs, LM.leftHip) : null;
    const rh = obs ? lm(obs, LM.rightHip) : null;
    return {
      phase,
      torso: drawNow ? torso : null,
      targetOpacity,
      resetFilters,
      subjectIndex,
      diagnostics: {
        rawPhase,
        personCount: observations.length,
        shoulderVisibility: [ls?.visibility ?? 0, rs?.visibility ?? 0],
        hipVisibility: [lh?.visibility ?? 0, rh?.visibility ?? 0],
        yawDeg: raw.torso?.yawDeg ?? null,
        yawFromDepthDeg: this.cues.depth,
        yawFromWidthDeg: this.cues.width,
        torsoRatio: this.torsoRatio,
        learnedRatio: this.ratioLearned,
        limitReason: raw.reason ?? null,
        measuredRatio: this.measuredRatio,
        faceVisibility: this.faceVisibility,
      },
    };
  }

  private applyDwell(rawPhase: TrackingPhase, timeMs: number, still: boolean): void {
    if (rawPhase === this.displayed) {
      this.candidate = null;
      return;
    }
    // Holding is itself the short-gap bridge, so enter it immediately.
    const immediate = still || rawPhase === 'holding';
    if (immediate) {
      this.displayed = rawPhase;
      this.candidate = null;
      return;
    }
    if (!this.candidate || this.candidate.phase !== rawPhase) {
      this.candidate = { phase: rawPhase, sinceMs: timeMs, count: 1 };
    } else {
      this.candidate.count++;
    }
    const { sinceMs, count } = this.candidate;
    if (timeMs - sinceMs >= this.config.phaseDwellMs && count >= this.config.phaseDwellObservations) {
      this.displayed = rawPhase;
      this.candidate = null;
    } else if (this.displayed === 'holding' && !DRAWABLE_PHASES.has(rawPhase)) {
      // The hold expired: leave it at once rather than holding a stale garment longer.
      this.displayed = rawPhase;
      this.candidate = null;
    }
  }

  private assess(obs: PoseObservation | null, timeMs: number): RawAssessment {
    const cfg = this.config;
    this.cues = { depth: null, width: null };
    this.measuredRatio = null;
    this.faceVisibility = null;
    if (!obs) return { phase: this.everTracked ? 'lost' : 'searching', torso: null };

    const tracking = DRAWABLE_PHASES.has(this.displayed);
    const shoulderThreshold = tracking ? cfg.shoulderStayVisibility : cfg.shoulderEnterVisibility;
    const lOk = shoulderUsable(obs, LM.leftShoulder, shoulderThreshold, cfg);
    const rOk = shoulderUsable(obs, LM.rightShoulder, shoulderThreshold, cfg);
    let left: ObservedLandmark | Point = lm(obs, LM.leftShoulder);
    let right: ObservedLandmark | Point = lm(obs, LM.rightShoulder);
    let source: TorsoEstimate['source'] = 'upper';

    if (!lOk || !rOk) {
      const head = headVisible(obs, cfg);
      const lRaw = lm(obs, LM.leftShoulder);
      const rRaw = lm(obs, LM.rightShoulder);
      const offFrame =
        !isInFrame(obs, lRaw, cfg.shoulderBoundsMargin) || !isInFrame(obs, rRaw, cfg.shoulderBoundsMargin);
      // One shoulder briefly unreliable: bridge it from the recent shoulder vector.
      const recentVector =
        this.lastShoulderVector && timeMs - this.lastShoulderVector.timeMs <= cfg.holdMs
          ? this.lastShoulderVector.v
          : null;
      if ((lOk || rOk) && recentVector && tracking) {
        if (lOk) right = { x: lRaw.x - recentVector.x, y: lRaw.y - recentVector.y };
        else left = { x: rRaw.x + recentVector.x, y: rRaw.y + recentVector.y };
        source = 'bridged';
      } else if (head && offFrame) {
        return { phase: 'too-close', torso: null };
      } else {
        return { phase: this.everTracked ? 'lost' : 'searching', torso: null };
      }
    }

    const shoulderWidth = distance(left, right);
    if (!(shoulderWidth >= cfg.minShoulderWidthPx)) {
      return { phase: this.everTracked ? 'lost' : 'searching', torso: null };
    }
    const angle = Math.atan2(left.y - right.y, left.x - right.x);
    const tiltDeg = (Math.abs(wrapAngle(angle)) * 180) / Math.PI;
    const center = midpoint(left, right);

    // Yaw cue 1: depth difference between shoulders (MediaPipe z, approximate).
    const lz = lm(obs, LM.leftShoulder).z;
    const rz = lm(obs, LM.rightShoulder).z;
    const dz = source === 'bridged' ? 0 : lz - rz;
    const depthYaw = (Math.atan2(Math.abs(dz) * cfg.depthYawWeight, shoulderWidth) * 180) / Math.PI;
    // Yaw cue 2: shoulders much narrower than recently seen while facing the camera.
    const widthYaw =
      this.refWidth !== null
        ? (Math.acos(Math.max(0, Math.min(1, shoulderWidth / this.refWidth))) * 180) / Math.PI
        : 0;
    this.cues = { depth: depthYaw, width: widthYaw };
    const yawDeg = Math.max(depthYaw, widthYaw);
    if (tiltDeg > 90) {
      // Right→left vector points the wrong way: back view (or swapped labels). A front garment
      // image cannot represent this honestly.
      return { phase: 'turned', torso: null, reason: 'back-view' };
    }
    if (tiltDeg > cfg.maxShoulderTiltDeg) return { phase: 'turned', torso: null, reason: 'tilt' };
    if (yawDeg >= cfg.yawHideDeg) return { phase: 'turned', torso: null, reason: 'yaw' };
    if (this.refWidth !== null && shoulderWidth < this.refWidth * cfg.turnedWidthRatio) {
      return { phase: 'turned', torso: null, reason: 'narrow' };
    }

    // Facing cue: when seen from behind, MediaPipe may still order the shoulders as if facing the
    // camera, but its face landmarks lose visibility. A face above the frame means "too close".
    const face = [LM.nose, LM.leftEye, LM.rightEye, LM.mouthLeft, LM.mouthRight].map((i) => lm(obs, i));
    const faceVisibility = face.reduce((sum, p) => sum + p.visibility, 0) / face.length;
    this.faceVisibility = faceVisibility;
    if (faceVisibility < cfg.minFaceVisibility) {
      const faceAbove = face.every((p) => Number.isFinite(p.y) && p.y < 0);
      return faceAbove
        ? { phase: 'too-close', torso: null }
        : { phase: 'turned', torso: null, reason: 'back-view' };
    }

    // Head at or below the shoulder line: bending over / lying down — not a pose a front-view
    // shirt can follow.
    const nose = lm(obs, LM.nose);
    if (nose.visibility >= cfg.headVisibility && isInFrame(obs, nose)) {
      const down = { x: -Math.sin(angle), y: Math.cos(angle) };
      const noseDown = ((nose.x - center.x) * down.x + (nose.y - center.y) * down.y) / shoulderWidth;
      if (noseDown > -cfg.minHeadAboveShoulders) return { phase: 'turned', torso: null, reason: 'head-low' };
    }

    if (source !== 'bridged') {
      this.lastShoulderVector = { v: { x: left.x - right.x, y: left.y - right.y }, timeMs };
      if (this.refWidth === null) {
        this.refWidth = shoulderWidth;
      } else {
        // Follow quickly while facing the camera; otherwise relax slowly so a changed distance can
        // never leave us stuck in "turned".
        const dt = this.lastRefMs === null ? 33 : Math.min(200, Math.max(0, timeMs - this.lastRefMs));
        const tau = yawDeg < 20 ? 90 : cfg.refWidthRelaxMs;
        this.refWidth += (1 - Math.exp(-dt / tau)) * (shoulderWidth - this.refWidth);
      }
      this.lastRefMs = timeMs;
    }

    const tooClose = shoulderWidth > cfg.tooCloseShoulderFraction * obs.width;
    const lengthBasis = Math.max(shoulderWidth, (this.refWidth ?? shoulderWidth) * 0.9);
    let torsoLength = lengthBasis * this.torsoRatio;
    let rotation = angle;

    const hipThreshold = this.displayed === 'full' ? cfg.hipStayVisibility : cfg.hipEnterVisibility;
    const hipsOk =
      source !== 'bridged' &&
      hipUsable(obs, LM.leftHip, hipThreshold, cfg) &&
      hipUsable(obs, LM.rightHip, hipThreshold, cfg);
    if (hipsOk) {
      const hipMid = midpoint(lm(obs, LM.leftHip), lm(obs, LM.rightHip));
      const measured = distance(center, hipMid);
      const ratio = measured / lengthBasis;
      this.measuredRatio = ratio;
      if (ratio < cfg.torsoRatioMin || ratio > cfg.torsoRatioMax) {
        // Hips are visible but the torso is strongly foreshortened (bending toward/away from the
        // camera) or the estimate is implausible. Do NOT fall back to upper-body mode here: that
        // would draw a full-length shirt over a bent body.
        return { phase: 'turned', torso: null, reason: 'foreshortened' };
      }
      {
        source = 'full';
        torsoLength = measured;
        // Blend the shoulder line with the torso axis: steadier than shoulders alone (shrugs).
        const axisAngle = Math.atan2(hipMid.y - center.y, hipMid.x - center.x) - Math.PI / 2;
        rotation = angle + 0.5 * wrapAngle(axisAngle - angle);
        if (yawDeg < 25) {
          const dt = this.lastRatioMs === null ? 33 : Math.min(200, Math.max(0, timeMs - this.lastRatioMs));
          this.lastRatioMs = timeMs;
          const k = this.ratioLearned ? 1 - Math.exp(-dt / cfg.torsoRatioTauMs) : 1;
          this.torsoRatio += k * (ratio - this.torsoRatio);
          this.ratioLearned = true;
        }
      }
    }

    const confidence =
      yawDeg <= cfg.yawFadeStartDeg
        ? 1
        : Math.max(0, 1 - (yawDeg - cfg.yawFadeStartDeg) / (cfg.yawHideDeg - cfg.yawFadeStartDeg));

    const torso: TorsoEstimate = {
      leftShoulder: { x: left.x, y: left.y },
      rightShoulder: { x: right.x, y: right.y },
      center,
      shoulderWidth,
      angle: rotation,
      torsoLength,
      source,
      confidence,
      yawDeg,
      arms: {
        left: this.arm(obs, LM.leftShoulder, LM.leftElbow, LM.leftWrist, left, shoulderWidth),
        right: this.arm(obs, LM.rightShoulder, LM.rightElbow, LM.rightWrist, right, shoulderWidth),
      },
    };
    // Too close still draws (both shoulders are known) but asks the user to step back.
    const phase: TrackingPhase = tooClose ? 'too-close' : source === 'full' ? 'full' : 'upper';
    return { phase, torso };
  }

  private arm(
    obs: PoseObservation,
    shoulderIndex: number,
    elbowIndex: number,
    wristIndex: number,
    shoulder: Point,
    shoulderWidth: number,
  ): ArmEstimate {
    const elbowLm = lm(obs, elbowIndex);
    const wristLm = lm(obs, wristIndex);
    const elbow = elbowLm.visibility >= 0.5 && isInFrame(obs, elbowLm, 0.05) ? elbowLm : null;
    const wrist = wristLm.visibility >= 0.5 && isInFrame(obs, wristLm, 0.05) ? wristLm : null;
    const shoulderZ = lm(obs, shoulderIndex).z;
    const forearmInFront =
      elbow !== null &&
      wrist !== null &&
      wrist.z < shoulderZ - 0.1 * shoulderWidth &&
      wristLm.visibility >= 0.7;
    return {
      shoulder,
      elbow: elbow ? { x: elbow.x, y: elbow.y } : null,
      wrist: wrist ? { x: wrist.x, y: wrist.y } : null,
      forearmInFront,
    };
  }
}
