/**
 * Approximate foreground-forearm occlusion: which forearm/hand segments should show the ORIGINAL
 * video in front of the garment.
 *
 * Depth gate: with world landmarks, a forearm counts as "in front" when the wrist lies in front of
 * the torso plane (through the shoulders, normal = chest forward) by more than a threshold; without
 * them, the legacy image-z test from the interpreter is used. The cutout starts a fraction past the
 * elbow so the (rolled) sleeve end is never cut, and it is softened at the edges by the compositor.
 *
 * This is a capsule approximation, not segmentation: it can reveal a sliver of the original shirt
 * next to the forearm or miss part of the hand (documented in LIMITATIONS.md). MediaPipe's person
 * mask is deliberately not used: it cannot separate arms from the torso.
 */
import type { Vector3 } from 'three';
import type { Point } from '../rendering/matrix';
import { LM } from '../tracking/landmarks';
import type { TorsoEstimate } from './interpreter';
import { type PoseObservation, worldLm } from './observation';
import { frameFromLateral, worldToBody } from './pose3d';

export interface ForearmCutout {
  /** Capsule from `from` to `to` in source pixels. */
  from: Point;
  to: Point;
  radius: number;
  /** 0..1: fades the cutout in/out with depth margin and landmark confidence. */
  strength: number;
}

export const OCCLUSION = {
  /**
   * Wrist must be this far (m) in front of the torso plane to start revealing the forearm. The plane
   * passes through the shoulder JOINT centres; the shirt front lies ~0.10–0.12 m in front of it, so
   * smaller margins would cut into the garment for hands resting at the belly or hips.
   */
  depthStartM: 0.12,
  /** …and is fully revealed from this margin on. */
  depthFullM: 0.19,
  /** Cutout starts this fraction along elbow→wrist (keeps the sleeve end intact). */
  sleeveClearance: 0.18,
  /** Extension past the wrist to cover the hand (fraction of the forearm length). */
  handExtension: 0.4,
  /** Capsule radius as a fraction of the (frontal) shoulder width in pixels. */
  radiusFraction: 0.12,
  minVisibility: 0.6,
} as const;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function forearmCutouts(obs: PoseObservation | null, torso: TorsoEstimate): ForearmCutout[] {
  const out: ForearmCutout[] = [];
  const radius = torso.shoulderWidth * OCCLUSION.radiusFraction;
  let plane: { origin: Vector3; normal: Vector3 } | null = null;
  if (obs?.world) {
    const ls = worldLm(obs, LM.leftShoulder);
    const rs = worldLm(obs, LM.rightShoulder);
    if (ls && rs) {
      const L = worldToBody(ls);
      const R = worldToBody(rs);
      const frame = frameFromLateral(L.clone().sub(R), null);
      if (frame) plane = { origin: L.add(R).multiplyScalar(0.5), normal: frame.z };
    }
  }
  for (const side of ['left', 'right'] as const) {
    const arm = torso.arms[side];
    if (!arm?.elbow || !arm.wrist) continue;
    const wi = side === 'left' ? LM.leftWrist : LM.rightWrist;
    const ei = side === 'left' ? LM.leftElbow : LM.rightElbow;
    const visibility = Math.min(obs?.landmarks[wi]?.visibility ?? 0, obs?.landmarks[ei]?.visibility ?? 0);
    if (visibility < OCCLUSION.minVisibility) continue;
    let strength: number;
    let startT: number = OCCLUSION.sleeveClearance;
    const w = obs ? worldLm(obs, wi) : null;
    const e = obs ? worldLm(obs, ei) : null;
    if (plane && w && e) {
      const dw = worldToBody(w).sub(plane.origin).dot(plane.normal);
      const de = worldToBody(e).sub(plane.origin).dot(plane.normal);
      strength = smoothstep(OCCLUSION.depthStartM, OCCLUSION.depthFullM, dw);
      // Elbow behind the torso plane: start where the forearm comes out in front of it.
      if (de < OCCLUSION.depthStartM && dw > de) {
        startT = Math.max(startT, Math.min(0.9, (OCCLUSION.depthStartM - de) / (dw - de)));
      }
    } else {
      strength = arm.forearmInFront ? 1 : 0;
    }
    strength *= smoothstep(OCCLUSION.minVisibility, 0.85, visibility);
    if (strength <= 0.01) continue;
    const dx = arm.wrist.x - arm.elbow.x;
    const dy = arm.wrist.y - arm.elbow.y;
    out.push({
      from: { x: arm.elbow.x + dx * startT, y: arm.elbow.y + dy * startT },
      to: { x: arm.wrist.x + dx * OCCLUSION.handExtension, y: arm.wrist.y + dy * OCCLUSION.handExtension },
      radius,
      strength,
    });
  }
  return out;
}
