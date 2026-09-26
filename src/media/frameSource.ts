/**
 * Common source abstraction: both a local video file and a webcam are exposed as an
 * HTMLVideoElement plus lifecycle, so the tracker and renderer never care which one is active.
 */
export type SourceKind = 'file' | 'camera';

export type SourceErrorKind =
  | 'unsupported-file'
  | 'decode'
  | 'no-video-track'
  | 'timeout'
  | 'insecure-context'
  | 'camera-unsupported'
  | 'permission-denied'
  | 'no-camera'
  | 'camera-busy'
  | 'constraints'
  | 'camera-disconnected'
  | 'unknown';

export class SourceError extends Error {
  constructor(
    readonly kind: SourceErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'SourceError';
  }
}

export interface FrameSource {
  readonly kind: SourceKind;
  readonly label: string;
  readonly video: HTMLVideoElement;
  /** Resolves once the first frame is decodable (dimensions known), or rejects with SourceError. */
  start(): Promise<void>;
  /** Releases the object URL / camera tracks and detaches the element. Idempotent. */
  dispose(): void;
  /** Called if the source stops unexpectedly (e.g. camera unplugged). */
  onInterrupted?: (error: SourceError) => void;
}

/** A hidden, inline, muted video element that stays in the DOM so frame callbacks keep firing. */
export function createVideoElement(): HTMLVideoElement {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('aria-hidden', 'true');
  video.tabIndex = -1;
  Object.assign(video.style, {
    position: 'fixed',
    width: '1px',
    height: '1px',
    opacity: '0',
    pointerEvents: 'none',
    left: '0',
    top: '0',
  });
  document.body.appendChild(video);
  return video;
}

export function waitForFirstFrame(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
      resolve();
      return;
    }
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('error', onError);
    };
    const onLoaded = () => {
      cleanup();
      if (video.videoWidth > 0 && video.videoHeight > 0) resolve();
      else reject(new SourceError('no-video-track', 'This file has no video track the browser can display.'));
    };
    const onError = () => {
      cleanup();
      reject(mediaErrorToSourceError(video.error));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new SourceError(
          'timeout',
          'The video took too long to load. It may be corrupt or use an unsupported codec.',
        ),
      );
    }, timeoutMs);
    video.addEventListener('loadeddata', onLoaded);
    video.addEventListener('error', onError);
  });
}

export function mediaErrorToSourceError(error: MediaError | null): SourceError {
  switch (error?.code) {
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return new SourceError(
        'unsupported-file',
        'This browser cannot play this file’s format or codec. Try an MP4 (H.264) or WebM (VP8/VP9) video, ' +
          'or re-encode it (e.g. with HandBrake or ffmpeg).',
      );
    case MediaError.MEDIA_ERR_DECODE:
      return new SourceError(
        'decode',
        'The video could not be decoded. The file may be damaged or use an unsupported codec.',
      );
    default:
      return new SourceError('unknown', error?.message || 'The video could not be loaded.');
  }
}
