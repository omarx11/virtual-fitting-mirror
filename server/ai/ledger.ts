/**
 * Durable daily credit ledger — the local spending cap. Rate limiting alone is not a cap.
 *
 * - Scope: this server process's data directory (one kiosk). The day is the UTC calendar day.
 * - Contents: job IDs, credit counts, states and timestamps only — never images or customer data.
 * - Credits are RESERVED before the provider is called (synchronously, so two concurrent requests
 *   cannot both pass the check), then CHARGED (completed), RELEASED (the provider documents that
 *   failed predictions are not charged, or the request was definitely never accepted) or kept as
 *   UNCERTAIN (timeouts, lost connections, unknown outcomes) — uncertain credits keep counting.
 * - Every change is written synchronously to a temp file and renamed over the ledger, so a crash
 *   leaves either the old or the new file. Reservations of a process that died stay counted.
 * - A corrupt or unreadable ledger fails CLOSED: no new generations until an operator fixes it.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AiUsageDay } from '../../src/ai/types';

export type LedgerState = 'reserved' | 'charged' | 'released' | 'uncertain';

export interface LedgerEntry {
  /** UTC day (YYYY-MM-DD) the reservation counts against. */
  day: string;
  credits: number;
  state: LedgerState;
  at: number;
}

interface LedgerFile {
  version: 1;
  entries: Record<string, LedgerEntry>;
}

/** Entries older than this are pruned (kept this long for the staff usage history). */
const KEEP_DAYS = 90;

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export class UsageLedger {
  private entries: Record<string, LedgerEntry> = {};
  /** Set when the stored ledger cannot be trusted; blocks all reservations. */
  readonly loadError: string | null = null;

  constructor(
    private readonly path: string | null,
    private readonly dailyCap: number,
    private readonly now: () => number = Date.now,
  ) {
    if (!path) return;
    let text: string | null = null;
    try {
      text = readFileSync(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.loadError = `The usage ledger could not be read (${(error as Error).message}).`;
      }
    }
    if (text !== null) {
      try {
        const parsed = JSON.parse(text) as LedgerFile;
        if (parsed?.version !== 1 || typeof parsed.entries !== 'object' || parsed.entries === null) {
          throw new Error('unexpected format');
        }
        for (const [id, e] of Object.entries(parsed.entries)) {
          if (
            typeof e?.day !== 'string' ||
            !Number.isFinite(e.credits) ||
            !['reserved', 'charged', 'released', 'uncertain'].includes(e.state)
          ) {
            throw new Error(`bad entry ${id}`);
          }
        }
        this.entries = parsed.entries;
      } catch (error) {
        this.loadError = `The usage ledger at ${path} is corrupt (${(error as Error).message}); AI is blocked until it is fixed or removed.`;
      }
    }
  }

  /** Credits counted against today's cap (everything except released entries). */
  usedToday(): number {
    const today = utcDay(this.now());
    let sum = 0;
    for (const e of Object.values(this.entries))
      if (e.day === today && e.state !== 'released') sum += e.credits;
    return sum;
  }

  uncertainToday(): number {
    const today = utcDay(this.now());
    return Object.values(this.entries).filter((e) => e.day === today && e.state === 'uncertain').length;
  }

  /** Per-day totals, newest first (only days with activity). */
  summary(days = 30): AiUsageDay[] {
    const cutoff = utcDay(this.now() - (days - 1) * 86_400_000);
    const byDay = new Map<string, AiUsageDay>();
    for (const e of Object.values(this.entries)) {
      if (e.day < cutoff) continue;
      let d = byDay.get(e.day);
      if (!d) {
        d = { day: e.day, generations: 0, credits: 0, failed: 0, uncertain: 0 };
        byDay.set(e.day, d);
      }
      if (e.state === 'charged') d.generations++;
      if (e.state === 'released') d.failed++;
      else d.credits += e.credits;
      if (e.state === 'uncertain') d.uncertain++;
    }
    return [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day));
  }

  get cap(): number {
    return this.dailyCap;
  }

  remainingToday(): number {
    return Math.max(0, this.dailyCap - this.usedToday());
  }

  /** Atomically checks the cap and records a reservation. Returns false when it would exceed it. */
  reserve(id: string, credits: number): boolean {
    if (this.loadError) return false;
    if (this.entries[id]) return false;
    if (this.usedToday() + credits > this.dailyCap) return false;
    this.entries[id] = { day: utcDay(this.now()), credits, state: 'reserved', at: this.now() };
    try {
      this.persist();
    } catch {
      // Could not record the reservation durably: refuse rather than spend untracked.
      delete this.entries[id];
      return false;
    }
    return true;
  }

  /** Completed: record the credits actually used (from the provider when it reports them). */
  charge(id: string, credits?: number): void {
    this.update(id, 'charged', credits);
  }

  /** Definitely not charged (never accepted, or a documented non-billable failure). */
  release(id: string): void {
    this.update(id, 'released');
  }

  /** Outcome unknown: keep counting the reservation. */
  markUncertain(id: string): void {
    this.update(id, 'uncertain');
  }

  get(id: string): LedgerEntry | undefined {
    return this.entries[id];
  }

  private update(id: string, state: LedgerState, credits?: number): void {
    const e = this.entries[id];
    if (!e) return;
    // A charged or released entry is final; late status reads cannot rewrite history.
    if (e.state === 'charged' || e.state === 'released') return;
    e.state = state;
    if (credits !== undefined && Number.isFinite(credits) && credits >= 0) e.credits = credits;
    e.at = this.now();
    try {
      this.persist();
    } catch (error) {
      console.error(`[ai] could not update the usage ledger: ${(error as Error).message}`);
    }
  }

  private persist(): void {
    const cutoff = utcDay(this.now() - KEEP_DAYS * 86_400_000);
    for (const [id, e] of Object.entries(this.entries)) if (e.day < cutoff) delete this.entries[id];
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    const data: LedgerFile = { version: 1, entries: this.entries };
    writeFileSync(tmp, JSON.stringify(data), 'utf8');
    renameSync(tmp, this.path);
  }
}
