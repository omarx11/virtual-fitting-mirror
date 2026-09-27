/**
 * In-memory job store: one explicit Generate action → at most ONE provider submission.
 *
 * Spend controls, in the order `create()` applies them — synchronously, before the first `await`,
 * so concurrent requests cannot interleave between check and insert:
 *   1. Deduplication of (session, client request UUID). A repeat with identical inputs returns the
 *      existing job; a repeat with different inputs is refused.
 *   2. One active job per session, and a global concurrency bound (abandoned jobs still in flight at
 *      the provider count, because they still cost money and capacity).
 *   3. A credit reservation in the durable daily ledger.
 * A submission is never retried. Ambiguous failures become 'uncertain' and keep their reservation.
 *
 * The backend polls the provider itself (bounded interval, backoff on errors, hard deadline), so
 * browser polling only reads cached state. Images live only in memory: inputs are dropped once
 * submitted; results expire after the TTL; abandoned/purged jobs never store output.
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
import type { UsageLedger } from './ledger';
import { PRESETS } from './presets';
import { mapRuntimeError, ProviderSubmitError, type TryOnProvider } from './providers/types';

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
}

interface Job {
  id: string;
  sessionId: string;
  requestKey: string;
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
  /** Provider prediction ID: server-only, never sent to the browser or accepted from it. */
  providerJobId: string | null;
  /** True while the backend still polls the provider (e.g. to reconcile an abandoned job). */
  inFlight: boolean;
  abandoned: boolean;
  /** The owning session was ended/expired; the job is kept only until it stops being in flight. */
  orphaned: boolean;
  result: NormalizedImage | null;
  resultExpiresAt: number | null;
  timer: ReturnType<typeof setTimeout> | null;
  statusFailures: number;
}

/** Terminal job metadata (no images) is kept this long for deduplication, then deleted. */
const METADATA_TTL_MS = 30 * 60_000;
const MAX_JOBS = 500;
/** Upper bound of the status-read backoff after transient errors. */
const MAX_BACKOFF_MS = 10_000;

export interface JobManagerDeps {
  ai: AiConfig;
  provider: TryOnProvider;
  ledger: UsageLedger;
  now?: () => number;
}

export class JobManager {
  private jobs = new Map<string, Job>();
  private byRequest = new Map<string, string>();
  private readonly now: () => number;
  private disposed = false;

  constructor(private readonly deps: JobManagerDeps) {
    this.now = deps.now ?? Date.now;
  }

  get testResults(): boolean {
    return this.deps.provider.name === 'fake';
  }

  /** Accepts a job (or returns the identical earlier one). Synchronous up to the provider call. */
  create(input: JobInput): { job: AiJobView; created: boolean } {
    if (this.disposed) throw new AppError('internal', 503, 'The server is shutting down.');
    const requestKey = `${input.sessionId}\n${input.clientRequestId}`;
    const existingId = this.byRequest.get(requestKey);
    if (existingId) {
      const existing = this.jobs.get(existingId);
      if (existing) {
        if (existing.fingerprint !== input.fingerprint) {
          throw new AppError(
            'duplicate-conflict',
            409,
            'This request ID was already used with different inputs.',
          );
        }
        return { job: this.toView(existing), created: false };
      }
    }
    for (const j of this.jobs.values()) {
      if (j.sessionId === input.sessionId && !j.abandoned && isActive(j.status)) {
        throw new AppError(
          'busy',
          409,
          'A preview is already being generated. Please wait for it to finish.',
        );
      }
    }
    let inFlight = 0;
    for (const j of this.jobs.values()) if (j.inFlight) inFlight++;
    if (inFlight >= this.deps.ai.maxConcurrentJobs) {
      throw new AppError(
        'busy',
        429,
        'The previous preview is still finishing. Please try again in a few seconds.',
      );
    }
    const preset = PRESETS[input.preset];
    const id = randomBytes(18).toString('base64url');
    if (this.deps.ledger.loadError) {
      throw new AppError('not-configured', 503, 'AI usage tracking is unavailable on this device.');
    }
    if (!this.deps.ledger.reserve(id, preset.credits)) {
      throw new AppError('daily-limit', 429, 'The daily AI preview limit has been reached on this device.');
    }
    const now = this.now();
    const job: Job = {
      id,
      sessionId: input.sessionId,
      requestKey,
      fingerprint: input.fingerprint,
      preset: input.preset,
      garmentId: input.garmentId,
      seed: randomInt(0, 2 ** 32),
      status: 'submitting',
      error: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      deadlineAt: now + this.deps.ai.jobDeadlineSeconds * 1000,
      providerJobId: null,
      inFlight: true,
      abandoned: false,
      orphaned: false,
      result: null,
      resultExpiresAt: null,
      timer: null,
      statusFailures: 0,
    };
    this.jobs.set(id, job);
    this.byRequest.set(requestKey, id);
    void this.submit(job, input);
    return { job: this.toView(job), created: true };
  }

  view(jobId: string, sessionId: string): AiJobView {
    return this.toView(this.owned(jobId, sessionId));
  }

  result(jobId: string, sessionId: string): NormalizedImage {
    const job = this.owned(jobId, sessionId);
    this.expire(job);
    if (!job.result) throw new AppError('not-found', 404, 'That preview is no longer available.');
    return job.result;
  }

  /** Stops local consumption and deletes local images. Does NOT cancel or refund provider work. */
  abandon(jobId: string, sessionId: string): void {
    this.abandonJob(this.owned(jobId, sessionId));
  }

  /** End of a customer's session: abandon everything they own and drop their images now. */
  purgeSession(sessionId: string): void {
    for (const job of this.jobs.values()) {
      if (job.sessionId !== sessionId) continue;
      this.abandonJob(job);
      job.orphaned = true;
    }
    this.sweep();
  }

  /** Enforces result TTLs and bounds the store. Called periodically and on purge. */
  sweep(): void {
    const now = this.now();
    for (const job of this.jobs.values()) this.expire(job);
    for (const [id, job] of this.jobs) {
      if (job.inFlight) continue;
      if (job.orphaned || now - job.updatedAt > METADATA_TTL_MS) this.delete(id);
    }
    if (this.jobs.size > MAX_JOBS) {
      const done = [...this.jobs.values()]
        .filter((j) => !j.inFlight)
        .sort((a, b) => a.updatedAt - b.updatedAt);
      for (const j of done.slice(0, this.jobs.size - MAX_JOBS)) this.delete(j.id);
    }
  }

  /** Number of jobs whose provider work is still being tracked. */
  inFlightCount(): number {
    let n = 0;
    for (const j of this.jobs.values()) if (j.inFlight) n++;
    return n;
  }

  size(): number {
    return this.jobs.size;
  }

  dispose(): void {
    this.disposed = true;
    for (const job of this.jobs.values()) if (job.timer) clearTimeout(job.timer);
    this.jobs.clear();
    this.byRequest.clear();
  }

  // ---- internals --------------------------------------------------------------------------------

  private owned(jobId: string, sessionId: string): Job {
    const job = this.jobs.get(jobId);
    // Unknown and foreign jobs are indistinguishable to the caller: IDs alone are not permission.
    if (!job || job.sessionId !== sessionId || job.orphaned) {
      throw new AppError('not-found', 404, 'That preview no longer exists.');
    }
    return job;
  }

  private abandonJob(job: Job): void {
    job.result = null;
    job.resultExpiresAt = null;
    if (!job.abandoned) {
      job.abandoned = true;
      if (!isTerminal(job.status)) job.status = 'abandoned';
      job.updatedAt = this.now();
    }
  }

  private expire(job: Job): void {
    if (job.result && job.resultExpiresAt !== null && this.now() >= job.resultExpiresAt) {
      job.result = null;
      job.resultExpiresAt = null;
      if (job.status === 'completed') job.status = 'expired';
      job.updatedAt = this.now();
    }
  }

  private delete(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    if (job.timer) clearTimeout(job.timer);
    this.jobs.delete(id);
    if (this.byRequest.get(job.requestKey) === id) this.byRequest.delete(job.requestKey);
  }

  private setStatus(job: Job, status: AiJobStatus, error: AiJobView['error'] = null): void {
    if (job.abandoned) return;
    job.status = status;
    job.error = error;
    job.updatedAt = this.now();
  }

  private settle(job: Job): void {
    job.inFlight = false;
    job.completedAt ??= this.now();
    job.updatedAt = this.now();
  }

  private async submit(job: Job, input: JobInput): Promise<void> {
    const { ai, provider, ledger } = this.deps;
    const outbound = base64Length(input.person.buffer.length) + base64Length(input.product.buffer.length);
    if (outbound > 2 * base64Length(ai.maxUploadBytes)) {
      ledger.release(job.id);
      this.setStatus(job, 'failed', jobError('image-too-large'));
      this.settle(job);
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
        ledger.release(job.id);
        this.setStatus(job, 'failed', jobError(e.code));
      } else {
        // It may have been accepted. Never resubmit; keep the reservation.
        ledger.markUncertain(job.id);
        this.setStatus(job, 'uncertain', jobError('uncertain'));
      }
      this.settle(job);
      return;
    } finally {
      // Release the only references to the base64 request body promptly.
      request = null;
    }
    if (this.disposed) return;
    this.setStatus(job, 'queued');
    this.schedule(job, ai.pollIntervalMs);
  }

  private schedule(job: Job, delayMs: number): void {
    if (this.disposed) return;
    job.timer = setTimeout(() => void this.poll(job), delayMs);
    job.timer.unref?.();
  }

  private async poll(job: Job): Promise<void> {
    job.timer = null;
    if (this.disposed || !job.providerJobId) return;
    const { ai, provider, ledger } = this.deps;
    if (this.now() > job.deadlineAt) {
      // Stop waiting. The provider may still finish (and charge); keep the reservation.
      ledger.markUncertain(job.id);
      this.setStatus(job, 'uncertain', jobError('timeout'));
      this.settle(job);
      return;
    }
    let status: Awaited<ReturnType<TryOnProvider['status']>>;
    try {
      status = await provider.status(job.providerJobId, AbortSignal.timeout(20_000));
      job.statusFailures = 0;
    } catch {
      // Transient status failure: back off and read again. Never resubmit.
      job.statusFailures++;
      this.schedule(job, Math.min(MAX_BACKOFF_MS, ai.pollIntervalMs * 2 ** job.statusFailures));
      return;
    }
    if (this.disposed) return;
    const preset = PRESETS[job.preset];
    switch (status.state) {
      case 'starting':
      case 'in_queue':
        this.setStatus(job, 'queued');
        this.schedule(job, ai.pollIntervalMs);
        return;
      case 'processing':
        this.setStatus(job, 'generating');
        this.schedule(job, ai.pollIntervalMs);
        return;
      case 'unknown':
        this.schedule(job, ai.pollIntervalMs);
        return;
      case 'failed':
        // Documented: failed predictions do not consume credits.
        ledger.release(job.id);
        this.setStatus(job, 'failed', jobError(mapRuntimeError(status.errorName)));
        this.settle(job);
        return;
      case 'canceled':
      case 'time_out':
        // Billing for these is not documented: keep counting conservatively.
        ledger.markUncertain(job.id);
        this.setStatus(job, 'failed', jobError(status.state === 'time_out' ? 'timeout' : 'provider-failed'));
        this.settle(job);
        return;
      case 'completed': {
        ledger.charge(job.id, status.creditsUsed ?? preset.credits);
        if (job.abandoned) {
          // Nobody is waiting: never decode or keep the output.
          this.settle(job);
          return;
        }
        try {
          if (status.output.length !== 1) throw new OutputError('invalid', 'Expected exactly one output.');
          const image = await decodeProviderOutput(status.output[0], {
            maxBytes: 3 * ai.maxUploadBytes,
            maxPixels: ai.maxInputPixels,
          });
          if (job.abandoned || this.disposed) {
            this.settle(job);
            return;
          }
          job.result = image;
          job.resultExpiresAt = this.now() + ai.resultTtlSeconds * 1000;
          this.setStatus(job, 'completed');
        } catch {
          this.setStatus(job, 'failed', jobError('provider-output'));
        }
        this.settle(job);
        return;
      }
    }
  }

  private toView(job: Job): AiJobView {
    this.expire(job);
    return {
      id: job.id,
      status: job.status,
      preset: job.preset,
      garmentId: job.garmentId,
      createdAt: job.createdAt,
      elapsedMs:
        (job.status === 'completed' || !job.inFlight ? (job.completedAt ?? this.now()) : this.now()) -
        job.createdAt,
      resultAvailable: job.result !== null,
      resultExpiresAt: job.resultExpiresAt,
      error: job.error,
      testResult: this.testResults,
    };
  }
}

function isActive(status: AiJobStatus): boolean {
  return status === 'submitting' || status === 'queued' || status === 'generating';
}

function isTerminal(status: AiJobStatus): boolean {
  return !isActive(status);
}
