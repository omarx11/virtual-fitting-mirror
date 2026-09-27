// The AI state machine with an in-memory client and manual timers: what it sends, when, and that
// stale responses never surface.
import { describe, expect, it } from 'vitest';
import type { CapturedImage } from '../../src/ai/capture';
import { AiApiError, type AiClient, type SubmitJobInput } from '../../src/ai/client';
import { AiTryOnController } from '../../src/ai/controller';
import {
  AI_CONSENT_VERSION,
  type AiCapabilities,
  type AiJobStatus,
  type AiJobView,
} from '../../src/ai/types';

const CAPS: AiCapabilities = {
  enabled: true,
  reason: null,
  provider: 'fake',
  testProvider: true,
  presets: [{ id: 'max-fast-1k', label: 'Max', model: 'tryon-max', credits: 1 }],
  defaultPreset: 'max-fast-1k',
  consentVersion: AI_CONSENT_VERSION,
  devUploads: true,
  limits: { maxUploadBytes: 8 << 20, maxInputPixels: 4e7 },
  localResultTtlSeconds: 120,
  jobDeadlineSeconds: 120,
  providerRetentionUrl: 'https://docs.fashn.ai/api-overview/data-retention-privacy',
};

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

const view = (id: string, status: AiJobStatus, extra: Partial<AiJobView> = {}): AiJobView => ({
  id,
  status,
  preset: 'max-fast-1k',
  garmentId: 'coral-crew-tee',
  createdAt: 0,
  elapsedMs: 0,
  resultAvailable: status === 'completed',
  resultExpiresAt: null,
  error: null,
  testResult: true,
  ...extra,
});

/** Records every call; responses are controlled by the test. */
class FakeClient implements AiClient {
  calls: string[] = [];
  submits: SubmitJobInput[] = [];
  caps: AiCapabilities | Error = CAPS;
  submitResponse: () => Promise<AiJobView> = async () => view('job-1', 'queued');
  statusResponse: (id: string) => Promise<AiJobView> = async (id) => view(id, 'completed');
  async capabilities() {
    this.calls.push('capabilities');
    if (this.caps instanceof Error) throw this.caps;
    return this.caps;
  }
  async createSession() {
    this.calls.push('session');
    return { expiresAt: 0, idleTimeoutSeconds: 600 };
  }
  async endSession() {
    this.calls.push('end-session');
  }
  async submitJob(input: SubmitJobInput) {
    this.calls.push('submit');
    this.submits.push(input);
    return this.submitResponse();
  }
  async jobStatus(id: string) {
    this.calls.push(`status:${id}`);
    return this.statusResponse(id);
  }
  async jobResult(id: string) {
    this.calls.push(`result:${id}`);
    return new Blob(['result-bytes'], { type: 'image/jpeg' });
  }
  async abandonJob(id: string) {
    this.calls.push(`abandon:${id}`);
  }
}

function setup() {
  const client = new FakeClient();
  const timers: { fn: () => void; ms: number; id: number }[] = [];
  let nextId = 1;
  let clock = 0;
  const urls = new Set<string>();
  let urlCount = 0;
  const controller = new AiTryOnController({
    client,
    now: () => clock,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.push({ fn, ms, id });
      return id;
    },
    clearTimeout: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    createObjectURL: () => {
      const u = `blob:test/${++urlCount}`;
      urls.add(u);
      return u;
    },
    revokeObjectURL: (u) => urls.delete(u),
    randomUUID: () => `00000000-0000-4000-8000-${String(++urlCount).padStart(12, '0')}`,
    pollIntervalMs: 1000,
  });
  /** Advances the clock and runs the timers that are due now (one round), then settles promises. */
  const tick = async (ms = 1000) => {
    clock += ms;
    const due = timers.filter((t) => t.ms <= ms);
    for (const t of due) {
      timers.splice(timers.indexOf(t), 1);
      t.fn();
    }
    await flush();
  };
  return { client, controller, urls, tick, advance: (ms: number) => (clock += ms) };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const photo = (): CapturedImage => ({
  blob: new Blob(['capture'], { type: 'image/jpeg' }),
  width: 640,
  height: 480,
  source: 'camera',
  mediaTimeMs: 0,
});

async function readyWithCapture() {
  const t = setup();
  await t.controller.activate();
  t.controller.selectCatalogueGarment('coral-crew-tee', 'Coral crew tee');
  t.controller.setCapture(photo());
  return t;
}

describe('AI controller: nothing is sent without an explicit Generate + opt-in', () => {
  it('activation only reads capabilities; capture and garment choice send nothing', async () => {
    const { client, controller } = await readyWithCapture();
    expect(controller.getState().phase).toBe('review');
    expect(client.calls).toEqual(['capabilities']);
  });

  it('asks for consent before the first upload; declining sends nothing', async () => {
    const { client, controller } = await readyWithCapture();
    controller.requestGenerate();
    expect(controller.getState().phase).toBe('consent');
    controller.declineConsent();
    expect(controller.getState().phase).toBe('review');
    expect(client.calls).toEqual(['capabilities']);
  });

  it('accepting consent creates one session and one job, with the consent version', async () => {
    const { client, controller } = await readyWithCapture();
    controller.requestGenerate();
    controller.acceptConsent();
    await flush();
    expect(client.calls).toEqual(['capabilities', 'session', 'submit']);
    expect(client.submits[0]).toMatchObject({
      garmentId: 'coral-crew-tee',
      preset: 'max-fast-1k',
      consentVersion: AI_CONSENT_VERSION,
    });
  });

  it('repeated clicks while submitting produce exactly one submission', async () => {
    const { client, controller } = await readyWithCapture();
    controller.requestGenerate();
    controller.acceptConsent();
    controller.requestGenerate();
    controller.requestGenerate();
    await flush();
    expect(client.calls.filter((c) => c === 'submit')).toHaveLength(1);
  });

  it('shows unconfigured states instead of a fake success', async () => {
    const t = setup();
    t.client.caps = { ...CAPS, enabled: false, reason: 'No FASHN API key is configured on the server.' };
    await t.controller.activate();
    expect(t.controller.getState().phase).toBe('unconfigured');
    expect(t.controller.getState().unavailable?.reason).toMatch(/API key/);
    const down = setup();
    down.client.caps = new AiApiError('network', 0, 'unreachable');
    await down.controller.activate();
    expect(down.controller.getState().unavailable).toMatchObject({ backendDown: true });
    down.controller.setCapture(photo());
    down.controller.requestGenerate();
    expect(down.client.calls).toEqual(['capabilities']);
  });
});

describe('AI controller: progress, result and comparison', () => {
  it('maps queued → generating → result and uses the original capture for "try another"', async () => {
    const t = await readyWithCapture();
    const states: AiJobStatus[] = ['queued', 'generating', 'completed'];
    t.client.statusResponse = async (id) => view(id, states.shift() ?? 'completed');
    t.controller.requestGenerate();
    t.controller.acceptConsent();
    await flush();
    expect(t.controller.getState().phase).toBe('queued');
    await t.tick();
    expect(t.controller.getState().phase).toBe('queued');
    await t.tick();
    expect(t.controller.getState().phase).toBe('generating');
    await t.tick();
    const s = t.controller.getState();
    expect(s.phase).toBe('result');
    expect(s.result).toMatchObject({ garmentLabel: 'Coral crew tee', testResult: true });
    const capturedBlob = t.client.submits[0]?.person;
    // Try another garment: same capture, never the generated image.
    t.controller.tryAnother();
    t.controller.selectCatalogueGarment('breton-stripe-tee', 'Breton stripe');
    t.controller.requestGenerate();
    await flush();
    expect(t.client.submits).toHaveLength(2);
    expect(t.client.submits[1]?.person).toBe(capturedBlob);
    expect(t.client.submits[1]?.garmentId).toBe('breton-stripe-tee');
    expect(t.client.submits[1]?.clientRequestId).not.toBe(t.client.submits[0]?.clientRequestId);
  });

  it('reports failures with sanitized messages', async () => {
    const t = await readyWithCapture();
    t.client.statusResponse = async (id) =>
      view(id, 'failed', { error: { code: 'pose', message: 'The person could not be detected clearly.' } });
    t.controller.requestGenerate();
    t.controller.acceptConsent();
    await flush();
    await t.tick();
    expect(t.controller.getState()).toMatchObject({ phase: 'error', error: { code: 'pose' } });
  });
});

describe('AI controller: stale results never surface', () => {
  it('retake during generation abandons the job and ignores its late completion', async () => {
    const t = await readyWithCapture();
    const status = deferred<AiJobView>();
    t.client.statusResponse = () => status.promise;
    t.controller.requestGenerate();
    t.controller.acceptConsent();
    await flush();
    await t.tick(); // poll in flight
    t.controller.retake();
    expect(t.client.calls).toContain('abandon:job-1');
    status.resolve(view('job-1', 'completed'));
    await flush();
    await t.tick();
    expect(t.controller.getState()).toMatchObject({ phase: 'ready', result: null, capture: null });
    expect(t.client.calls.filter((c) => c.startsWith('result:'))).toEqual([]);
  });

  it('leaving AI mode mid-generation abandons, purges the session and shows nothing later', async () => {
    const t = await readyWithCapture();
    const submit = deferred<AiJobView>();
    t.client.submitResponse = () => submit.promise;
    t.controller.requestGenerate();
    t.controller.acceptConsent();
    await flush();
    t.controller.deactivate();
    expect(t.client.calls).toContain('end-session');
    // The job ID arrives late. Ending the session already purged it server-side, so it is neither
    // polled, shown, nor DELETEd separately (that request would only race the purge).
    submit.resolve(view('job-late', 'queued'));
    await flush();
    await t.tick();
    expect(t.client.calls).not.toContain('abandon:job-late');
    expect(t.client.calls.some((c) => c.startsWith('status:'))).toBe(false);
    expect(t.controller.getState()).toMatchObject({
      phase: 'inactive',
      result: null,
      capture: null,
      consented: false,
    });
  });

  it('retake while the submission is in flight abandons the late job explicitly (session kept)', async () => {
    const t = await readyWithCapture();
    const submit = deferred<AiJobView>();
    t.client.submitResponse = () => submit.promise;
    t.controller.requestGenerate();
    t.controller.acceptConsent();
    await flush();
    t.controller.retake();
    submit.resolve(view('job-late', 'queued'));
    await flush();
    expect(t.client.calls).toContain('abandon:job-late');
    expect(t.client.calls).not.toContain('end-session');
    expect(t.controller.getState().phase).toBe('ready');
  });

  it('ending the session with a known job relies on the session purge (no racing job DELETE)', async () => {
    const t = await readyWithCapture();
    t.client.statusResponse = async (id) => view(id, 'generating');
    t.controller.requestGenerate();
    t.controller.acceptConsent();
    await flush();
    t.controller.deactivate();
    expect(t.client.calls).toContain('end-session');
    expect(t.client.calls).not.toContain('abandon:job-1');
    await t.tick();
    expect(t.client.calls.some((c) => c.startsWith('status:'))).toBe(false);
    expect(t.controller.getState().phase).toBe('inactive');
  });

  it('changing the garment during generation abandons that job', async () => {
    const t = await readyWithCapture();
    t.client.statusResponse = async (id) => view(id, 'generating');
    t.controller.requestGenerate();
    t.controller.acceptConsent();
    await flush();
    t.controller.selectCatalogueGarment('forest-v-neck', 'Forest V-neck');
    expect(t.client.calls).toContain('abandon:job-1');
    expect(t.controller.getState().phase).toBe('review');
    await t.tick();
    expect(t.client.calls.some((c) => c.startsWith('status:'))).toBe(false);
  });

  it('End session revokes images and requires a fresh opt-in for the next customer', async () => {
    const t = await readyWithCapture();
    t.controller.requestGenerate();
    t.controller.acceptConsent();
    await flush();
    await t.tick();
    expect(t.controller.getState().phase).toBe('result');
    t.controller.endSession();
    expect(t.urls.size).toBe(0);
    expect(t.controller.getState()).toMatchObject({
      phase: 'ready',
      capture: null,
      result: null,
      consented: false,
    });
    t.controller.setCapture(photo());
    t.controller.requestGenerate();
    expect(t.controller.getState().phase).toBe('consent');
  });

  it('dispose (unmount) releases every object URL', async () => {
    const t = await readyWithCapture();
    t.controller.selectUploadedGarment(new Blob(['g']), 'Uploaded', 'tops', 'auto');
    t.controller.dispose();
    expect(t.urls.size).toBe(0);
  });
});

describe('AI controller: network interruptions never cause a second charge', () => {
  it('polling failures show a notice and keep reading the same job', async () => {
    const t = await readyWithCapture();
    let fail = 2;
    t.client.statusResponse = async (id) => {
      if (fail-- > 0) throw new AiApiError('network', 0, 'offline');
      return view(id, 'completed');
    };
    t.controller.requestGenerate();
    t.controller.acceptConsent();
    await flush();
    await t.tick();
    expect(t.controller.getState().notice).toMatch(/Connection interrupted/);
    await t.tick(5000);
    await t.tick(5000);
    expect(t.controller.getState().phase).toBe('result');
    expect(t.client.calls.filter((c) => c === 'submit')).toHaveLength(1);
  });

  it('after a lost submission the explicit retry reuses the same request ID (server dedupes)', async () => {
    const t = await readyWithCapture();
    t.client.submitResponse = async () => {
      throw new AiApiError('network', 0, 'offline');
    };
    t.controller.requestGenerate();
    t.controller.acceptConsent();
    await flush();
    expect(t.controller.getState().phase).toBe('error');
    expect(t.client.calls.filter((c) => c === 'submit')).toHaveLength(1); // no automatic retry
    t.client.submitResponse = async () => view('job-1', 'queued');
    t.controller.requestGenerate();
    await flush();
    expect(t.client.submits[1]?.clientRequestId).toBe(t.client.submits[0]?.clientRequestId);
    // A different photo is a different request.
    t.controller.retake();
    t.controller.setCapture(photo());
    t.controller.requestGenerate();
    await flush();
    expect(t.client.submits[2]?.clientRequestId).not.toBe(t.client.submits[0]?.clientRequestId);
  });

  it('gives up locally at the deadline without resubmitting', async () => {
    const t = await readyWithCapture();
    t.client.statusResponse = async (id) => view(id, 'generating');
    t.controller.requestGenerate();
    t.controller.acceptConsent();
    await flush();
    t.advance((CAPS.jobDeadlineSeconds + 31) * 1000);
    await t.tick();
    expect(t.controller.getState()).toMatchObject({ phase: 'error', error: { code: 'timeout' } });
    expect(t.client.calls.filter((c) => c === 'submit')).toHaveLength(1);
    expect(t.client.calls).toContain('abandon:job-1');
  });
});
