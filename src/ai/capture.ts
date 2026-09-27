/**
 * Still-image helpers for AI mode. Captures are drawn from the RAW decoded video (or a still photo)
 * into a temporary canvas — never from the stage canvas, which contains garments, landmarks and
 * letterboxing — at the source's native size and orientation, unmirrored. Mirroring is applied once,
 * at display time, to the captured and generated images alike.
 */

export interface CapturedImage {
  blob: Blob;
  width: number;
  height: number;
  source: 'camera' | 'file' | 'photo';
  /** Media time of the captured frame (video sources), for diagnostics. */
  mediaTimeMs: number | null;
}

/** JPEG quality for captured frames (visually lossless; the backend re-encodes anyway). */
export const CAPTURE_JPEG_QUALITY = 0.92;

export function canvasToJpeg(
  canvas: HTMLCanvasElement,
  quality = CAPTURE_JPEG_QUALITY,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));
}

/** Draws the video's current decoded frame at its intrinsic size. Returns null without a frame. */
export async function captureVideoFrame(
  video: HTMLVideoElement,
): Promise<Omit<CapturedImage, 'source'> | null> {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);
  const mediaTimeMs = video.currentTime * 1000;
  const blob = await canvasToJpeg(canvas);
  // Release the backing store immediately.
  canvas.width = 0;
  canvas.height = 0;
  return blob ? { blob, width, height, mediaTimeMs } : null;
}

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export type PhotoErrorKind = 'type' | 'size' | 'read' | 'convert';

/** A developer photo that cannot be used; `kind` picks the translated message. */
export class PhotoError extends Error {
  constructor(
    readonly kind: PhotoErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'PhotoError';
  }
}

/**
 * Loads a user-supplied still photo (developer testing). EXIF orientation is applied by the
 * browser (`imageOrientation: 'from-image'`); re-encoding drops all metadata.
 */
export async function loadPhotoFile(file: File, maxBytes: number): Promise<CapturedImage> {
  if (!PHOTO_TYPES.includes(file.type)) throw new PhotoError('type', 'Choose a JPEG, PNG or WebP photo.');
  if (file.size > maxBytes) throw new PhotoError('size', 'That photo is too large.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoError('read', 'That photo could not be read.');
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new PhotoError('convert', 'Canvas is unavailable.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    const blob = await canvasToJpeg(canvas);
    const { width, height } = canvas;
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new PhotoError('convert', 'That photo could not be converted.');
    return { blob, width, height, source: 'photo', mediaTimeMs: null };
  } finally {
    bitmap.close();
  }
}
