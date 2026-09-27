import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, parsePreferences } from '../../src/app/preferences';
import { describeStatus } from '../../src/app/statusMessages';
import { selectSubject } from '../../src/fitting/subject';
import { syntheticPose } from './syntheticPose';

const ready = {
  state: 'ready' as const,
  info: { model: 'full' as const, delegate: 'GPU' as const, initMs: 1, modelBytes: 1 },
  backend: 'worker' as const,
  note: null,
};
const source = { state: 'ready' as const, kind: 'file' as const, label: 'x', width: 640, height: 480 };

describe('describeStatus', () => {
  it('reports model failures as tracking errors, never as posture advice', () => {
    const s = describeStatus({
      tracker: { state: 'error', kind: 'model-missing', message: 'Run npm run setup:assets' },
      source,
      phase: 'searching',
    });
    expect(s?.tone).toBe('error');
    expect(s?.title).toMatch(/Tracking unavailable/);
    expect(s?.detail).toMatch(/setup:assets/);
  });

  it('shows loading progress while the model loads', () => {
    const s = describeStatus({
      tracker: { state: 'loading', message: 'Downloading', progress: 0.5 },
      source,
      phase: 'searching',
    });
    expect(s?.title).toContain('50%');
  });

  it('maps tracking phases to shopper messages', () => {
    expect(describeStatus({ tracker: ready, source, phase: 'full' })?.title).toBe('Tracking');
    expect(describeStatus({ tracker: ready, source, phase: 'upper' })?.title).toBe('Upper-body view');
    expect(describeStatus({ tracker: ready, source, phase: 'too-close' })?.title).toBe('Move back slightly');
    expect(describeStatus({ tracker: ready, source, phase: 'lost' })?.title).toBe('Tracking lost');
  });

  it('shows nothing on the stage when no source is open', () => {
    expect(describeStatus({ tracker: ready, source: { state: 'none' }, phase: 'searching' })).toBeNull();
  });
});

describe('parsePreferences', () => {
  it('falls back to defaults for garbage', () => {
    expect(parsePreferences('nope')).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES);
  });
  it('validates each field', () => {
    const p = parsePreferences({
      garmentId: 'no-such',
      mirror: 'yes',
      preset: 'fast',
      fit: { scale: 99 },
      fitMode: 'cover',
    });
    expect(p.garmentId).toBe(DEFAULT_PREFERENCES.garmentId);
    expect(p.mirror).toBe(DEFAULT_PREFERENCES.mirror);
    expect(p.preset).toBe('fast');
    expect(p.fit.scale).toBe(1.3);
    expect(p.fitMode).toBe('cover');
  });
  it('keeps the sidebar layout, dropping unknown or repeated section IDs', () => {
    expect(DEFAULT_PREFERENCES.sidebarCollapsed).toBe(false);
    const p = parsePreferences({
      sidebarCollapsed: true,
      collapsedSections: ['fit', 'fit', 'nope', 42, 'view'],
    });
    expect(p.sidebarCollapsed).toBe(true);
    expect(p.collapsedSections).toEqual(['fit', 'view']);
    expect(parsePreferences({ sidebarCollapsed: 'yes', collapsedSections: 'fit' })).toEqual(
      DEFAULT_PREFERENCES,
    );
  });
});

describe('selectSubject', () => {
  it('picks the largest, most central person when nobody is being tracked', () => {
    const small = syntheticPose({ cx: 200, shoulderWidth: 100 });
    const big = syntheticPose({ cx: 640, shoulderWidth: 220 });
    expect(selectSubject([small, big], null, 0)).toBe(1);
  });
  it('stays with the remembered subject and refuses to hop to someone far away', () => {
    const memory = { center: { x: 300, y: 252 }, width: 200, timeMs: 0 };
    const near = syntheticPose({ cx: 320 });
    const far = syntheticPose({ cx: 1100, shoulderWidth: 300 });
    expect(selectSubject([far, near], memory, 100)).toBe(1);
    expect(selectSubject([far], memory, 100)).toBeNull();
    // Memory expires: then the other person may be selected.
    expect(selectSubject([far], memory, 5000)).toBe(0);
  });
});
