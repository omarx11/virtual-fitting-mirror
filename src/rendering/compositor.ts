/**
 * Canvas 2D compositor. The video frame and the garment (2D parts or the source-aligned 3D layer)
 * are drawn through the SAME source→canvas transform, so letterboxing, DPR, resize and mirroring
 * apply to both exactly once. Order: video → garment → foreground-forearm video cutouts →
 * diagnostics (canvas space, never mirrored text).
 */

import type { GarmentPlacement, PartPlacement } from '../fitting/garmentFit';
import type { TorsoEstimate } from '../fitting/interpreter';
import type { PoseObservation } from '../fitting/observation';
import type { ForearmCutout } from '../fitting/occlusion';
import type { LoadedGarment, LoadedPart } from '../garments/loader';
import { SKELETON_EDGES } from '../tracking/landmarks';
import { applyToPoint, type Mat2D, multiply, type Point } from './matrix';
import type { ViewTransform } from './viewTransform';

export interface OcclusionInput {
  cutouts: ForearmCutout[];
}

/** A rendered 3D garment layer whose pixels cover the source frame exactly (0..sw × 0..sh). */
export interface GarmentLayer {
  canvas: CanvasImageSource;
}

export interface RenderInput {
  view: ViewTransform;
  source: CanvasImageSource | null;
  sourceWidth: number;
  sourceHeight: number;
  /** Legacy 2D garment (never drawn together with a 3D layer). */
  garment: LoadedGarment | null;
  placement: GarmentPlacement | null;
  layer3d: GarmentLayer | null;
  opacity: number;
  occlusion: OcclusionInput | null;
  debug: {
    observation: PoseObservation | null;
    torso: TorsoEstimate | null;
    /** Garment shoulder anchors in source px (registration check against the landmarks). */
    garmentShoulders: { left: Point; right: Point } | null;
    cutouts: ForearmCutout[];
  } | null;
  background: string;
}

export interface RenderTimings {
  /** Time to draw the 3D layer into the visible canvas (the canvas copy). */
  layerCopyMs: number;
  /** Time spent on forearm cutouts. */
  occlusionMs: number;
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function setMatrix(ctx: Ctx2D, m: Mat2D): void {
  ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
}

function drawPart(
  ctx: CanvasRenderingContext2D,
  view: ViewTransform,
  part: LoadedPart,
  placement: PartPlacement,
) {
  setMatrix(ctx, multiply(view.sourceToCanvas, placement.matrix));
  ctx.drawImage(part.bitmap, 0, 0, placement.width, placement.height);
}

/** Capsule (rounded segment) path in the current transform's coordinates. */
function capsule(ctx: Ctx2D, a: Point, b: Point, radius: number): void {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  ctx.moveTo(a.x + Math.cos(angle + Math.PI / 2) * radius, a.y + Math.sin(angle + Math.PI / 2) * radius);
  ctx.arc(b.x, b.y, radius, angle + Math.PI / 2, angle - Math.PI / 2, true);
  ctx.arc(a.x, a.y, radius, angle - Math.PI / 2, angle + Math.PI / 2, true);
  ctx.closePath();
}

let maskCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;

function getMask(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: Ctx2D } | null {
  if (!maskCanvas || maskCanvas.width < width || maskCanvas.height < height) {
    const w = Math.max(width, maskCanvas?.width ?? 0);
    const h = Math.max(height, maskCanvas?.height ?? 0);
    maskCanvas =
      typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
    maskCanvas.width = w;
    maskCanvas.height = h;
  }
  const ctx = maskCanvas.getContext('2d') as Ctx2D | null;
  return ctx ? { canvas: maskCanvas, ctx } : null;
}

/**
 * Redraws original video pixels inside soft-edged capsules around foreground forearms/hands, on top
 * of the garment. Works on the capsules' bounding box only. Returns true if anything was drawn.
 */
function drawForearmCutouts(
  ctx: CanvasRenderingContext2D,
  input: RenderInput,
  cutouts: ForearmCutout[],
): boolean {
  const { view } = input;
  if (!input.source || cutouts.length === 0) return false;
  const caps = cutouts.map((c) => ({
    a: applyToPoint(view.sourceToCanvas, c.from),
    b: applyToPoint(view.sourceToCanvas, c.to),
    r: c.radius * view.scale,
    strength: c.strength,
  }));
  const feather = Math.max(2, Math.max(...caps.map((c) => c.r)) * 0.45);
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const c of caps) {
    const pad = c.r + feather * 2;
    x0 = Math.min(x0, c.a.x - pad, c.b.x - pad);
    y0 = Math.min(y0, c.a.y - pad, c.b.y - pad);
    x1 = Math.max(x1, c.a.x + pad, c.b.x + pad);
    y1 = Math.max(y1, c.a.y + pad, c.b.y + pad);
  }
  x0 = Math.floor(Math.max(x0, view.clip.x));
  y0 = Math.floor(Math.max(y0, view.clip.y));
  x1 = Math.ceil(Math.min(x1, view.clip.x + view.clip.width));
  y1 = Math.ceil(Math.min(y1, view.clip.y + view.clip.height));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return false;
  const mask = getMask(w, h);
  if (!mask) return false;
  const m = mask.ctx;
  m.setTransform(1, 0, 0, 1, 0, 0);
  m.globalCompositeOperation = 'source-over';
  m.globalAlpha = 1;
  m.clearRect(0, 0, w, h);
  m.filter = `blur(${(feather / 2).toFixed(1)}px)`;
  m.fillStyle = '#fff';
  for (const c of caps) {
    m.globalAlpha = Math.min(1, c.strength);
    m.beginPath();
    capsule(m, { x: c.a.x - x0, y: c.a.y - y0 }, { x: c.b.x - x0, y: c.b.y - y0 }, c.r);
    m.fill();
  }
  m.filter = 'none';
  m.globalAlpha = 1;
  // Keep only video pixels under the soft mask.
  m.globalCompositeOperation = 'source-in';
  const t = view.sourceToCanvas;
  m.setTransform(t[0], t[1], t[2], t[3], t[4] - x0, t[5] - y0);
  m.drawImage(input.source, 0, 0, input.sourceWidth, input.sourceHeight);
  m.globalCompositeOperation = 'source-over';
  m.setTransform(1, 0, 0, 1, 0, 0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.drawImage(mask.canvas, 0, 0, w, h, x0, y0, w, h);
  ctx.restore();
  return true;
}

function drawDiagnostics(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  const debug = input.debug;
  if (!debug) return;
  const dpr = Math.max(1, input.view.dpr);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const toCanvas = (p: Point) => applyToPoint(input.view.sourceToCanvas, p);
  const obs = debug.observation;
  if (obs) {
    ctx.lineWidth = 2 * dpr;
    for (const [a, b] of SKELETON_EDGES) {
      const pa = obs.landmarks[a];
      const pb = obs.landmarks[b];
      if (!pa || !pb) continue;
      const v = Math.min(pa.visibility, pb.visibility);
      ctx.strokeStyle = v >= 0.5 ? 'rgba(80, 220, 160, 0.85)' : 'rgba(255, 170, 60, 0.55)';
      const ca = toCanvas(pa);
      const cb = toCanvas(pb);
      ctx.beginPath();
      ctx.moveTo(ca.x, ca.y);
      ctx.lineTo(cb.x, cb.y);
      ctx.stroke();
    }
    for (const p of obs.landmarks) {
      const c = toCanvas(p);
      ctx.fillStyle = p.visibility >= 0.5 ? '#50dca0' : '#ffaa3c';
      ctx.beginPath();
      ctx.arc(c.x, c.y, 3.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const torso = debug.torso;
  if (torso) {
    const l = toCanvas(torso.leftShoulder);
    const r = toCanvas(torso.rightShoulder);
    ctx.strokeStyle = torso.source === 'bridged' ? '#ff5577' : '#4aa8ff';
    ctx.lineWidth = 3 * dpr;
    ctx.beginPath();
    ctx.moveTo(l.x, l.y);
    ctx.lineTo(r.x, r.y);
    ctx.stroke();
    const c = toCanvas(torso.center);
    const down = {
      x: -Math.sin(torso.angle) * torso.torsoLength,
      y: Math.cos(torso.angle) * torso.torsoLength,
    };
    const hem = toCanvas({ x: torso.center.x + down.x, y: torso.center.y + down.y });
    ctx.setLineDash([6 * dpr, 6 * dpr]);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(hem.x, hem.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const gs = debug.garmentShoulders;
  if (gs) {
    // Registration overlay: garment shoulder anchors (magenta) vs. tracked shoulders (blue line).
    const l = toCanvas(gs.left);
    const r = toCanvas(gs.right);
    ctx.strokeStyle = '#ff4fd8';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(l.x, l.y);
    ctx.lineTo(r.x, r.y);
    for (const p of [l, r]) {
      ctx.moveTo(p.x - 8 * dpr, p.y);
      ctx.lineTo(p.x + 8 * dpr, p.y);
      ctx.moveTo(p.x, p.y - 8 * dpr);
      ctx.lineTo(p.x, p.y + 8 * dpr);
    }
    ctx.stroke();
  }
  for (const c of debug.cutouts) {
    ctx.strokeStyle = `rgba(255, 230, 80, ${(0.3 + 0.6 * c.strength).toFixed(2)})`;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    capsule(ctx, toCanvas(c.from), toCanvas(c.to), c.radius * input.view.scale);
    ctx.stroke();
  }
}

export function drawFrame(ctx: CanvasRenderingContext2D, input: RenderInput): RenderTimings {
  const timings: RenderTimings = { layerCopyMs: 0, occlusionMs: 0 };
  const { view } = input;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = input.background;
  ctx.fillRect(0, 0, view.canvasWidth, view.canvasHeight);
  if (!input.source || view.clip.width <= 0 || view.clip.height <= 0) return timings;

  ctx.save();
  ctx.beginPath();
  ctx.rect(view.clip.x, view.clip.y, view.clip.width, view.clip.height);
  ctx.clip();

  setMatrix(ctx, view.sourceToCanvas);
  ctx.drawImage(input.source, 0, 0, input.sourceWidth, input.sourceHeight);

  const { garment, placement, layer3d } = input;
  if (input.opacity > 0.01 && (layer3d || (garment && placement))) {
    ctx.globalAlpha = Math.min(1, input.opacity);
    if (layer3d) {
      // One opaque garment render faded as a whole: no double-sided transparency artefacts.
      const started = performance.now();
      setMatrix(ctx, view.sourceToCanvas);
      ctx.drawImage(layer3d.canvas, 0, 0, input.sourceWidth, input.sourceHeight);
      timings.layerCopyMs = performance.now() - started;
    } else if (garment && placement) {
      // Legacy 2D: sleeves first so the body's armhole edge covers the joint.
      if (garment.leftSleeve && placement.leftSleeve)
        drawPart(ctx, view, garment.leftSleeve, placement.leftSleeve);
      if (garment.rightSleeve && placement.rightSleeve)
        drawPart(ctx, view, garment.rightSleeve, placement.rightSleeve);
      drawPart(ctx, view, garment.body, placement.body);
    }
    ctx.globalAlpha = 1;
    if (input.occlusion) {
      const started = performance.now();
      drawForearmCutouts(ctx, input, input.occlusion.cutouts);
      timings.occlusionMs = performance.now() - started;
    }
  }

  drawDiagnostics(ctx, input);
  ctx.restore();
  return timings;
}
