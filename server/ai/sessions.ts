/**
 * Ephemeral, anonymous sessions. A session only groups one customer's jobs so that results can be
 * read and deleted by their owner alone; it holds no personal data. The ID travels in an HttpOnly,
 * SameSite=Strict cookie scoped to /api/ai. The session key's time to live is the idle timeout, so
 * it expires server-side on its own (even if the browser disappears) and every use refreshes it.
 */
import { randomBytes } from 'node:crypto';
import type { KvStore } from './kv';

export const SESSION_COOKIE = 'vfm_ai_sid';
const ID = /^[A-Za-z0-9_-]{43}$/;

export interface Session {
  id: string;
  lastSeen: number;
}

const key = (id: string) => `session:${id}`;

export class SessionStore {
  constructor(
    private readonly kv: KvStore,
    private readonly idleMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async create(): Promise<Session> {
    const session = { id: randomBytes(32).toString('base64url'), lastSeen: this.now() };
    await this.kv.set(key(session.id), String(session.lastSeen), { pxMs: this.idleMs });
    return session;
  }

  /** Returns the live session and refreshes its idle timer (one store call), or null. */
  async touch(id: string | null | undefined): Promise<Session | null> {
    if (!id || !ID.test(id)) return null;
    if (!(await this.kv.pexpire(key(id), this.idleMs))) return null;
    return { id, lastSeen: this.now() };
  }

  async delete(id: string): Promise<boolean> {
    return (await this.kv.del(key(id))) > 0;
  }

  async has(id: string): Promise<boolean> {
    return (await this.kv.get(key(id))) !== null;
  }

  expiresAt(s: Session): number {
    return s.lastSeen + this.idleMs;
  }
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export function sessionCookie(value: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${value}; Path=/api/ai; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

export function clearedSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/api/ai; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}
