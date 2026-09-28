/**
 * Server configuration from environment variables (see .env.example). Secrets are read here and
 * never leave the server: the capabilities endpoint reports only whether AI is usable.
 *
 * Two platforms:
 *   - 'node': one long-running process (`npm run dev`, `npm start` on the kiosk). State lives in
 *     memory, the credit ledger in a file.
 *   - 'vercel': the same app as a Vercel Function (server/vercel.ts). Many short-lived instances
 *     share their state and the credit ledger through Redis, and paid generations need an access
 *     code because the site is public.
 *
 * Invalid numbers or names fail fast with a clear message. A missing API key, Redis database or
 * access code does NOT fail: the app still serves 2D/3D and AI reports itself as unconfigured.
 *
 * Who pays: the operator's key (FASHN_API_KEY) and, unless AI_USER_KEYS=false, a visitor's own key
 * entered in the AI panel. `unavailableReason` blocks AI entirely; `serverKeyReason` only blocks the
 * operator's key, so visitors can still bring theirs.
 */
import { isAbsolute, join, resolve } from 'node:path';
import { AI_PRESET_IDS, type AiPresetId } from '../src/ai/types';

export type ProviderName = 'fashn' | 'fake';
export type Platform = 'node' | 'vercel';

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
  /**
   * Operator switch (AI_ENABLED, default true: the operator's key is spent only once FASHN_API_KEY is
   * set, otherwise visitors pay with their own). Even when true, AI can be unavailable; see
   * `unavailableReason`.
   */
  switchedOn: boolean;
  provider: ProviderName;
  /** Kept private to the provider adapter. Never logged or returned. */
  apiKey: string | null;
  /** Visitors may use their own FASHN API key (AI_USER_KEYS, default true). */
  userKeys: boolean;
  defaultPreset: AiPresetId;
  /** Presets the operator may choose in diagnostics (always includes the default). */
  presets: AiPresetId[];
  maxConcurrentJobs: number;
  /** Daily credit cap for the operator's key; null = no cap (AI_MAX_DAILY_CREDITS unset or empty). */
  maxDailyCredits: number | null;
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
  /** Where sessions, jobs and results live: this process, or the shared Redis database. */
  store: 'memory' | 'redis';
  /** Upstash Redis REST credentials (store 'redis'); the token never leaves the server. */
  redis: { url: string; token: string } | null;
  /** Shared access code for paid generations (required on Vercel), or null. */
  accessCode: string | null;
  accessLifetimeHours: number;
  fakeScenario: FakeScenario;
  fakeStepMs: number;
  /** Reason AI cannot be used at all right now, or null when it can. */
  unavailableReason: string | null;
  /** Reason the operator's key cannot pay for generations, or null when it can. */
  serverKeyReason: string | null;
}

export interface ServerConfig {
  platform: Platform;
  production: boolean;
  host: string;
  port: number;
  /** Exact origins allowed to call /api/ai (Origin header) — also defines the allowed Host values. */
  allowedOrigins: string[];
  /**
   * Vercel: requests only arrive for the project's own domains (production, previews, custom), so
   * instead of a fixed list the Origin must equal https://<Host>.
   */
  sameOriginHosts: boolean;
  /** Mark cookies Secure (always on Vercel, which serves HTTPS only). */
  secureCookies: boolean;
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

export function loadConfig(
  env: Env,
  options: { production: boolean; root: string; platform?: Platform },
): ServerConfig {
  const { production, root } = options;
  const platform = options.platform ?? 'node';
  const vercel = platform === 'vercel';
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
  const store = (str(env, 'AI_STORE') ?? (vercel ? 'redis' : 'memory')) as AiConfig['store'];
  if (store !== 'memory' && store !== 'redis') {
    throw new ConfigError(`AI_STORE must be "memory" or "redis" (got "${store}").`);
  }
  if (vercel && store !== 'redis') {
    throw new ConfigError('On Vercel AI_STORE must be "redis": instances do not share memory.');
  }
  // The Vercel Marketplace integration sets KV_REST_API_*; a database made on upstash.com, UPSTASH_*.
  const redisUrl = str(env, 'UPSTASH_REDIS_REST_URL') ?? str(env, 'KV_REST_API_URL');
  const redisToken = str(env, 'UPSTASH_REDIS_REST_TOKEN') ?? str(env, 'KV_REST_API_TOKEN');
  const accessCode = str(env, 'AI_ACCESS_CODE') ?? null;
  if (accessCode !== null && accessCode.length < 8) {
    throw new ConfigError('AI_ACCESS_CODE must be at least 8 characters long.');
  }
  const sessionIdleSeconds = int(env, 'AI_SESSION_IDLE_SECONDS', 3600, 30, 86_400);
  // A request to a Vercel Function may carry at most 4.5 MB, photos and form fields included.
  const maxUploadBytes = int(
    env,
    'AI_MAX_UPLOAD_BYTES',
    vercel ? 4 * 1024 * 1024 : 8 * 1024 * 1024,
    64 * 1024,
    vercel ? 4 * 1024 * 1024 : 30 * 1024 * 1024,
  );

  const ai: AiConfig = {
    switchedOn: bool(env, 'AI_ENABLED', true),
    provider,
    apiKey,
    userKeys: bool(env, 'AI_USER_KEYS', true),
    defaultPreset,
    presets: [...presets],
    maxConcurrentJobs: int(env, 'AI_MAX_CONCURRENT_JOBS', 1, 1, 6),
    // Unset or empty: no daily cap (the FASHN balance is then the only limit). 0 blocks the operator's key.
    maxDailyCredits:
      str(env, 'AI_MAX_DAILY_CREDITS') === undefined ? null : int(env, 'AI_MAX_DAILY_CREDITS', 0, 0, 100_000),
    // A result never outlives the session idle timeout, so an idle session takes its image with it.
    resultTtlSeconds: Math.min(int(env, 'AI_RESULT_TTL_SECONDS', 1800, 10, 3600), sessionIdleSeconds),
    jobDeadlineSeconds: int(env, 'AI_JOB_DEADLINE_SECONDS', 120, 5, 600),
    sessionIdleSeconds,
    submitTimeoutSeconds: int(env, 'AI_SUBMIT_TIMEOUT_SECONDS', 60, 1, 300),
    pollIntervalMs: int(env, 'AI_POLL_INTERVAL_MS', 1000, 5, 30_000),
    maxUploadBytes,
    maxInputPixels: int(env, 'AI_MAX_INPUT_PIXELS', 40_000_000, 10_000, 100_000_000),
    maxUploadLongSide: int(env, 'AI_UPLOAD_LONG_SIDE', 2048, 512, 4096),
    devUploads: bool(env, 'AI_DEV_UPLOADS', !production),
    ledgerPath: ledger === 'memory' ? null : isAbsolute(ledger) ? ledger : resolve(root, ledger),
    store,
    redis: redisUrl && redisToken ? { url: redisUrl, token: redisToken } : null,
    accessCode,
    accessLifetimeHours: int(env, 'AI_ACCESS_HOURS', 12, 1, 24 * 30),
    fakeScenario,
    fakeStepMs: int(env, 'AI_FAKE_STEP_MS', 700, 1, 60_000),
    unavailableReason: null,
    serverKeyReason: null,
  };

  // Fail closed: every reason the operator's key must not be spent is reported, not silently skipped.
  if (provider === 'fashn' && !apiKey) {
    ai.serverKeyReason = 'No FASHN API key is configured on the server (FASHN_API_KEY).';
  } else if (ai.maxDailyCredits === 0) {
    ai.serverKeyReason = 'The daily AI credit limit is 0 (AI_MAX_DAILY_CREDITS).';
  } else if (vercel && !accessCode) {
    ai.serverKeyReason =
      'Set AI_ACCESS_CODE (at least 8 characters) in the Vercel project settings: the site is public.';
  }

  // Every reason AI must not run at all, whoever's key pays.
  if (!ai.switchedOn) {
    ai.unavailableReason = 'AI mode is switched off on the server (AI_ENABLED is not true).';
  } else if (provider === 'fake' && production && !bool(env, 'AI_ALLOW_FAKE_PROVIDER', false)) {
    ai.unavailableReason = 'The offline test provider is disabled in production.';
  } else if (store === 'redis' && !ai.redis) {
    ai.unavailableReason =
      'No Redis database is connected (add "Upstash for Redis" to the project in the Vercel Marketplace).';
  } else if (!vercel && !isLoopbackHost(host) && !bool(env, 'AI_ALLOW_NON_LOOPBACK', false)) {
    ai.unavailableReason =
      'AI is disabled because the server listens beyond this computer without access control. ' +
      'Bind to 127.0.0.1, or add authentication + HTTPS and set AI_ALLOW_NON_LOOPBACK=true.';
  } else if (ai.serverKeyReason && !ai.userKeys) {
    ai.unavailableReason = ai.serverKeyReason;
  }

  const logLevel = (str(env, 'AI_LOG_LEVEL') ?? 'warn') as ServerConfig['logLevel'];
  if (!['silent', 'error', 'warn', 'info', 'debug'].includes(logLevel)) {
    throw new ConfigError('AI_LOG_LEVEL must be silent, error, warn, info or debug.');
  }

  return {
    platform,
    production,
    host,
    port,
    allowedOrigins: [...origins],
    sameOriginHosts: vercel,
    secureCookies: vercel,
    // On Vercel the CDN serves the frontend; the function only answers /api/ai.
    staticRoot: production && !vercel ? resolve(root, 'dist') : null,
    // Vercel ships public/garments/ai/ with the function (vercel.json → includeFiles).
    catalogueRoot: resolve(root, production && !vercel ? 'dist' : 'public'),
    logLevel,
    ai,
  };
}
