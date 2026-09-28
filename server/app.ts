/**
 * Fastify application: the AI API and, in production, the built frontend at the same origin.
 * Browser → same-origin /api/ai/* → this server → the configured provider. This server is the only
 * component allowed to reach the cloud provider; the browser stays same-origin (CSP + fetch guard).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { Redis } from '@upstash/redis';
import Fastify, { type FastifyError, type FastifyInstance, LogController } from 'fastify';
import { AI_USER_KEY_HEADER } from '../src/ai/types';
import { AccessGate } from './ai/access';
import { CatalogueStore } from './ai/catalogue';
import { AppError } from './ai/errors';
import { JobManager } from './ai/jobs';
import { type KvStore, MemoryKv, RedisKv, storeHealthCheck } from './ai/kv';
import { FileLedger, KvLedger, type UsageLedger } from './ai/ledger';
import { FakeProvider } from './ai/providers/fake';
import { FashnProvider } from './ai/providers/fashn';
import type { TryOnProvider } from './ai/providers/types';
import { type AiServices, aiRoutes } from './ai/routes';
import { SessionStore } from './ai/sessions';
import type { ServerConfig } from './config';

/** Same policy as vite.config.ts / index.html: the page may only connect to its own origin. */
export const CONTENT_SECURITY_POLICY = "connect-src 'self' ws: wss: blob: data:";

export interface AppOverrides {
  provider?: TryOnProvider;
  /** Provider for a visitor's own API key (default: FASHN with that key; tests reuse `provider`). */
  userProvider?: (apiKey: string) => TryOnProvider;
  ledger?: UsageLedger;
  /** Shared state store (tests pass one to simulate several instances sharing Redis). */
  kv?: KvStore;
  now?: () => number;
  /** How often expired in-memory entries are freed (ms). */
  sweepIntervalMs?: number;
  /** Keeps background job work alive after a response (Vercel: waitUntil). */
  defer?: (work: Promise<unknown>) => void;
}

/** The configured store: this process's memory, or the shared Upstash Redis database. */
export function createKv(config: ServerConfig, now?: () => number): KvStore {
  const { redis } = config.ai;
  if (config.ai.store === 'redis' && redis) {
    const client = new Redis({
      url: redis.url,
      token: redis.token,
      // Values are strings we encode ourselves (JSON, base64); nothing is converted implicitly.
      automaticDeserialization: false,
      // Commands issued together (Promise.all) travel in one HTTP request.
      enableAutoPipelining: true,
    });
    return new RedisKv(client);
  }
  // Without Redis credentials AI reports itself unavailable; a local store keeps the app running.
  return new MemoryKv(now);
}

export function createProvider(
  config: ServerConfig,
  now?: () => number,
  apiKey = config.ai.apiKey,
): TryOnProvider {
  const { ai } = config;
  if (ai.provider === 'fake') {
    return new FakeProvider({ scenario: ai.fakeScenario, stepMs: ai.fakeStepMs, ...(now ? { now } : {}) });
  }
  return new FashnProvider({ apiKey: apiKey ?? '', submitTimeoutMs: ai.submitTimeoutSeconds * 1000 });
}

export interface BuiltApp {
  app: FastifyInstance;
  services: AiServices;
}

export async function buildApp(config: ServerConfig, overrides: AppOverrides = {}): Promise<BuiltApp> {
  const { ai } = config;
  const now = overrides.now ?? Date.now;
  const app = Fastify({
    logger:
      config.logLevel === 'silent'
        ? false
        : {
            level: config.logLevel,
            redact: [
              'req.headers.cookie',
              'req.headers.authorization',
              `req.headers["${AI_USER_KEY_HEADER}"]`,
            ],
          },
    // Request bodies are never logged; only errors are, without payloads.
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 64 * 1024,
    trustProxy: false,
  });

  const provider = overrides.provider ?? createProvider(config, overrides.now);
  // The offline test provider has no account: a visitor's key then reuses the same instance.
  const userProvider =
    overrides.userProvider ??
    (overrides.provider || ai.provider === 'fake'
      ? () => provider
      : (apiKey: string) => createProvider(config, overrides.now, apiKey));
  const kv = overrides.kv ?? createKv(config, now);
  const ledger =
    overrides.ledger ??
    (kv.kind === 'redis'
      ? new KvLedger(kv, ai.maxDailyCredits, now)
      : new FileLedger(ai.ledgerPath, ai.maxDailyCredits, now));
  const services: AiServices = {
    config,
    sessions: new SessionStore(kv, ai.sessionIdleSeconds * 1000, now),
    jobs: new JobManager({
      ai,
      provider,
      ledger,
      kv,
      now,
      ...(overrides.defer ? { defer: overrides.defer } : {}),
    }),
    access: new AccessGate(ai.accessCode, kv, ai.accessLifetimeHours * 3_600_000, now),
    catalogue: new CatalogueStore(config.catalogueRoot, {
      maxBytes: ai.maxUploadBytes,
      maxPixels: ai.maxInputPixels,
      longSide: ai.maxUploadLongSide,
    }),
    ledger,
    provider,
    userProvider,
    providerName: provider.name,
    storeHealth: storeHealthCheck(kv),
  };

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('content-security-policy', CONTENT_SECURITY_POLICY);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    if (req.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
    return payload;
  });

  await app.register(rateLimit, { global: false });
  await app.register(multipart, {
    limits: {
      fileSize: ai.maxUploadBytes,
      files: 2,
      fields: 8,
      fieldSize: 256,
      parts: 10,
      headerPairs: 50,
    },
  });
  // Set before registering routes: plugins inherit the error handler present at registration.
  app.setErrorHandler((error: FastifyError | AppError, _req, reply) => {
    if (error instanceof AppError) return reply.code(error.status).send({ error: error.toJSON() });
    const status = (error as FastifyError).statusCode ?? 500;
    const code = (error as FastifyError).code ?? '';
    if (code === 'FST_REQ_FILE_TOO_LARGE' || code === 'FST_FILES_LIMIT' || status === 413) {
      return reply
        .code(413)
        .send({ error: { code: 'image-too-large', message: 'That image is too large.' } });
    }
    if (status === 429) {
      return reply
        .code(429)
        .send({ error: { code: 'rate-limited', message: 'Too many requests. Please wait a moment.' } });
    }
    if (status >= 400 && status < 500) {
      return reply
        .code(status)
        .send({ error: { code: 'bad-request', message: 'The request was not valid.' } });
    }
    app.log.error({ code, name: (error as Error).name }, 'unhandled server error');
    return reply
      .code(500)
      .send({ error: { code: 'internal', message: 'Something went wrong on this device.' } });
  });

  await app.register(async (scope) => aiRoutes(scope, services), { prefix: '/api/ai' });

  const staticRoot =
    config.staticRoot && existsSync(join(config.staticRoot, 'index.html')) ? config.staticRoot : null;
  if (staticRoot) {
    await app.register(fastifyStatic, { root: staticRoot, index: ['index.html'], wildcard: true });
  }
  app.setNotFoundHandler((req, reply) => {
    // API routes must never fall through to the SPA's HTML.
    if (req.url === '/api' || req.url.startsWith('/api/')) {
      return reply.code(404).send({ error: { code: 'not-found', message: 'Unknown API route.' } });
    }
    if (staticRoot && req.method === 'GET' && (req.headers.accept ?? '').includes('text/html')) {
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    }
    return reply.code(404).type('text/plain').send('Not found');
  });

  // Everything expires by time to live; a memory store only needs expired entries freed now and then.
  const sweeper =
    kv instanceof MemoryKv ? setInterval(() => kv.sweep(), overrides.sweepIntervalMs ?? 5000) : null;
  sweeper?.unref();
  app.addHook('onClose', async () => {
    if (sweeper) clearInterval(sweeper);
    services.jobs.dispose();
  });

  return { app, services };
}
