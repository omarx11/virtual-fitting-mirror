import { describe, expect, it } from 'vitest';
import { AngleOneEuroFilter, OneEuroFilter, wrapAngle } from '../../src/fitting/oneEuro';
import { DEFAULT_SMOOTHER_PARAMS } from '../../src/fitting/smoother';

const params = { minCutoff: 1, beta: 0.5, dCutoff: 1 };

function noise(i: number): number {
  // Deterministic pseudo-noise in [-1, 1].
  return Math.sin(i * 12.9898) * 43758.5453 - Math.floor(Math.sin(i * 12.9898) * 43758.5453) - 0.5;
}

describe('OneEuroFilter', () => {
  it('passes the first sample through', () => {
    expect(new OneEuroFilter(params).filter(5, 0)).toBe(5);
  });

  // Uses the app's real position parameters, in their units (fractions of the frame's long side).
  it('reduces jitter on a stationary signal (app position params)', () => {
    const f = new OneEuroFilter(DEFAULT_SMOOTHER_PARAMS.position);
    let rawVar = 0;
    let outVar = 0;
    for (let i = 0; i < 300; i++) {
      const raw = 0.5 + noise(i) * 0.006; // ≈ ±3 px jitter at 1000 px
      const out = f.filter(raw, i / 30);
      if (i > 30) {
        rawVar += (raw - 0.5) ** 2;
        outVar += (out - 0.5) ** 2;
      }
    }
    expect(outVar).toBeLessThan(rawVar * 0.35);
  });

  it('follows fast motion with bounded lag (app position params)', () => {
    const f = new OneEuroFilter(DEFAULT_SMOOTHER_PARAMS.position);
    let out = 0;
    for (let i = 0; i < 30; i++) out = f.filter(0.2 + i * (0.6 / 30), i / 30); // 0.6 frame-widths/s
    const target = 0.2 + 29 * (0.6 / 30);
    expect(Math.abs(out - target)).toBeLessThan(0.03); // < 30 px at 1000 px ≈ 50 ms of lag
  });

  it('restarts instead of extrapolating after a long gap or time going backwards', () => {
    const f = new OneEuroFilter(params);
    f.filter(0, 0);
    f.filter(1, 0.033);
    expect(f.filter(500, 5)).toBe(500);
    expect(f.filter(-3, 1)).toBe(-3);
  });

  it('reset forgets state', () => {
    const f = new OneEuroFilter(params);
    f.filter(10, 0);
    f.reset();
    expect(f.value).toBeNull();
    expect(f.filter(99, 0.1)).toBe(99);
  });
});

describe('angles', () => {
  it('wrapAngle maps into (-π, π]', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle((-3 * Math.PI) / 2)).toBeCloseTo(Math.PI / 2);
    expect(wrapAngle(0.1)).toBeCloseTo(0.1);
  });

  it('does not spin across the ±π boundary', () => {
    const f = new AngleOneEuroFilter(params);
    const a = f.filter(Math.PI - 0.05, 0);
    const b = f.filter(-Math.PI + 0.05, 0.033);
    // Shortest path is 0.1 rad through π, so the output must stay near ±π, never near 0.
    expect(Math.abs(Math.abs(b) - Math.PI)).toBeLessThan(0.1);
    expect(Math.abs(a)).toBeGreaterThan(3);
  });
});
