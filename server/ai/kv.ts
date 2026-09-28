/**
 * The small key-value interface all AI server state goes through, so the same session, job and
 * ledger logic runs on one kiosk process (MemoryKv) and on many short-lived Vercel Function
 * instances sharing one Redis database (RedisKv, Upstash REST).
 *
 * Every key has a time-to-live where it holds customer-related data, so nothing needs a background
 * sweeper to be deleted: sessions, job metadata and result images expire on their own. Values are
 * strings (JSON or base64); nothing is serialized implicitly.
 */
import { randomBytes } from 'node:crypto';
import { AppError } from './errors';

export interface SetOptions {
  /** Time to live in milliseconds. */
  pxMs?: number;
  /** Only set the key if it does not exist yet (returns false otherwise). */
  nx?: boolean;
}

export interface KvStore {
  readonly kind: 'memory' | 'redis';
  get(key: string): Promise<string | null>;
  mget(keys: readonly string[]): Promise<(string | null)[]>;
  /** Returns false only when `nx` is set and the key already existed. */
  set(key: string, value: string, options?: SetOptions): Promise<boolean>;
  del(...keys: string[]): Promise<number>;
  /** Deletes the key only while it still holds `value` (safe lock release). */
  delIfEquals(key: string, value: string): Promise<boolean>;
  /** Refreshes a key's time to live; false when the key does not exist. */
  pexpire(key: string, ms: number): Promise<boolean>;
  /** Increments a counter; a newly created counter expires after `pxMs`. */
  incr(key: string, pxMs: number): Promise<number>;
  sadd(key: string, member: string, pxMs?: number): Promise<void>;
  srem(key: string, member: string): Promise<void>;
  smembers(key: string): Promise<string[]>;
  hset(key: string, field: string, value: string, pxMs?: number): Promise<void>;
  hget(key: string, field: string): Promise<string | null>;
  hgetall(key: string): Promise<Record<string, string>>;
}

// ---- In-process store (kiosk, development, tests) -------------------------------------------------

type Stored = { value: string | Set<string> | Map<string, string>; expiresAt: number | null };

export class MemoryKv implements KvStore {
  readonly kind = 'memory' as const;
  private data = new Map<string, Stored>();

  constructor(private readonly now: () => number = Date.now) {}

  private entry(key: string): Stored | undefined {
    const e = this.data.get(key);
    if (e && e.expiresAt !== null && this.now() >= e.expiresAt) {
      this.data.delete(key);
      return undefined;
    }
    return e;
  }

  private expiry(pxMs: number | undefined): number | null {
    return pxMs === undefined ? null : this.now() + pxMs;
  }

  async get(key: string) {
    const e = this.entry(key);
    return typeof e?.value === 'string' ? e.value : null;
  }

  async mget(keys: readonly string[]) {
    return Promise.all(keys.map((k) => this.get(k)));
  }

  async set(key: string, value: string, options: SetOptions = {}) {
    if (options.nx && this.entry(key)) return false;
    this.data.set(key, { value, expiresAt: this.expiry(options.pxMs) });
    return true;
  }

  async del(...keys: string[]) {
    let n = 0;
    for (const k of keys) if (this.entry(k) && this.data.delete(k)) n++;
    return n;
  }

  async delIfEquals(key: string, value: string) {
    if ((await this.get(key)) !== value) return false;
    this.data.delete(key);
    return true;
  }

  async pexpire(key: string, ms: number) {
    const e = this.entry(key);
    if (!e) return false;
    e.expiresAt = this.now() + ms;
    return true;
  }

  async incr(key: string, pxMs: number) {
    const e = this.entry(key);
    const n = (typeof e?.value === 'string' ? Number(e.value) : 0) + 1;
    this.data.set(key, { value: String(n), expiresAt: e ? e.expiresAt : this.expiry(pxMs) });
    return n;
  }

  private collection<T extends Set<string> | Map<string, string>>(key: string, make: () => T): T {
    const e = this.entry(key);
    if (e && typeof e.value !== 'string') return e.value as T;
    const value = make();
    this.data.set(key, { value, expiresAt: null });
    return value;
  }

  async sadd(key: string, member: string, pxMs?: number) {
    this.collection(key, () => new Set<string>()).add(member);
    if (pxMs !== undefined) await this.pexpire(key, pxMs);
  }

  async srem(key: string, member: string) {
    const e = this.entry(key);
    if (e?.value instanceof Set) {
      e.value.delete(member);
      if (e.value.size === 0) this.data.delete(key);
    }
  }

  async smembers(key: string) {
    const e = this.entry(key);
    return e?.value instanceof Set ? [...e.value] : [];
  }

  async hset(key: string, field: string, value: string, pxMs?: number) {
    this.collection(key, () => new Map<string, string>()).set(field, value);
    if (pxMs !== undefined) await this.pexpire(key, pxMs);
  }

  async hget(key: string, field: string) {
    const e = this.entry(key);
    return e?.value instanceof Map ? (e.value.get(field) ?? null) : null;
  }

  async hgetall(key: string) {
    const e = this.entry(key);
    return e?.value instanceof Map ? Object.fromEntries(e.value) : {};
  }

  /** Frees expired entries (memory only; reads already ignore them). */
  sweep(): void {
    for (const key of [...this.data.keys()]) this.entry(key);
  }

  /** Number of live keys (tests and diagnostics). */
  size(): number {
    this.sweep();
    return this.data.size;
  }
}

// ---- Shared Redis (Vercel: Upstash for Redis over its REST API) -----------------------------------

/** The subset of @upstash/redis used here (a structural type, so tests can pass any client). */
export interface UpstashLike {
  get(key: string): Promise<unknown>;
  mget(...keys: string[]): Promise<unknown[]>;
  set(key: string, value: string, opts?: Record<string, unknown>): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
  sadd(key: string, ...members: [string, ...string[]]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<unknown[]>;
  hset(key: string, kv: Record<string, string>): Promise<number>;
  hget(key: string, field: string): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, unknown> | null>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
}

const DEL_IF_EQUALS = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0`;
const INCR_WITH_TTL = `local n = redis.call('incr', KEYS[1]) if n == 1 then redis.call('pexpire', KEYS[1], ARGV[1]) end return n`;

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export class RedisKv implements KvStore {
  readonly kind = 'redis' as const;

  /**
   * @param client an @upstash/redis client created with `automaticDeserialization: false`.
   * @param prefix namespaces every key (one database can serve several deployments).
   */
  constructor(
    private readonly client: UpstashLike,
    private readonly prefix = 'vfm:',
  ) {}

  private k(key: string): string {
    return this.prefix + key;
  }

  async get(key: string) {
    return str(await this.client.get(this.k(key)));
  }

  async mget(keys: readonly string[]) {
    if (keys.length === 0) return [];
    return (await this.client.mget(...keys.map((k) => this.k(k)))).map(str);
  }

  async set(key: string, value: string, options: SetOptions = {}) {
    const opts: Record<string, unknown> = {};
    if (options.pxMs !== undefined) opts.px = Math.max(1, Math.round(options.pxMs));
    if (options.nx) opts.nx = true;
    const res = await this.client.set(this.k(key), value, opts);
    return !options.nx || res === 'OK';
  }

  async del(...keys: string[]) {
    return keys.length ? this.client.del(...keys.map((k) => this.k(k))) : 0;
  }

  async delIfEquals(key: string, value: string) {
    return Number(await this.client.eval(DEL_IF_EQUALS, [this.k(key)], [value])) === 1;
  }

  async pexpire(key: string, ms: number) {
    return (await this.client.pexpire(this.k(key), Math.max(1, Math.round(ms)))) === 1;
  }

  async incr(key: string, pxMs: number) {
    return Number(await this.client.eval(INCR_WITH_TTL, [this.k(key)], [String(Math.round(pxMs))]));
  }

  async sadd(key: string, member: string, pxMs?: number) {
    await this.client.sadd(this.k(key), member);
    if (pxMs !== undefined) await this.client.pexpire(this.k(key), Math.round(pxMs));
  }

  async srem(key: string, member: string) {
    await this.client.srem(this.k(key), member);
  }

  async smembers(key: string) {
    return (await this.client.smembers(this.k(key))).map(String);
  }

  async hset(key: string, field: string, value: string, pxMs?: number) {
    await this.client.hset(this.k(key), { [field]: value });
    if (pxMs !== undefined) await this.client.pexpire(this.k(key), Math.round(pxMs));
  }

  async hget(key: string, field: string) {
    return str(await this.client.hget(this.k(key), field));
  }

  async hgetall(key: string) {
    const all: unknown = await this.client.hgetall(this.k(key));
    const out: Record<string, string> = {};
    if (Array.isArray(all)) {
      // Without automatic deserialization the client returns Redis's flat [field, value, …] reply.
      for (let i = 0; i + 1 < all.length; i += 2) out[String(all[i])] = String(all[i + 1]);
    } else if (all && typeof all === 'object') {
      for (const [f, v] of Object.entries(all)) out[f] = String(v);
    }
    return out;
  }
}

// ---- Health -----------------------------------------------------------------------------------------

/**
 * Checks that the store answers, so AI mode reports a wrong or unreachable Redis database up front
 * instead of failing at the first generation. A good answer is remembered for `okForMs`; a failure
 * is checked again on the next call. Returns why the store cannot be used, or null.
 */
export function storeHealthCheck(kv: KvStore, { timeoutMs = 4000, okForMs = 60_000 } = {}) {
  if (kv.kind === 'memory') return async (): Promise<string | null> => null;
  let okUntil = 0;
  return async (): Promise<string | null> => {
    if (Date.now() < okUntil) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        kv.get('health'),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`no answer within ${timeoutMs / 1000} s`)), timeoutMs);
        }),
      ]);
      okUntil = Date.now() + okForMs;
      return null;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return `The Redis database cannot be reached (${detail.slice(0, 160)}). Check that Upstash for Redis is connected to this Vercel project, then redeploy.`;
    } finally {
      clearTimeout(timer);
    }
  };
}

// ---- Locks ------------------------------------------------------------------------------------------

export function token(): string {
  return randomBytes(12).toString('base64url');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs `fn` while holding a short exclusive lock shared by every server instance. The lock expires
 * after `ttlMs` even if its holder dies, and is released only by its holder.
 */
export async function withLock<T>(
  kv: KvStore,
  name: string,
  fn: () => Promise<T>,
  { ttlMs = 10_000, waitMs = 5_000 } = {},
): Promise<T> {
  const key = `lock:${name}`;
  const value = token();
  const giveUp = Date.now() + waitMs;
  for (
    let delay = 5;
    !(await kv.set(key, value, { nx: true, pxMs: ttlMs }));
    delay = Math.min(delay * 2, 100)
  ) {
    if (Date.now() > giveUp) {
      throw new AppError('busy', 503, 'The AI service is busy. Please try again in a moment.');
    }
    await sleep(delay);
  }
  try {
    return await fn();
  } finally {
    await kv.delIfEquals(key, value).catch(() => undefined);
  }
}
