/**
 * AI photo try-on state machine (framework-free; React subscribes through useAiTryOn).
 *
 * Only an explicit Generate (plus the per-session opt-in) sends anything to the backend. Entering
 * AI mode, capturing, or choosing a garment never does.
 *
 * Stale output protection: `epoch` increments whenever what is on screen stops being the thing a
 * pending request was for (retake, garment change, try another, end session, leaving AI mode,
 * unmount). Every async continuation compares its epoch first and drops itself if it changed, and
 * asks the backend to abandon the job — so a late result can never appear over live mode or the
 * next customer's screen.
 *
 * Who pays: the operator's key (behind the access code on public deployments) or the visitor's own
 * FASHN key, saved in their browser (`saveUserKey`). A saved key is checked with the provider first,
 * and is sent only while the server accepts visitor keys.
 *
 * Network loss while polling never starts a replacement job. After a submission whose outcome is
 * unknown (connection lost), the next explicit Generate reuses the SAME request ID, so the backend
 * deduplicates it instead of charging twice.
 */
import type { CapturedImage } from './capture';
import { AiApiError, type AiClient } from './client';
import {
  AI_USER_KEY_PATTERN,
  type AiCapabilities,
  type AiErrorCode,
  type AiGarmentCategory,
  type AiGarmentPhotoType,
  type AiJobStatus,
  type AiJobView,
  type AiPresetId,
} from './types';
import { createMemoryKeyStore, type UserKeyStore } from './userKey';

export type AiPhase =
  | 'inactive'
  | 'checking'
  | 'unconfigured'
  | 'ready'
  | 'review'
  | 'consent'
  | 'submitting'
  | 'queued'
  | 'generating'
  | 'result'
  | 'error';

export type AiGarmentChoice =
  | { kind: 'catalogue'; id: string; label: string }
  | {
      kind: 'upload';
      label: string;
      blob: Blob;
      url: string;
      category: AiGarmentCategory;
      photoType: AiGarmentPhotoType;
    };

/**
 * Why AI cannot be used: turned off / not configured on the server, the local AI server is not
 * running, or this build has no AI server at all (a static online deployment, `vite build --mode static`).
 */
export type AiUnavailableCause = 'disabled' | 'backend-down' | 'not-deployed';

export interface AiViewState {
  phase: AiPhase;
  capabilities: AiCapabilities | null;
  /** Why AI cannot be used (operator-facing). */
  unavailable: { reason: string; cause: AiUnavailableCause } | null;
  capture: { url: string; width: number; height: number; source: CapturedImage['source'] } | null;
  garment: AiGarmentChoice | null;
  preset: AiPresetId | null;
  consented: boolean;
  /** The request currently being generated. `startedAt` uses the injected clock (ms). */
  job: { id: string | null; status: AiJobStatus; startedAt: number; garmentLabel: string } | null;
  result: {
    url: string;
    garmentLabel: string;
    testResult: boolean;
    preset: AiPresetId;
    expiresAt: number | null;
  } | null;
  error: { code: AiErrorCode | 'network'; message: string } | null;
  /** Transient information, e.g. a reconnect notice while polling. */
  notice: string | null;
  /** Access-code entry on public deployments (see `unlock`). */
  access: { unlocking: boolean; error: { code: AiErrorCode | 'network'; message: string } | null };
  /** The visitor's own API key: saved (and used), being checked, its balance when known. */
  userKey: {
    saved: boolean;
    checking: boolean;
    credits: number | null;
    error: { code: AiErrorCode | 'network'; message: string } | null;
  };
}

/** What still stands between the shopper and Generate: nothing, their own key, or the access code. */
export type AiPayment = 'ok' | 'key' | 'access';

export interface AiControllerDeps {
  client: AiClient;
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  randomUUID: () => string;
  /** Where the visitor's own API key is kept (default: memory only). */
  keyStore?: UserKeyStore;
  /** Client-side idle reset of a customer's AI data (the server enforces its own timeout). */
  idleResetMs?: number;
  /** False for a build without the AI server: AI mode explains itself and never calls the API. */
  backendDeployed?: boolean;
  pollIntervalMs?: number;
}

const ACTIVE: readonly AiPhase[] = ['submitting', 'queued', 'generating'];

export const INITIAL_AI_STATE: AiViewState = {
  phase: 'inactive',
  capabilities: null,
  unavailable: null,
  capture: null,
  garment: null,
  preset: null,
  consented: false,
  job: null,
  result: null,
  error: null,
  notice: null,
  access: { unlocking: false, error: null },
  userKey: { saved: false, checking: false, credits: null, error: null },
};

export class AiTryOnController {
  private state: AiViewState = INITIAL_AI_STATE;
  private listeners = new Set<(s: AiViewState) => void>();
  private epoch = 0;
  private disposed = false;
  private sessionReady = false;
  /** Incremented whenever the backend session is ended (which purges all of its jobs). */
  private sessionGeneration = 0;
  private captureBlob: Blob | null = null;
  private captureToken = 0;
  private jobId: string | null = null;
  private pollTimer: unknown = null;
  /** In-flight status/result read; aborted when the job is abandoned (never the submission). */
  private readAbort: AbortController | null = null;
  private pollFailures = 0;
  private clientDeadline = 0;
  private idleTimer: unknown = null;
  /** Request ID to reuse after a submission with unknown outcome, bound to the same inputs. */
  private retryRequest: { id: string; key: string } | null = null;
  private readonly keys: UserKeyStore;

  constructor(private readonly deps: AiControllerDeps) {
    this.keys = deps.keyStore ?? createMemoryKeyStore();
  }

  getState(): AiViewState {
    return this.state;
  }

  subscribe(listener: (s: AiViewState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  get isGenerating(): boolean {
    return ACTIVE.includes(this.state.phase);
  }

  // ---- mode lifecycle ---------------------------------------------------------------------------

  /** Entering AI mode: reads capabilities only (no session, no upload). */
  async activate(): Promise<void> {
    if (this.disposed) return;
    if (this.deps.backendDeployed === false) {
      this.set({
        ...INITIAL_AI_STATE,
        phase: 'unconfigured',
        garment: this.state.garment,
        unavailable: {
          reason:
            'This copy of the site was built without the AI server, so AI photo mode is not available here. 2D and 3D work as usual.',
          cause: 'not-deployed',
        },
      });
      return;
    }
    const epoch = ++this.epoch;
    this.set({ ...INITIAL_AI_STATE, phase: 'checking', garment: this.state.garment });
    try {
      const caps = await this.deps.client.capabilities();
      if (epoch !== this.epoch || this.disposed) return;
      // A saved key is sent only while this server accepts visitor keys.
      const key = caps.enabled && caps.keys.user ? this.keys.get() : null;
      this.deps.client.setUserKey(key);
      if (!caps.enabled) {
        this.set({
          phase: 'unconfigured',
          capabilities: caps,
          unavailable: { reason: caps.reason ?? 'AI preview is not available.', cause: 'disabled' },
        });
        return;
      }
      this.set({
        phase: 'ready',
        capabilities: caps,
        unavailable: null,
        preset: caps.defaultPreset,
        userKey: { ...INITIAL_AI_STATE.userKey, saved: key !== null },
      });
    } catch (error) {
      if (epoch !== this.epoch || this.disposed) return;
      const down = error instanceof AiApiError && error.code === 'network';
      this.set({
        phase: 'unconfigured',
        unavailable: {
          reason: down
            ? 'The local AI server is not running (start it with npm run dev, or npm start after a build).'
            : 'The local AI server returned an error.',
          cause: down ? 'backend-down' : 'disabled',
        },
      });
    }
  }

  /** Leaving AI mode: abandon pending work, purge this customer's AI session and images. */
  deactivate(): void {
    this.reset('inactive');
  }

  /** "End session": the next customer starts clean (new session, new opt-in). */
  endSession(): void {
    if (this.state.phase === 'inactive') return;
    const caps = this.state.capabilities;
    this.reset(caps?.enabled ? 'ready' : 'unconfigured');
    if (!caps) void this.activate();
  }

  dispose(): void {
    if (this.disposed) return;
    this.reset('inactive');
    this.disposed = true;
    this.listeners.clear();
  }

  // ---- capture ----------------------------------------------------------------------------------

  setCapture(image: CapturedImage): void {
    if (this.disposed || !this.canCapture()) return;
    this.abandonActive();
    this.revokeCapture();
    this.revokeResult();
    this.captureBlob = image.blob;
    this.captureToken++;
    this.set({
      phase: 'review',
      capture: {
        url: this.deps.createObjectURL(image.blob),
        width: image.width,
        height: image.height,
        source: image.source,
      },
      result: null,
      job: null,
      error: null,
      notice: null,
    });
    this.touch();
  }

  canCapture(): boolean {
    return this.state.phase === 'ready' || this.state.phase === 'review' || this.state.phase === 'error';
  }

  /** Drops the captured photo (and any result) and returns to the live preview. */
  retake(): void {
    if (!this.state.capture && this.state.phase !== 'error') return;
    this.abandonActive();
    this.revokeCapture();
    this.revokeResult();
    this.set({
      phase: this.state.capabilities?.enabled ? 'ready' : 'unconfigured',
      capture: null,
      job: null,
      result: null,
      error: null,
      notice: null,
    });
    this.touch();
  }

  // ---- garment & preset -------------------------------------------------------------------------

  selectCatalogueGarment(id: string, label: string): void {
    this.changeGarment({ kind: 'catalogue', id, label });
  }

  selectUploadedGarment(
    blob: Blob,
    label: string,
    category: AiGarmentCategory,
    photoType: AiGarmentPhotoType,
  ): void {
    this.changeGarment({
      kind: 'upload',
      label,
      blob,
      url: this.deps.createObjectURL(blob),
      category,
      photoType,
    });
  }

  setPreset(preset: AiPresetId): void {
    if (!this.state.capabilities?.presets.some((p) => p.id === preset)) return;
    this.set({ preset });
  }

  /** From a result: keep the SAME captured photo (never the generated image) and pick again. */
  tryAnother(): void {
    if (this.state.phase !== 'result' && this.state.phase !== 'error') return;
    this.revokeResult();
    ++this.epoch;
    this.set({
      phase: this.state.capture ? 'review' : 'ready',
      result: null,
      job: null,
      error: null,
      notice: null,
    });
    this.touch();
  }

  // ---- generation -------------------------------------------------------------------------------

  /** The shopper pressed Generate. Asks for the per-session opt-in first if needed. */
  requestGenerate(): void {
    if (!this.readyToGenerate()) return;
    if (!this.state.consented) {
      this.set({ phase: 'consent' });
      return;
    }
    void this.start();
  }

  acceptConsent(): void {
    if (this.state.phase !== 'consent') return;
    this.set({ consented: true, phase: 'review' });
    void this.start();
  }

  declineConsent(): void {
    if (this.state.phase === 'consent') this.set({ phase: 'review' });
  }

  readyToGenerate(): boolean {
    const s = this.state;
    return (
      (s.phase === 'review' || (s.phase === 'error' && s.capture !== null)) &&
      s.capture !== null &&
      s.garment !== null &&
      s.capabilities?.enabled === true &&
      this.payment() === 'ok' &&
      s.preset !== null
    );
  }

  /**
   * Whether a generation can be paid for: with the visitor's saved key, or the operator's key once any
   * access code was entered. Otherwise names what is missing.
   */
  payment(): AiPayment {
    const caps = this.state.capabilities;
    if (!caps || this.state.userKey.saved) return 'ok';
    if (!caps.keys.server) return 'key';
    return caps.access.required && !caps.access.granted ? 'access' : 'ok';
  }

  /**
   * Checks the visitor's own API key with the provider, then saves it in this browser and uses it for
   * every later generation. False (with `userKey.error` set) when it is refused.
   */
  async saveUserKey(raw: string): Promise<boolean> {
    const key = raw.trim();
    if (!this.state.capabilities?.keys.user || this.state.userKey.checking || this.disposed) return false;
    if (!AI_USER_KEY_PATTERN.test(key)) return false;
    this.set({ userKey: { ...this.state.userKey, checking: true, error: null } });
    try {
      const check = await this.deps.client.checkKey(key);
      if (this.disposed) return false;
      this.keys.set(key);
      this.deps.client.setUserKey(key);
      this.set({ userKey: { saved: true, checking: false, credits: check.credits, error: null } });
      return true;
    } catch (error) {
      const e = toApiError(error);
      this.set({
        userKey: { ...this.state.userKey, checking: false, error: { code: e.code, message: e.message } },
      });
      return false;
    }
  }

  /** Removes the visitor's key from this browser; the operator's key (if any) pays again. */
  forgetUserKey(): void {
    this.keys.set(null);
    this.deps.client.setUserKey(null);
    this.set({ userKey: INITIAL_AI_STATE.userKey });
  }

  /**
   * Sends the access code (public deployments). On success the server sets an HttpOnly cookie and
   * generating is allowed; the code itself is never stored by the page.
   */
  async unlock(code: string): Promise<boolean> {
    const caps = this.state.capabilities;
    if (!caps?.access?.required || this.state.access.unlocking || this.disposed) return false;
    this.set({ access: { unlocking: true, error: null } });
    try {
      await this.deps.client.unlock(code);
      const current = this.state.capabilities ?? caps;
      this.set({
        capabilities: { ...current, access: { required: true, granted: true } },
        access: { unlocking: false, error: null },
      });
      return true;
    } catch (error) {
      const e = toApiError(error);
      this.set({ access: { unlocking: false, error: { code: e.code, message: e.message } } });
      return false;
    }
  }

  /** The server no longer accepts this browser's access (cookie expired or code changed). */
  private lockAccess(): void {
    const caps = this.state.capabilities;
    if (caps?.access?.required)
      this.set({ capabilities: { ...caps, access: { required: true, granted: false } } });
  }

  // ---- internals --------------------------------------------------------------------------------

  private set(patch: Partial<AiViewState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  private changeGarment(garment: AiGarmentChoice): void {
    const previous = this.state.garment;
    if (previous?.kind === 'upload') this.deps.revokeObjectURL(previous.url);
    const phase = this.state.phase;
    // A pending or shown result no longer matches what is selected: drop it.
    const stale = this.isGenerating || phase === 'result' || phase === 'error' || phase === 'consent';
    if (stale) {
      this.abandonActive();
      this.revokeResult();
    }
    this.set({
      garment,
      ...(stale
        ? {
            phase: this.state.capture ? 'review' : 'ready',
            job: null,
            result: null,
            error: null,
            notice: null,
          }
        : {}),
    });
    this.touch();
  }

  private inputKey(): string {
    const g = this.state.garment;
    const garment = g?.kind === 'catalogue' ? `c:${g.id}` : `u:${g?.url ?? ''}`;
    return `${this.captureToken}|${garment}|${this.state.preset}`;
  }

  private async start(): Promise<void> {
    const s = this.state;
    const capture = this.captureBlob;
    if (!this.readyToGenerate() || !capture || !s.garment || !s.preset || !s.consented || !s.capabilities)
      return;
    const epoch = ++this.epoch;
    const session = this.sessionGeneration;
    const key = this.inputKey();
    const clientRequestId = this.retryRequest?.key === key ? this.retryRequest.id : this.deps.randomUUID();
    this.retryRequest = null;
    const garmentLabel = s.garment.label;
    const startedAt = this.deps.now();
    this.clientDeadline = startedAt + (s.capabilities.jobDeadlineSeconds + 30) * 1000;
    this.pollFailures = 0;
    // Set synchronously: a second click sees 'submitting' and is ignored.
    this.set({
      phase: 'submitting',
      job: { id: null, status: 'submitting', startedAt, garmentLabel },
      error: null,
      notice: null,
    });
    this.touch();
    try {
      if (!this.sessionReady) {
        await this.deps.client.createSession();
        if (epoch !== this.epoch || this.disposed) return;
        this.sessionReady = true;
      }
      const garment = s.garment;
      const view = await this.deps.client.submitJob({
        person: capture,
        ...(garment.kind === 'catalogue'
          ? { garmentId: garment.id }
          : {
              garmentFile: garment.blob,
              garmentCategory: garment.category,
              garmentPhotoType: garment.photoType,
            }),
        preset: s.preset,
        consentVersion: s.capabilities.consentVersion,
        clientRequestId,
      });
      if (epoch !== this.epoch || this.disposed) {
        // Nobody wants this job any more. If its session was ended meanwhile, that already purged it.
        if (session === this.sessionGeneration)
          void this.deps.client.abandonJob(view.id).catch(() => undefined);
        return;
      }
      this.jobId = view.id;
      this.applyJob(epoch, view);
    } catch (error) {
      if (epoch !== this.epoch || this.disposed) return;
      const e = toApiError(error);
      if (e.code === 'network') {
        // Unknown whether the backend accepted it: allow an explicit retry with the same ID.
        this.retryRequest = { id: clientRequestId, key };
      }
      if (e.code === 'session-expired') this.sessionReady = false;
      if (e.code === 'access-required') this.lockAccess();
      this.fail(
        e.code,
        e.code === 'session-expired' ? 'Your AI session ended. Press Generate to start again.' : e.message,
      );
    }
  }

  private applyJob(epoch: number, view: AiJobView): void {
    const job = this.state.job;
    if (!job) return;
    switch (view.status) {
      case 'submitting':
      case 'queued':
      case 'generating':
        this.set({
          phase: view.status,
          job: { ...job, id: view.id, status: view.status },
        });
        this.schedulePoll(epoch, view.id, this.deps.pollIntervalMs ?? 1000);
        return;
      case 'completed':
        void this.fetchResult(epoch, view);
        return;
      default:
        this.jobId = null;
        this.fail(
          view.error?.code ?? 'provider-failed',
          view.error?.message ?? 'The preview could not be generated.',
        );
    }
  }

  private schedulePoll(epoch: number, jobId: string, delay: number): void {
    this.clearPoll();
    this.pollTimer = this.deps.setTimeout(() => void this.poll(epoch, jobId), delay);
  }

  private async poll(epoch: number, jobId: string): Promise<void> {
    this.pollTimer = null;
    if (epoch !== this.epoch || this.disposed) return;
    if (this.deps.now() > this.clientDeadline) {
      this.abandonActive();
      this.fail('timeout', 'No answer from the AI service in time. The request was not sent again.');
      return;
    }
    try {
      const view = await this.deps.client.jobStatus(jobId, this.newRead());
      if (epoch !== this.epoch || this.disposed) return;
      this.pollFailures = 0;
      if (this.state.notice) this.set({ notice: null });
      this.applyJob(epoch, view);
    } catch (error) {
      if (epoch !== this.epoch || this.disposed) return;
      const e = toApiError(error);
      if (e.code === 'network' || e.status >= 500) {
        // Recoverable interruption: keep reading status. Never submit a replacement.
        this.pollFailures++;
        this.set({ notice: 'Connection interrupted — still waiting for the same preview…' });
        this.schedulePoll(epoch, jobId, Math.min(5000, 1000 * 2 ** this.pollFailures));
        return;
      }
      this.jobId = null;
      if (e.code === 'session-expired') this.sessionReady = false;
      if (e.code === 'access-required') this.lockAccess();
      this.fail(e.code, e.message);
    }
  }

  private async fetchResult(epoch: number, view: AiJobView): Promise<void> {
    try {
      const blob = await this.deps.client.jobResult(view.id, this.newRead());
      if (epoch !== this.epoch || this.disposed) return;
      const job = this.state.job;
      this.jobId = null;
      this.revokeResult();
      this.set({
        phase: 'result',
        result: {
          url: this.deps.createObjectURL(blob),
          garmentLabel: job?.garmentLabel ?? '',
          testResult: view.testResult,
          preset: view.preset,
          expiresAt: view.resultExpiresAt,
        },
        job: job ? { ...job, status: 'completed' } : null,
        notice: null,
      });
      this.touch();
    } catch (error) {
      if (epoch !== this.epoch || this.disposed) return;
      this.jobId = null;
      const e = toApiError(error);
      this.fail(e.code, e.code === 'not-found' ? 'The preview expired before it could be shown.' : e.message);
    }
  }

  private fail(code: AiErrorCode | 'network', message: string): void {
    this.clearPoll();
    this.set({ phase: 'error', error: { code, message }, notice: null });
  }

  private clearPoll(): void {
    if (this.pollTimer !== null) this.deps.clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.readAbort?.abort();
    this.readAbort = null;
  }

  private newRead(): AbortSignal {
    this.readAbort?.abort();
    this.readAbort = new AbortController();
    return this.readAbort.signal;
  }

  /**
   * Stops consuming the current job and asks the backend to drop it (not a provider cancel).
   * `notify: false` when the whole session is being ended, which purges its jobs anyway.
   */
  private abandonActive(notify = true): void {
    ++this.epoch;
    this.clearPoll();
    const id = this.jobId;
    this.jobId = null;
    if (id && notify) void this.deps.client.abandonJob(id).catch(() => undefined);
  }

  private revokeCapture(): void {
    if (this.state.capture) this.deps.revokeObjectURL(this.state.capture.url);
    this.captureBlob = null;
  }

  private revokeResult(): void {
    if (this.state.result) this.deps.revokeObjectURL(this.state.result.url);
  }

  private reset(phase: AiPhase): void {
    // Ending the session below purges its jobs server-side; a separate job DELETE would race it.
    this.abandonActive(!this.sessionReady);
    this.revokeCapture();
    this.revokeResult();
    const g = this.state.garment;
    if (g?.kind === 'upload') this.deps.revokeObjectURL(g.url);
    if (this.idleTimer !== null) this.deps.clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.retryRequest = null;
    if (this.sessionReady) {
      this.sessionReady = false;
      this.sessionGeneration++;
      void this.deps.client.endSession().catch(() => undefined);
    }
    this.set({
      ...INITIAL_AI_STATE,
      phase,
      capabilities: phase === 'inactive' ? null : this.state.capabilities,
      unavailable: phase === 'unconfigured' ? this.state.unavailable : null,
      preset: phase === 'inactive' ? null : this.state.preset,
      // The saved key belongs to this browser, not to one customer session.
      userKey: phase === 'inactive' ? INITIAL_AI_STATE.userKey : this.state.userKey,
      // A catalogue choice is not personal data; uploads are dropped.
      garment: g?.kind === 'catalogue' ? g : null,
    });
  }

  /** Restarts the client idle timer: an abandoned kiosk forgets the customer's photos and opt-in. */
  private touch(): void {
    const idle = this.deps.idleResetMs;
    if (!idle) return;
    if (this.idleTimer !== null) this.deps.clearTimeout(this.idleTimer);
    this.idleTimer = this.deps.setTimeout(() => {
      this.idleTimer = null;
      if (this.isGenerating) {
        this.touch();
        return;
      }
      if (this.state.capture || this.state.result || this.state.consented) this.endSession();
    }, idle);
  }
}

function toApiError(error: unknown): AiApiError {
  if (error instanceof AiApiError) return error;
  return new AiApiError('internal', 0, 'Something went wrong on this device.');
}
