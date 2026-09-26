/**
 * Harmless UI preferences persisted in localStorage (never footage or images). Every read is
 * validated; storage failures (private mode, blocked storage) silently fall back to defaults.
 */
import { QUALITY_PRESETS } from '../config/performance';
import { clampUserFit } from '../fitting/garmentFit';
import { GARMENTS } from '../garments/catalogue';
import { DEFAULT_SETTINGS, type EngineSettings } from './MirrorEngine';

const KEY = 'virtual-fitting-mirror.preferences.v1';

export interface Preferences extends EngineSettings {
  diagnosticsOpen: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = { ...DEFAULT_SETTINGS, diagnosticsOpen: false };

const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

/** Validates untrusted stored data field by field. Unknown or invalid fields use defaults. */
export function parsePreferences(raw: unknown): Preferences {
  const p: Preferences = { ...DEFAULT_PREFERENCES, fit: { ...DEFAULT_PREFERENCES.fit } };
  if (!raw || typeof raw !== 'object') return p;
  const r = raw as Record<string, unknown>;
  if (typeof r.garmentId === 'string' && GARMENTS.some((g) => g.id === r.garmentId))
    p.garmentId = r.garmentId;
  if (isBool(r.showGarment)) p.showGarment = r.showGarment;
  if (isBool(r.mirror)) p.mirror = r.mirror;
  if (isBool(r.showLandmarks)) p.showLandmarks = r.showLandmarks;
  if (isBool(r.occlusion)) p.occlusion = r.occlusion;
  if (isBool(r.diagnosticsOpen)) p.diagnosticsOpen = r.diagnosticsOpen;
  if (r.fitMode === 'contain' || r.fitMode === 'cover') p.fitMode = r.fitMode;
  if (typeof r.preset === 'string' && r.preset in QUALITY_PRESETS)
    p.preset = r.preset as Preferences['preset'];
  if (r.delegate === 'GPU' || r.delegate === 'CPU') p.delegate = r.delegate;
  if (r.fit && typeof r.fit === 'object') {
    const f = r.fit as Record<string, unknown>;
    p.fit = clampUserFit({
      scale: typeof f.scale === 'number' ? f.scale : 1,
      verticalOffset: typeof f.verticalOffset === 'number' ? f.verticalOffset : 0,
    });
  }
  return p;
}

export function loadPreferences(): Preferences {
  try {
    const text = globalThis.localStorage?.getItem(KEY);
    return parsePreferences(text ? JSON.parse(text) : null);
  } catch {
    return parsePreferences(null);
  }
}

export function savePreferences(prefs: Preferences): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable: preferences simply are not remembered.
  }
}
