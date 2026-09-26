import { applyToPoint, invert, type Mat2D, type Point } from './matrix';

export type FitMode = 'contain' | 'cover';

export interface ViewInput {
  /** Intrinsic source frame size in pixels (e.g. video.videoWidth/videoHeight). */
  sourceWidth: number;
  sourceHeight: number;
  /** Size of the stage element in CSS pixels. */
  viewportCssWidth: number;
  viewportCssHeight: number;
  devicePixelRatio: number;
  fit: FitMode;
  /** Display mirroring. Applied once here, to both video and overlay. */
  mirror: boolean;
}

export interface ViewTransform {
  /** Backing-store size for the display canvas (device pixels). */
  canvasWidth: number;
  canvasHeight: number;
  /** Maps source-frame pixels to canvas device pixels (includes mirroring). */
  sourceToCanvas: Mat2D;
  /** Visible video area on the canvas, device pixels (the garment is clipped to this). */
  clip: { x: number; y: number; width: number; height: number };
  /** Source pixels → canvas pixels scale factor (uniform; aspect ratio is never stretched). */
  scale: number;
  mirror: boolean;
  /** Effective device pixel ratio after the backing-store cap. */
  dpr: number;
}

/** Caps the backing store so a 4K kiosk at DPR 2 does not allocate an enormous canvas. */
export const MAX_CANVAS_PIXELS = 3840 * 2160;

export function computeViewTransform(input: ViewInput): ViewTransform {
  const { sourceWidth: sw, sourceHeight: sh, fit, mirror } = input;
  let dpr = Math.max(0.5, Number.isFinite(input.devicePixelRatio) ? input.devicePixelRatio : 1);
  const cssW = Math.max(1, input.viewportCssWidth);
  const cssH = Math.max(1, input.viewportCssHeight);
  if (cssW * cssH * dpr * dpr > MAX_CANVAS_PIXELS) {
    dpr = Math.sqrt(MAX_CANVAS_PIXELS / (cssW * cssH));
  }
  const canvasWidth = Math.max(1, Math.round(cssW * dpr));
  const canvasHeight = Math.max(1, Math.round(cssH * dpr));

  if (sw <= 0 || sh <= 0) {
    return {
      canvasWidth,
      canvasHeight,
      sourceToCanvas: [1, 0, 0, 1, 0, 0],
      clip: { x: 0, y: 0, width: 0, height: 0 },
      scale: 1,
      mirror,
      dpr,
    };
  }

  const scale =
    fit === 'contain'
      ? Math.min(canvasWidth / sw, canvasHeight / sh)
      : Math.max(canvasWidth / sw, canvasHeight / sh);
  const drawnW = sw * scale;
  const drawnH = sh * scale;
  const offsetX = (canvasWidth - drawnW) / 2;
  const offsetY = (canvasHeight - drawnH) / 2;

  const sourceToCanvas: Mat2D = mirror
    ? [-scale, 0, 0, scale, offsetX + drawnW, offsetY]
    : [scale, 0, 0, scale, offsetX, offsetY];

  const clipX = Math.max(0, offsetX);
  const clipY = Math.max(0, offsetY);
  const clip = {
    x: clipX,
    y: clipY,
    width: Math.min(canvasWidth, offsetX + drawnW) - clipX,
    height: Math.min(canvasHeight, offsetY + drawnH) - clipY,
  };

  return { canvasWidth, canvasHeight, sourceToCanvas, clip, scale, mirror, dpr };
}

export function sourceToCanvasPoint(view: ViewTransform, p: Point): Point {
  return applyToPoint(view.sourceToCanvas, p);
}

export function canvasToSourcePoint(view: ViewTransform, p: Point): Point {
  return applyToPoint(invert(view.sourceToCanvas), p);
}
