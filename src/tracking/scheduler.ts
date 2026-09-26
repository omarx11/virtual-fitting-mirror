/**
 * Inference scheduling with backpressure:
 * - at most ONE inference in flight; frames arriving meanwhile replace a single "latest" slot
 *   (superseded frames are dropped, never queued);
 * - every frame carries the source *generation*; bumping the generation (seek, loop, source or
 *   model change) makes late results from the old timeline stale, and they are discarded;
 * - after a generation bump nothing new is submitted until the backend's tracking reset finishes.
 */
import type { DetectOutput } from './protocol';

export interface FrameTicket {
  generation: number;
  /** Unique, increasing per offered frame. */
  key: number;
  /** Frame time used for interpretation/smoothing (ms). */
  frameTimeMs: number;
  /** performance.now() when the frame was presented to us (latency reference). */
  receivedAt: number;
  sourceWidth: number;
  sourceHeight: number;
}

export interface SchedulerBackend {
  detect(frame: ImageBitmap, timestampMs: number): Promise<DetectOutput>;
  reset(): Promise<void>;
}

export interface SchedulerDeps {
  backend: SchedulerBackend;
  /** Captures the current frame for inference, or null if not capturable right now. */
  capture: (ticket: FrameTicket) => Promise<ImageBitmap | null>;
  onResult: (ticket: FrameTicket, output: DetectOutput) => void;
  onError: (ticket: FrameTicket, error: unknown) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface SchedulerStats {
  offered: number;
  submitted: number;
  completed: number;
  /** Frames replaced by a newer frame before they could be submitted. */
  superseded: number;
  /** Results that arrived for an old generation and were discarded. */
  stale: number;
  errors: number;
}

export class InferenceScheduler {
  private _generation = 0;
  private nextKey = 1;
  private inFlight: FrameTicket | null = null;
  private latest: FrameTicket | null = null;
  private lastSubmittedKey = 0;
  private lastSubmitAt = Number.NEGATIVE_INFINITY;
  private resetting: Promise<void> | null = null;
  private timer: unknown = null;
  private paused = false;
  private disposed = false;
  minIntervalMs = 0;
  readonly stats: SchedulerStats = {
    offered: 0,
    submitted: 0,
    completed: 0,
    superseded: 0,
    stale: 0,
    errors: 0,
  };

  constructor(private readonly deps: SchedulerDeps) {}

  get generation(): number {
    return this._generation;
  }

  get busy(): boolean {
    return this.inFlight !== null;
  }

  private now(): number {
    return (this.deps.now ?? (() => performance.now()))();
  }

  /** Offer the newest presented frame. Returns the ticket that was created. */
  offer(frame: Omit<FrameTicket, 'generation' | 'key'>): FrameTicket {
    const ticket: FrameTicket = { ...frame, generation: this._generation, key: this.nextKey++ };
    this.stats.offered++;
    if (this.latest && this.latest.key !== this.lastSubmittedKey) this.stats.superseded++;
    this.latest = ticket;
    this.pump();
    return ticket;
  }

  /**
   * Starts a new timeline: late results from the old one are ignored, the pending frame is
   * dropped, and the backend's temporal tracking is reset before the next submission.
   */
  newGeneration(): number {
    this._generation++;
    this.latest = null;
    const reset = this.deps.backend
      .reset()
      .catch(() => undefined)
      .finally(() => {
        if (this.resetting === reset) this.resetting = null;
        this.pump();
      });
    this.resetting = reset;
    return this._generation;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused) this.pump();
  }

  dispose(): void {
    this.disposed = true;
    this.latest = null;
    if (this.timer !== null)
      (this.deps.clearTimer ?? clearTimeout)(this.timer as ReturnType<typeof setTimeout>);
    this.timer = null;
  }

  pump(): void {
    if (this.disposed || this.paused || this.inFlight || this.resetting) return;
    const ticket = this.latest;
    if (!ticket || ticket.key === this.lastSubmittedKey || ticket.generation !== this._generation) return;
    const wait = this.lastSubmitAt + this.minIntervalMs - this.now();
    if (wait > 0) {
      if (this.timer === null) {
        this.timer = (this.deps.setTimer ?? setTimeout)(() => {
          this.timer = null;
          this.pump();
        }, wait);
      }
      return;
    }
    this.submit(ticket);
  }

  private submit(ticket: FrameTicket): void {
    this.inFlight = ticket;
    this.lastSubmittedKey = ticket.key;
    this.lastSubmitAt = this.now();
    this.stats.submitted++;
    void (async () => {
      try {
        const frame = await this.deps.capture(ticket);
        if (!frame) return;
        if (this.disposed) {
          frame.close();
          return;
        }
        // Timestamps only need to be monotonic for MediaPipe; the engine enforces +1 ms steps.
        const output = await this.deps.backend.detect(frame, this.now());
        if (ticket.generation !== this._generation || this.disposed) {
          this.stats.stale++;
          return;
        }
        this.stats.completed++;
        this.deps.onResult(ticket, output);
      } catch (error) {
        this.stats.errors++;
        if (ticket.generation === this._generation && !this.disposed) this.deps.onError(ticket, error);
      } finally {
        this.inFlight = null;
        this.pump();
      }
    })();
  }
}
