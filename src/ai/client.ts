/**
 * Browser client for the local AI backend. Every call is a same-origin request to /api/ai (allowed
 * by the CSP and the local-only fetch guard); the browser never talks to the cloud provider and
 * never sees an API key.
 */
import {
  AI_CLIENT_HEADER,
  type AiCapabilities,
  type AiErrorCode,
  type AiGarmentCategory,
  type AiGarmentPhotoType,
  type AiJobView,
  type AiPresetId,
  type AiSessionView,
  type AiUsageView,
} from './types';

export class AiApiError extends Error {
  constructor(
    /** 'network' = the backend could not be reached (not an answer from it). */
    readonly code: AiErrorCode | 'network',
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AiApiError';
  }
}

export interface SubmitJobInput {
  person: Blob;
  garmentId?: string;
  garmentFile?: Blob;
  garmentCategory?: AiGarmentCategory;
  garmentPhotoType?: AiGarmentPhotoType;
  preset: AiPresetId;
  consentVersion: string;
  clientRequestId: string;
}

export interface AiClient {
  capabilities(signal?: AbortSignal): Promise<AiCapabilities>;
  createSession(signal?: AbortSignal): Promise<AiSessionView>;
  endSession(): Promise<void>;
  /** Sends the access code of a public deployment; the server answers with an HttpOnly cookie. */
  unlock(code: string, signal?: AbortSignal): Promise<void>;
  submitJob(input: SubmitJobInput, signal?: AbortSignal): Promise<AiJobView>;
  jobStatus(id: string, signal?: AbortSignal): Promise<AiJobView>;
  jobResult(id: string, signal?: AbortSignal): Promise<Blob>;
  abandonJob(id: string): Promise<void>;
}

const BASE = '/api/ai';
/** Set by the Vite dev/preview server when the local AI server is not running (vite.config.ts). */
const BACKEND_OFFLINE_HEADER = 'x-ai-backend-offline';

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { [AI_CLIENT_HEADER]: '1', ...(init.headers ?? {}) },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new AiApiError('network', 0, 'The AI service on this device could not be reached.');
  }
  if (res.headers.get(BACKEND_OFFLINE_HEADER)) {
    throw new AiApiError('network', 503, 'The AI service on this device is not running.');
  }
  if (res.ok) return res;
  let code: AiErrorCode | 'network' = res.status === 404 ? 'not-found' : 'internal';
  let message = `AI service error (${res.status}).`;
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    if (body?.error?.code) code = body.error.code as AiErrorCode;
    if (body?.error?.message) message = body.error.message;
  } else if (res.status === 502 || res.status === 503 || res.status === 504) {
    // e.g. the Vite proxy with no backend running.
    code = 'network';
    message = 'The AI service on this device is not running.';
  }
  throw new AiApiError(code, res.status, message);
}

export function createHttpAiClient(): AiClient {
  return {
    async capabilities(signal) {
      const res = await request('/capabilities', signal ? { signal } : {});
      return (await res.json()) as AiCapabilities;
    },
    async createSession(signal) {
      const res = await request('/session', { method: 'POST', ...(signal ? { signal } : {}) });
      return (await res.json()) as AiSessionView;
    },
    async endSession() {
      // keepalive lets the purge complete even if the page is being closed.
      await request('/session', { method: 'DELETE', keepalive: true });
    },
    async unlock(code, signal) {
      await request('/access', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
        ...(signal ? { signal } : {}),
      });
    },
    async submitJob(input, signal) {
      const form = new FormData();
      form.set('person', input.person, 'person.jpg');
      if (input.garmentId) form.set('garmentId', input.garmentId);
      if (input.garmentFile) form.set('garment', input.garmentFile, 'garment');
      if (input.garmentCategory) form.set('garmentCategory', input.garmentCategory);
      if (input.garmentPhotoType) form.set('garmentPhotoType', input.garmentPhotoType);
      form.set('preset', input.preset);
      form.set('consentVersion', input.consentVersion);
      form.set('clientRequestId', input.clientRequestId);
      const res = await request('/jobs', { method: 'POST', body: form, ...(signal ? { signal } : {}) });
      return (await res.json()) as AiJobView;
    },
    async jobStatus(id, signal) {
      const res = await request(`/jobs/${encodeURIComponent(id)}`, signal ? { signal } : {});
      return (await res.json()) as AiJobView;
    },
    async jobResult(id, signal) {
      const res = await request(`/jobs/${encodeURIComponent(id)}/result`, signal ? { signal } : {});
      const type = res.headers.get('content-type') ?? '';
      if (!/^image\/(jpeg|png|webp)/.test(type)) {
        throw new AiApiError('provider-output', res.status, 'The preview image was not usable.');
      }
      return res.blob();
    },
    async abandonJob(id) {
      await request(`/jobs/${encodeURIComponent(id)}`, { method: 'DELETE', keepalive: true });
    },
  };
}

/** Staff usage view (Diagnostics): local ledger history and the FASHN balance. */
export async function fetchAiUsage(signal?: AbortSignal): Promise<AiUsageView> {
  const res = await request('/usage', signal ? { signal } : {});
  return (await res.json()) as AiUsageView;
}
