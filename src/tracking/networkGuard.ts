/**
 * Local-only network guard.
 *
 * @mediapipe/tasks-vision sends usage metrics to Google (POST https://odml.pa.googleapis.com/v1/log)
 * via the global `fetch`. This app needs no network access beyond its own origin, so `fetch` is
 * wrapped to reject every request that is not same-origin, blob: or data:. It is installed in the
 * pose worker and on the main thread before MediaPipe runs, so it works on any host. The
 * Content-Security-Policy in index.html / vite.config.ts is a second, browser-enforced layer.
 */
let installed = false;
let blocked = 0;

export function isLocalUrl(url: string, origin: string): boolean {
  try {
    const u = new URL(url, origin);
    return u.protocol === 'blob:' || u.protocol === 'data:' || u.origin === origin;
  } catch {
    return false;
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function installLocalOnlyFetch(scope: typeof globalThis = globalThis): void {
  if (installed || typeof scope.fetch !== 'function') return;
  installed = true;
  const originalFetch = scope.fetch.bind(scope);
  const origin = scope.location.origin;
  scope.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (!isLocalUrl(url, origin)) {
      blocked++;
      if (blocked === 1) console.info(`[privacy] Blocked outgoing request to ${new URL(url, origin).host}.`);
      return Promise.reject(new TypeError('Blocked by the app’s local-only network policy'));
    }
    return originalFetch(input, init);
  };
}

/** Number of requests blocked in this JavaScript realm (for diagnostics/tests). */
export function blockedRequestCount(): number {
  return blocked;
}
