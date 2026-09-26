/**
 * One Euro filter (Casiez, Roussel & Vogel, CHI 2012; https://gery.casiez.net/1euro/).
 *
 * A first-order low-pass filter whose cutoff rises with speed: heavy smoothing when still (low
 * jitter), light smoothing when moving (low lag). Time-aware: pass the sample time in seconds, so
 * irregular inference rates are handled correctly.
 */
export interface OneEuroParams {
  /** Cutoff at rest (Hz). Lower = smoother when still, more lag. */
  minCutoff: number;
  /** Speed coefficient. Higher = less lag during fast motion. */
  beta: number;
  /** Cutoff for the derivative estimate (Hz). */
  dCutoff: number;
}

function alpha(cutoffHz: number, dtSeconds: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSeconds);
}

export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;
  private t: number | null = null;

  constructor(public params: OneEuroParams) {}

  reset(): void {
    this.x = null;
    this.dx = 0;
    this.t = null;
  }

  get value(): number | null {
    return this.x;
  }

  filter(value: number, timeSeconds: number): number {
    if (this.x === null || this.t === null) {
      this.x = value;
      this.dx = 0;
      this.t = timeSeconds;
      return value;
    }
    const dt = timeSeconds - this.t;
    // Non-increasing or huge gaps: treat as a fresh start rather than extrapolating stale motion.
    if (!(dt > 0) || dt > 1) {
      this.x = value;
      this.dx = 0;
      this.t = timeSeconds;
      return value;
    }
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.params.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.params.minCutoff + this.params.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    this.t = timeSeconds;
    return this.x;
  }
}

/** Wraps an angle difference into (-π, π]. */
export function wrapAngle(radians: number): number {
  let a = radians % (2 * Math.PI);
  if (a <= -Math.PI) a += 2 * Math.PI;
  if (a > Math.PI) a -= 2 * Math.PI;
  return a;
}

/** One Euro filter for angles: filters an unwrapped angle so ±π crossings do not spin. */
export class AngleOneEuroFilter {
  private inner: OneEuroFilter;
  private unwrapped: number | null = null;

  constructor(params: OneEuroParams) {
    this.inner = new OneEuroFilter(params);
  }

  reset(): void {
    this.inner.reset();
    this.unwrapped = null;
  }

  filter(radians: number, timeSeconds: number): number {
    if (this.unwrapped === null) {
      this.unwrapped = radians;
    } else {
      this.unwrapped += wrapAngle(radians - this.unwrapped);
    }
    return wrapAngle(this.inner.filter(this.unwrapped, timeSeconds));
  }
}
