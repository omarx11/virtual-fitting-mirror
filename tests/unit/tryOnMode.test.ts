import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFERENCES,
  liveGarmentPatch,
  modePatch,
  type Preferences,
  parsePreferences,
} from '../../src/app/preferences';
import { AI_GARMENTS } from '../../src/garments/aiCatalogue';
import { findGarment, GARMENTS } from '../../src/garments/catalogue';

const apply = (p: Preferences, patch: Partial<Preferences>): Preferences =>
  parsePreferences({ ...p, ...patch });

describe('try-on mode preferences', () => {
  it('defaults to live 3D (unchanged until the user chooses AI)', () => {
    expect(DEFAULT_PREFERENCES.tryOnMode).toBe('3d');
    expect(findGarment(DEFAULT_PREFERENCES.garmentId).kind).toBe('3d');
    expect(parsePreferences(null).tryOnMode).toBe('3d');
  });

  it('migrates preferences saved before the selector existed from the stored garment', () => {
    const old2d = parsePreferences({ garmentId: 'breton-stripe-tee', mirror: false });
    expect(old2d.tryOnMode).toBe('2d');
    expect(old2d.lastGarment2d).toBe('breton-stripe-tee');
    expect(old2d.garmentId).toBe('breton-stripe-tee');
    expect(old2d.mirror).toBe(false);
    const old3d = parsePreferences({ garmentId: 'vneck-3d', materialId: 'navy' });
    expect(old3d.tryOnMode).toBe('3d');
    expect(old3d.materialId).toBe('navy');
  });

  it('remembers the last garment of each live mode across 2D → AI → 3D → 2D', () => {
    let p = parsePreferences(null);
    p = apply(p, liveGarmentPatch('chambray-button-shirt'));
    expect(p.tryOnMode).toBe('2d');
    p = apply(p, modePatch(p, 'ai'));
    expect(p.tryOnMode).toBe('ai');
    expect(p.garmentId).toBe('chambray-button-shirt'); // live garment untouched while in AI
    p = apply(p, modePatch(p, '3d'));
    expect(p.garmentId).toBe('vneck-3d');
    p = apply(p, modePatch(p, '2d'));
    expect(p.garmentId).toBe('chambray-button-shirt');
  });

  it('keeps the live-mode invariant even for inconsistent stored data', () => {
    const p = parsePreferences({ tryOnMode: '2d', garmentId: 'vneck-3d', lastGarment2d: 'forest-v-neck' });
    expect(p.garmentId).toBe('forest-v-neck');
    const bad = parsePreferences({ tryOnMode: 'vr', lastGarment2d: 'vneck-3d', aiGarmentId: '../x' });
    expect(bad.tryOnMode).toBe('3d');
    expect(findGarment(bad.lastGarment2d).kind).toBe('2d');
    expect(bad.aiGarmentId).toBe(AI_GARMENTS[0]?.id);
  });

  it('never stores AI photos, results or consent', () => {
    expect(Object.keys(DEFAULT_PREFERENCES).sort()).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/consent|photo|capture|result|session/i)]),
    );
  });
});

describe('AI catalogue', () => {
  it('lists product photos with identity, category, photo type, provenance and demo flag', () => {
    expect(AI_GARMENTS.length).toBeGreaterThan(0);
    const ids = new Set<string>();
    for (const g of AI_GARMENTS) {
      expect(ids.has(g.id)).toBe(false);
      ids.add(g.id);
      expect(g.productImage).toMatch(/^garments\/ai\/[a-z0-9-]+\/product\.jpg$/);
      expect(g.preview).toMatch(/^garments\/ai\/[a-z0-9-]+\/preview\.jpg$/);
      expect(['tops', 'bottoms', 'one-pieces']).toContain(g.category);
      expect(['flat-lay', 'model', 'auto']).toContain(g.photoType);
      expect(g.provenance.length).toBeGreaterThan(10);
      if (g.liveGarmentId) expect(GARMENTS.some((l) => l.id === g.liveGarmentId)).toBe(true);
    }
    // Colour variants have their own photos.
    expect(new Set(AI_GARMENTS.map((g) => g.productImage)).size).toBe(AI_GARMENTS.length);
  });
});
