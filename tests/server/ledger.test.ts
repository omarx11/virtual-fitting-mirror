import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { UsageLedger } from '../../server/ai/ledger';

const dirs: string[] = [];
function tempPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vfm-ledger-'));
  dirs.push(dir);
  return join(dir, 'nested', 'ledger.json');
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('usage ledger (daily credit cap)', () => {
  it('reserves up to the cap and refuses beyond it', () => {
    const ledger = new UsageLedger(null, 3);
    expect(ledger.reserve('a', 1)).toBe(true);
    expect(ledger.reserve('b', 2)).toBe(true);
    expect(ledger.reserve('c', 1)).toBe(false);
    expect(ledger.remainingToday()).toBe(0);
  });

  it('releases only definitely-uncharged work; uncertain and charged keep counting', () => {
    const ledger = new UsageLedger(null, 2);
    ledger.reserve('ok', 1);
    ledger.reserve('lost', 1);
    ledger.charge('ok');
    ledger.markUncertain('lost');
    expect(ledger.reserve('x', 1)).toBe(false);
    ledger.release('ok'); // a charged entry is final
    expect(ledger.get('ok')?.state).toBe('charged');
    const l2 = new UsageLedger(null, 2);
    l2.reserve('r', 2);
    l2.release('r');
    expect(l2.reserve('s', 2)).toBe(true);
  });

  it('records provider-reported credits on charge', () => {
    const ledger = new UsageLedger(null, 10);
    ledger.reserve('a', 1);
    ledger.charge('a', 3);
    expect(ledger.usedToday()).toBe(3);
  });

  it('survives a restart: reservations of a crashed process stay counted', () => {
    const path = tempPath();
    const first = new UsageLedger(path, 2);
    expect(first.reserve('in-flight', 1)).toBe(true);
    expect(first.reserve('done', 1)).toBe(true);
    first.charge('done');
    // "Restart": a new instance reads the same file.
    const second = new UsageLedger(path, 2);
    expect(second.usedToday()).toBe(2);
    expect(second.reserve('next', 1)).toBe(false);
    const stored = JSON.parse(readFileSync(path, 'utf8'));
    expect(Object.keys(stored.entries)).toEqual(['in-flight', 'done']);
    // Non-image data only.
    expect(JSON.stringify(stored)).not.toMatch(/base64|data:image/);
  });

  it('uses the UTC day: yesterday’s usage does not count today', () => {
    let now = Date.parse('2026-09-27T23:30:00Z');
    const ledger = new UsageLedger(null, 1, () => now);
    expect(ledger.reserve('a', 1)).toBe(true);
    expect(ledger.reserve('b', 1)).toBe(false);
    now = Date.parse('2026-09-28T00:10:00Z');
    expect(ledger.reserve('b', 1)).toBe(true);
  });

  it('fails closed on a corrupt ledger file', () => {
    const path = tempPath();
    new UsageLedger(path, 5).reserve('a', 1);
    writeFileSync(path, '{not json');
    const ledger = new UsageLedger(path, 5);
    expect(ledger.loadError).toMatch(/corrupt/);
    expect(ledger.reserve('b', 1)).toBe(false);
  });

  it('refuses a duplicate reservation ID', () => {
    const ledger = new UsageLedger(null, 5);
    expect(ledger.reserve('a', 1)).toBe(true);
    expect(ledger.reserve('a', 1)).toBe(false);
  });
});
