import { useEffect, useState } from 'react';
import { createHttpAiClient } from './client';
import { AiTryOnController, type AiViewState, INITIAL_AI_STATE } from './controller';
import { AI_BACKEND_DEPLOYED, AI_BACKEND_HOSTED } from './deployment';
import { createBrowserKeyStore } from './userKey';

/**
 * A customer's photos, results and opt-in are forgotten after this long without interaction. Long
 * enough to show a result around; matches the server's default result lifetime (server/config.ts).
 */
export const AI_IDLE_RESET_MS = 30 * 60_000;

/**
 * One controller per mounted App. Safe under React Strict Mode: the development double mount
 * creates and disposes a controller that has sent nothing (activation only reads capabilities and
 * the credit count).
 * Leaving AI mode (`active` false) abandons pending work and purges the AI session.
 */
export function useAiTryOn(active: boolean): { state: AiViewState; controller: AiTryOnController | null } {
  const [controller, setController] = useState<AiTryOnController | null>(null);
  const [state, setState] = useState<AiViewState>(INITIAL_AI_STATE);

  useEffect(() => {
    const instance = new AiTryOnController({
      client: createHttpAiClient(),
      now: () => performance.now(),
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (handle) => window.clearTimeout(handle as number),
      createObjectURL: (blob) => URL.createObjectURL(blob),
      revokeObjectURL: (url) => URL.revokeObjectURL(url),
      randomUUID: () => crypto.randomUUID(),
      keyStore: createBrowserKeyStore(),
      idleResetMs: AI_IDLE_RESET_MS,
      backendDeployed: AI_BACKEND_DEPLOYED,
      backendHosted: AI_BACKEND_HOSTED,
    });
    const unsubscribe = instance.subscribe(setState);
    setController(instance);
    // Exposed for automated browser tests, like window.__mirror.
    (window as unknown as { __ai?: AiTryOnController }).__ai = instance;
    const onPageHide = () => instance.dispose();
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      unsubscribe();
      instance.dispose();
      setController(null);
      const w = window as unknown as { __ai?: AiTryOnController };
      if (w.__ai === instance) delete w.__ai;
    };
  }, []);

  useEffect(() => {
    if (!controller) return;
    if (active) void controller.activate();
    else controller.deactivate();
  }, [active, controller]);

  return { state, controller };
}
