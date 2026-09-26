import { createVideoElement, type FrameSource, SourceError, waitForFirstFrame } from './frameSource';

/** Preferred capture size; browsers pick the closest supported mode. */
const PREFERRED: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30, max: 60 },
};

export function cameraSupportProblem(): SourceError | null {
  if (!globalThis.isSecureContext) {
    return new SourceError(
      'insecure-context',
      'Camera access needs a secure page: open the app via http://localhost during development, or serve it over HTTPS.',
    );
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return new SourceError(
      'camera-unsupported',
      'This browser does not support camera capture (getUserMedia).',
    );
  }
  return null;
}

export function toCameraError(error: unknown): SourceError {
  if (error instanceof SourceError) return error;
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new SourceError(
        'permission-denied',
        'Camera permission was denied. Allow camera access in the browser’s site settings (the icon left of the address bar), then try again.',
      );
    case 'NotFoundError':
    case 'OverconstrainedError':
      return name === 'NotFoundError'
        ? new SourceError(
            'no-camera',
            'No camera was found. Connect a webcam and try again — video files still work.',
          )
        : new SourceError('constraints', 'The camera does not support the requested settings.');
    case 'NotReadableError':
    case 'AbortError':
      return new SourceError(
        'camera-busy',
        'The camera is in use by another application (or blocked by the system). Close other apps using it and try again.',
      );
    default:
      return new SourceError(
        'unknown',
        `Could not start the camera: ${error instanceof Error ? error.message : String(error)}`,
      );
  }
}

export async function listCameras(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'videoinput');
}

/**
 * Webcam source. Permission is requested only when start() runs (i.e. when the user picks camera
 * mode). Audio is never requested. All tracks are stopped on dispose.
 */
export class CameraSource implements FrameSource {
  readonly kind = 'camera' as const;
  readonly video: HTMLVideoElement;
  label = 'Camera';
  onInterrupted?: (error: SourceError) => void;
  private stream: MediaStream | null = null;
  private disposed = false;

  constructor(private readonly deviceId?: string) {
    this.video = createVideoElement();
  }

  private async open(): Promise<MediaStream> {
    const device = this.deviceId ? { deviceId: { exact: this.deviceId } } : { facingMode: 'user' };
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...PREFERRED, ...device } });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name !== 'OverconstrainedError' && name !== 'NotReadableError') throw error;
      // Fall back to whatever the device offers.
      return navigator.mediaDevices.getUserMedia({
        audio: false,
        video: this.deviceId ? { deviceId: { exact: this.deviceId } } : true,
      });
    }
  }

  async start(): Promise<void> {
    const problem = cameraSupportProblem();
    if (problem) throw problem;
    let stream: MediaStream;
    try {
      stream = await this.open();
    } catch (error) {
      throw toCameraError(error);
    }
    if (this.disposed) {
      for (const track of stream.getTracks()) track.stop();
      throw new SourceError('unknown', 'Source was replaced while starting the camera');
    }
    this.stream = stream;
    const track = stream.getVideoTracks()[0];
    if (track) {
      this.label = track.label || 'Camera';
      track.addEventListener('ended', this.onTrackEnded);
    }
    this.video.srcObject = stream;
    await waitForFirstFrame(this.video, 10000);
    await this.video.play();
  }

  private onTrackEnded = () => {
    if (this.disposed) return;
    this.onInterrupted?.(
      new SourceError(
        'camera-disconnected',
        'The camera stopped (disconnected or taken by another app). Reconnect it and choose Camera again.',
      ),
    );
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.removeEventListener('ended', this.onTrackEnded);
        track.stop();
      }
    }
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    this.video.remove();
  }
}
