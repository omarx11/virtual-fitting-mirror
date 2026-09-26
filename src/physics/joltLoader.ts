/**
 * Browser loader for Jolt: the single-threaded WASM build from the installed package. The .wasm
 * file is resolved by Vite (`?url`) and served from this origin, so loading passes the local-only
 * fetch guard and the `connect-src 'self'` CSP. No CDN, no SharedArrayBuffer/cross-origin
 * isolation (the multithreaded build is not used).
 */

import wasmUrl from 'jolt-physics/jolt-physics.wasm.wasm?url';
import initJolt from 'jolt-physics/wasm';
import type { Jolt } from './joltCloth';

export async function loadJoltWasm(): Promise<Jolt> {
  const absolute = new URL(wasmUrl, globalThis.location.href).href;
  return (await initJolt({ locateFile: () => absolute })) as Jolt;
}
