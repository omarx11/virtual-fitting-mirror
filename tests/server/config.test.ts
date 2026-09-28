import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../server/config';
import { ROOT } from './helpers';

const load = (env: Record<string, string>, production = false) => loadConfig(env, { production, root: ROOT });

describe('server configuration', () => {
  it('is safe by default: no operator key spent, loopback only, Max fast 1K, one job, daily cap', () => {
    const c = load({});
    expect(c.host).toBe('127.0.0.1');
    expect(c.port).toBe(3001);
    // On, but without FASHN_API_KEY only visitors' own keys can pay.
    expect(c.ai.switchedOn).toBe(true);
    expect(c.ai.serverKeyReason).toMatch(/FASHN_API_KEY/);
    expect(load({ AI_ENABLED: 'false' }).ai.unavailableReason).toMatch(/AI_ENABLED/);
    expect(c.ai.defaultPreset).toBe('max-fast-1k');
    expect(c.ai.presets).toEqual(['max-fast-1k']);
    expect(c.ai.maxConcurrentJobs).toBe(1);
    expect(c.ai.maxDailyCredits).toBe(20);
    expect(c.ai.resultTtlSeconds).toBe(120);
  });

  it('reports a missing key without failing (2D/3D keep running, visitors may bring their own)', () => {
    const c = load({ AI_ENABLED: 'true' });
    expect(c.ai.userKeys).toBe(true);
    expect(c.ai.unavailableReason).toBeNull();
    expect(c.ai.serverKeyReason).toMatch(/FASHN_API_KEY/);
    const kiosk = load({ AI_ENABLED: 'true', AI_USER_KEYS: 'false' });
    expect(kiosk.ai.unavailableReason).toMatch(/FASHN_API_KEY/);
    const keyed = load({ AI_ENABLED: 'true', FASHN_API_KEY: 'k' });
    expect(keyed.ai.unavailableReason).toBeNull();
    expect(keyed.ai.serverKeyReason).toBeNull();
  });

  it('disables the fake provider in production unless explicitly allowed', () => {
    expect(load({ AI_ENABLED: 'true', AI_PROVIDER: 'fake' }, true).ai.unavailableReason).toMatch(
      /production/,
    );
    expect(
      load({ AI_ENABLED: 'true', AI_PROVIDER: 'fake', AI_ALLOW_FAKE_PROVIDER: 'true' }, true).ai
        .unavailableReason,
    ).toBeNull();
  });

  it('refuses to run AI on a network-reachable address without explicit acknowledgement', () => {
    const c = load({ AI_ENABLED: 'true', FASHN_API_KEY: 'k', AI_HOST: '0.0.0.0' });
    expect(c.ai.unavailableReason).toMatch(/access control/);
  });

  it('builds exact allowed origins (dev adds the Vite ports only outside production)', () => {
    expect(load({}).allowedOrigins).toContain('http://localhost:5173');
    const prod = load({ AI_ALLOWED_ORIGINS: 'https://kiosk.example/' }, true);
    expect(prod.allowedOrigins).not.toContain('http://localhost:5173');
    expect(prod.allowedOrigins).toContain('https://kiosk.example');
    expect(prod.ai.devUploads).toBe(false);
  });

  it.each([
    { AI_PORT: 'abc' },
    { AI_MAX_CONCURRENT_JOBS: '0' },
    { AI_PROVIDER: 'openai' },
    { AI_PRESET: 'max-quality-4k' },
    { AI_ENABLED: 'maybe' },
    { AI_ALLOWED_ORIGINS: 'ftp://x' },
  ])('rejects invalid settings %j with a clear error', (env) => {
    expect(() => load(env)).toThrow(ConfigError);
  });

  it('allows the v1.6 comparison preset only when configured', () => {
    expect(load({ AI_EXTRA_PRESETS: 'v16-performance' }).ai.presets).toEqual([
      'max-fast-1k',
      'v16-performance',
    ]);
  });
});
