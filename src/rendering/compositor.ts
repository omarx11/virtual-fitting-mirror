/**
 * Canvas 2D compositor. The video frame and the garment are drawn through the SAME source→canvas
 * transform, so letterboxing, DPR, resize and mirroring apply to both exactly once. Diagnostics are
 * drawn in canvas space afterwards (never mirrored text).
 */

import type { GarmentPlacement, PartPlacement } from '../fitting/garmentFit';
import type { TorsoEstimate } from '../fitting/interpreter';
import type { PoseObservation } from '../fitting/observation';
import type { LoadedGarment, LoadedPart } from '../garments/loader';
import { SKELETON_EDGES } from '../tracking/landmarks';
import { applyToPoint, type Mat2D, multiply, type Point } from './matrix';
import type { ViewTransform } from './viewTransform';

export interface OcclusionInput {
  torso: TorsoEstimate;
}

export interface RenderInput {
  view: ViewTransform;
  source: CanvasImageSource | null;
  sourceWidth: number;
  sourceHeight: number;
  garment: LoadedGarment | null;
  placement: GarmentPlacement | null;
  opacity: number;
  occlusion: OcclusionInput | null;
  debug: { observation: PoseObservation | null; torso: TorsoEstimate | null } | null;
  background: string;
}

function setMatrix(ctx: CanvasRenderingContext2D, m: Mat2D): void {
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
function capsule(ctx: CanvasRenderingContext2D, a: Point, b: Point, radius: number): void {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  ctx.moveTo(a.x + Math.cos(angle + Math.PI / 2) * radius, a.y + Math.sin(angle + Math.PI / 2) * radius);
  ctx.arc(b.x, b.y, radius, angle + Math.PI / 2, angle - Math.PI / 2, true);
  ctx.arc(a.x, a.y, radius, angle - Math.PI / 2, angle + Math.PI / 2, true);
  ctx.closePath();
}

/**
 * Experimental: redraw original video pixels for forearms/hands estimated to be in front of the
 * torso, so crossed arms are not hidden under the shirt. Landmark capsules are approximate: they
 * can reveal a sliver of the real clothing or miss part of the arm. Returns true if anything drew.
 */
function drawForearmOcclusion(
  ctx: CanvasRenderingContext2D,
  input: RenderInput,
  torso: TorsoEstimate,
): boolean {
  if (!input.source) return false;
  const arms = [torso.arms.left, torso.arms.right].filter(
    (arm): arm is NonNullable<typeof arm> => !!arm && arm.forearmInFront && !!arm.elbow && !!arm.wrist,
  );
  if (arms.length === 0) return false;
  const radius = torso.shoulderWidth * 0.14;
  setMatrix(ctx, input.view.sourceToCanvas);
  ctx.beginPath();
  for (const arm of arms) {
    const elbow = arm.elbow as Point;
    const wrist = arm.wrist as Point;
    // Extend past the wrist to cover the hand.
    const hand = { x: wrist.x + (wrist.x - elbow.x) * 0.35, y: wrist.y + (wrist.y - elbow.y) * 0.35 };
    capsule(ctx, elbow, hand, radius);
  }
  ctx.save();
  ctx.clip();
  ctx.drawImage(input.source, 0, 0, input.sourceWidth, input.sourceHeight);
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
}

export function drawFrame(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  const { view } = input;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = input.background;
  ctx.fillRect(0, 0, view.canvasWidth, view.canvasHeight);
  if (!input.source || view.clip.width <= 0 || view.clip.height <= 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(view.clip.x, view.clip.y, view.clip.width, view.clip.height);
  ctx.clip();

  setMatrix(ctx, view.sourceToCanvas);
  ctx.drawImage(input.source, 0, 0, input.sourceWidth, input.sourceHeight);

  const { garment, placement } = input;
  if (garment && placement && input.opacity > 0.01) {
    ctx.globalAlpha = Math.min(1, input.opacity);
    // Sleeves first so the body's armhole edge covers the joint.
    if (garment.leftSleeve && placement.leftSleeve)
      drawPart(ctx, view, garment.leftSleeve, placement.leftSleeve);
    if (garment.rightSleeve && placement.rightSleeve)
      drawPart(ctx, view, garment.rightSleeve, placement.rightSleeve);
    drawPart(ctx, view, garment.body, placement.body);
    if (input.occlusion) drawForearmOcclusion(ctx, input, input.occlusion.torso);
    ctx.globalAlpha = 1;
  }

  drawDiagnostics(ctx, input);
  ctx.restore();
}
