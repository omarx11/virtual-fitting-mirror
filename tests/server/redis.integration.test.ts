// Opt-in: the Redis store, ledger and job flow against a REAL Redis over the Upstash REST API,
// through the same @upstash/redis client Vercel uses. Skipped unless VFM_REDIS_TEST_URL is set.
//
// Local run (Docker; Redis plus an Upstash-compatible REST proxy):
//   docker network create vfm-test-net
//   docker run -d --name vfm-test-redis --network vfm-test-net redis:7-alpine
//   docker run -d --name vfm-test-srh --network vfm-test-net -p 127.0.0.1:8079:80 \
//     -e SRH_MODE=env -e SRH_TOKEN=local-test-token \
//     -e SRH_CONNECTION_STRING=redis://vfm-test-redis:6379 hiett/serverless-redis-http:latest
//   VFM_REDIS_TEST_URL=http://127.0.0.1:8079 VFM_REDIS_TEST_TOKEN=local-test-token npx vitest run redis
// Never point it at a production database: every key it writes has a random test prefix.
import { randomUUID } from 'node:crypto';
import { Redis } from '@upstash/redis';
import { afterAll, describe, expect, it } from 'vitest';
import { normalizeImage } from '../../server/ai/images';
import { JobManager } from '../../server/ai/jobs';
import { RedisKv, withLock } from '../../server/ai/kv';
import { KvLedger } from '../../server/ai/ledger';
import { FakeProvider } from '../../server/ai/providers/fake';
import { makeImage, testConfig, waitFor } from './helpers';

const url = process.env.VFM_REDIS_TEST_URL;
const token = process.env.VFM_REDIS_TEST_TOKEN ?? '';

const client = () =>
  new Redis({ url: url ?? '', token, automaticDeserialization: false, enableAutoPipelining: true });
const managers: JobManager[] = [];
afterAll(() => {
  for (const m of managers) m.dispose();
});

describe.skipIf(!url)('real Redis (Upstash REST API)', () => {
  const kv = () => new RedisKv(client(), `vfm-test:${randomUUID()}:`);

  it('implements every store operation', async () => {
    const s = kv();
    expect(await s.set('a', 'x')).toBe(true);
    expect(await s.set('a', 'y', { nx: true })).toBe(false);
    expect(await s.get('a')).toBe('x');
    expect(await s.mget(['a', 'missing'])).toEqual(['x', null]);
    // Values stay exactly as written (no implicit JSON conversion).
    expect(await s.set('json', '{"n":1}')).toBe(true);
    expect(await s.get('json')).toBe('{"n":1}');
    expect(await s.set('num', '007')).toBe(true);
    expect(await s.get('num')).toBe('007');
    expect(await s.delIfEquals('a', 'wrong')).toBe(false);
    expect(await s.delIfEquals('a', 'x')).toBe(true);
    expect(await s.get('a')).toBeNull();
    expect(await s.pexpire('missing', 1000)).toBe(false);
    await s.set('ttl', 'v', { pxMs: 150 });
    expect(await s.get('ttl')).toBe('v');
    await new Promise((r) => setTimeout(r, 300));
    expect(await s.get('ttl')).toBeNull();
    expect(await s.incr('n', 60_000)).toBe(1);
    expect(await s.incr('n', 60_000)).toBe(2);
    await s.sadd('set', 'm1');
    await s.sadd('set', 'm2', 60_000);
    expect((await s.smembers('set')).sort()).toEqual(['m1', 'm2']);
    await s.srem('set', 'm1');
    expect(await s.smembers('set')).toEqual(['m2']);
    await s.hset('h', 'f', 'v1', 60_000);
    expect(await s.hget('h', 'f')).toBe('v1');
    expect(await s.hgetall('h')).toEqual({ f: 'v1' });
    expect(await s.hgetall('missing')).toEqual({});
    expect(await s.del('h', 'set', 'n', 'json', 'num')).toBe(5);
  });

  it('a lock excludes concurrent holders', async () => {
    const s = kv();
    let inside = 0;
    let max = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        withLock(s, 'x', async () => {
          inside++;
          max = Math.max(max, inside);
          await new Promise((r) => setTimeout(r, 20));
          inside--;
        }),
      ),
    );
    expect(max).toBe(1);
  });

  it('the credit cap holds under concurrent reservations from many instances', async () => {
    const s = kv();
    const ledgers = Array.from({ length: 5 }, () => new KvLedger(s, 3));
    const results = await Promise.all(
      ledgers.flatMap((l, i) => [l.reserve(`a${i}`, 1), l.reserve(`b${i}`, 1)]),
    );
    expect(results.filter(Boolean)).toHaveLength(3);
    expect((await ledgers[0]?.today())?.used).toBe(3);
  });

  it('runs a job end to end on two instances sharing the database', async () => {
    const s = kv();
    const config = testConfig();
    const ledger = new KvLedger(s, config.ai.maxDailyCredits);
    const fake = new FakeProvider({ scenario: 'success', stepMs: 30 });
    const a = new JobManager({ ai: config.ai, provider: fake, ledger, kv: s });
    const b = new JobManager({ ai: config.ai, provider: fake, ledger, kv: s });
    managers.push(a, b);
    const limits = { maxBytes: 8 << 20, maxPixels: 4e7, longSide: 2048 };
    const input = {
      sessionId: 's1',
      clientRequestId: randomUUID(),
      fingerprint: 'fp',
      preset: 'max-fast-1k' as const,
      garmentId: 'coral-crew-tee',
      person: await normalizeImage(await makeImage(320, 480), limits),
      product: await normalizeImage(await makeImage(200, 250, 'png'), limits),
      category: 'tops' as const,
      photoType: 'flat-lay' as const,
    };
    const [x, y] = await Promise.all([a.create(input), b.create(input)]);
    expect(x.job.id).toBe(y.job.id);
    await waitFor(
      async () => (await b.view(x.job.id, 's1')).status,
      (st) => st !== 'submitting',
      10_000,
    );
    a.dispose(); // the submitting instance goes away; b finishes the job from the shared state
    const done = await waitFor(
      () => b.view(x.job.id, 's1'),
      (v) => v.status === 'completed',
      10_000,
    );
    expect(done.resultAvailable).toBe(true);
    const image = await b.result(x.job.id, 's1');
    expect([image.buffer[0], image.buffer[1]]).toEqual([0xff, 0xd8]);
    expect(fake.submitCount).toBe(1);
    expect((await ledger.get(x.job.id))?.state).toBe('charged');
    await b.purgeSession('s1');
    expect(await b.hasStoredResult(x.job.id)).toBe(false);
  });
});
