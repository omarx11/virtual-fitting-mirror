/**
 * Ephemeral, anonymous kiosk sessions. A session only groups one customer's jobs so that results
 * can be read and deleted by their owner alone; it holds no personal data. The ID travels in an
 * HttpOnly, SameSite=Strict cookie scoped to /api/ai and expires after an idle timeout
 * (enforced here, server-side, even if the browser disappears).
 */
import { randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'vfm_ai_sid';
const ID = /^[A-Za-z0-9_-]{43}$/;

export interface Session {
  id: string;
  createdAt: number;
  lastSeen: number;
}

export class SessionStore {
  private sessions = new Map<string, Session>();

  constructor(
    private readonly idleMs: number,
    private readonly now: () => number = Date.now,
    /** Upper bound on concurrent sessions (a kiosk has one; this caps abuse). */
    private readonly max = 200,
  ) {}

  create(): Session {
    this.sweep();
    if (this.sessions.size >= this.max) {
      // Evict the least recently used session rather than grow without bound.
      let oldest: Session | null = null;
      for (const s of this.sessions.values()) if (!oldest || s.lastSeen < oldest.lastSeen) oldest = s;
      if (oldest) this.sessions.delete(oldest.id);
    }
    const session = {
      id: randomBytes(32).toString('base64url'),
      createdAt: this.now(),
      lastSeen: this.now(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  /** Returns the live session and refreshes its idle timer, or null. */
  touch(id: string | null | undefined): Session | null {
    if (!id || !ID.test(id)) return null;
    const s = this.sessions.get(id);
    if (!s) return null;
    if (this.now() - s.lastSeen > this.idleMs) {
      this.sessions.delete(id);
      return null;
    }
    s.lastSeen = this.now();
    return s;
  }

  delete(id: string): boolean {
    return this.sessions.delete(id);
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  expiresAt(s: Session): number {
    return s.lastSeen + this.idleMs;
  }

  /** Removes idle sessions; returns their IDs so their jobs can be purged. */
  sweep(): string[] {
    const expired: string[] = [];
    for (const [id, s] of this.sessions) {
      if (this.now() - s.lastSeen > this.idleMs) {
        this.sessions.delete(id);
        expired.push(id);
      }
    }
    return expired;
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
