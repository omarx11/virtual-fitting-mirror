import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../../server/ai/errors';
import { type NormalizedImage, normalizeImage } from '../../server/ai/images';
import { type JobInput, JobManager } from '../../server/ai/jobs';
import { type KvStore, MemoryKv } from '../../server/ai/kv';
import { FileLedger, KvLedger, type UsageLedger } from '../../server/ai/ledger';
import type { ProviderRequest } from '../../server/ai/presets';
import { FakeProvider } from '../../server/ai/providers/fake';
import type { ProviderStatus, TryOnProvider } from '../../server/ai/providers/types';
import type { FakeScenario } from '../../server/config';
import type { AiJobView } from '../../src/ai/types';
import { makeImage, testConfig, waitFor } from './helpers';

const LIMITS = { maxBytes: 8 * 1024 * 1024, maxPixels: 40_000_000, longSide: 2048 };
let person: NormalizedImage;
let product: NormalizedImage;
const managers: JobManager[] = [];

async function setup(
  opts: {
    scenario?: FakeScenario;
    env?: Record<string, string>;
    provider?: TryOnProvider;
    ledger?: UsageLedger;
    kv?: KvStore;
    now?: () => number;
    stepMs?: number;
  } = {},
) {
  person ??= await normalizeImage(await makeImage(320, 480), LIMITS);
  product ??= await normalizeImage(await makeImage(200, 250, 'png'), LIMITS);
  const config = testConfig(opts.env);
  const fake = new FakeProvider({ scenario: opts.scenario ?? 'success', stepMs: opts.stepMs ?? 10 });
  const provider = opts.provider ?? fake;
  const kv = opts.kv ?? new MemoryKv(opts.now);
  const ledger = opts.ledger ?? new FileLedger(null, config.ai.maxDailyCredits, opts.now);
  const jobs = new JobManager({
    ai: config.ai,
    provider,
    ledger,
    kv,
    ...(opts.now ? { now: opts.now } : {}),
  });
  managers.push(jobs);
  return { jobs, fake, ledger, kv, config };
}

afterEach(() => {
  for (const m of managers.splice(0)) m.dispose();
});

function input(overrides: Partial<JobInput> = {}): JobInput {
  return {
    sessionId: 's1',
    clientRequestId: randomUUID(),
    fingerprint: 'fp-1',
    preset: 'max-fast-1k',
    garmentId: 'coral-crew-tee',
    person,
    product,
    category: 'tops',
    photoType: 'flat-lay',
    ...overrides,
  };
}

const ACTIVE = ['submitting', 'queued', 'generating'];
const settled = (jobs: JobManager, id: string, session = 's1') =>
  waitFor(
    () => jobs.view(id, session),
    (v: AiJobView) => !ACTIVE.includes(v.status),
  );

async function codeOf(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof AppError ? e.code : 'other';
  }
}

describe('job lifecycle', () => {
  it('submits once, maps queue/processing states, and stores one decoded result', async () => {
    // Each provider state lasts 60 ms; the backend polls every 5 ms, so every state is observed.
    const { jobs, fake, ledger } = await setup({ stepMs: 60 });
    const { job, created } = await jobs.create(input());
    expect(created).toBe(true);
    expect(job.status).toBe('submitting');
    const seen = new Set<string>();
    const done = await waitFor(
      async () => {
        const v = await jobs.view(job.id, 's1');
        seen.add(v.status);
        return v;
      },
      (v) => v.status === 'completed',
    );
    expect([...seen]).toEqual(expect.arrayContaining(['queued', 'generating', 'completed']));
    expect(done.resultAvailable).toBe(true);
    expect(done.testResult).toBe(true);
    expect(fake.submitCount).toBe(1);
    expect((await jobs.result(job.id, 's1')).contentType).toBe('image/jpeg');
    expect((await ledger.get(job.id))?.state).toBe('charged');
    // The browser never sees the provider's prediction ID.
    expect(JSON.stringify(done)).not.toContain('fake-');
  });

  it('keeps the request schema for the selected preset', async () => {
    const { jobs, fake } = await setup({ env: { AI_EXTRA_PRESETS: 'v16-performance' } });
    const { job } = await jobs.create(
      input({ preset: 'v16-performance', category: 'tops', photoType: 'flat-lay' }),
    );
    await settled(jobs, job.id);
    expect(fake.requests[0]?.model_name).toBe('tryon-v1.6');
    expect(fake.requests[0]?.inputs).toMatchObject({
      category: 'tops',
      garment_photo_type: 'flat-lay',
      num_samples: 1,
    });
  });
});

describe('spend controls', () => {
  it('deduplicates simultaneous duplicates: exactly one provider submission', async () => {
    const { jobs, fake } = await setup();
    const id = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => jobs.create(input({ clientRequestId: id }))),
    );
    expect(new Set(results.map((r) => r.job.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    await settled(jobs, results[0]?.job.id ?? '');
    expect(fake.submitCount).toBe(1);
  });

  it('refuses reuse of a request ID with different inputs', async () => {
    const { jobs } = await setup();
    const id = randomUUID();
    await jobs.create(input({ clientRequestId: id }));
    expect(await codeOf(() => jobs.create(input({ clientRequestId: id, fingerprint: 'other' })))).toBe(
      'duplicate-conflict',
    );
  });

  it('allows one active job per session and bounds global concurrency', async () => {
    const { jobs } = await setup({ scenario: 'never-completes' });
    await jobs.create(input());
    expect(await codeOf(() => jobs.create(input()))).toBe('busy');
    expect(await codeOf(() => jobs.create(input({ sessionId: 's2' })))).toBe('busy'); // global max 1
  });

  it('counts an abandoned job still in flight toward global concurrency', async () => {
    const { jobs } = await setup({ scenario: 'never-completes' });
    const { job } = await jobs.create(input());
    await jobs.abandon(job.id, 's1');
    expect(await codeOf(() => jobs.create(input()))).toBe('busy');
  });

  it('stops at the daily credit cap', async () => {
    const { jobs } = await setup({ env: { AI_MAX_DAILY_CREDITS: '1' } });
    const { job } = await jobs.create(input());
    await settled(jobs, job.id);
    expect(await codeOf(() => jobs.create(input()))).toBe('daily-limit');
  });

  it('an ambiguous submission is never retried and keeps its reservation', async () => {
    const { jobs, fake, ledger } = await setup({ scenario: 'submit-timeout' });
    const { job } = await jobs.create(input());
    const done = await settled(jobs, job.id);
    expect(done.status).toBe('uncertain');
    expect(done.error?.code).toBe('uncertain');
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.submitCount).toBe(1);
    expect((await ledger.get(job.id))?.state).toBe('uncertain');
    expect((await ledger.today()).used).toBe(1);
  });

  it('a definite rejection releases the reservation', async () => {
    const { jobs, ledger } = await setup({ scenario: 'submit-rejected' });
    const { job } = await jobs.create(input());
    const done = await settled(jobs, job.id);
    expect(done.status).toBe('failed');
    expect(done.error?.code).toBe('provider-credits');
    expect((await ledger.today()).used).toBe(0);
  });

  it('budget reservations stay sound across a restart', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'vfm-jobs-'));
    try {
      const path = join(dir, 'ledger.json');
      const first = await setup({ scenario: 'never-completes', ledger: new FileLedger(path, 1) });
      await first.jobs.create(input());
      first.jobs.dispose(); // "crash" while the job is in flight
      const second = await setup({ ledger: new FileLedger(path, 1) });
      expect(await codeOf(() => second.jobs.create(input({ sessionId: 's9' })))).toBe('daily-limit');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('provider outcomes', () => {
  it.each([
    ['fail-pose', 'failed', 'pose', 'released'],
    ['fail-moderation', 'failed', 'moderation', 'released'],
    ['bad-output', 'failed', 'provider-output', 'charged'],
    ['expired-output', 'failed', 'provider-output', 'charged'],
  ] as const)('%s → %s (%s), ledger %s', async (scenario, status, code, ledgerState) => {
    const { jobs, ledger } = await setup({ scenario });
    const { job } = await jobs.create(input());
    const done = await settled(jobs, job.id);
    expect(done.status).toBe(status);
    expect(done.error?.code).toBe(code);
    expect(done.resultAvailable).toBe(false);
    expect((await ledger.get(job.id))?.state).toBe(ledgerState);
  });

  it('enforces the overall deadline and keeps the reservation', async () => {
    let now = 1_000_000;
    const { jobs, ledger } = await setup({ scenario: 'never-completes', now: () => now });
    const { job } = await jobs.create(input());
    await waitFor(
      async () => (await jobs.view(job.id, 's1')).status,
      (s) => s === 'generating' || s === 'queued',
    );
    now += 10 * 60_000;
    const done = await settled(jobs, job.id);
    expect(done.status).toBe('uncertain');
    expect(done.error?.code).toBe('timeout');
    expect((await ledger.get(job.id))?.state).toBe('uncertain');
  });

  it('recovers from transient status failures without resubmitting', async () => {
    const fake = new FakeProvider({ scenario: 'success', stepMs: 10 });
    let failures = 3;
    const flaky: TryOnProvider = {
      name: 'fake',
      submit: (r: ProviderRequest, s: AbortSignal) => fake.submit(r, s),
      status: async (id: string): Promise<ProviderStatus> => {
        if (failures-- > 0) throw new Error('network blip');
        return fake.status(id);
      },
    };
    const { jobs } = await setup({ provider: flaky, env: { AI_POLL_INTERVAL_MS: '5' } });
    const { job } = await jobs.create(input());
    const done = await settled(jobs, job.id);
    expect(done.status).toBe('completed');
    expect(fake.submitCount).toBe(1);
  });
});

describe('ownership, abandonment and cleanup', () => {
  it('denies other sessions (indistinguishable from a missing job)', async () => {
    const { jobs } = await setup();
    const { job } = await jobs.create(input());
    await settled(jobs, job.id);
    expect(await codeOf(() => jobs.view(job.id, 's2'))).toBe('not-found');
    expect(await codeOf(() => jobs.result(job.id, 's2'))).toBe('not-found');
    expect(await codeOf(() => jobs.abandon(job.id, 's2'))).toBe('not-found');
    expect(await codeOf(() => jobs.view('no-such-job-id-000000000', 's1'))).toBe('not-found');
  });

  it('an abandoned job never stores its late result, but its cost is still recorded', async () => {
    const { jobs, ledger } = await setup();
    const { job } = await jobs.create(input());
    await jobs.abandon(job.id, 's1');
    await waitFor(
      () => jobs.inFlightCount(),
      (n) => n === 0,
    );
    const v = await jobs.view(job.id, 's1');
    expect(v.status).toBe('abandoned');
    expect(v.resultAvailable).toBe(false);
    expect(await codeOf(() => jobs.result(job.id, 's1'))).toBe('not-found');
    expect(await jobs.hasStoredResult(job.id)).toBe(false);
    expect((await ledger.get(job.id))?.state).toBe('charged');
  });

  it('expires results after the TTL', async () => {
    let now = 5_000_000;
    const { jobs } = await setup({
      now: () => now,
      env: { AI_RESULT_TTL_SECONDS: '10', AI_FAKE_STEP_MS: '1' },
    });
    const { job } = await jobs.create(input());
    // The fake provider advances with real time; our clock only matters for TTL/deadline.
    await waitFor(
      async () => (await jobs.view(job.id, 's1')).status,
      (s) => s === 'completed',
    );
    now += 11_000;
    expect((await jobs.view(job.id, 's1')).status).toBe('expired');
    expect(await codeOf(() => jobs.result(job.id, 's1'))).toBe('not-found');
    expect(await jobs.hasStoredResult(job.id)).toBe(false);
  });

  it('purging a session hides its jobs and drops their images immediately', async () => {
    const { jobs } = await setup();
    const { job } = await jobs.create(input());
    await settled(jobs, job.id);
    expect(await jobs.hasStoredResult(job.id)).toBe(true);
    await jobs.purgeSession('s1');
    expect(await codeOf(() => jobs.view(job.id, 's1'))).toBe('not-found');
    expect(await jobs.hasStoredResult(job.id)).toBe(false);
  });
});

// Vercel runs several short-lived instances that share one Redis. Each "instance" here is its own
// JobManager over the same store, ledger and provider account.
describe('several server instances sharing one store', () => {
  async function instances(
    opts: { scenario?: FakeScenario; now?: () => number; env?: Record<string, string> } = {},
  ) {
    const kv = new MemoryKv(opts.now);
    const config = testConfig(opts.env);
    const ledger = new KvLedger(kv, config.ai.maxDailyCredits, opts.now);
    const fake = new FakeProvider({ scenario: opts.scenario ?? 'success', stepMs: 10 });
    const shared = { provider: fake, kv, ledger, ...opts };
    return { fake, ledger, a: (await setup(shared)).jobs, b: (await setup(shared)).jobs };
  }

  it('a duplicate sent to two instances at once creates one provider job', async () => {
    const { fake, a, b } = await instances();
    const id = randomUUID();
    const [x, y] = await Promise.all([
      a.create(input({ clientRequestId: id })),
      b.create(input({ clientRequestId: id })),
    ]);
    expect(x.job.id).toBe(y.job.id);
    expect([x.created, y.created].filter(Boolean)).toHaveLength(1);
    await settled(a, x.job.id);
    expect(fake.submitCount).toBe(1);
  });

  it('bounds global concurrency across instances', async () => {
    const { a, b } = await instances({ scenario: 'never-completes' });
    await a.create(input());
    expect(await codeOf(() => b.create(input({ sessionId: 's2' })))).toBe('busy');
  });

  it('another instance finishes a job whose submitting instance disappeared', async () => {
    const { fake, ledger, a, b } = await instances();
    const { job } = await a.create(input());
    await waitFor(
      async () => (await b.view(job.id, 's1')).status,
      (s) => s !== 'submitting',
    );
    a.dispose(); // the instance that submitted (and was polling) is gone
    const done = await settled(b, job.id);
    expect(done.status).toBe('completed');
    expect((await b.result(job.id, 's1')).contentType).toBe('image/jpeg');
    expect(fake.submitCount).toBe(1);
    expect((await ledger.get(job.id))?.state).toBe('charged');
  });

  it('a submission lost with its instance becomes uncertain, keeps its credit and frees the slot', async () => {
    let now = 2_000_000;
    const hung: TryOnProvider = {
      name: 'fake',
      submit: () => new Promise(() => undefined), // the instance dies mid-request
      status: async () => ({ state: 'processing', output: [], errorName: null, creditsUsed: null }),
    };
    const kv = new MemoryKv(() => now);
    const config = testConfig();
    const ledger = new KvLedger(kv, config.ai.maxDailyCredits, () => now);
    const a = (await setup({ provider: hung, kv, ledger, now: () => now })).jobs;
    const b = (await setup({ provider: hung, kv, ledger, now: () => now })).jobs;
    const { job } = await a.create(input());
    a.dispose();
    expect((await b.view(job.id, 's1')).status).toBe('submitting');
    now += (config.ai.submitTimeoutSeconds + 16) * 1000; // past the submission's lease
    const done = await b.view(job.id, 's1');
    expect(done.status).toBe('uncertain');
    expect((await ledger.get(job.id))?.state).toBe('uncertain');
    expect(await b.inFlightCount()).toBe(0);
  });
});
