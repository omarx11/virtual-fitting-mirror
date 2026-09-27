/**
 * Still-image helpers for AI mode. Captures are drawn from the RAW decoded video (or a still photo)
 * into a temporary canvas — never from the stage canvas, which contains garments, landmarks and
 * letterboxing — in the source's orientation, unmirrored. Mirroring is applied once, at display
 * time, to the captured and generated images alike.
 *
 * Images larger than CAPTURE_LONG_SIDE are downscaled here, before upload: the server would reduce
 * them to that size anyway (AI_UPLOAD_LONG_SIDE), so sending more pixels only costs upload time
 * and stays further from Vercel's 4.5 MB request limit.
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
/** Longest side sent to the server; matches its default AI_UPLOAD_LONG_SIDE (server/config.ts). */
export const CAPTURE_LONG_SIDE = 2048;
/** Largest photo file read at all (developer uploads); it is downscaled before upload. */
const MAX_PHOTO_FILE_BYTES = 40 * 1024 * 1024;

/** The size an image is drawn at: its own, or scaled down to fit `longSide` (never enlarged). */
export function fitWithin(width: number, height: number, longSide = CAPTURE_LONG_SIDE) {
  const scale = Math.min(1, longSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function canvasToJpeg(
  canvas: HTMLCanvasElement,
  quality = CAPTURE_JPEG_QUALITY,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));
}

/** Draws the video's current decoded frame (downscaled to CAPTURE_LONG_SIDE). Null without a frame. */
export async function captureVideoFrame(
  video: HTMLVideoElement,
): Promise<Omit<CapturedImage, 'source'> | null> {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
  if (!video.videoWidth || !video.videoHeight) return null;
  const { width, height } = fitWithin(video.videoWidth, video.videoHeight);
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
  if (file.size > MAX_PHOTO_FILE_BYTES) throw new PhotoError('size', 'That photo is too large.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoError('read', 'That photo could not be read.');
  }
  try {
    const canvas = document.createElement('canvas');
    const size = fitWithin(bitmap.width, bitmap.height);
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new PhotoError('convert', 'Canvas is unavailable.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToJpeg(canvas);
    const { width, height } = canvas;
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new PhotoError('convert', 'That photo could not be converted.');
    if (blob.size > maxBytes) throw new PhotoError('size', 'That photo is too large.');
    return { blob, width, height, source: 'photo', mediaTimeMs: null };
  } finally {
    bitmap.close();
  }
}
