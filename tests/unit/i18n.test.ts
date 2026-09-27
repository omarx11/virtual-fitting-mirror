import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeStatus } from '../../src/app/statusMessages';
import { AI_GARMENTS } from '../../src/garments/aiCatalogue';
import { GARMENT_CARDS, GARMENTS } from '../../src/garments/catalogue';
import { ar } from '../../src/i18n/ar';
import { en } from '../../src/i18n/en';
import { loadLocale } from '../../src/i18n/locale';
import { RESEARCH_MESSAGES } from '../../src/research/messages';

/** Every string leaf of a message tree, with its path (functions are called with sample arguments). */
function leaves(node: unknown, path = ''): [string, string][] {
  if (typeof node === 'string') return [[path, node]];
  if (typeof node === 'function') return [[`${path}()`, String(node('x', 'y', 'z', 1))]];
  if (Array.isArray(node)) return node.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  if (node && typeof node === 'object')
    return Object.entries(node).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  return [];
}

const ARABIC = /[؀-ۿ]/;
/** Leaves that are the same in both languages on purpose (key and brand names, language codes). */
const SAME_IN_BOTH = new Set([
  'keys.Esc',
  'language.switchText',
  'language.switchTextLang',
  'ai.consentBody.accent',
]);

/**
 * Leaves that must be Arabic: not intentionally shared, not empty, not a status tone code, and not a
 * code-to-message function (those are checked with real codes below).
 */
const mustBeArabic = ([path, text]: [string, string]) =>
  !SAME_IN_BOTH.has(path) &&
  text !== '' &&
  !path.endsWith('.tone') &&
  !path.endsWith('error()') &&
  !path.endsWith('trackerError()');

describe('Arabic messages', () => {
  it('has the same shape as English (arrays of the same length included)', () => {
    const enPaths = leaves(en).map(([p]) => p);
    const arPaths = leaves(ar).map(([p]) => p);
    expect(arPaths).toEqual(enPaths);
  });

  it('translates every message (no English left behind)', () => {
    expect(leaves(ar).filter((leaf) => mustBeArabic(leaf) && !ARABIC.test(leaf[1]))).toEqual([]);
  });

  it('covers every catalogue garment, card and AI garment', () => {
    for (const id of [...GARMENTS.map((g) => g.id), ...GARMENT_CARDS.map((c) => c.id)]) {
      expect(ar.garments.items[id], id).toBeDefined();
      expect(en.garments.items[id], id).toBeDefined();
    }
    for (const g of AI_GARMENTS) {
      expect(ar.ai.items[g.id], g.id).toBeDefined();
      // English repeats the catalogue so the two cannot drift apart unnoticed.
      expect(en.ai.items[g.id]).toEqual({
        label: g.label,
        description: g.description,
        provenance: g.provenance,
      });
    }
  });

  it('research page text has the same shape and is translated', () => {
    const { en: rEn, ar: rAr } = RESEARCH_MESSAGES;
    expect(leaves(rAr).map(([p]) => p)).toEqual(leaves(rEn).map(([p]) => p));
    // Stat values are numbers with units and `chart.ms()` is "n ms"; everything else must be Arabic.
    const untranslated = leaves(rAr).filter(
      (leaf) =>
        mustBeArabic(leaf) && !/^stats\[\d\]\.value$|^chart\.ms\(\)$/.test(leaf[0]) && !ARABIC.test(leaf[1]),
    );
    expect(untranslated).toEqual([]);
  });
});

describe('status messages in Arabic', () => {
  const source = { state: 'ready' as const, kind: 'file' as const, label: 'x', width: 640, height: 480 };
  const ready = {
    state: 'ready' as const,
    info: { model: 'full' as const, delegate: 'GPU' as const, initMs: 1, modelBytes: 1 },
    backend: 'worker' as const,
    note: null,
  };

  it('maps phases and tracker errors to Arabic, keeping the staff command', () => {
    expect(describeStatus({ tracker: ready, source, phase: 'too-close' }, ar.status)?.title).toBe(
      'ارجع ورا شوي',
    );
    const error = describeStatus(
      {
        tracker: { state: 'error', kind: 'model-missing', message: 'English detail' },
        source,
        phase: 'full',
      },
      ar.status,
    );
    expect(error?.title).toBe('التتبّع غير متاح');
    expect(error?.detail).toContain('npm run setup:assets');
    expect(error?.detail).not.toContain('English detail');
  });

  it('has an Arabic sentence for every error code', () => {
    const aiCodes = ['network', 'pose', 'timeout', 'uncertain', 'moderation', 'daily-limit'] as const;
    for (const code of aiCodes) expect(ar.ai.error(code, 'x')).toMatch(ARABIC);
    for (const kind of ['permission-denied', 'no-camera', 'camera-busy', 'decode'] as const)
      expect(ar.source.error(kind, 'x')).toMatch(ARABIC);
    for (const kind of ['model-missing', 'model-download'] as const)
      expect(ar.status.trackerError(kind, 'x')).toMatch(ARABIC);
  });

  it('keeps the technical detail of an unknown error for staff', () => {
    expect(ar.source.error('unknown', 'NotReadableError: x')).toContain('NotReadableError: x');
    expect(ar.status.trackerError('runtime', 'WebGL lost')).toContain('WebGL lost');
  });

  it('English shows the engine’s own detailed error text', () => {
    expect(en.source.error('unsupported-file', 'Try an MP4')).toBe('Try an MP4');
    expect(en.ai.error('pose', 'Server sentence')).toBe('Server sentence');
  });
});

describe('loadLocale', () => {
  afterEach(() => vi.unstubAllGlobals());

  const stub = (search: string, stored: string | null, languages: string[]) => {
    const store = new Map<string, string>(stored ? [['virtual-fitting-mirror.locale.v1', stored]] : []);
    vi.stubGlobal('location', { search });
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    });
    vi.stubGlobal('navigator', { languages });
    return store;
  };

  it('prefers ?lang=, and remembers it', () => {
    const store = stub('?lang=ar', 'en', ['en-US']);
    expect(loadLocale()).toBe('ar');
    expect(store.get('virtual-fitting-mirror.locale.v1')).toBe('ar');
  });

  it('then the stored choice, then the browser language, then English', () => {
    stub('', 'ar', ['en-US']);
    expect(loadLocale()).toBe('ar');
    stub('', null, ['ar-SA', 'en']);
    expect(loadLocale()).toBe('ar');
    stub('?lang=fr', 'nonsense', ['de-DE']);
    expect(loadLocale()).toBe('en');
  });

  it('falls back to the browser language when storage throws', () => {
    vi.stubGlobal('location', { search: '' });
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
    });
    vi.stubGlobal('navigator', { languages: ['ar'] });
    expect(loadLocale()).toBe('ar');
  });
});
