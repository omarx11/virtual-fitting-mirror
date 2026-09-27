/**
 * Server configuration from environment variables (see .env.example). Secrets are read here and
 * never leave the server: the capabilities endpoint reports only whether AI is usable.
 *
 * Invalid numbers or names fail fast with a clear message. A missing API key does NOT fail: the app
 * still serves 2D/3D and AI reports itself as unconfigured.
 */
import { isAbsolute, join, resolve } from 'node:path';
import { AI_PRESET_IDS, type AiPresetId } from '../src/ai/types';

export type ProviderName = 'fashn' | 'fake';

export type FakeScenario =
  | 'success'
  | 'fail-pose'
  | 'fail-moderation'
  | 'submit-timeout'
  | 'submit-rejected'
  | 'bad-output'
  | 'expired-output'
  | 'never-completes';

const FAKE_SCENARIOS: readonly FakeScenario[] = [
  'success',
  'fail-pose',
  'fail-moderation',
  'submit-timeout',
  'submit-rejected',
  'bad-output',
  'expired-output',
  'never-completes',
];

export interface AiConfig {
  /** Operator switch (AI_ENABLED). Even when true, AI can be unavailable; see `unavailableReason`. */
  switchedOn: boolean;
  provider: ProviderName;
  /** Kept private to the provider adapter. Never logged or returned. */
  apiKey: string | null;
  defaultPreset: AiPresetId;
  /** Presets the operator may choose in diagnostics (always includes the default). */
  presets: AiPresetId[];
  maxConcurrentJobs: number;
  maxDailyCredits: number;
  resultTtlSeconds: number;
  jobDeadlineSeconds: number;
  sessionIdleSeconds: number;
  submitTimeoutSeconds: number;
  pollIntervalMs: number;
  maxUploadBytes: number;
  maxInputPixels: number;
  /** Long side (px) inputs are downscaled to before upload, to bound request size and cost. */
  maxUploadLongSide: number;
  devUploads: boolean;
  /** Durable non-image usage ledger (daily credit cap), or null for in-memory only (tests). */
  ledgerPath: string | null;
  fakeScenario: FakeScenario;
  fakeStepMs: number;
  /** Reason AI cannot be used right now, or null when it can. */
  unavailableReason: string | null;
}

export interface ServerConfig {
  production: boolean;
  host: string;
  port: number;
  /** Exact origins allowed to call /api/ai (Origin header) — also defines the allowed Host values. */
  allowedOrigins: string[];
  /** Built frontend to serve at the same origin (production), or null. */
  staticRoot: string | null;
  /** Directory the AI catalogue's product images are resolved in (public/ or the built dist/). */
  catalogueRoot: string;
  logLevel: 'silent' | 'error' | 'warn' | 'info' | 'debug';
  ai: AiConfig;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

function str(env: Env, name: string): string | undefined {
  const v = env[name]?.trim();
  return v ? v : undefined;
}

function bool(env: Env, name: string, fallback: boolean): boolean {
  const v = str(env, name)?.toLowerCase();
  if (v === undefined) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  throw new ConfigError(`${name} must be true or false (got "${env[name]}").`);
}

function int(env: Env, name: string, fallback: number, min: number, max: number): number {
  const v = str(env, name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ConfigError(`${name} must be an integer between ${min} and ${max} (got "${v}").`);
  }
  return n;
}

function preset(value: string, name: string): AiPresetId {
  if ((AI_PRESET_IDS as readonly string[]).includes(value)) return value as AiPresetId;
  throw new ConfigError(`${name}: unknown preset "${value}". Known presets: ${AI_PRESET_IDS.join(', ')}.`);
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK.has(host) || host.startsWith('127.');
}

function normalizeOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`AI_ALLOWED_ORIGINS: "${value}" is not a valid origin.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError(`AI_ALLOWED_ORIGINS: "${value}" must be http(s).`);
  }
  return url.origin;
}

export function loadConfig(env: Env, options: { production: boolean; root: string }): ServerConfig {
  const { production, root } = options;
  const host = str(env, 'AI_HOST') ?? '127.0.0.1';
  const port = int(env, 'AI_PORT', 3001, 1, 65535);

  const origins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
  // The Vite dev server proxies /api from its own origin.
  if (!production) for (const p of [5173, 5174]) origins.add(`http://localhost:${p}`);
  for (const o of (str(env, 'AI_ALLOWED_ORIGINS') ?? '').split(',')) {
    if (o.trim()) origins.add(normalizeOrigin(o.trim()));
  }

  const provider = (str(env, 'AI_PROVIDER') ?? 'fashn') as ProviderName;
  if (provider !== 'fashn' && provider !== 'fake') {
    throw new ConfigError(`AI_PROVIDER must be "fashn" or "fake" (got "${provider}").`);
  }
  const defaultPreset = preset(str(env, 'AI_PRESET') ?? 'max-fast-1k', 'AI_PRESET');
  const presets = new Set<AiPresetId>([defaultPreset]);
  for (const p of (str(env, 'AI_EXTRA_PRESETS') ?? '').split(',')) {
    if (p.trim()) presets.add(preset(p.trim(), 'AI_EXTRA_PRESETS'));
  }
  const fakeScenario = (str(env, 'AI_FAKE_SCENARIO') ?? 'success') as FakeScenario;
  if (!FAKE_SCENARIOS.includes(fakeScenario)) {
    throw new ConfigError(`AI_FAKE_SCENARIO must be one of ${FAKE_SCENARIOS.join(', ')}.`);
  }
  const ledger = str(env, 'AI_LEDGER_PATH') ?? join('.ai-usage', 'ledger.json');
  const apiKey = str(env, 'FASHN_API_KEY') ?? null;

  const ai: AiConfig = {
    switchedOn: bool(env, 'AI_ENABLED', false),
    provider,
    apiKey,
    defaultPreset,
    presets: [...presets],
    maxConcurrentJobs: int(env, 'AI_MAX_CONCURRENT_JOBS', 1, 1, 6),
    maxDailyCredits: int(env, 'AI_MAX_DAILY_CREDITS', 20, 0, 100_000),
    resultTtlSeconds: int(env, 'AI_RESULT_TTL_SECONDS', 120, 10, 3600),
    jobDeadlineSeconds: int(env, 'AI_JOB_DEADLINE_SECONDS', 120, 5, 600),
    sessionIdleSeconds: int(env, 'AI_SESSION_IDLE_SECONDS', 600, 30, 86_400),
    submitTimeoutSeconds: int(env, 'AI_SUBMIT_TIMEOUT_SECONDS', 60, 1, 300),
    pollIntervalMs: int(env, 'AI_POLL_INTERVAL_MS', 1500, 5, 30_000),
    maxUploadBytes: int(env, 'AI_MAX_UPLOAD_BYTES', 8 * 1024 * 1024, 64 * 1024, 30 * 1024 * 1024),
    maxInputPixels: int(env, 'AI_MAX_INPUT_PIXELS', 40_000_000, 10_000, 100_000_000),
    maxUploadLongSide: int(env, 'AI_UPLOAD_LONG_SIDE', 2048, 512, 4096),
    devUploads: bool(env, 'AI_DEV_UPLOADS', !production),
    ledgerPath: ledger === 'memory' ? null : isAbsolute(ledger) ? ledger : resolve(root, ledger),
    fakeScenario,
    fakeStepMs: int(env, 'AI_FAKE_STEP_MS', 700, 1, 60_000),
    unavailableReason: null,
  };

  // Fail closed: every reason AI must not run is reported instead of silently degrading.
  if (!ai.switchedOn) {
    ai.unavailableReason = 'AI mode is switched off on the server (AI_ENABLED is not true).';
  } else if (provider === 'fashn' && !apiKey) {
    ai.unavailableReason = 'No FASHN API key is configured on the server (FASHN_API_KEY).';
  } else if (provider === 'fake' && production && !bool(env, 'AI_ALLOW_FAKE_PROVIDER', false)) {
    ai.unavailableReason = 'The offline test provider is disabled in production.';
  } else if (ai.maxDailyCredits === 0) {
    ai.unavailableReason = 'The daily AI credit limit is 0 (AI_MAX_DAILY_CREDITS).';
  } else if (!isLoopbackHost(host) && !bool(env, 'AI_ALLOW_NON_LOOPBACK', false)) {
    ai.unavailableReason =
      'AI is disabled because the server listens beyond this computer without access control. ' +
      'Bind to 127.0.0.1, or add authentication + HTTPS and set AI_ALLOW_NON_LOOPBACK=true.';
  }

  const logLevel = (str(env, 'AI_LOG_LEVEL') ?? 'warn') as ServerConfig['logLevel'];
  if (!['silent', 'error', 'warn', 'info', 'debug'].includes(logLevel)) {
    throw new ConfigError('AI_LOG_LEVEL must be silent, error, warn, info or debug.');
  }

  return {
    production,
    host,
    port,
    allowedOrigins: [...origins],
    staticRoot: production ? resolve(root, 'dist') : null,
    catalogueRoot: resolve(root, production ? 'dist' : 'public'),
    logLevel,
    ai,
  };
}
