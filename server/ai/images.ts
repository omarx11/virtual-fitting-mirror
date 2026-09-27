/**
 * Image validation and normalization. Every image (customer photo, garment upload, catalogue file,
 * provider output) is decoded by Sharp under explicit limits before use:
 *   - only JPEG, PNG and WebP, recognized by their magic bytes (never SVG, GIF, HEIC, …);
 *   - byte and decoded-pixel limits (decompression bombs are refused before decoding);
 *   - animated images are refused;
 *   - EXIF orientation is applied, then ALL metadata (EXIF/GPS/ICC/XMP) is dropped by re-encoding;
 *   - aspect ratio is preserved; images are only ever downscaled, to `longSide`.
 * These are this application's limits; the provider documents its own (e.g. 30 MiB for Try-On Max).
 */
import sharp, { type Metadata } from 'sharp';
import { AppError } from './errors';

export type ImageFormat = 'jpeg' | 'png' | 'webp';

export interface NormalizedImage {
  buffer: Buffer;
  contentType: 'image/jpeg';
  width: number;
  height: number;
}

export interface ImageLimits {
  maxBytes: number;
  maxPixels: number;
  /** Output long side cap in pixels (downscale only). */
  longSide: number;
}

/** Smallest side we accept; smaller inputs cannot produce a usable try-on. */
export const MIN_SIDE = 64;
/** The provider accepts aspect ratios between 1:16 and 16:1. */
const MAX_ASPECT = 16;
/** JPEG quality for uploads: visually lossless for photos, far smaller than PNG. */
export const UPLOAD_JPEG_QUALITY = 90;

export function sniffImageType(buf: Buffer): ImageFormat | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'png';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP')
    return 'webp';
  return null;
}

const invalid = (message = 'That image could not be used. Please try a different photo.') =>
  new AppError('invalid-image', 400, message);

async function inspect(buf: Buffer, limits: Pick<ImageLimits, 'maxBytes' | 'maxPixels'>) {
  if (buf.length === 0) throw invalid('The image is empty.');
  if (buf.length > limits.maxBytes) throw new AppError('image-too-large', 413, 'That image is too large.');
  const format = sniffImageType(buf);
  if (!format) throw invalid('Only JPEG, PNG or WebP images are accepted.');
  let meta: Metadata;
  try {
    // Header only (no pixel decoding): the pixel limit is checked explicitly below, then enforced
    // again by Sharp while decoding.
    meta = await sharp(buf, { limitInputPixels: false, failOn: 'error' }).metadata();
  } catch {
    throw invalid();
  }
  if (meta.format !== format) throw invalid('The image data does not match its format.');
  const { width, height } = meta;
  if (!width || !height) throw invalid();
  if (width * height > limits.maxPixels) {
    throw new AppError('image-too-large', 413, 'That image has too many pixels.');
  }
  if ((meta.pages ?? 1) > 1) throw invalid('Animated images are not accepted.');
  if (Math.min(width, height) < MIN_SIDE) throw invalid('That image is too small.');
  if (Math.max(width, height) / Math.min(width, height) > MAX_ASPECT)
    throw invalid('That image is too narrow.');
  return { format, width, height };
}

/**
 * Decodes, orients, strips metadata and re-encodes an input image as JPEG (transparency is
 * flattened onto white, which suits cut-out product photos).
 */
export async function normalizeImage(buf: Buffer, limits: ImageLimits): Promise<NormalizedImage> {
  await inspect(buf, limits);
  try {
    const { data, info } = await sharp(buf, { limitInputPixels: limits.maxPixels, failOn: 'error' })
      .rotate()
      .resize({
        width: limits.longSide,
        height: limits.longSide,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: UPLOAD_JPEG_QUALITY, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { buffer: data, contentType: 'image/jpeg', width: info.width, height: info.height };
  } catch {
    throw invalid();
  }
}

export function toDataUri(img: { buffer: Buffer; contentType: string }): string {
  return `data:${img.contentType};base64,${img.buffer.toString('base64')}`;
}

/** Base64 grows data by 4/3; used to bound outbound request size. */
export function base64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

export class OutputError extends Error {
  constructor(
    readonly kind: 'expired' | 'invalid',
    message: string,
  ) {
    super(message);
    this.name = 'OutputError';
  }
}

const DATA_URI = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

/**
 * Parses ONE provider output: only a base64 raster data URI of a known type is accepted. URLs,
 * HTML, SVG, the provider's expiry marker, or malformed data are rejected; nothing is fetched. The
 * image is decoded and re-encoded, so only clean pixels reach the browser.
 */
export async function decodeProviderOutput(
  value: unknown,
  limits: Pick<ImageLimits, 'maxBytes' | 'maxPixels'>,
): Promise<NormalizedImage> {
  if (typeof value !== 'string' || value.length === 0)
    throw new OutputError('invalid', 'Output is not a string.');
  if (/expired/i.test(value.slice(0, 64))) throw new OutputError('expired', 'Provider output has expired.');
  if (value.length > base64Length(limits.maxBytes) + 64)
    throw new OutputError('invalid', 'Output is too large.');
  const match = DATA_URI.exec(value);
  if (!match) throw new OutputError('invalid', 'Output is not a base64 image data URI.');
  const declared = match[1] === 'jpg' ? 'jpeg' : (match[1] as ImageFormat);
  const b64 = match[2] ?? '';
  if (b64.length % 4 !== 0) throw new OutputError('invalid', 'Output base64 is malformed.');
  const buf = Buffer.from(b64, 'base64');
  if (sniffImageType(buf) !== declared)
    throw new OutputError('invalid', 'Output type does not match its data.');
  try {
    await inspect(buf, limits);
    const { data, info } = await sharp(buf, { limitInputPixels: limits.maxPixels, failOn: 'error' })
      .rotate()
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { buffer: data, contentType: 'image/jpeg', width: info.width, height: info.height };
  } catch {
    throw new OutputError('invalid', 'Output image could not be decoded.');
  }
}
