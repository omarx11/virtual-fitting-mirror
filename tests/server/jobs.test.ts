import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../../server/ai/errors';
import { type NormalizedImage, normalizeImage } from '../../server/ai/images';
import { type JobInput, JobManager } from '../../server/ai/jobs';
import { UsageLedger } from '../../server/ai/ledger';
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
    now?: () => number;
    stepMs?: number;
  } = {},
) {
  person ??= await normalizeImage(await makeImage(320, 480), LIMITS);
  product ??= await normalizeImage(await makeImage(200, 250, 'png'), LIMITS);
  const config = testConfig(opts.env);
  const fake = new FakeProvider({ scenario: opts.scenario ?? 'success', stepMs: opts.stepMs ?? 10 });
  const provider = opts.provider ?? fake;
  const ledger = opts.ledger ?? new UsageLedger(null, config.ai.maxDailyCredits);
  const jobs = new JobManager({ ai: config.ai, provider, ledger, ...(opts.now ? { now: opts.now } : {}) });
  managers.push(jobs);
  return { jobs, fake, ledger, config };
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

const settled = (jobs: JobManager, id: string, session = 's1') =>
  waitFor(
    () => jobs.view(id, session),
    (v: AiJobView) => !['submitting', 'queued', 'generating'].includes(v.status),
  );

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof AppError ? e.code : 'other';
  }
}

describe('job lifecycle', () => {
  it('submits once, maps queue/processing states, and stores one decoded result', async () => {
    // Each provider state lasts 60 ms; the backend polls every 5 ms, so every state is observed.
    const { jobs, fake, ledger } = await setup({ stepMs: 60 });
    const { job, created } = jobs.create(input());
    expect(created).toBe(true);
    expect(job.status).toBe('submitting');
    const seen = new Set<string>();
    const done = await waitFor(
      () => {
        const v = jobs.view(job.id, 's1');
        seen.add(v.status);
        return v;
      },
      (v) => v.status === 'completed',
    );
    expect([...seen]).toEqual(expect.arrayContaining(['queued', 'generating', 'completed']));
    expect(done.resultAvailable).toBe(true);
    expect(done.testResult).toBe(true);
    expect(fake.submitCount).toBe(1);
    expect(jobs.result(job.id, 's1').contentType).toBe('image/jpeg');
    expect(ledger.get(job.id)?.state).toBe('charged');
    // The browser never sees the provider's prediction ID.
    expect(JSON.stringify(done)).not.toContain('fake-');
  });

  it('keeps the request schema for the selected preset', async () => {
    const { jobs, fake } = await setup({ env: { AI_EXTRA_PRESETS: 'v16-performance' } });
    const { job } = jobs.create(
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
      Array.from({ length: 5 }, () =>
        Promise.resolve().then(() => jobs.create(input({ clientRequestId: id }))),
      ),
    );
    expect(new Set(results.map((r) => r.job.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    await settled(jobs, results[0]?.job.id ?? '');
    expect(fake.submitCount).toBe(1);
  });

  it('refuses reuse of a request ID with different inputs', async () => {
    const { jobs } = await setup();
    const id = randomUUID();
    jobs.create(input({ clientRequestId: id }));
    expect(codeOf(() => jobs.create(input({ clientRequestId: id, fingerprint: 'other' })))).toBe(
      'duplicate-conflict',
    );
  });

  it('allows one active job per session and bounds global concurrency', async () => {
    const { jobs } = await setup({ scenario: 'never-completes' });
    jobs.create(input());
    expect(codeOf(() => jobs.create(input()))).toBe('busy');
    expect(codeOf(() => jobs.create(input({ sessionId: 's2' })))).toBe('busy'); // global max 1
  });

  it('counts an abandoned job still in flight toward global concurrency', async () => {
    const { jobs } = await setup({ scenario: 'never-completes' });
    const { job } = jobs.create(input());
    jobs.abandon(job.id, 's1');
    expect(codeOf(() => jobs.create(input()))).toBe('busy');
  });

  it('stops at the daily credit cap', async () => {
    const { jobs } = await setup({ env: { AI_MAX_DAILY_CREDITS: '1' } });
    const { job } = jobs.create(input());
    await settled(jobs, job.id);
    expect(codeOf(() => jobs.create(input()))).toBe('daily-limit');
  });

  it('an ambiguous submission is never retried and keeps its reservation', async () => {
    const { jobs, fake, ledger } = await setup({ scenario: 'submit-timeout' });
    const { job } = jobs.create(input());
    const done = await settled(jobs, job.id);
    expect(done.status).toBe('uncertain');
    expect(done.error?.code).toBe('uncertain');
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.submitCount).toBe(1);
    expect(ledger.get(job.id)?.state).toBe('uncertain');
    expect(ledger.usedToday()).toBe(1);
  });

  it('a definite rejection releases the reservation', async () => {
    const { jobs, ledger } = await setup({ scenario: 'submit-rejected' });
    const { job } = jobs.create(input());
    const done = await settled(jobs, job.id);
    expect(done.status).toBe('failed');
    expect(done.error?.code).toBe('provider-credits');
    expect(ledger.usedToday()).toBe(0);
  });

  it('budget reservations stay sound across a restart', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'vfm-jobs-'));
    try {
      const path = join(dir, 'ledger.json');
      const first = await setup({ scenario: 'never-completes', ledger: new UsageLedger(path, 1) });
      first.jobs.create(input());
      first.jobs.dispose(); // "crash" while the job is in flight
      const second = await setup({ ledger: new UsageLedger(path, 1) });
      expect(codeOf(() => second.jobs.create(input({ sessionId: 's9' })))).toBe('daily-limit');
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
    const { job } = jobs.create(input());
    const done = await settled(jobs, job.id);
    expect(done.status).toBe(status);
    expect(done.error?.code).toBe(code);
    expect(done.resultAvailable).toBe(false);
    expect(ledger.get(job.id)?.state).toBe(ledgerState);
  });

  it('enforces the overall deadline and keeps the reservation', async () => {
    let now = 1_000_000;
    const { jobs, ledger } = await setup({ scenario: 'never-completes', now: () => now });
    const { job } = jobs.create(input());
    await waitFor(
      () => jobs.view(job.id, 's1').status,
      (s) => s === 'generating' || s === 'queued',
    );
    now += 10 * 60_000;
    const done = await settled(jobs, job.id);
    expect(done.status).toBe('uncertain');
    expect(done.error?.code).toBe('timeout');
    expect(ledger.get(job.id)?.state).toBe('uncertain');
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
    const { job } = jobs.create(input());
    const done = await settled(jobs, job.id);
    expect(done.status).toBe('completed');
    expect(fake.submitCount).toBe(1);
  });
});

describe('ownership, abandonment and cleanup', () => {
  it('denies other sessions (indistinguishable from a missing job)', async () => {
    const { jobs } = await setup();
    const { job } = jobs.create(input());
    await settled(jobs, job.id);
    expect(codeOf(() => jobs.view(job.id, 's2'))).toBe('not-found');
    expect(codeOf(() => jobs.result(job.id, 's2'))).toBe('not-found');
    expect(codeOf(() => jobs.abandon(job.id, 's2'))).toBe('not-found');
    expect(codeOf(() => jobs.view('no-such-job-id-000000000', 's1'))).toBe('not-found');
  });

  it('an abandoned job never stores its late result, but its cost is still recorded', async () => {
    const { jobs, ledger } = await setup();
    const { job } = jobs.create(input());
    jobs.abandon(job.id, 's1');
    await waitFor(
      () => jobs.inFlightCount(),
      (n) => n === 0,
    );
    const v = jobs.view(job.id, 's1');
    expect(v.status).toBe('abandoned');
    expect(v.resultAvailable).toBe(false);
    expect(codeOf(() => jobs.result(job.id, 's1'))).toBe('not-found');
    expect(ledger.get(job.id)?.state).toBe('charged');
  });

  it('expires results after the TTL', async () => {
    let now = 5_000_000;
    const { jobs } = await setup({
      now: () => now,
      env: { AI_RESULT_TTL_SECONDS: '10', AI_FAKE_STEP_MS: '1' },
    });
    const { job } = jobs.create(input());
    // The fake provider advances with real time; our clock only matters for TTL/deadline.
    await waitFor(
      () => jobs.view(job.id, 's1').status,
      (s) => s === 'completed',
    );
    now += 11_000;
    jobs.sweep();
    expect(jobs.view(job.id, 's1').status).toBe('expired');
    expect(codeOf(() => jobs.result(job.id, 's1'))).toBe('not-found');
  });

  it('purging a session drops its jobs and images immediately', async () => {
    const { jobs } = await setup();
    const { job } = jobs.create(input());
    await settled(jobs, job.id);
    jobs.purgeSession('s1');
    expect(codeOf(() => jobs.view(job.id, 's1'))).toBe('not-found');
    expect(jobs.size()).toBe(0);
  });
});
