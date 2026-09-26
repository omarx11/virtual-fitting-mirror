import { describe, expect, it } from 'vitest';
import {
  ASPECT_CLAMP,
  clampUserFit,
  computeGarmentPlacement,
  MAX_GARMENT_ROTATION,
} from '../../src/fitting/garmentFit';
import type { GarmentPose } from '../../src/fitting/smoother';
import { armOutwardAngle } from '../../src/fitting/smoother';
import { GARMENTS } from '../../src/garments/catalogue';
import type { Garment2DDefinition } from '../../src/garments/types';
import { applyToPoint } from '../../src/rendering/matrix';

const garment = GARMENTS.find((g): g is Garment2DDefinition => g.kind === '2d');
if (!garment) throw new Error('no 2D garment in the catalogue');

const pose = (p: Partial<GarmentPose> = {}): GarmentPose => ({
  center: { x: 640, y: 300 },
  shoulderWidth: 200,
  torsoLength: 280,
  angle: 0,
  leftArmOutward: null,
  rightArmOutward: null,
  ...p,
});

function anchorPx(which: 'leftShoulder' | 'rightShoulder' | 'hem') {
  const a = garment?.anchors[which] ?? { x: 0, y: 0 };
  return { x: a.x * (garment?.body.width ?? 0), y: a.y * (garment?.body.height ?? 0) };
}

describe('computeGarmentPlacement', () => {
  it('maps the garment shoulder anchors symmetric around the wearer shoulder midpoint', () => {
    const pl = computeGarmentPlacement(garment, pose(), { scale: 1, verticalOffset: 0 });
    const l = applyToPoint(pl.body.matrix, anchorPx('leftShoulder'));
    const r = applyToPoint(pl.body.matrix, anchorPx('rightShoulder'));
    expect((l.x + r.x) / 2).toBeCloseTo(640, 3);
    expect(l.x - r.x).toBeCloseTo(200 * garment.fit.widthScale, 3);
    // Wearer's left is on the image right in an unmirrored front view.
    expect(l.x).toBeGreaterThan(r.x);
    // Shoulder seams sit slightly above the joint landmarks (negative default offset).
    expect(l.y).toBeCloseTo(300 + garment.fit.verticalOffset * 200, 3);
  });

  it('scales with the wearer (near/far)', () => {
    const near = computeGarmentPlacement(garment, pose({ shoulderWidth: 300, torsoLength: 420 }), {
      scale: 1,
      verticalOffset: 0,
    });
    const far = computeGarmentPlacement(garment, pose({ shoulderWidth: 100, torsoLength: 140 }), {
      scale: 1,
      verticalOffset: 0,
    });
    expect(near.body.matrix[0] / far.body.matrix[0]).toBeCloseTo(3, 5);
  });

  it('clamps extreme length/width aspect changes', () => {
    const tall = computeGarmentPlacement(garment, pose({ torsoLength: 5000 }), {
      scale: 1,
      verticalOffset: 0,
    });
    const flat = computeGarmentPlacement(garment, pose({ torsoLength: 5 }), { scale: 1, verticalOffset: 0 });
    expect(tall.body.matrix[3] / tall.body.matrix[0]).toBeCloseTo(ASPECT_CLAMP.max, 5);
    expect(flat.body.matrix[3] / flat.body.matrix[0]).toBeCloseTo(ASPECT_CLAMP.min, 5);
  });

  it('rotates with the shoulder line and clamps implausible rotation', () => {
    const tilted = computeGarmentPlacement(garment, pose({ angle: 0.2 }), { scale: 1, verticalOffset: 0 });
    const l = applyToPoint(tilted.body.matrix, anchorPx('leftShoulder'));
    const r = applyToPoint(tilted.body.matrix, anchorPx('rightShoulder'));
    expect(Math.atan2(l.y - r.y, l.x - r.x)).toBeCloseTo(0.2, 5);
    const wild = computeGarmentPlacement(garment, pose({ angle: 1.5 }), { scale: 1, verticalOffset: 0 });
    const wl = applyToPoint(wild.body.matrix, anchorPx('leftShoulder'));
    const wr = applyToPoint(wild.body.matrix, anchorPx('rightShoulder'));
    expect(Math.atan2(wl.y - wr.y, wl.x - wr.x)).toBeCloseTo(MAX_GARMENT_ROTATION, 5);
  });

  it('applies user scale and vertical offset', () => {
    const a = computeGarmentPlacement(garment, pose(), { scale: 1.2, verticalOffset: 0.1 });
    const b = computeGarmentPlacement(garment, pose(), { scale: 1, verticalOffset: 0 });
    expect(a.body.matrix[0] / b.body.matrix[0]).toBeCloseTo(1.2, 5);
    const la = applyToPoint(a.body.matrix, anchorPx('leftShoulder'));
    const lb = applyToPoint(b.body.matrix, anchorPx('leftShoulder'));
    expect(la.y - lb.y).toBeCloseTo(0.1 * 200, 3);
  });

  it('clamps user adjustments and rejects NaN', () => {
    expect(clampUserFit({ scale: 9, verticalOffset: -9 })).toEqual({ scale: 1.3, verticalOffset: -0.3 });
    expect(clampUserFit({ scale: Number.NaN, verticalOffset: Number.NaN })).toEqual({
      scale: 1,
      verticalOffset: 0,
    });
  });

  it('attaches sleeves at the body shoulder anchors and points them along the arm', () => {
    const pl = computeGarmentPlacement(garment, pose({ leftArmOutward: Math.PI / 2 }), {
      scale: 1,
      verticalOffset: 0,
    });
    const sleeve = garment.sleeves?.left;
    if (!sleeve || !pl.leftSleeve) throw new Error('expected sleeves');
    const pivot = { x: sleeve.pivot.x * sleeve.width, y: sleeve.pivot.y * sleeve.height };
    const attached = applyToPoint(pl.leftSleeve.matrix, pivot);
    const seam = applyToPoint(pl.body.matrix, anchorPx('leftShoulder'));
    expect(attached.x).toBeCloseTo(seam.x, 3);
    expect(attached.y).toBeCloseTo(seam.y, 3);
    // Arm raised sideways: the wearer's left sleeve axis points to +x (image right).
    const tip = applyToPoint(pl.leftSleeve.matrix, { x: pivot.x, y: pivot.y + 100 });
    expect(tip.x - attached.x).toBeGreaterThan(50);
    expect(Math.abs(tip.y - attached.y)).toBeLessThan(5);
  });
});

describe('armOutwardAngle', () => {
  it('is ~0 for arms hanging and ~π/2 for arms raised sideways, on both sides', () => {
    const shoulderL = { x: 740, y: 300 };
    const shoulderR = { x: 540, y: 300 };
    const hang = (s: { x: number; y: number }) => ({
      shoulder: s,
      elbow: { x: s.x, y: s.y + 150 },
      wrist: null,
      forearmInFront: false,
    });
    expect(armOutwardAngle(0, hang(shoulderL), 'left')).toBeCloseTo(0, 5);
    expect(armOutwardAngle(0, hang(shoulderR), 'right')).toBeCloseTo(0, 5);
    const raised = { shoulder: shoulderL, elbow: { x: 890, y: 300 }, wrist: null, forearmInFront: false };
    expect(armOutwardAngle(0, raised, 'left')).toBeCloseTo(Math.PI / 2, 5);
    const raisedR = { shoulder: shoulderR, elbow: { x: 390, y: 300 }, wrist: null, forearmInFront: false };
    expect(armOutwardAngle(0, raisedR, 'right')).toBeCloseTo(Math.PI / 2, 5);
    expect(armOutwardAngle(0, null, 'left')).toBeNull();
  });
});

describe('catalogue', () => {
  it('has at least three garments with sane anchors and licence metadata', () => {
    expect(GARMENTS.length).toBeGreaterThanOrEqual(3);
    const ids = new Set<string>();
    for (const g of GARMENTS) {
      ids.add(g.id);
      expect(g.license.name).toBeTruthy();
      expect(g.supportedViews).toContain('front');
      if (g.kind === '3d') {
        // Third-party 3D asset: never labelled with the demo art CC0 licence.
        expect(g.license.name).not.toMatch(/CC0/);
        expect(g.materials.some((m) => m.id === g.defaultMaterialId)).toBe(true);
        continue;
      }
      expect(g.anchors.leftShoulder.x).toBeGreaterThan(g.anchors.rightShoulder.x);
      expect(g.anchors.hem.y).toBeGreaterThan(g.anchors.leftShoulder.y);
      expect(g.license.name).toBeTruthy();
      expect(g.supportedViews).toContain('front');
    }
    expect(ids.size).toBe(GARMENTS.length);
  });
});
