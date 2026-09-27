/**
 * Access code for AI mode on a public deployment (AI_ACCESS_CODE). Anyone can open the website, but
 * only people given the code can start paid generations, so a shared link cannot spend the FASHN
 * credits.
 *
 * - Entering the code sets a signed, HttpOnly, SameSite=Strict cookie (`<expiry>.<HMAC>`), checked
 *   statelessly on every instance. Its key is derived from the code, so changing AI_ACCESS_CODE
 *   signs everyone out. It is separate from the customer session: ending a session keeps access.
 * - Wrong codes are counted per client IP in the shared store; after MAX_FAILURES within the window
 *   further attempts are refused until it passes.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors';
import type { KvStore } from './kv';
import { readCookie } from './sessions';

export const ACCESS_COOKIE = 'vfm_ai_access';
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60_000;

export class AccessGate {
  private readonly key: Buffer | null;

  constructor(
    code: string | null,
    private readonly kv: KvStore,
    private readonly lifetimeMs: number,
    private readonly now: () => number = Date.now,
  ) {
    this.key = code ? createHash('sha256').update(`vfm-ai-access\n${code}`).digest() : null;
    this.codeDigest = code ? digest(code) : null;
  }

  private readonly codeDigest: Buffer | null;

  get required(): boolean {
    return this.key !== null;
  }

  /** True when no code is configured, or the request carries a valid, unexpired access cookie. */
  granted(cookieHeader: string | undefined): boolean {
    if (!this.key) return true;
    const value = readCookie(cookieHeader, ACCESS_COOKIE);
    const match = value ? /^(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(value) : null;
    if (!match) return false;
    const expires = Number(match[1]);
    if (!(expires > this.now())) return false;
    return safeEqual(Buffer.from(match[2] ?? '', 'base64url'), this.sign(expires));
  }

  /** Throws unless access is granted (used by every route that can start paid work). */
  require(cookieHeader: string | undefined): void {
    if (!this.granted(cookieHeader)) {
      throw new AppError('access-required', 403, 'Enter the access code to use AI photo mode.');
    }
  }

  /** Checks a submitted code. Returns the cookie value to set on success. */
  async unlock(code: unknown, clientKey: string): Promise<{ value: string; maxAgeSeconds: number }> {
    if (!this.key || !this.codeDigest) throw new AppError('bad-request', 400, 'No access code is required.');
    const failuresKey = `access:failures:${clientKey}`;
    const failures = Number((await this.kv.get(failuresKey)) ?? 0);
    if (failures >= MAX_FAILURES) {
      throw new AppError('rate-limited', 429, 'Too many wrong codes. Please wait 15 minutes and try again.');
    }
    const ok =
      typeof code === 'string' && code.length <= 200 && safeEqual(digest(code.trim()), this.codeDigest);
    if (!ok) {
      await this.kv.incr(failuresKey, FAILURE_WINDOW_MS);
      throw new AppError('access-denied', 403, 'That access code is not correct.');
    }
    await this.kv.del(failuresKey);
    const expires = this.now() + this.lifetimeMs;
    return {
      value: `${expires}.${this.sign(expires).toString('base64url')}`,
      maxAgeSeconds: Math.floor(this.lifetimeMs / 1000),
    };
  }

  private sign(expires: number): Buffer {
    return createHmac('sha256', this.key ?? Buffer.alloc(0))
      .update(String(expires))
      .digest();
  }
}

function digest(code: string): Buffer {
  return createHash('sha256').update(code).digest();
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function accessCookie(value: string, maxAgeSeconds: number, secure: boolean): string {
  return `${ACCESS_COOKIE}=${value}; Path=/api/ai; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}
