/**
 * Emits one callback per newly presented video frame. Uses requestVideoFrameCallback where
 * available (fires only for new frames, with media-time metadata); otherwise falls back to
 * requestAnimationFrame and reports a frame when currentTime changes.
 */
export interface FrameInfo {
  /** Media time of the frame in milliseconds (file position; stream time for cameras). */
  mediaTimeMs: number;
  /** performance.now() when the frame was handed to us. */
  receivedAt: number;
  /** Frame counter from rVFC (or a local counter for the fallback). */
  presentedFrames: number;
  /** Capture/presentation timestamp (performance.now() domain) when the browser provides one. */
  frameTimestamp: number;
}

export type FrameCallback = (info: FrameInfo) => void;

export function supportsVideoFrameCallback(video: HTMLVideoElement): boolean {
  return typeof video.requestVideoFrameCallback === 'function';
}

export class FrameLoop {
  private rvfcHandle: number | null = null;
  private rafHandle: number | null = null;
  private running = false;
  private lastFallbackTime = -1;
  private fallbackCounter = 0;
  readonly mode: 'rvfc' | 'raf';

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly onFrame: FrameCallback,
  ) {
    this.mode = supportsVideoFrameCallback(video) ? 'rvfc' : 'raf';
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.rvfcHandle !== null) this.video.cancelVideoFrameCallback(this.rvfcHandle);
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.rvfcHandle = null;
    this.rafHandle = null;
  }

  private schedule(): void {
    if (!this.running) return;
    if (this.mode === 'rvfc') {
      this.rvfcHandle = this.video.requestVideoFrameCallback(this.onVideoFrame);
    } else {
      this.rafHandle = requestAnimationFrame(this.onAnimationFrame);
    }
  }

  private onVideoFrame = (now: DOMHighResTimeStamp, meta: VideoFrameCallbackMetadata) => {
    this.rvfcHandle = null;
    if (!this.running) return;
    this.onFrame({
      mediaTimeMs: meta.mediaTime * 1000,
      receivedAt: performance.now(),
      presentedFrames: meta.presentedFrames,
      frameTimestamp: meta.captureTime ?? meta.expectedDisplayTime ?? now,
    });
    this.schedule();
  };

  private onAnimationFrame = (now: DOMHighResTimeStamp) => {
    this.rafHandle = null;
    if (!this.running) return;
    const t = this.video.currentTime;
    if (this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && t !== this.lastFallbackTime) {
      this.lastFallbackTime = t;
      this.fallbackCounter++;
      this.onFrame({
        mediaTimeMs: t * 1000,
        receivedAt: performance.now(),
        presentedFrames: this.fallbackCounter,
        frameTimestamp: now,
      });
    }
    this.schedule();
  };
}
