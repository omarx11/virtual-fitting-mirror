/**
 * Job store: one explicit Generate action → at most ONE provider submission, on one kiosk process or
 * across many short-lived Vercel Function instances sharing one key-value store (see kv.ts).
 *
 * Spend controls, applied by `create()` under a cross-instance lock, so concurrent requests (even on
 * different instances) cannot interleave between check and insert:
 *   1. Deduplication of (session, client request UUID). A repeat with identical inputs returns the
 *      existing job; a repeat with different inputs is refused.
 *   2. One active job per session, and a global concurrency bound (abandoned jobs still in flight at
 *      the provider count, because they still cost money and capacity).
 *   3. A credit reservation in the daily ledger.
 * A submission is never retried. Ambiguous failures become 'uncertain' and keep their reservation.
 *
 * Progress: after submitting, the instance that accepted the job keeps polling the provider in the
 * background (on Vercel the platform keeps that instance alive for it via `waitUntil`). Every status
 * read by the browser also advances an overdue job itself, so a job survives the loss of the
 * instance that submitted it. A per-job lease guarantees one provider status call at a time, and
 * only the lease holder changes a job's provider state or ledger entry.
 *
 * Visitor keys: a job paid with a visitor's own API key (`userKey`) uses a provider built from that
 * key, is not counted in the operator's daily ledger or global concurrency bound, and stores only a
 * hash of the key. The submitting instance keeps the provider in memory while it polls; any other
 * instance can read the job's status only when the owner's status read carries the same key.
 *
 * Images: inputs exist only in the memory of the submitting instance until submission; the result
 * is stored once, with a time to live, and never for an abandoned or purged job. Abandonment and
 * purging are separate flag keys, so they are never lost to a concurrent status update.
 */
import { randomBytes, randomInt } from 'node:crypto';
import type {
  AiGarmentCategory,
  AiGarmentPhotoType,
  AiJobStatus,
  AiJobView,
  AiPresetId,
} from '../../src/ai/types';
import type { AiConfig } from '../config';
import { AppError, jobError } from './errors';
import { base64Length, decodeProviderOutput, type NormalizedImage, OutputError, toDataUri } from './images';
import { type KvStore, token, withLock } from './kv';
import type { UsageLedger } from './ledger';
import { PRESETS } from './presets';
import { mapRuntimeError, ProviderSubmitError, type TryOnProvider } from './providers/types';

/** A visitor's own API key: the provider built from it, and the key's hash (the only part stored). */
export interface UserKey {
  provider: TryOnProvider;
  hash: string;
}

/** Ledger for visitor-paid jobs: they never count against the operator's daily credits. */
const VISITOR_LEDGER: Pick<UsageLedger, 'reserve' | 'charge' | 'release' | 'markUncertain'> = {
  reserve: async () => true,
  charge: async () => undefined,
  release: async () => undefined,
  markUncertain: async () => undefined,
};

export interface JobInput {
  sessionId: string;
  clientRequestId: string;
  /** Hash of the normalized inputs + preset: binds a request UUID to its payload. */
  fingerprint: string;
  preset: AiPresetId;
  garmentId: string | null;
  person: NormalizedImage;
  product: NormalizedImage;
  category: AiGarmentCategory;
  photoType: AiGarmentPhotoType;
  /** The visitor's own key paying for this job, or null for the operator's. */
  userKey?: UserKey | null;
}

/** Stored job metadata. Never contains an image or the provider's credentials. */
interface JobRecord {
  id: string;
  sessionId: string;
  fingerprint: string;
  preset: AiPresetId;
  garmentId: string | null;
  seed: number;
  status: AiJobStatus;
  error: AiJobView['error'];
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  deadlineAt: number;
  /** Hash of the visitor's API key paying for the job, or null when the operator's key pays. */
  keyHash: string | null;
  /** Provider prediction ID: server-only, never sent to the browser or accepted from it. */
  providerJobId: string | null;
  /** True while provider work is still tracked (it costs money and capacity until it settles). */
  inFlight: boolean;
  /** Earliest time the next provider status read is due. */
  nextCheckAt: number;
  statusFailures: number;
  result: { width: number; height: number; expiresAt: number } | null;
}

/** Set once when the owner abandons a job, or when its session is ended ("purged"). */
interface JobFlag {
  kind: 'abandoned' | 'purged';
  at: number;
}

/** Terminal job metadata (no images) is kept this long for deduplication, then expires. */
const METADATA_TTL_MS = 30 * 60_000;
/** Upper bound of the status-read backoff after transient errors. */
const MAX_BACKOFF_MS = 10_000;
/** A status read holds the job's lease at most this long (provider timeout + decoding). */
const STATUS_LEASE_MS = 40_000;
/** Extra time after the submit timeout before an unfinished submission counts as lost. */
const SUBMIT_GRACE_MS = 15_000;

const k = {
  job: (id: string) => `job:${id}`,
  flag: (id: string) => `job:${id}:flag`,
  result: (id: string) => `job:${id}:result`,
  lease: (id: string) => `job:${id}:lease`,
  request: (sessionId: string, requestId: string) => `request:${sessionId}:${requestId}`,
  active: (sessionId: string) => `session:${sessionId}:active`,
  sessionJobs: (sessionId: string) => `session:${sessionId}:jobs`,
  inFlight: 'jobs:in-flight',
};

export interface JobManagerDeps {
  ai: AiConfig;
  provider: TryOnProvider;
  ledger: UsageLedger;
  kv: KvStore;
  now?: () => number;
  /**
   * Keeps background work (submission + polling) alive after the response. Vercel: `waitUntil`.
   * A long-running process needs nothing (the default lets the promise run).
   */
  defer?: (work: Promise<unknown>) => void;
}

export class JobManager {
  private readonly now: () => number;
  private readonly kv: KvStore;
  private disposed = false;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  /** Providers for visitor-paid jobs this instance submitted, until their polling ends. */
  private readonly userProviders = new Map<string, TryOnProvider>();

  constructor(private readonly deps: JobManagerDeps) {
    this.now = deps.now ?? Date.now;
    this.kv = deps.kv;
  }

  get testResults(): boolean {
    return this.deps.provider.name === 'fake';
  }

  /** Accepts a job (or returns the identical earlier one) and starts it in the background. */
  async create(input: JobInput): Promise<{ job: AiJobView; created: boolean }> {
    if (this.disposed) throw new AppError('internal', 503, 'The server is shutting down.');
    // Settle work whose instance disappeared, so it does not block the concurrency bound.
    await this.reconcileStale();
    const { ai } = this.deps;
    const ledger = input.userKey ? VISITOR_LEDGER : this.deps.ledger;
    const accepted = await withLock(this.kv, 'jobs', async () => {
      const requestKey = k.request(input.sessionId, input.clientRequestId);
      const existingId = await this.kv.get(requestKey);
      if (existingId) {
        const [existing, flag] = await this.loadWithFlag(existingId);
        if (existing && flag?.kind !== 'purged') {
          if (existing.fingerprint !== input.fingerprint) {
            throw new AppError(
              'duplicate-conflict',
              409,
              'This request ID was already used with different inputs.',
            );
          }
          return { job: this.toView(existing, flag), created: null };
        }
      }
      const activeId = await this.kv.get(k.active(input.sessionId));
      if (activeId) {
        const [active, flag] = await this.loadWithFlag(activeId);
        if (active && !flag && isActive(active.status) && active.inFlight) {
          throw new AppError(
            'busy',
            409,
            'A preview is already being generated. Please wait for it to finish.',
          );
        }
      }
      // The bound protects the operator's account; visitors' own keys are limited per session only.
      const operatorJobs = input.userKey ? 0 : (await this.inFlightJobs()).filter((j) => !j.keyHash).length;
      if (operatorJobs >= ai.maxConcurrentJobs) {
        throw new AppError(
          'busy',
          429,
          'The previous preview is still finishing. Please try again in a few seconds.',
        );
      }
      if (!input.userKey && this.deps.ledger.loadError) {
        throw new AppError('not-configured', 503, 'AI usage tracking is unavailable on this device.');
      }
      const id = randomBytes(18).toString('base64url');
      if (!(await ledger.reserve(id, PRESETS[input.preset].credits))) {
        throw new AppError('daily-limit', 429, 'The daily AI preview limit has been reached on this device.');
      }
      const now = this.now();
      const job: JobRecord = {
        id,
        sessionId: input.sessionId,
        fingerprint: input.fingerprint,
        preset: input.preset,
        garmentId: input.garmentId,
        seed: randomInt(0, 2 ** 32),
        status: 'submitting',
        error: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        deadlineAt: now + ai.jobDeadlineSeconds * 1000,
        keyHash: input.userKey?.hash ?? null,
        providerJobId: null,
        inFlight: true,
        nextCheckAt: now + ai.pollIntervalMs,
        statusFailures: 0,
        result: null,
      };
      // The submission holds the job's lease, so no other instance touches it meanwhile.
      const lease = token();
      await Promise.all([
        this.save(job),
        this.kv.set(k.lease(id), lease, { pxMs: ai.submitTimeoutSeconds * 1000 + SUBMIT_GRACE_MS }),
        this.kv.set(requestKey, id, { pxMs: METADATA_TTL_MS }),
        this.kv.set(k.active(input.sessionId), id, { pxMs: METADATA_TTL_MS }),
        this.kv.sadd(k.sessionJobs(input.sessionId), id, METADATA_TTL_MS),
        this.kv.sadd(k.inFlight, id),
      ]);
      return { job: this.toView(job, null), created: { record: job, lease } };
    });
    if (!accepted.created) return { job: accepted.job, created: false };
    if (input.userKey) this.userProviders.set(accepted.created.record.id, input.userKey.provider);
    const work = this.run(accepted.created.record, input, accepted.created.lease);
    (this.deps.defer ?? (() => undefined))(work);
    return { job: accepted.job, created: true };
  }

  /**
   * The owner's view of a job. Advances it first when a provider status read is due; a visitor-paid
   * job can be advanced with `userKey` when it is the key the job was submitted with.
   */
  async view(jobId: string, sessionId: string, userKey: UserKey | null = null): Promise<AiJobView> {
    let [job, flag] = await this.owned(jobId, sessionId);
    if (job.inFlight && this.now() >= job.nextCheckAt) {
      await this.advance(jobId, false, userKey);
      [job, flag] = await this.owned(jobId, sessionId);
    }
    return this.toView(job, flag);
  }

  async result(jobId: string, sessionId: string): Promise<NormalizedImage> {
    const [job, flag] = await this.owned(jobId, sessionId);
    const data =
      flag || !job.result || this.now() >= job.result.expiresAt ? null : await this.kv.get(k.result(jobId));
    if (!job.result || !data) throw new AppError('not-found', 404, 'That preview is no longer available.');
    return {
      buffer: Buffer.from(data, 'base64'),
      contentType: 'image/jpeg',
      width: job.result.width,
      height: job.result.height,
    };
  }

  /** Stops local consumption and deletes the stored image. Does NOT cancel or refund provider work. */
  async abandon(jobId: string, sessionId: string): Promise<void> {
    await this.owned(jobId, sessionId);
    await this.flag(jobId, 'abandoned');
  }

  /** End of a customer's session: hide everything they own and drop their images now. */
  async purgeSession(sessionId: string): Promise<void> {
    const ids = await this.kv.smembers(k.sessionJobs(sessionId));
    await Promise.all(ids.map((id) => this.flag(id, 'purged')));
    await this.kv.del(k.sessionJobs(sessionId), k.active(sessionId));
  }

  /** Number of jobs whose provider work is still tracked. */
  async inFlightCount(): Promise<number> {
    return (await this.inFlightJobs()).length;
  }

  /** Whether a result image is stored for a job (tests: images must not outlive their job). */
  async hasStoredResult(jobId: string): Promise<boolean> {
    return (await this.kv.get(k.result(jobId))) !== null;
  }

  /** Stops background polling (process shutdown, tests). Stored state is left as it is. */
  dispose(): void {
    this.disposed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.userProviders.clear();
  }

  // ---- storage ------------------------------------------------------------------------------------

  private async load(id: string): Promise<JobRecord | null> {
    const raw = await this.kv.get(k.job(id));
    return raw ? (JSON.parse(raw) as JobRecord) : null;
  }

  private async loadWithFlag(id: string): Promise<[JobRecord | null, JobFlag | null]> {
    const [raw, flag] = await this.kv.mget([k.job(id), k.flag(id)]);
    return [raw ? (JSON.parse(raw) as JobRecord) : null, flag ? (JSON.parse(flag) as JobFlag) : null];
  }

  private async save(job: JobRecord): Promise<void> {
    job.updatedAt = this.now();
    await this.kv.set(k.job(job.id), JSON.stringify(job), { pxMs: METADATA_TTL_MS });
  }

  private async owned(jobId: string, sessionId: string): Promise<[JobRecord, JobFlag | null]> {
    const [job, flag] = await this.loadWithFlag(jobId);
    // Unknown and foreign jobs are indistinguishable to the caller: IDs alone are not permission.
    if (!job || job.sessionId !== sessionId || flag?.kind === 'purged') {
      throw new AppError('not-found', 404, 'That preview no longer exists.');
    }
    return [job, flag];
  }

  private async flag(jobId: string, kind: JobFlag['kind']): Promise<void> {
    const value = JSON.stringify({ kind, at: this.now() } satisfies JobFlag);
    // 'abandoned' never overwrites an earlier flag; 'purged' always wins.
    await this.kv.set(k.flag(jobId), value, { pxMs: METADATA_TTL_MS, nx: kind === 'abandoned' });
    await this.kv.del(k.result(jobId));
  }

  /** In-flight jobs, pruning the index of jobs that settled or expired. */
  private async inFlightJobs(): Promise<JobRecord[]> {
    const ids = await this.kv.smembers(k.inFlight);
    if (ids.length === 0) return [];
    const raws = await this.kv.mget(ids.map(k.job));
    const live: JobRecord[] = [];
    await Promise.all(
      ids.map(async (id, i) => {
        const raw = raws[i];
        const job = raw ? (JSON.parse(raw) as JobRecord) : null;
        if (job?.inFlight) live.push(job);
        else await this.kv.srem(k.inFlight, id);
      }),
    );
    return live;
  }

  /** Advances in-flight jobs nobody has checked on for a while (their instance may be gone). */
  private async reconcileStale(): Promise<void> {
    const stale = this.deps.ai.pollIntervalMs * 3;
    const now = this.now();
    const jobs = await this.inFlightJobs();
    await Promise.all(
      jobs.filter((j) => now >= j.nextCheckAt + stale).map((j) => this.advance(j.id).catch(() => undefined)),
    );
  }

  // ---- provider work ----------------------------------------------------------------------------------

  /** The provider that may read a job: the operator's, or the key the job was submitted with. */
  private providerFor(job: JobRecord, offered: UserKey | null = null): TryOnProvider | null {
    if (!job.keyHash) return this.deps.provider;
    const local = this.userProviders.get(job.id);
    if (local) return local;
    return offered?.hash === job.keyHash ? offered.provider : null;
  }

  private ledgerFor(job: JobRecord) {
    return job.keyHash ? VISITOR_LEDGER : this.deps.ledger;
  }

  /** Background work for a new job: submit once, then poll until it settles. */
  private async run(job: JobRecord, input: JobInput, lease: string): Promise<void> {
    try {
      try {
        await this.submit(job, input);
      } finally {
        await this.kv.delIfEquals(k.lease(job.id), lease).catch(() => undefined);
      }
      let delay = this.deps.ai.pollIntervalMs;
      while (job.inFlight && !this.disposed) {
        await this.sleep(delay);
        if (this.disposed) return;
        // The loop already waited for this read, so it does not wait for `nextCheckAt` again.
        const step = await this.advance(job.id, true).catch(() => ({
          settled: false,
          delay: this.deps.ai.pollIntervalMs,
        }));
        if (step.settled) return;
        delay = step.delay;
      }
    } finally {
      this.userProviders.delete(job.id);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.timers.delete(t);
        resolve();
      }, ms);
      this.timers.add(t);
    });
  }

  private async settle(job: JobRecord, status: AiJobStatus, error: AiJobView['error'] = null): Promise<void> {
    job.status = status;
    job.error = error;
    job.inFlight = false;
    job.completedAt ??= this.now();
    await this.save(job);
    await this.kv.srem(k.inFlight, job.id);
  }

  private async submit(job: JobRecord, input: JobInput): Promise<void> {
    const { ai } = this.deps;
    const provider = input.userKey?.provider ?? this.deps.provider;
    const ledger = this.ledgerFor(job);
    const outbound = base64Length(input.person.buffer.length) + base64Length(input.product.buffer.length);
    if (outbound > 2 * base64Length(ai.maxUploadBytes)) {
      await ledger.release(job.id);
      await this.settle(job, 'failed', jobError('image-too-large'));
      return;
    }
    let request: ReturnType<(typeof PRESETS)[AiPresetId]['build']> | null = PRESETS[job.preset].build({
      personDataUri: toDataUri(input.person),
      productDataUri: toDataUri(input.product),
      category: input.category,
      photoType: input.photoType,
      seed: job.seed,
    });
    try {
      const { providerJobId } = await provider.submit(
        request,
        AbortSignal.timeout(ai.submitTimeoutSeconds * 1000),
      );
      job.providerJobId = providerJobId;
    } catch (error) {
      const e =
        error instanceof ProviderSubmitError
          ? error
          : new ProviderSubmitError('ambiguous', 'uncertain', 'Unexpected submission failure.');
      if (e.kind === 'rejected') {
        // The provider definitely refused it: nothing was charged.
        await ledger.release(job.id);
        await this.settle(job, 'failed', jobError(e.code));
      } else {
        // It may have been accepted. Never resubmit; keep the reservation.
        await ledger.markUncertain(job.id);
        await this.settle(job, 'uncertain', jobError('uncertain'));
      }
      return;
    } finally {
      // Release the only references to the base64 request body promptly.
      request = null;
    }
    job.status = 'queued';
    job.nextCheckAt = this.now() + ai.pollIntervalMs;
    await this.save(job);
  }

  /**
   * One provider status read for a job, by whichever instance gets its lease. Returns whether the
   * job settled and when the next read is due. Reads triggered by the browser (`scheduled` false)
   * happen only once the job's `nextCheckAt` has passed.
   */
  private async advance(
    jobId: string,
    scheduled = false,
    userKey: UserKey | null = null,
  ): Promise<{ settled: boolean; delay: number }> {
    const { ai } = this.deps;
    const pending = { settled: false, delay: ai.pollIntervalMs };
    const lease = token();
    if (!(await this.kv.set(k.lease(jobId), lease, { nx: true, pxMs: STATUS_LEASE_MS }))) return pending;
    try {
      const job = await this.load(jobId);
      if (!job?.inFlight) return { settled: true, delay: 0 };
      const ledger = this.ledgerFor(job);
      const now = this.now();
      if (!job.providerJobId) {
        // The submitting instance vanished before recording the outcome: it may have been sent.
        if (now > job.createdAt + ai.submitTimeoutSeconds * 1000 + SUBMIT_GRACE_MS) {
          await ledger.markUncertain(job.id);
          await this.settle(job, 'uncertain', jobError('uncertain'));
          return { settled: true, delay: 0 };
        }
        return pending;
      }
      if (now > job.deadlineAt) {
        // Stop waiting. The provider may still finish (and charge); keep the reservation.
        await ledger.markUncertain(job.id);
        await this.settle(job, 'uncertain', jobError('timeout'));
        return { settled: true, delay: 0 };
      }
      if (!scheduled && now < job.nextCheckAt) return { settled: false, delay: job.nextCheckAt - now };
      // A visitor-paid job whose key is not at hand waits for its owner's next status read.
      const provider = this.providerFor(job, userKey);
      if (!provider) return pending;

      let status: Awaited<ReturnType<TryOnProvider['status']>>;
      try {
        status = await provider.status(job.providerJobId, AbortSignal.timeout(20_000));
        job.statusFailures = 0;
      } catch {
        // Transient status failure: back off and read again. Never resubmit.
        job.statusFailures++;
        const delay = Math.min(MAX_BACKOFF_MS, ai.pollIntervalMs * 2 ** job.statusFailures);
        job.nextCheckAt = this.now() + delay;
        await this.save(job);
        return { settled: false, delay };
      }
      job.nextCheckAt = this.now() + ai.pollIntervalMs;
      switch (status.state) {
        case 'starting':
        case 'in_queue':
        case 'processing':
        case 'unknown':
          if (status.state !== 'unknown')
            job.status = status.state === 'processing' ? 'generating' : 'queued';
          await this.save(job);
          return pending;
        case 'failed':
          // Documented: failed predictions do not consume credits.
          await ledger.release(job.id);
          await this.settle(job, 'failed', jobError(mapRuntimeError(status.errorName)));
          return { settled: true, delay: 0 };
        case 'canceled':
        case 'time_out':
          // Billing for these is not documented: keep counting conservatively.
          await ledger.markUncertain(job.id);
          await this.settle(
            job,
            'failed',
            jobError(status.state === 'time_out' ? 'timeout' : 'provider-failed'),
          );
          return { settled: true, delay: 0 };
        case 'completed':
          await ledger.charge(job.id, status.creditsUsed ?? PRESETS[job.preset].credits);
          await this.storeOutput(job, status.output);
          return { settled: true, delay: 0 };
      }
    } finally {
      await this.kv.delIfEquals(k.lease(jobId), lease).catch(() => undefined);
    }
  }

  /** Decodes and stores the one output, unless nobody is waiting for it any more. */
  private async storeOutput(job: JobRecord, output: unknown[]): Promise<void> {
    const { ai } = this.deps;
    if (await this.kv.get(k.flag(job.id))) {
      // Abandoned or purged: never decode or keep the output.
      await this.settle(job, 'completed');
      return;
    }
    try {
      if (output.length !== 1) throw new OutputError('invalid', 'Expected exactly one output.');
      const image = await decodeProviderOutput(output[0], {
        maxBytes: 3 * ai.maxUploadBytes,
        maxPixels: ai.maxInputPixels,
      });
      const ttlMs = ai.resultTtlSeconds * 1000;
      await this.kv.set(k.result(job.id), image.buffer.toString('base64'), { pxMs: ttlMs });
      job.result = { width: image.width, height: image.height, expiresAt: this.now() + ttlMs };
      await this.settle(job, 'completed');
      // Abandoned while decoding: drop the image again.
      if (await this.kv.get(k.flag(job.id))) await this.kv.del(k.result(job.id));
    } catch {
      await this.settle(job, 'failed', jobError('provider-output'));
    }
  }

  private toView(job: JobRecord, flag: JobFlag | null): AiJobView {
    const now = this.now();
    let status = job.status;
    if (flag) {
      // A job abandoned while it was still running shows as abandoned, whatever happened later.
      const settledBefore = !job.inFlight && job.completedAt !== null && job.completedAt <= flag.at;
      if (!settledBefore) status = 'abandoned';
    }
    const resultLive = !flag && job.result !== null && now < job.result.expiresAt;
    if (status === 'completed' && job.result && !resultLive && !flag) status = 'expired';
    return {
      id: job.id,
      status,
      preset: job.preset,
      garmentId: job.garmentId,
      createdAt: job.createdAt,
      elapsedMs: (job.inFlight ? now : (job.completedAt ?? now)) - job.createdAt,
      resultAvailable: resultLive,
      resultExpiresAt: resultLive ? (job.result?.expiresAt ?? null) : null,
      error: job.error,
      testResult: this.testResults,
    };
  }
}

function isActive(status: AiJobStatus): boolean {
  return status === 'submitting' || status === 'queued' || status === 'generating';
}
