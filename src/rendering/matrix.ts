/**
 * 2D affine matrices in Canvas order: [a, b, c, d, e, f] so that
 *   x' = a·x + c·y + e
 *   y' = b·x + d·y + f
 * which matches CanvasRenderingContext2D.setTransform(a, b, c, d, e, f).
 */
export type Mat2D = readonly [number, number, number, number, number, number];

export interface Point {
  x: number;
  y: number;
}

export const IDENTITY: Mat2D = [1, 0, 0, 1, 0, 0];

/** Returns m1·m2 (apply m2 first, then m1). */
export function multiply(m1: Mat2D, m2: Mat2D): Mat2D {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function applyToPoint(m: Mat2D, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function invert(m: Mat2D): Mat2D {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) throw new Error('Matrix is not invertible');
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function translation(x: number, y: number): Mat2D {
  return [1, 0, 0, 1, x, y];
}

export function scaling(sx: number, sy: number): Mat2D {
  return [sx, 0, 0, sy, 0, 0];
}

export function rotation(radians: number): Mat2D {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [cos, sin, -sin, cos, 0, 0];
}

/** Composes transforms in application order: compose(A, B, C) applies A, then B, then C. */
export function compose(...steps: Mat2D[]): Mat2D {
  return steps.reduce<Mat2D>((acc, step) => multiply(step, acc), IDENTITY);
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
