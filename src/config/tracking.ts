/**
 * Documented thresholds for interpreting MediaPipe pose output.
 *
 * All values are heuristics tuned on the test clips listed in docs/TESTING.md. They are not
 * calibrated measurements. Times are milliseconds of *frame* time (not wall time), so a paused or
 * slowed video behaves consistently.
 */
export interface TrackingConfig {
  /** Landmark visibility needed to *start* trusting a shoulder (enter threshold). */
  shoulderEnterVisibility: number;
  /** Landmark visibility needed to *keep* trusting a shoulder once tracking (exit threshold, hysteresis). */
  shoulderStayVisibility: number;
  /** Hip visibility to switch into full-torso mode. */
  hipEnterVisibility: number;
  /** Hip visibility to stay in full-torso mode. */
  hipStayVisibility: number;
  /** Visibility for a head landmark (nose/eyes) to count as "person present". */
  headVisibility: number;
  /** Normalized margin outside the image in which a shoulder may still be trusted. */
  shoulderBoundsMargin: number;
  /** Hips must be at least this far inside the bottom edge (normalized) to be used as anchors.
   * MediaPipe often places off-screen hips just inside the edge with high visibility. */
  hipBottomInset: number;

  /** A new phase must persist this long before it becomes the displayed phase. */
  phaseDwellMs: number;
  /** …and be observed in at least this many consecutive results. */
  phaseDwellObservations: number;
  /** How long a lost shoulder may be bridged from recent tracking before fading out. */
  holdMs: number;
  /** A gap in usable results longer than this resets smoothing/history on reacquisition. */
  reacquireResetMs: number;
  /** A jump of the shoulder centre by more than this many shoulder widths is treated as a new subject. */
  reacquireJumpWidths: number;

  /** Default torso length / shoulder width ratio before any full-torso frame has been seen. */
  defaultTorsoRatio: number;
  /** Allowed range for the torso ratio (clamps implausible hip estimates). */
  torsoRatioMin: number;
  torsoRatioMax: number;
  /** Time constant for learning the subject's torso ratio from reliable full-torso frames. */
  torsoRatioTauMs: number;

  /** Shoulder line tilt beyond which the geometry is treated as implausible (degrees). */
  maxShoulderTiltDeg: number;
  /** Weight on MediaPipe's shoulder depth difference in the yaw estimate (z is noisy). */
  depthYawWeight: number;
  /** Yaw (degrees, estimated) at which the garment starts to fade. */
  yawFadeStartDeg: number;
  /** Yaw at which the garment is hidden and the user is asked to face the mirror. */
  yawHideDeg: number;
  /** Shoulder width relative to recent front-facing width below which we treat the pose as turned. */
  turnedWidthRatio: number;
  /** Time constant with which the front-facing reference width relaxes toward the current width
   * while not front-facing (prevents getting stuck after a distance change). */
  refWidthRelaxMs: number;
  /** Mean face-landmark visibility required to treat the pose as front-facing. */
  minFaceVisibility: number;
  /** The nose must be at least this many shoulder widths above the shoulder line (else: bent over). */
  minHeadAboveShoulders: number;
  /** Shoulder width as a fraction of frame width above which we ask the user to move back. */
  tooCloseShoulderFraction: number;
  /** Minimum shoulder width in pixels of the processed frame (tiny = too far / false detection). */
  minShoulderWidthPx: number;

  /** Results older than this (frame time vs displayed frame) are not drawn. */
  maxPoseAgeMs: number;
}

export const TRACKING_CONFIG: TrackingConfig = {
  shoulderEnterVisibility: 0.6,
  shoulderStayVisibility: 0.4,
  hipEnterVisibility: 0.65,
  hipStayVisibility: 0.45,
  headVisibility: 0.5,
  shoulderBoundsMargin: 0.02,
  hipBottomInset: 0.05,

  phaseDwellMs: 120,
  phaseDwellObservations: 2,
  holdMs: 350,
  reacquireResetMs: 600,
  reacquireJumpWidths: 1.2,

  defaultTorsoRatio: 1.35,
  torsoRatioMin: 0.9,
  torsoRatioMax: 2.0,
  torsoRatioTauMs: 800,

  maxShoulderTiltDeg: 40,
  depthYawWeight: 1,
  yawFadeStartDeg: 40,
  yawHideDeg: 65,
  turnedWidthRatio: 0.5,
  refWidthRelaxMs: 1200,
  minHeadAboveShoulders: 0.15,
  minFaceVisibility: 0.6,
  tooCloseShoulderFraction: 0.72,
  minShoulderWidthPx: 12,

  maxPoseAgeMs: 250,
};
