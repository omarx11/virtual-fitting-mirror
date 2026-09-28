/**
 * Shared server-test helpers. Test images are synthetic (generated with Sharp in memory); no photo
 * of a person is used or stored.
 */
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { loadConfig, type ServerConfig } from '../../server/config';
import { AI_CLIENT_HEADER, AI_CONSENT_VERSION } from '../../src/ai/types';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** A deterministic gradient "photo". */
export async function makeImage(
  width: number,
  height: number,
  format: 'jpeg' | 'png' | 'webp' = 'jpeg',
  options: { orientation?: number; alpha?: boolean } = {},
): Promise<Buffer> {
  const channels = options.alpha ? 4 : 3;
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      data[i] = (x * 255) / width;
      data[i + 1] = (y * 255) / height;
      data[i + 2] = 128;
      if (options.alpha) data[i + 3] = x < width / 2 ? 0 : 255;
    }
  let img = sharp(data, { raw: { width, height, channels } });
  if (options.orientation) img = img.withMetadata({ orientation: options.orientation });
  if (format === 'png') return img.png().toBuffer();
  if (format === 'webp') return img.webp().toBuffer();
  return img.jpeg({ quality: 85 }).toBuffer();
}

export function testConfig(env: Record<string, string> = {}, production = false): ServerConfig {
  return loadConfig(
    {
      AI_ENABLED: 'true',
      AI_PROVIDER: 'fake',
      AI_LEDGER_PATH: 'memory',
      AI_POLL_INTERVAL_MS: '5',
      AI_FAKE_STEP_MS: '10',
      AI_LOG_LEVEL: 'silent',
      AI_PORT: '3001',
      ...env,
    },
    { production, root: ROOT },
  );
}

export const ORIGIN = 'http://localhost:3001';
export const HOST = 'localhost:3001';

/** Headers a same-origin browser request carries. */
export function browserHeaders(cookie?: string): Record<string, string> {
  return {
    host: HOST,
    origin: ORIGIN,
    'sec-fetch-site': 'same-origin',
    [AI_CLIENT_HEADER]: '1',
    ...(cookie ? { cookie } : {}),
  };
}

export interface Part {
  name: string;
  value: string | Buffer;
  filename?: string;
  contentType?: string;
}

/** Builds a multipart/form-data body by hand (what a browser FormData upload sends). */
export function multipart(parts: Part[]): { payload: Buffer; contentType: string } {
  const boundary = `----vfmtest${randomUUID().replace(/-/g, '')}`;
  const chunks: Buffer[] = [];
  for (const p of parts) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"`;
    if (p.filename) head += `; filename="${p.filename}"\r\nContent-Type: ${p.contentType ?? 'image/jpeg'}`;
    chunks.push(
      Buffer.from(`${head}\r\n\r\n`),
      Buffer.isBuffer(p.value) ? p.value : Buffer.from(p.value),
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

export function jobParts(
  person: Buffer,
  overrides: {
    garmentId?: string | null;
    clientRequestId?: string;
    consentVersion?: string;
    preset?: string;
  } = {},
  extra: Part[] = [],
): Part[] {
  const parts: Part[] = [{ name: 'person', value: person, filename: 'person.jpg' }];
  const garmentId = overrides.garmentId === undefined ? 'dress-green' : overrides.garmentId;
  if (garmentId !== null) parts.push({ name: 'garmentId', value: garmentId });
  parts.push({ name: 'consentVersion', value: overrides.consentVersion ?? AI_CONSENT_VERSION });
  parts.push({ name: 'clientRequestId', value: overrides.clientRequestId ?? randomUUID() });
  if (overrides.preset) parts.push({ name: 'preset', value: overrides.preset });
  return [...parts, ...extra];
}

export async function waitFor<T>(
  fn: () => T | Promise<T>,
  ok: (v: T) => boolean,
  timeoutMs = 3000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() - start > timeoutMs)
      throw new Error(`waitFor timed out; last value: ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}
