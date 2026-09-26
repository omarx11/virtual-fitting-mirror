import { describe, expect, it } from 'vitest';
import {
  applyToPoint,
  compose,
  invert,
  multiply,
  rotation,
  scaling,
  translation,
} from '../../src/rendering/matrix';
import {
  canvasToSourcePoint,
  computeViewTransform,
  MAX_CANVAS_PIXELS,
  sourceToCanvasPoint,
} from '../../src/rendering/viewTransform';

const base = { devicePixelRatio: 1, fit: 'contain' as const, mirror: false };

describe('matrix helpers', () => {
  it('compose applies steps in order', () => {
    const m = compose(translation(10, 0), scaling(2, 2));
    expect(applyToPoint(m, { x: 1, y: 1 })).toEqual({ x: 22, y: 2 });
  });
  it('invert round-trips', () => {
    const m = multiply(rotation(0.3), compose(scaling(2, 3), translation(5, -7)));
    const p = applyToPoint(invert(m), applyToPoint(m, { x: 4, y: 9 }));
    expect(p.x).toBeCloseTo(4);
    expect(p.y).toBeCloseTo(9);
  });
});

describe('computeViewTransform', () => {
  it('letterboxes a landscape video in a portrait kiosk without stretching', () => {
    const v = computeViewTransform({
      ...base,
      sourceWidth: 1920,
      sourceHeight: 1080,
      viewportCssWidth: 1080,
      viewportCssHeight: 1920,
    });
    expect(v.scale).toBeCloseTo(1080 / 1920);
    expect(v.clip.x).toBe(0);
    expect(v.clip.width).toBeCloseTo(1080);
    expect(v.clip.height).toBeCloseTo(1080 * (1080 / 1920));
    expect(v.clip.y).toBeCloseTo((1920 - v.clip.height) / 2);
    // uniform scale: aspect preserved
    expect(v.sourceToCanvas[0]).toBeCloseTo(v.sourceToCanvas[3]);
  });

  it('pillarboxes a portrait video on a landscape screen', () => {
    const v = computeViewTransform({
      ...base,
      sourceWidth: 480,
      sourceHeight: 640,
      viewportCssWidth: 1600,
      viewportCssHeight: 900,
    });
    expect(v.clip.height).toBeCloseTo(900);
    expect(v.clip.width).toBeCloseTo(480 * (900 / 640));
    expect(v.clip.x).toBeCloseTo((1600 - v.clip.width) / 2);
  });

  it('cover mode crops and clips to the viewport', () => {
    const v = computeViewTransform({
      ...base,
      fit: 'cover',
      sourceWidth: 1920,
      sourceHeight: 1080,
      viewportCssWidth: 1080,
      viewportCssHeight: 1920,
    });
    expect(v.scale).toBeCloseTo(1920 / 1080);
    expect(v.clip).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
  });

  it('applies device pixel ratio to the backing store', () => {
    const v = computeViewTransform({
      ...base,
      devicePixelRatio: 2,
      sourceWidth: 1280,
      sourceHeight: 720,
      viewportCssWidth: 640,
      viewportCssHeight: 360,
    });
    expect(v.canvasWidth).toBe(1280);
    expect(v.canvasHeight).toBe(720);
    expect(v.scale).toBeCloseTo(1);
  });

  it('caps huge backing stores', () => {
    const v = computeViewTransform({
      ...base,
      devicePixelRatio: 3,
      sourceWidth: 3840,
      sourceHeight: 2160,
      viewportCssWidth: 3840,
      viewportCssHeight: 2160,
    });
    expect(v.canvasWidth * v.canvasHeight).toBeLessThanOrEqual(MAX_CANVAS_PIXELS * 1.01);
  });

  it('mirrors exactly once around the video centre', () => {
    const input = {
      ...base,
      sourceWidth: 640,
      sourceHeight: 480,
      viewportCssWidth: 800,
      viewportCssHeight: 800,
    };
    const plain = computeViewTransform(input);
    const mirrored = computeViewTransform({ ...input, mirror: true });
    const p = { x: 100, y: 200 };
    const a = sourceToCanvasPoint(plain, p);
    const b = sourceToCanvasPoint(mirrored, p);
    const centreX = plain.clip.x + plain.clip.width / 2;
    expect(b.x - centreX).toBeCloseTo(centreX - a.x);
    expect(b.y).toBeCloseTo(a.y);
    // The video's own corners still land on the clip rectangle.
    const tl = sourceToCanvasPoint(mirrored, { x: 0, y: 0 });
    expect(tl.x).toBeCloseTo(mirrored.clip.x + mirrored.clip.width);
  });

  it('inverse mapping returns source coordinates after resize', () => {
    for (const [w, h] of [
      [300, 900],
      [1920, 1080],
      [777, 333],
    ] as const) {
      const v = computeViewTransform({
        ...base,
        mirror: true,
        sourceWidth: 1280,
        sourceHeight: 720,
        viewportCssWidth: w,
        viewportCssHeight: h,
      });
      const back = canvasToSourcePoint(v, sourceToCanvasPoint(v, { x: 321, y: 123 }));
      expect(back.x).toBeCloseTo(321);
      expect(back.y).toBeCloseTo(123);
    }
  });

  it('handles an unknown source size without NaN', () => {
    const v = computeViewTransform({
      ...base,
      sourceWidth: 0,
      sourceHeight: 0,
      viewportCssWidth: 100,
      viewportCssHeight: 100,
    });
    expect(v.clip.width).toBe(0);
    expect(Number.isFinite(v.scale)).toBe(true);
  });
});
