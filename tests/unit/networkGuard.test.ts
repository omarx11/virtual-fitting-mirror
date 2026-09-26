import { describe, expect, it } from 'vitest';
import { blockedRequestCount, installLocalOnlyFetch, isLocalUrl } from '../../src/tracking/networkGuard';

const origin = 'http://localhost:5173';

describe('isLocalUrl', () => {
  it('allows same-origin, relative, blob: and data: URLs', () => {
    expect(isLocalUrl('/models/pose_landmarker_full.task', origin)).toBe(true);
    expect(isLocalUrl('http://localhost:5173/assets/x.wasm', origin)).toBe(true);
    expect(isLocalUrl('blob:http://localhost:5173/abc', origin)).toBe(true);
    expect(isLocalUrl('data:text/plain,hi', origin)).toBe(true);
  });
  it('rejects MediaPipe metrics and any other origin', () => {
    expect(isLocalUrl('https://odml.pa.googleapis.com/v1/log', origin)).toBe(false);
    expect(isLocalUrl('https://cdn.jsdelivr.net/npm/x', origin)).toBe(false);
    expect(isLocalUrl('http://localhost:9999/x', origin)).toBe(false);
  });
});

describe('installLocalOnlyFetch', () => {
  it('blocks outgoing requests without calling the real fetch, and passes local ones through', async () => {
    const calls: string[] = [];
    const scope = {
      location: { origin },
      fetch: async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return new Response('ok');
      },
    } as unknown as typeof globalThis;
    installLocalOnlyFetch(scope);
    await expect(scope.fetch('https://odml.pa.googleapis.com/v1/log', { method: 'POST' })).rejects.toThrow(
      /local-only/,
    );
    expect(calls).toEqual([]);
    expect(blockedRequestCount()).toBe(1);
    await expect(scope.fetch('/models/pose_landmarker_lite.task')).resolves.toBeInstanceOf(Response);
    expect(calls).toEqual(['/models/pose_landmarker_lite.task']);
  });
});
