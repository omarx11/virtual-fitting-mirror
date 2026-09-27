/**
 * Harmless UI preferences persisted in localStorage (never footage, photos, results or AI consent).
 * Every read is validated; storage failures (private mode, blocked storage) silently fall back to
 * defaults.
 *
 * Try-on mode: `tryOnMode` is the explicit 2D / 3D / AI selector. In the live modes the selected
 * garment's kind always equals the mode. The last garment chosen in each live mode is remembered, so
 * switching 2D → AI → 3D → 2D restores each mode's choice. Stored preferences from before the mode
 * selector existed are migrated: the mode follows the stored garment (3D stays the default).
 */
import { QUALITY_PRESETS } from '../config/performance';
import { clampUserFit } from '../fitting/garmentFit';
import { AI_GARMENTS, DEFAULT_AI_GARMENT_ID } from '../garments/aiCatalogue';
import { findGarment, GARMENTS } from '../garments/catalogue';
import { DEFAULT_SETTINGS, type EngineSettings } from './MirrorEngine';

const KEY = 'virtual-fitting-mirror.preferences.v1';

export type TryOnMode = '2d' | '3d' | 'ai';
export type LiveMode = Exclude<TryOnMode, 'ai'>;

/** Preferences that are UI-only (never passed to the engine). */
export interface UiPreferences {
  diagnosticsOpen: boolean;
  tryOnMode: TryOnMode;
  lastGarment2d: string;
  lastGarment3d: string;
  aiGarmentId: string;
}

export interface Preferences extends EngineSettings, UiPreferences {}

export const UI_PREFERENCE_KEYS: readonly (keyof UiPreferences)[] = [
  'diagnosticsOpen',
  'tryOnMode',
  'lastGarment2d',
  'lastGarment3d',
  'aiGarmentId',
];

const firstOfKind = (kind: LiveMode) =>
  GARMENTS.find((g) => g.kind === kind)?.id ?? DEFAULT_SETTINGS.garmentId;

export const DEFAULT_PREFERENCES: Preferences = {
  ...DEFAULT_SETTINGS,
  diagnosticsOpen: false,
  tryOnMode: findGarment(DEFAULT_SETTINGS.garmentId).kind,
  lastGarment2d: firstOfKind('2d'),
  lastGarment3d: firstOfKind('3d'),
  aiGarmentId: DEFAULT_AI_GARMENT_ID,
};

const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isGarmentOfKind = (v: unknown, kind: LiveMode): v is string =>
  typeof v === 'string' && GARMENTS.some((g) => g.id === v && g.kind === kind);

/** Validates untrusted stored data field by field. Unknown or invalid fields use defaults. */
export function parsePreferences(raw: unknown): Preferences {
  const p: Preferences = { ...DEFAULT_PREFERENCES, fit: { ...DEFAULT_PREFERENCES.fit } };
  if (!raw || typeof raw !== 'object') return p;
  const r = raw as Record<string, unknown>;
  if (typeof r.garmentId === 'string' && GARMENTS.some((g) => g.id === r.garmentId))
    p.garmentId = r.garmentId;
  if (typeof r.materialId === 'string' && r.materialId.length <= 64) p.materialId = r.materialId;
  if (r.motion === 'skeletal' || r.motion === 'cloth') p.motion = r.motion;
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

  // Try-on mode (with migration from preferences saved before the selector existed).
  const garmentKind = findGarment(p.garmentId).kind;
  if (isGarmentOfKind(r.lastGarment2d, '2d')) p.lastGarment2d = r.lastGarment2d;
  else if (garmentKind === '2d') p.lastGarment2d = p.garmentId;
  if (isGarmentOfKind(r.lastGarment3d, '3d')) p.lastGarment3d = r.lastGarment3d;
  else if (garmentKind === '3d') p.lastGarment3d = p.garmentId;
  if (typeof r.aiGarmentId === 'string' && AI_GARMENTS.some((g) => g.id === r.aiGarmentId))
    p.aiGarmentId = r.aiGarmentId;
  p.tryOnMode =
    r.tryOnMode === '2d' || r.tryOnMode === '3d' || r.tryOnMode === 'ai' ? r.tryOnMode : garmentKind;
  // Invariant: in a live mode the engine's garment is of that kind.
  if (p.tryOnMode !== 'ai' && garmentKind !== p.tryOnMode) {
    p.garmentId = p.tryOnMode === '2d' ? p.lastGarment2d : p.lastGarment3d;
  }
  return p;
}

/** The preference patch for choosing a mode on the 2D / 3D / AI selector. */
export function modePatch(prefs: Preferences, mode: TryOnMode): Partial<Preferences> {
  if (mode === 'ai') return { tryOnMode: 'ai' };
  return { tryOnMode: mode, garmentId: mode === '2d' ? prefs.lastGarment2d : prefs.lastGarment3d };
}

/** The preference patch for picking a live garment (the mode follows the garment's kind). */
export function liveGarmentPatch(garmentId: string): Partial<Preferences> {
  const garment = findGarment(garmentId);
  return {
    garmentId: garment.id,
    tryOnMode: garment.kind,
    ...(garment.kind === '2d' ? { lastGarment2d: garment.id } : { lastGarment3d: garment.id }),
  };
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
