import type { AiErrorCode } from '../../../src/ai/types';
import type { ProviderRequest } from '../presets';

/** Provider prediction states (FASHN's set), plus 'unknown' for anything unexpected. */
export type ProviderState =
  | 'starting'
  | 'in_queue'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'time_out'
  | 'unknown';

export interface ProviderStatus {
  state: ProviderState;
  /** Raw outputs (validated later by decodeProviderOutput). */
  output: unknown[];
  /** Provider runtime error name (e.g. PoseError), never shown verbatim. */
  errorName: string | null;
  /** Credits the provider reports for this prediction, when it does. */
  creditsUsed: number | null;
}

/**
 * Submission failure.
 * - 'rejected': the provider definitely did NOT accept the request (e.g. 400/401/429 response):
 *   nothing was charged and the reservation can be released.
 * - 'ambiguous': the outcome is unknown (timeout, connection loss, 5xx): the provider may have
 *   accepted it. Never retried automatically; the reservation is kept.
 */
export class ProviderSubmitError extends Error {
  constructor(
    readonly kind: 'rejected' | 'ambiguous',
    readonly code: AiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderSubmitError';
  }
}

export interface TryOnProvider {
  readonly name: 'fashn' | 'fake';
  /** Submits ONE generation. Must not retry internally. */
  submit(request: ProviderRequest, signal: AbortSignal): Promise<{ providerJobId: string }>;
  /** Reads status. Safe to retry (idempotent GET). */
  status(providerJobId: string, signal: AbortSignal): Promise<ProviderStatus>;
  /** Account credit balance, when the provider offers one (free read). */
  balance?(signal: AbortSignal): Promise<ProviderBalance>;
}

export interface ProviderBalance {
  total: number;
  subscription: number;
  onDemand: number;
}

const STATES: readonly ProviderState[] = [
  'starting',
  'in_queue',
  'processing',
  'completed',
  'failed',
  'canceled',
  'time_out',
];

/** Validates an untrusted status body. Unexpected shapes become state 'unknown', never a throw. */
export function parseProviderStatus(raw: unknown, creditsUsed: number | null = null): ProviderStatus {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const state = STATES.includes(r.status as ProviderState) ? (r.status as ProviderState) : 'unknown';
  const output = Array.isArray(r.output) ? r.output : [];
  const err = r.error && typeof r.error === 'object' ? (r.error as Record<string, unknown>) : null;
  const errorName = err && typeof err.name === 'string' ? err.name.slice(0, 64) : null;
  return { state, output, errorName, creditsUsed };
}

/** Maps a provider runtime error name to a sanitized code. */
export function mapRuntimeError(name: string | null): AiErrorCode {
  switch (name) {
    case 'PoseError':
      return 'pose';
    case 'ContentModerationError':
      return 'moderation';
    case 'ImageLoadError':
      return 'image-load';
    case 'UnavailableError':
      return 'provider-busy';
    case 'PollingTimeout':
      return 'timeout';
    default:
      return 'provider-failed';
  }
}
