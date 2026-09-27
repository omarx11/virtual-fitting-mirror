// The REAL FASHN adapter (official SDK) against a mocked transport: no network, no key, no spend.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRESETS } from '../../server/ai/presets';
import { FashnProvider } from '../../server/ai/providers/fashn';
import { mapRuntimeError, ProviderSubmitError } from '../../server/ai/providers/types';

const KEY = 'fa-test-key-0000000000000000';
const REQUEST = PRESETS['max-fast-1k'].build({
  personDataUri: `data:image/jpeg;base64,${'P'.repeat(4000)}`,
  productDataUri: `data:image/jpeg;base64,${'Q'.repeat(4000)}`,
  category: 'tops',
  photoType: 'flat-lay',
  seed: 7,
});

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
}

function mockFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const call: Call = {
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : null,
    };
    calls.push(call);
    return respond(call);
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const provider = (f: typeof fetch) => new FashnProvider({ apiKey: KEY, submitTimeoutMs: 2000, fetch: f });
const signal = () => AbortSignal.timeout(5000);

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.FASHN_LOG;
});

describe('FASHN adapter (mocked transport)', () => {
  it('POSTs one /v1/run with Bearer auth and the exact preset body', async () => {
    const m = mockFetch(() => json(200, { id: 'abc123def-4567-u1', error: null }));
    const result = await provider(m.fetch).submit(REQUEST, signal());
    expect(result).toEqual({ providerJobId: 'abc123def-4567-u1' });
    expect(m.calls).toHaveLength(1);
    const call = m.calls[0];
    expect(call?.method).toBe('POST');
    expect(new URL(call?.url ?? '').origin).toBe('https://api.fashn.ai');
    expect(new URL(call?.url ?? '').pathname).toBe('/v1/run');
    expect(call?.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(call?.body ?? '{}')).toEqual(REQUEST);
  });

  it.each([
    ['a connection failure', () => Promise.reject(new TypeError('fetch failed'))],
    ['a 500', () => json(500, { error: 'InternalServerError', message: 'x' })],
    ['a 503', () => json(503, { error: 'Unavailable', message: 'x' })],
  ])('never retries a submission after %s and reports it as ambiguous', async (_label, respond) => {
    const m = mockFetch(respond as () => Promise<Response>);
    const error = await provider(m.fetch)
      .submit(REQUEST, signal())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderSubmitError);
    expect((error as ProviderSubmitError).kind).toBe('ambiguous');
    expect(m.calls).toHaveLength(1);
  });

  it('treats a timeout as ambiguous without retrying', async () => {
    const m = mockFetch(
      (call) =>
        new Promise<Response>((_resolve, reject) => {
          void call;
          setTimeout(() => reject(new DOMException('timed out', 'AbortError')), 50);
        }),
    );
    const p = new FashnProvider({ apiKey: KEY, submitTimeoutMs: 20, fetch: m.fetch });
    const error = await p.submit(REQUEST, signal()).catch((e: unknown) => e);
    expect((error as ProviderSubmitError).kind).toBe('ambiguous');
    expect(m.calls).toHaveLength(1);
  });

  it.each([
    [401, { error: 'UnauthorizedAccess', message: 'bad key' }, 'provider-auth'],
    [429, { error: 'OutOfCredits', message: 'none left' }, 'provider-credits'],
    [429, { error: 'RateLimitExceeded', message: 'slow down' }, 'provider-busy'],
    [429, { error: 'ConcurrencyLimitExceeded', message: 'too many' }, 'provider-busy'],
    [400, { error: 'BadRequest', message: 'bad' }, 'provider-failed'],
  ])('HTTP %i %j is a definite rejection (%s), sent once', async (status, body, code) => {
    const m = mockFetch(() => json(status, body));
    const error = (await provider(m.fetch)
      .submit(REQUEST, signal())
      .catch((e: unknown) => e)) as ProviderSubmitError;
    expect(error.kind).toBe('rejected');
    expect(error.code).toBe(code);
    // The provider's own message is not forwarded.
    expect(error.message).not.toContain(body.message);
    expect(m.calls).toHaveLength(1);
  });

  it('a 2xx without a usable prediction ID is ambiguous', async () => {
    const m = mockFetch(() => json(200, { id: '../../etc', error: null }));
    const error = (await provider(m.fetch)
      .submit(REQUEST, signal())
      .catch((e: unknown) => e)) as ProviderSubmitError;
    expect(error.kind).toBe('ambiguous');
  });

  it('reads GET /v1/status/{id}, validates the shape and the credits header', async () => {
    const m = mockFetch(() =>
      json(
        200,
        { id: 'abc123def', status: 'completed', output: ['data:image/jpeg;base64,AAAA'], error: null },
        {
          'x-fashn-credits-used': '1',
        },
      ),
    );
    const status = await provider(m.fetch).status('abc123def', signal());
    expect(m.calls[0]?.method).toBe('GET');
    expect(new URL(m.calls[0]?.url ?? '').pathname).toBe('/v1/status/abc123def');
    expect(status).toEqual({
      state: 'completed',
      output: ['data:image/jpeg;base64,AAAA'],
      errorName: null,
      creditsUsed: 1,
    });
  });

  it('maps unexpected status bodies to "unknown" and runtime errors to sanitized codes', async () => {
    const m = mockFetch(() => json(200, { status: 'dancing', output: 'nope', error: 'x' }));
    const status = await provider(m.fetch).status('abc123def', signal());
    expect(status.state).toBe('unknown');
    expect(status.output).toEqual([]);
    expect(mapRuntimeError('PoseError')).toBe('pose');
    expect(mapRuntimeError('ContentModerationError')).toBe('moderation');
    expect(mapRuntimeError('ImageLoadError')).toBe('image-load');
    expect(mapRuntimeError('SomethingNew')).toBe('provider-failed');
  });

  it('never logs request bodies or the key, even with FASHN_LOG=debug', async () => {
    process.env.FASHN_LOG = 'debug';
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) =>
      vi.spyOn(console, k).mockImplementation(() => undefined),
    );
    const m = mockFetch(() => json(500, { error: 'InternalServerError', message: 'x' }));
    await provider(m.fetch)
      .submit(REQUEST, signal())
      .catch(() => undefined);
    const logged = spies.flatMap((s) => s.mock.calls.flat().map(String)).join('\n');
    expect(logged).not.toContain('PPPP');
    expect(logged).not.toContain(KEY);
  });
});
