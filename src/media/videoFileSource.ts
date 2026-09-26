import { createVideoElement, type FrameSource, SourceError, waitForFirstFrame } from './frameSource';

/**
 * Plays a local file through an object URL. Nothing is uploaded; the URL is revoked on dispose.
 */
export class VideoFileSource implements FrameSource {
  readonly kind = 'file' as const;
  readonly label: string;
  readonly video: HTMLVideoElement;
  private url: string | null;
  private disposed = false;

  constructor(private readonly file: File) {
    this.label = file.name;
    this.video = createVideoElement();
    this.url = URL.createObjectURL(file);
  }

  async start(): Promise<void> {
    if (this.file.type && !this.file.type.startsWith('video/')) {
      throw new SourceError(
        'unsupported-file',
        `“${this.file.name}” does not look like a video file (${this.file.type}).`,
      );
    }
    // canPlayType is only a hint ("maybe"/"probably"); the real check is decoding the first frame.
    if (this.file.type && this.video.canPlayType(this.file.type) === '') {
      throw new SourceError(
        'unsupported-file',
        `This browser reports it cannot play ${this.file.type} files. Try an MP4 (H.264) or WebM (VP8/VP9) video.`,
      );
    }
    if (!this.url) throw new SourceError('unknown', 'Source was disposed');
    this.video.src = this.url;
    this.video.load();
    await waitForFirstFrame(this.video, 20000);
    if (this.disposed) throw new SourceError('unknown', 'Source was replaced while loading');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.video.remove();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }
}
