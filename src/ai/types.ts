/**
 * Application-owned contract between the browser and the local AI backend (`server/`). Pure types
 * and constants only: this module is imported by both sides, so it must never import Node modules,
 * the provider SDK, or browser APIs.
 */

/** Operator-selectable generation presets. Each maps to one explicit provider request shape. */
export type AiPresetId = 'max-fast-1k' | 'v16-performance';

export const AI_PRESET_IDS: readonly AiPresetId[] = ['max-fast-1k', 'v16-performance'];

/** Garment category (from product metadata; sent to models that accept it). */
export type AiGarmentCategory = 'tops' | 'bottoms' | 'one-pieces';

/** How the product photo was taken (from product metadata). */
export type AiGarmentPhotoType = 'flat-lay' | 'model' | 'auto';

/**
 * Version of the shopper opt-in text. The backend rejects a job whose consent version does not match,
 * so changing the wording (or the provider) forces a new opt-in.
 */
export const AI_CONSENT_VERSION = 'fashn-cloud-2026-09-27';

export const AI_PROVIDER_RETENTION_URL = 'https://docs.fashn.ai/api-overview/data-retention-privacy';

/** Header every browser call must carry (a same-origin marker; cross-site forms cannot set it). */
export const AI_CLIENT_HEADER = 'x-vfm-ai';

export interface AiPresetInfo {
  id: AiPresetId;
  label: string;
  /** Provider model name, shown in diagnostics only. */
  model: string;
  /** Credits reserved per generation (one output). */
  credits: number;
}

export interface AiCapabilities {
  /** True when a job can be submitted right now. */
  enabled: boolean;
  /** Why AI is unavailable (operator-facing), or null when enabled. */
  reason: string | null;
  provider: 'fashn' | 'fake' | null;
  /** True for the offline fake provider: results are test images, never real generations. */
  testProvider: boolean;
  presets: AiPresetInfo[];
  defaultPreset: AiPresetId | null;
  consentVersion: string;
  /** Developer uploads (a person photo instead of the camera, a garment photo) are accepted. */
  devUploads: boolean;
  limits: { maxUploadBytes: number; maxInputPixels: number };
  localResultTtlSeconds: number;
  jobDeadlineSeconds: number;
  providerRetentionUrl: string;
}

/** Local job states exposed to the browser (provider states are mapped onto these). */
export type AiJobStatus =
  | 'submitting'
  | 'queued'
  | 'generating'
  | 'completed'
  | 'failed'
  /** Submission or completion is unknown (e.g. a timeout); never retried automatically. */
  | 'uncertain'
  | 'expired'
  | 'abandoned';

export const AI_TERMINAL_STATUSES: readonly AiJobStatus[] = [
  'completed',
  'failed',
  'uncertain',
  'expired',
  'abandoned',
];

/** Sanitized, shopper-safe error codes. Provider messages are never forwarded verbatim. */
export type AiErrorCode =
  | 'not-configured'
  | 'bad-request'
  | 'consent-required'
  | 'invalid-image'
  | 'image-too-large'
  | 'unknown-garment'
  | 'uploads-disabled'
  | 'duplicate-conflict'
  | 'busy'
  | 'rate-limited'
  | 'daily-limit'
  | 'session-expired'
  | 'not-found'
  | 'forbidden'
  | 'pose'
  | 'moderation'
  | 'image-load'
  | 'provider-auth'
  | 'provider-credits'
  | 'provider-busy'
  | 'provider-failed'
  | 'provider-output'
  | 'timeout'
  | 'uncertain'
  | 'internal';

export interface AiError {
  code: AiErrorCode;
  message: string;
}

export interface AiJobView {
  id: string;
  status: AiJobStatus;
  preset: AiPresetId;
  garmentId: string | null;
  createdAt: number;
  /** Milliseconds since the job was accepted locally (server clock). */
  elapsedMs: number;
  resultAvailable: boolean;
  /** Epoch ms after which the local result is deleted. */
  resultExpiresAt: number | null;
  error: AiError | null;
  testResult: boolean;
}

export interface AiSessionView {
  expiresAt: number;
  idleTimeoutSeconds: number;
}

/** One UTC day of AI usage, from the server's local ledger (counts only, never images). */
export interface AiUsageDay {
  day: string;
  /** Completed generations (charged). */
  generations: number;
  /** Credits counted against the cap: charged + uncertain + still in progress. */
  credits: number;
  /** Failed or refused requests (not charged). */
  failed: number;
  /** Outcome unknown (e.g. timeout): may have been charged. */
  uncertain: number;
}

/** Staff usage view: local ledger history plus the FASHN account balance when available. */
export interface AiUsageView {
  today: { used: number; cap: number; remaining: number; uncertain: number };
  days: AiUsageDay[];
  balance: { total: number; subscription: number; onDemand: number } | null;
  balanceError: string | null;
  balanceCheckedAt: number | null;
}
