import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryKv } from '../../server/ai/kv';
import { FileLedger, KvLedger, type UsageLedger } from '../../server/ai/ledger';

const dirs: string[] = [];
function tempPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vfm-ledger-'));
  dirs.push(dir);
  return join(dir, 'nested', 'ledger.json');
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// The cap rules are the same for the kiosk (file) and for Vercel (shared key-value store).
const kinds: [string, (cap: number, now?: () => number) => UsageLedger][] = [
  ['file ledger', (cap, now) => new FileLedger(null, cap, now)],
  ['shared-store ledger', (cap, now) => new KvLedger(new MemoryKv(now), cap, now)],
];

describe.each(kinds)('%s (daily credit cap)', (_name, make) => {
  it('reserves up to the cap and refuses beyond it', async () => {
    const ledger = make(3);
    expect(await ledger.reserve('a', 1)).toBe(true);
    expect(await ledger.reserve('b', 2)).toBe(true);
    expect(await ledger.reserve('c', 1)).toBe(false);
    expect((await ledger.today()).remaining).toBe(0);
  });

  it('checks the cap atomically under concurrent reservations', async () => {
    const ledger = make(3);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => ledger.reserve(`r${i}`, 1)));
    expect(results.filter(Boolean)).toHaveLength(3);
    expect((await ledger.today()).used).toBe(3);
  });

  it('releases only definitely-uncharged work; uncertain and charged keep counting', async () => {
    const ledger = make(2);
    await ledger.reserve('ok', 1);
    await ledger.reserve('lost', 1);
    await ledger.charge('ok');
    await ledger.markUncertain('lost');
    expect(await ledger.reserve('x', 1)).toBe(false);
    await ledger.release('ok'); // a charged entry is final
    expect((await ledger.get('ok'))?.state).toBe('charged');
    expect((await ledger.today()).uncertain).toBe(1);
    const l2 = make(2);
    await l2.reserve('r', 2);
    await l2.release('r');
    expect(await l2.reserve('s', 2)).toBe(true);
  });

  it('records provider-reported credits on charge', async () => {
    const ledger = make(10);
    await ledger.reserve('a', 1);
    await ledger.charge('a', 3);
    expect((await ledger.today()).used).toBe(3);
  });

  it('uses the UTC day: yesterday’s usage does not count today', async () => {
    let now = Date.parse('2026-09-27T23:30:00Z');
    const ledger = make(1, () => now);
    expect(await ledger.reserve('a', 1)).toBe(true);
    expect(await ledger.reserve('b', 1)).toBe(false);
    now = Date.parse('2026-09-28T00:10:00Z');
    expect(await ledger.reserve('b', 1)).toBe(true);
    const days = await ledger.summary(30);
    expect(days.map((d) => d.day)).toEqual(['2026-09-28', '2026-09-27']);
    expect(days[1]).toMatchObject({ credits: 1, generations: 0 });
  });

  it('refuses a duplicate reservation ID', async () => {
    const ledger = make(5);
    expect(await ledger.reserve('a', 1)).toBe(true);
    expect(await ledger.reserve('a', 1)).toBe(false);
  });
});

describe('file ledger persistence', () => {
  it('survives a restart: reservations of a crashed process stay counted', async () => {
    const path = tempPath();
    const first = new FileLedger(path, 2);
    expect(await first.reserve('in-flight', 1)).toBe(true);
    expect(await first.reserve('done', 1)).toBe(true);
    await first.charge('done');
    // "Restart": a new instance reads the same file.
    const second = new FileLedger(path, 2);
    expect((await second.today()).used).toBe(2);
    expect(await second.reserve('next', 1)).toBe(false);
    const stored = JSON.parse(readFileSync(path, 'utf8'));
    expect(Object.keys(stored.entries)).toEqual(['in-flight', 'done']);
    // Non-image data only.
    expect(JSON.stringify(stored)).not.toMatch(/base64|data:image/);
  });

  it('fails closed on a corrupt ledger file', async () => {
    const path = tempPath();
    await new FileLedger(path, 5).reserve('a', 1);
    writeFileSync(path, '{not json');
    const ledger = new FileLedger(path, 5);
    expect(ledger.loadError).toMatch(/corrupt/);
    expect(await ledger.reserve('b', 1)).toBe(false);
  });
});

describe('shared-store ledger', () => {
  it('is shared by every instance using the same store', async () => {
    const kv = new MemoryKv();
    const a = new KvLedger(kv, 2);
    const b = new KvLedger(kv, 2);
    expect(await a.reserve('x', 1)).toBe(true);
    expect(await b.reserve('y', 1)).toBe(true);
    expect(await a.reserve('z', 1)).toBe(false);
    await b.charge('x');
    expect((await a.get('x'))?.state).toBe('charged');
  });
});
