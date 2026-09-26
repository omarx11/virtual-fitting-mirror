/**
 * Local tracking asset locations.
 *
 * WASM: imported with `?url` from the installed @mediapipe/tasks-vision package, so Vite serves /
 * bundles the exact files that match the JavaScript API version in package-lock.json. No CDN.
 * - The *module* build is used inside the module Web Worker (loaded with dynamic import()).
 * - The *classic* build is used by the main-thread fallback (loaded with a <script> tag).
 *
 * Models: downloaded (version-pinned, SHA-256 verified) by `npm run setup:assets` into public/models.
 */
import wasmClassicLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmClassicBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import wasmModuleLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_module_internal.js?url';
import wasmModuleBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url';
import type { ModelVariant } from '../config/performance';

function absolute(url: string): string {
  return new URL(url, globalThis.location.href).href;
}

export function modelUrl(variant: ModelVariant): string {
  return absolute(`${import.meta.env.BASE_URL}models/pose_landmarker_${variant}.task`);
}

export function wasmUrls(target: 'worker' | 'main-thread'): { loader: string; binary: string } {
  return target === 'worker'
    ? { loader: absolute(wasmModuleLoaderUrl), binary: absolute(wasmModuleBinaryUrl) }
    : { loader: absolute(wasmClassicLoaderUrl), binary: absolute(wasmClassicBinaryUrl) };
}

export const TASKS_VISION_VERSION = __TASKS_VISION_VERSION__;
