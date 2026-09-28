/**
 * A visitor's own FASHN API key, saved in this browser's localStorage so it survives a reload. It is
 * sent only to this site's AI server (same origin), with that visitor's AI requests, and never ends up
 * in the page's code or the server's storage.
 *
 * Storage can be unavailable (private mode, blocked site data): the key then lasts for this page load.
 */
const KEY = 'virtual-fitting-mirror.fashn-key.v1';

export interface UserKeyStore {
  get(): string | null;
  set(key: string | null): void;
}

export function createBrowserKeyStore(): UserKeyStore {
  let memory: string | null = null;
  try {
    memory = localStorage.getItem(KEY);
  } catch {
    // Storage blocked: start without a saved key.
  }
  return {
    get: () => memory,
    set(key) {
      memory = key;
      try {
        if (key) localStorage.setItem(KEY, key);
        else localStorage.removeItem(KEY);
      } catch {
        // Kept in memory only.
      }
    },
  };
}

/** A store that forgets everything on reload (tests, and callers without a browser). */
export function createMemoryKeyStore(initial: string | null = null): UserKeyStore {
  let memory = initial;
  return {
    get: () => memory,
    set(key) {
      memory = key;
    },
  };
}
