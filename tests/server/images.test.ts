import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../server/ai/errors';
import { decodeProviderOutput, normalizeImage, OutputError, sniffImageType } from '../../server/ai/images';
import { makeImage } from './helpers';

const LIMITS = { maxBytes: 8 * 1024 * 1024, maxPixels: 40_000_000, longSide: 2048 };

async function rejectsWith(p: Promise<unknown>, code: string) {
  const error = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

describe('input images', () => {
  it('recognizes only JPEG, PNG and WebP by magic bytes', async () => {
    expect(sniffImageType(await makeImage(80, 80, 'jpeg'))).toBe('jpeg');
    expect(sniffImageType(await makeImage(80, 80, 'png'))).toBe('png');
    expect(sniffImageType(await makeImage(80, 80, 'webp'))).toBe('webp');
    expect(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImageType(Buffer.from('GIF89a......'))).toBeNull();
  });

  it('applies EXIF orientation, strips all metadata and keeps the aspect ratio', async () => {
    // Stored 400×300 with orientation 6 (rotate 90°): displayed as 300×400.
    const input = await makeImage(400, 300, 'jpeg', { orientation: 6 });
    expect((await sharp(input).metadata()).orientation).toBe(6);
    const out = await normalizeImage(input, LIMITS);
    expect([out.width, out.height]).toEqual([300, 400]);
    const meta = await sharp(out.buffer).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.orientation).toBeUndefined();
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
  });

  it('downscales only above the long-side cap, preserving landscape and portrait shapes', async () => {
    const landscape = await normalizeImage(await makeImage(3000, 1500), LIMITS);
    expect([landscape.width, landscape.height]).toEqual([2048, 1024]);
    const portrait = await normalizeImage(await makeImage(600, 1200), LIMITS);
    expect([portrait.width, portrait.height]).toEqual([600, 1200]);
  });

  it('flattens transparency onto white', async () => {
    const out = await normalizeImage(await makeImage(100, 100, 'png', { alpha: true }), LIMITS);
    const { data } = await sharp(out.buffer).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(240); // left half was transparent
  });

  it('rejects SVG, text, empty, corrupt and mismatched data', async () => {
    await rejectsWith(
      normalizeImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), LIMITS),
      'invalid-image',
    );
    await rejectsWith(normalizeImage(Buffer.from('hello'), LIMITS), 'invalid-image');
    await rejectsWith(normalizeImage(Buffer.alloc(0), LIMITS), 'invalid-image');
    const jpeg = await makeImage(200, 200);
    await rejectsWith(normalizeImage(jpeg.subarray(0, 60), LIMITS), 'invalid-image');
  });

  it('enforces byte and decoded-pixel limits (decompression bombs) before decoding', async () => {
    const img = await makeImage(300, 300, 'png');
    await rejectsWith(normalizeImage(img, { ...LIMITS, maxBytes: 100 }), 'image-too-large');
    // A small file that decodes to more pixels than allowed.
    const bomb = await sharp({ create: { width: 4000, height: 4000, channels: 3, background: '#000' } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.length).toBeLessThan(200_000);
    await rejectsWith(normalizeImage(bomb, { ...LIMITS, maxPixels: 1_000_000 }), 'image-too-large');
  });

  it('rejects animated, tiny and extremely narrow images', async () => {
    // Two DIFFERENT frames (libwebp collapses identical frames into a still image).
    const frameA = await makeImage(100, 100, 'png');
    const frameB = await sharp(frameA).negate().png().toBuffer();
    const animated = await sharp([frameA, frameB], { join: { animated: true } })
      .webp({ loop: 0 })
      .toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(2);
    await rejectsWith(normalizeImage(animated, LIMITS), 'invalid-image');
    await rejectsWith(normalizeImage(await makeImage(40, 40), LIMITS), 'invalid-image');
    await rejectsWith(normalizeImage(await makeImage(2000, 100), LIMITS), 'invalid-image');
  });
});

describe('provider output', () => {
  const limits = { maxBytes: 4 * 1024 * 1024, maxPixels: 40_000_000 };

  it('accepts one base64 raster data URI and re-encodes it', async () => {
    const png = await makeImage(120, 160, 'png');
    const out = await decodeProviderOutput(`data:image/png;base64,${png.toString('base64')}`, limits);
    expect(out.contentType).toBe('image/jpeg');
    expect([out.width, out.height]).toEqual([120, 160]);
  });

  it.each([
    ['a URL (never fetched)', 'https://cdn.fashn.ai/x.jpg'],
    ['HTML', 'data:text/html;base64,PGgxPmhpPC9oMT4='],
    ['SVG', `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`],
    ['malformed base64', 'data:image/jpeg;base64,@@@@'],
    ['a non-string', 42],
    ['empty', ''],
  ])('rejects %s', async (_label, value) => {
    await expect(decodeProviderOutput(value, limits)).rejects.toBeInstanceOf(OutputError);
  });

  it('reports the provider expiry marker as expired', async () => {
    await expect(decodeProviderOutput('_expired', limits)).rejects.toMatchObject({ kind: 'expired' });
  });

  it('rejects data whose bytes do not match the declared type, and oversize output', async () => {
    const png = await makeImage(80, 80, 'png');
    await expect(
      decodeProviderOutput(`data:image/jpeg;base64,${png.toString('base64')}`, limits),
    ).rejects.toBeInstanceOf(OutputError);
    const big = `data:image/png;base64,${'A'.repeat(8 * 1024 * 1024)}`;
    await expect(decodeProviderOutput(big, limits)).rejects.toMatchObject({ kind: 'invalid' });
  });
});
