/**
 * /api/ai/* — the application-owned API the browser talks to (same origin only).
 *
 * Request protection (every route):
 *   - Host must be one of the configured origins' hosts (defeats DNS rebinding);
 *   - Sec-Fetch-Site, when sent, must be same-origin; state-changing requests need an allowed Origin;
 *   - every call carries the X-VFM-AI header, which a cross-site form or <img> cannot add, and no
 *     CORS headers are ever sent, so other sites cannot read or write this API;
 *   - jobs belong to an ephemeral session (HttpOnly SameSite=Strict cookie) and are checked on
 *     every read, result download and deletion. Job IDs alone are not permission, and provider
 *     prediction IDs are never accepted from or shown to the client.
 * Responses are `Cache-Control: no-store`.
 */
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  AI_CLIENT_HEADER,
  AI_CONSENT_VERSION,
  AI_PROVIDER_RETENTION_URL,
  type AiCapabilities,
  type AiGarmentCategory,
  type AiGarmentPhotoType,
  type AiPresetId,
  type AiSessionView,
  type AiUsageView,
} from '../../src/ai/types';
import type { ServerConfig } from '../config';
import type { CatalogueStore } from './catalogue';
import { AppError } from './errors';
import { type ImageLimits, type NormalizedImage, normalizeImage } from './images';
import type { JobManager } from './jobs';
import type { UsageLedger } from './ledger';
import { presetInfo } from './presets';
import type { ProviderBalance, TryOnProvider } from './providers/types';
import {
  clearedSessionCookie,
  readCookie,
  SESSION_COOKIE,
  type Session,
  type SessionStore,
  sessionCookie,
} from './sessions';

export interface AiServices {
  config: ServerConfig;
  sessions: SessionStore;
  jobs: JobManager;
  catalogue: CatalogueStore;
  ledger: UsageLedger;
  provider: TryOnProvider;
  providerName: 'fashn' | 'fake';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JOB_ID = /^[A-Za-z0-9_-]{24}$/;
const CATEGORIES: readonly AiGarmentCategory[] = ['tops', 'bottoms', 'one-pieces'];
const PHOTO_TYPES: readonly AiGarmentPhotoType[] = ['flat-lay', 'model', 'auto'];

export function unavailableReason(s: AiServices): string | null {
  return s.config.ai.unavailableReason ?? s.ledger.loadError;
}

export function capabilities(s: AiServices): AiCapabilities {
  const { ai } = s.config;
  const reason = unavailableReason(s);
  return {
    enabled: reason === null,
    reason,
    provider: reason === null ? s.providerName : null,
    testProvider: reason === null && s.providerName === 'fake',
    presets: reason === null ? ai.presets.map(presetInfo) : [],
    defaultPreset: reason === null ? ai.defaultPreset : null,
    consentVersion: AI_CONSENT_VERSION,
    devUploads: ai.devUploads,
    limits: { maxUploadBytes: ai.maxUploadBytes, maxInputPixels: ai.maxInputPixels },
    localResultTtlSeconds: ai.resultTtlSeconds,
    jobDeadlineSeconds: ai.jobDeadlineSeconds,
    providerRetentionUrl: AI_PROVIDER_RETENTION_URL,
  };
}

const forbidden = () => new AppError('forbidden', 403, 'This request is not allowed.');

export function checkRequestOrigin(
  req: Pick<FastifyRequest, 'headers' | 'method'>,
  allowedOrigins: ReadonlySet<string>,
  allowedHosts: ReadonlySet<string>,
): void {
  const host = req.headers.host?.toLowerCase();
  if (!host || !allowedHosts.has(host)) throw forbidden();
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin') throw forbidden();
  if (req.headers[AI_CLIENT_HEADER] !== '1') throw forbidden();
  const origin = req.headers.origin;
  const safe = req.method === 'GET' || req.method === 'HEAD';
  if (!safe && (!origin || !allowedOrigins.has(origin))) throw forbidden();
  if (safe && origin !== undefined && !allowedOrigins.has(origin)) throw forbidden();
}

export async function aiRoutes(app: FastifyInstance, s: AiServices): Promise<void> {
  const { ai } = s.config;
  const origins = new Set(s.config.allowedOrigins);
  const hosts = new Set(s.config.allowedOrigins.map((o) => new URL(o).host.toLowerCase()));
  const limits: ImageLimits = {
    maxBytes: ai.maxUploadBytes,
    maxPixels: ai.maxInputPixels,
    longSide: ai.maxUploadLongSide,
  };

  app.addHook('onRequest', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    checkRequestOrigin(req, origins, hosts);
  });

  const requireSession = (req: FastifyRequest): Session => {
    const session = s.sessions.touch(readCookie(req.headers.cookie, SESSION_COOKIE));
    if (!session) throw new AppError('session-expired', 401, 'Your AI session ended. Please start again.');
    return session;
  };
  const jobId = (req: FastifyRequest): string => {
    const id = (req.params as { id?: string }).id ?? '';
    if (!JOB_ID.test(id)) throw new AppError('not-found', 404, 'That preview no longer exists.');
    return id;
  };
  const endSession = (req: FastifyRequest) => {
    const previous = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (previous && s.sessions.delete(previous)) s.jobs.purgeSession(previous);
  };
  const sessionView = (session: Session): AiSessionView => ({
    expiresAt: s.sessions.expiresAt(session),
    idleTimeoutSeconds: ai.sessionIdleSeconds,
  });

  const lenient = { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } };

  app.get('/capabilities', lenient, async () => capabilities(s));

  // Staff usage view: local ledger (this server only) + FASHN account balance (cached 60 s).
  let balanceCache: { at: number; balance: ProviderBalance | null; error: string | null } | null = null;
  app.get('/usage', lenient, async (): Promise<AiUsageView> => {
    const { ledger } = s;
    const view: AiUsageView = {
      today: {
        used: ledger.usedToday(),
        cap: ledger.cap,
        remaining: ledger.remainingToday(),
        uncertain: ledger.uncertainToday(),
      },
      days: ledger.summary(30),
      balance: null,
      balanceError: null,
      balanceCheckedAt: null,
    };
    if (s.providerName !== 'fashn' || !ai.apiKey || !s.provider.balance) {
      view.balanceError =
        s.providerName === 'fake'
          ? 'Offline test provider: no FASHN account.'
          : 'No FASHN API key configured.';
      return view;
    }
    if (!balanceCache || Date.now() - balanceCache.at > 60_000) {
      try {
        balanceCache = {
          at: Date.now(),
          balance: await s.provider.balance(AbortSignal.timeout(10_000)),
          error: null,
        };
      } catch (error) {
        const message = error instanceof Error && error.message.startsWith('FASHN') ? error.message : null;
        balanceCache = {
          at: Date.now(),
          balance: null,
          error: message ?? 'Could not reach FASHN to read the balance.',
        };
      }
    }
    view.balance = balanceCache.balance;
    view.balanceError = balanceCache.error;
    view.balanceCheckedAt = balanceCache.at;
    return view;
  });

  // A new session always replaces (and purges) the caller's previous one: a new customer.
  app.post('/session', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    endSession(req);
    const session = s.sessions.create();
    reply.header('set-cookie', sessionCookie(session.id, req.protocol === 'https'));
    return sessionView(session);
  });

  app.delete('/session', lenient, async (req, reply) => {
    endSession(req);
    reply.header('set-cookie', clearedSessionCookie(req.protocol === 'https'));
    return reply.code(204).send();
  });

  app.post(
    '/jobs',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (unavailableReason(s)) throw new AppError('not-configured', 503, 'AI preview is not available.');
      const session = requireSession(req);
      if (!req.isMultipart()) throw new AppError('bad-request', 415, 'Expected a multipart upload.');

      const fields: Record<string, string> = {};
      const files: Record<string, Buffer> = {};
      // Limits (bytes per file, file/field counts, field sizes) are enforced by @fastify/multipart
      // while streaming, before anything larger is buffered.
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          if (part.fieldname !== 'person' && part.fieldname !== 'garment') {
            await part.toBuffer().catch(() => undefined);
            throw new AppError('bad-request', 400, 'Unexpected file.');
          }
          if (files[part.fieldname]) throw new AppError('bad-request', 400, 'Duplicate file.');
          files[part.fieldname] = await part.toBuffer();
        } else {
          if (typeof part.value !== 'string' || part.fieldname in fields) {
            throw new AppError('bad-request', 400, 'Invalid form field.');
          }
          fields[part.fieldname] = part.value;
        }
      }

      if (fields.consentVersion !== AI_CONSENT_VERSION) {
        throw new AppError('consent-required', 400, 'Please agree to the photo upload first.');
      }
      const clientRequestId = fields.clientRequestId ?? '';
      if (!UUID.test(clientRequestId)) throw new AppError('bad-request', 400, 'A request ID is required.');
      const preset = (fields.preset ?? ai.defaultPreset) as AiPresetId;
      if (!ai.presets.includes(preset)) throw new AppError('bad-request', 400, 'That preset is not enabled.');
      const person = files.person;
      if (!person) throw new AppError('bad-request', 400, 'A photo is required.');

      const garmentId = fields.garmentId ?? null;
      const upload = files.garment ?? null;
      if ((garmentId === null) === (upload === null)) {
        throw new AppError('bad-request', 400, 'Choose exactly one garment.');
      }
      let product: NormalizedImage;
      let category: AiGarmentCategory;
      let photoType: AiGarmentPhotoType;
      let garmentKey: string;
      if (garmentId !== null) {
        const garment = s.catalogue.garment(garmentId);
        product = await s.catalogue.productImage(garment.id);
        category = garment.category;
        photoType = garment.photoType;
        garmentKey = `catalogue:${garment.id}`;
      } else {
        if (!ai.devUploads) throw new AppError('uploads-disabled', 403, 'Garment uploads are disabled.');
        category = (fields.garmentCategory ?? 'tops') as AiGarmentCategory;
        photoType = (fields.garmentPhotoType ?? 'auto') as AiGarmentPhotoType;
        if (!CATEGORIES.includes(category) || !PHOTO_TYPES.includes(photoType)) {
          throw new AppError('bad-request', 400, 'Invalid garment category or photo type.');
        }
        product = await normalizeImage(upload as Buffer, limits);
        garmentKey = `upload:${createHash('sha256').update(product.buffer).digest('hex')}`;
      }
      const personImage = await normalizeImage(person, limits);
      const fingerprint = createHash('sha256')
        .update(`${preset}\n${garmentKey}\n${category}\n${photoType}\n`)
        .update(personImage.buffer)
        .digest('hex');

      // The session may have ended while the upload was processed.
      if (!s.sessions.has(session.id)) throw new AppError('session-expired', 401, 'Your AI session ended.');
      const { job } = s.jobs.create({
        sessionId: session.id,
        clientRequestId,
        fingerprint,
        preset,
        garmentId,
        person: personImage,
        product,
        category,
        photoType,
      });
      return reply.code(202).send(job);
    },
  );

  app.get('/jobs/:id', lenient, async (req) => s.jobs.view(jobId(req), requireSession(req).id));

  app.get('/jobs/:id/result', lenient, async (req, reply) => {
    const image = s.jobs.result(jobId(req), requireSession(req).id);
    return reply
      .type(image.contentType)
      .header('content-disposition', 'inline')
      .header('x-ai-test-result', s.providerName === 'fake' ? 'fake-provider' : 'none')
      .send(image.buffer);
  });

  // Local abandonment only: the provider may still finish and charge the prediction.
  app.delete('/jobs/:id', lenient, async (req, reply) => {
    s.jobs.abandon(jobId(req), requireSession(req).id);
    return reply.code(204).send();
  });
}
