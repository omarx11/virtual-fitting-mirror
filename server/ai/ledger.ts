/**
 * Durable daily credit ledger — the spending cap. Rate limiting alone is not a cap.
 *
 * - Scope: one kiosk (FileLedger, a JSON file) or every Vercel instance of a deployment (KvLedger,
 *   the shared Redis database). The day is the UTC calendar day.
 * - Contents: job IDs, credit counts, states and timestamps only — never images or customer data.
 * - Credits are RESERVED before the provider is called (atomically: two concurrent requests cannot
 *   both pass the check), then CHARGED (completed), RELEASED (the provider documents that failed
 *   predictions are not charged, or the request was definitely never accepted) or kept as UNCERTAIN
 *   (timeouts, lost connections, unknown outcomes) — uncertain credits keep counting.
 * - A charged or released entry is final: late status reads cannot rewrite history.
 * - FileLedger writes every change to a temp file renamed over the ledger (a crash leaves the old
 *   or the new file) and fails CLOSED on a corrupt file: no new generations until it is fixed.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AiUsageDay } from '../../src/ai/types';
import { type KvStore, withLock } from './kv';

export type LedgerState = 'reserved' | 'charged' | 'released' | 'uncertain';

export interface LedgerEntry {
  /** UTC day (YYYY-MM-DD) the reservation counts against. */
  day: string;
  credits: number;
  state: LedgerState;
  at: number;
}

export interface LedgerToday {
  used: number;
  /** Null when there is no daily cap. */
  remaining: number | null;
  uncertain: number;
}

export interface UsageLedger {
  /** Set when the stored ledger cannot be trusted; blocks all reservations. */
  readonly loadError: string | null;
  /** Credits allowed per UTC day; null = no cap (reservations are still recorded). */
  readonly cap: number | null;
  /** Atomically checks the cap and records a reservation. False when it would exceed it. */
  reserve(id: string, credits: number): Promise<boolean>;
  /** Completed: record the credits actually used (from the provider when it reports them). */
  charge(id: string, credits?: number): Promise<void>;
  /** Definitely not charged (never accepted, or a documented non-billable failure). */
  release(id: string): Promise<void>;
  /** Outcome unknown: keep counting the reservation. */
  markUncertain(id: string): Promise<void>;
  get(id: string): Promise<LedgerEntry | undefined>;
  today(): Promise<LedgerToday>;
  /** Per-day totals, newest first (only days with activity). */
  summary(days?: number): Promise<AiUsageDay[]>;
}

/** Entries older than this are pruned (kept this long for the staff usage history). */
const KEEP_DAYS = 90;
const DAY_MS = 86_400_000;
const STATES: readonly LedgerState[] = ['reserved', 'charged', 'released', 'uncertain'];

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Credits that count against a day's cap: everything except released entries. */
function usedCredits(entries: Iterable<LedgerEntry>): number {
  let sum = 0;
  for (const e of entries) if (e.state !== 'released') sum += e.credits;
  return sum;
}

function todayOf(entries: LedgerEntry[], cap: number | null): LedgerToday {
  const used = usedCredits(entries);
  return {
    used,
    remaining: cap === null ? null : Math.max(0, cap - used),
    uncertain: entries.filter((e) => e.state === 'uncertain').length,
  };
}

/** Whether `total` credits would exceed the cap (never, without one). */
function overCap(total: number, cap: number | null): boolean {
  return cap !== null && total > cap;
}

function summarize(entries: Iterable<LedgerEntry>, cutoff: string): AiUsageDay[] {
  const byDay = new Map<string, AiUsageDay>();
  for (const e of entries) {
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

/** Applies a state change; returns null when the entry is final (charged/released). */
function transition(e: LedgerEntry, state: LedgerState, at: number, credits?: number): LedgerEntry | null {
  if (e.state === 'charged' || e.state === 'released') return null;
  const next = { ...e, state, at };
  if (credits !== undefined && Number.isFinite(credits) && credits >= 0) next.credits = credits;
  return next;
}

function validEntry(e: unknown): e is LedgerEntry {
  const v = e as LedgerEntry | null;
  return (
    typeof v?.day === 'string' &&
    Number.isFinite(v.credits) &&
    STATES.includes(v.state) &&
    Number.isFinite(v.at)
  );
}

// ---- One kiosk: a JSON file (or memory only, for tests) -------------------------------------------

interface LedgerFile {
  version: 1;
  entries: Record<string, LedgerEntry>;
}

export class FileLedger implements UsageLedger {
  private entries: Record<string, LedgerEntry> = {};
  readonly loadError: string | null = null;

  constructor(
    private readonly path: string | null,
    private readonly dailyCap: number | null,
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
          // Entries written before `at` was validated may lack it; everything else must be exact.
          if (!validEntry({ ...e, at: e?.at ?? 0 })) throw new Error(`bad entry ${id}`);
        }
        this.entries = parsed.entries;
      } catch (error) {
        this.loadError = `The usage ledger at ${path} is corrupt (${(error as Error).message}); AI is blocked until it is fixed or removed.`;
      }
    }
  }

  get cap(): number | null {
    return this.dailyCap;
  }

  private todays(): LedgerEntry[] {
    const today = utcDay(this.now());
    return Object.values(this.entries).filter((e) => e.day === today);
  }

  async today(): Promise<LedgerToday> {
    return todayOf(this.todays(), this.dailyCap);
  }

  async summary(days = 30): Promise<AiUsageDay[]> {
    return summarize(Object.values(this.entries), utcDay(this.now() - (days - 1) * DAY_MS));
  }

  async reserve(id: string, credits: number): Promise<boolean> {
    // Synchronous from check to write: concurrent callers cannot interleave in one process.
    if (this.loadError || this.entries[id]) return false;
    if (overCap(usedCredits(this.todays()) + credits, this.dailyCap)) return false;
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

  async charge(id: string, credits?: number) {
    this.update(id, 'charged', credits);
  }

  async release(id: string) {
    this.update(id, 'released');
  }

  async markUncertain(id: string) {
    this.update(id, 'uncertain');
  }

  async get(id: string) {
    return this.entries[id];
  }

  private update(id: string, state: LedgerState, credits?: number): void {
    const e = this.entries[id];
    const next = e ? transition(e, state, this.now(), credits) : null;
    if (!next) return;
    this.entries[id] = next;
    try {
      this.persist();
    } catch (error) {
      console.error(`[ai] could not update the usage ledger: ${(error as Error).message}`);
    }
  }

  private persist(): void {
    const cutoff = utcDay(this.now() - KEEP_DAYS * DAY_MS);
    for (const [id, e] of Object.entries(this.entries)) if (e.day < cutoff) delete this.entries[id];
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    const data: LedgerFile = { version: 1, entries: this.entries };
    writeFileSync(tmp, JSON.stringify(data), 'utf8');
    renameSync(tmp, this.path);
  }
}

// ---- Every instance of a deployment: the shared key-value store (Redis on Vercel) ----------------

const dayKey = (day: string) => `ledger:day:${day}`;
const idKey = (id: string) => `ledger:id:${id}`;
const KEEP_MS = KEEP_DAYS * DAY_MS;

/**
 * One hash per UTC day (field = job ID, value = JSON entry) plus an ID → day index, both expiring
 * after KEEP_DAYS. Reservations take a short cross-instance lock, so the cap check and the write
 * are atomic across every server instance.
 */
export class KvLedger implements UsageLedger {
  readonly loadError = null;

  constructor(
    private readonly kv: KvStore,
    private readonly dailyCap: number | null,
    private readonly now: () => number = Date.now,
  ) {}

  get cap(): number | null {
    return this.dailyCap;
  }

  private async dayEntries(day: string): Promise<LedgerEntry[]> {
    const raw = await this.kv.hgetall(dayKey(day));
    return Object.values(raw)
      .map((v) => {
        try {
          return JSON.parse(v) as unknown;
        } catch {
          return null;
        }
      })
      .filter(validEntry);
  }

  async today(): Promise<LedgerToday> {
    return todayOf(await this.dayEntries(utcDay(this.now())), this.dailyCap);
  }

  async summary(days = 30): Promise<AiUsageDay[]> {
    const list = Array.from({ length: days }, (_, i) => utcDay(this.now() - i * DAY_MS));
    const all = await Promise.all(list.map((d) => this.dayEntries(d)));
    return summarize(all.flat(), list[list.length - 1] ?? '');
  }

  async reserve(id: string, credits: number): Promise<boolean> {
    return withLock(this.kv, 'ledger', async () => {
      const day = utcDay(this.now());
      if ((await this.kv.hget(dayKey(day), id)) !== null) return false;
      if (overCap(usedCredits(await this.dayEntries(day)) + credits, this.dailyCap)) return false;
      const entry: LedgerEntry = { day, credits, state: 'reserved', at: this.now() };
      await Promise.all([
        this.kv.hset(dayKey(day), id, JSON.stringify(entry), KEEP_MS),
        this.kv.set(idKey(id), day, { pxMs: KEEP_MS }),
      ]);
      return true;
    });
  }

  async get(id: string): Promise<LedgerEntry | undefined> {
    const day = await this.kv.get(idKey(id));
    if (!day) return undefined;
    const raw = await this.kv.hget(dayKey(day), id);
    if (!raw) return undefined;
    try {
      const e = JSON.parse(raw) as unknown;
      return validEntry(e) ? e : undefined;
    } catch {
      return undefined;
    }
  }

  // Updates to one entry come only from the holder of that job's lease (see jobs.ts), so a plain
  // read-modify-write of its own field cannot lose a concurrent change.
  private async update(id: string, state: LedgerState, credits?: number): Promise<void> {
    const e = await this.get(id);
    const next = e ? transition(e, state, this.now(), credits) : null;
    if (next) await this.kv.hset(dayKey(next.day), id, JSON.stringify(next));
  }

  charge(id: string, credits?: number) {
    return this.update(id, 'charged', credits);
  }

  release(id: string) {
    return this.update(id, 'released');
  }

  markUncertain(id: string) {
    return this.update(id, 'uncertain');
  }
}
