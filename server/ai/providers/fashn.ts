/**
 * FASHN adapter using the official SDK (server-side only). REST equivalent:
 *   POST https://api.fashn.ai/v1/run        { model_name, inputs }  → { id, error }
 *   GET  https://api.fashn.ai/v1/status/{id}                        → { id, status, output?, error }
 * with `Authorization: Bearer <key>`.
 *
 * - Submission uses maxRetries: 0. The SDK otherwise retries timeouts, 408/409/429 and 5xx, which
 *   could create a second paid generation. Status reads (idempotent GETs) may retry.
 * - SDK logging is forced off so request bodies (base64 photos) and headers are never logged,
 *   whatever FASHN_LOG says.
 * - We submit and poll separately instead of `predictions.subscribe()`: stopping the SDK's polling
 *   does not cancel the prediction on the server, and our job store must own the deadline.
 */
import Fashn, { APIConnectionError, APIError } from 'fashn';
import type { ProviderRequest } from '../presets';
import {
  type ProviderBalance,
  type ProviderStatus,
  ProviderSubmitError,
  parseProviderStatus,
  type TryOnProvider,
} from './types';

/** Prediction IDs look like `123a87r9-4129-4bb3-be18-9c9fb5bd7fc1-u1`; be permissive but bounded. */
const PREDICTION_ID = /^[A-Za-z0-9_-]{8,128}$/;

export interface FashnProviderOptions {
  apiKey: string;
  submitTimeoutMs: number;
  statusTimeoutMs?: number;
  /** Injected transport for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  baseURL?: string;
}

function apiErrorCode(error: APIError): string | null {
  const body = error.error as Record<string, unknown> | undefined;
  return body && typeof body.error === 'string' ? body.error : null;
}

export class FashnProvider implements TryOnProvider {
  readonly name = 'fashn' as const;
  private readonly client: Fashn;

  constructor(private readonly options: FashnProviderOptions) {
    this.client = new Fashn({
      apiKey: options.apiKey,
      maxRetries: 0,
      timeout: options.submitTimeoutMs,
      logLevel: 'off',
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    });
  }

  async submit(request: ProviderRequest, signal: AbortSignal): Promise<{ providerJobId: string }> {
    let response: { id?: unknown; error?: unknown };
    try {
      // The SDK 0.15.0 typings omit generation_mode 'fast' for tryon-max, although the official API
      // reference documents it (and bills an omitted mode as 'balanced'). Our request shapes are
      // built and unit-tested in presets.ts, so the typed union is bypassed deliberately here.
      response = await this.client.predictions.run(
        request as unknown as Parameters<Fashn['predictions']['run']>[0],
        {
          maxRetries: 0,
          signal,
        },
      );
    } catch (error) {
      throw mapSubmitError(error);
    }
    const id = response?.id;
    if (typeof id === 'string' && PREDICTION_ID.test(id)) return { providerJobId: id };
    if (response?.error) {
      throw new ProviderSubmitError(
        'rejected',
        'provider-failed',
        'The provider refused to start the prediction.',
      );
    }
    // A 2xx without a usable ID: the provider may have created a prediction we cannot track.
    throw new ProviderSubmitError(
      'ambiguous',
      'uncertain',
      'The provider response had no valid prediction ID.',
    );
  }

  async status(providerJobId: string, signal: AbortSignal): Promise<ProviderStatus> {
    const { data, response } = await this.client.predictions
      .status(providerJobId, { maxRetries: 2, timeout: this.options.statusTimeoutMs ?? 15_000, signal })
      .withResponse();
    const header = response.headers.get('x-fashn-credits-used');
    const credits = header !== null && /^\d+(\.\d+)?$/.test(header) ? Number(header) : null;
    return parseProviderStatus(data, credits);
  }

  /**
   * Account balance: GET /v1/credits (https://docs.fashn.ai/utility-endpoints/credits). The SDK
   * 0.15.0 has no method for it, so it is called directly; the key stays server-side.
   */
  async balance(signal: AbortSignal): Promise<ProviderBalance> {
    const base = this.options.baseURL ?? 'https://api.fashn.ai';
    const res = await (this.options.fetch ?? fetch)(`${base}/v1/credits`, {
      headers: { authorization: `Bearer ${this.options.apiKey}` },
      signal,
    });
    if (!res.ok) throw new Error(`FASHN balance request failed (HTTP ${res.status}).`);
    const credits = ((await res.json()) as { credits?: Record<string, unknown> })?.credits;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN);
    const balance = {
      total: num(credits?.total),
      subscription: num(credits?.subscription),
      onDemand: num(credits?.on_demand),
    };
    if (Object.values(balance).some(Number.isNaN)) throw new Error('Unexpected FASHN balance response.');
    return balance;
  }
}

/** Classifies a submission failure as definitely-not-accepted or unknown. */
export function mapSubmitError(error: unknown): ProviderSubmitError {
  // Connection failures and timeouts (APIConnectionTimeoutError extends APIConnectionError) are
  // ambiguous: the request may have reached the provider.
  if (error instanceof APIConnectionError) {
    return new ProviderSubmitError('ambiguous', 'uncertain', 'The provider could not be reached reliably.');
  }
  if (error instanceof APIError && typeof error.status === 'number') {
    const status = error.status;
    const code = apiErrorCode(error);
    if (status === 401 || status === 403) {
      return new ProviderSubmitError('rejected', 'provider-auth', 'The provider rejected the API key.');
    }
    if (status === 429) {
      return code === 'OutOfCredits'
        ? new ProviderSubmitError('rejected', 'provider-credits', 'The provider account is out of credits.')
        : new ProviderSubmitError(
            'rejected',
            'provider-busy',
            'The provider rate or concurrency limit was hit.',
          );
    }
    if (status >= 400 && status < 500) {
      return new ProviderSubmitError(
        'rejected',
        'provider-failed',
        `The provider rejected the request (${status}).`,
      );
    }
    return new ProviderSubmitError('ambiguous', 'uncertain', `The provider failed with status ${status}.`);
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new ProviderSubmitError(
      'ambiguous',
      'uncertain',
      'Submission was aborted after it may have been sent.',
    );
  }
  return new ProviderSubmitError('ambiguous', 'uncertain', 'Unexpected submission failure.');
}
