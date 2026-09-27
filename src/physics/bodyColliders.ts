/**
 * Invisible body colliders for the cloth solver, derived from the SAME posed garment bones as the
 * skinned attachment targets (so fabric and body can never drift apart). They exist only in the
 * physics world: they do not hide the garment and do not reveal video pixels (foreground-arm
 * occlusion is a separate 2D step, see src/fitting/occlusion.ts).
 *
 * Space: garment rest space / rig-root space, metres.
 */
import { type Quaternion, Vector3 } from 'three';
import type { BoneTransforms } from '../fitting/retargeter';
import type { RigModel } from '../garments/rigModel';
import type { GarmentSimulationConfig } from '../garments/types';

export interface Capsule {
  /** Segment end points (m). */
  a: Vector3;
  b: Vector3;
  radius: number;
}

const Y = new Vector3(0, 1, 0);

/** Writes the current capsules into `out` (reused every frame). */
export function computeColliders(
  rig: RigModel,
  bones: BoneTransforms,
  config: GarmentSimulationConfig['colliders'],
  out: Capsule[],
): Capsule[] {
  const r = rig.roles;
  const pos = (i: number) => bones.worldPosition[i] as Vector3;
  const chest = r.spine[r.spine.length - 1] ?? r.pelvis;
  const low = r.spine[0] ?? r.pelvis;
  const chestQ = bones.worldQuaternion[chest] as Quaternion;
  // Torso lateral/forward axes follow the chest frame (bind rotation removed).
  const chestBone = rig.bones[chest];
  if (!chestBone) throw new Error('Collider chest bone missing');
  const bindInv = chestBone.bindQuaternion.clone().invert();
  const frame = chestQ.clone().multiply(bindInv);
  const lateral = new Vector3(1, 0, 0).applyQuaternion(frame).multiplyScalar(config.torsoLateral);
  const forward = new Vector3(0, 0, 1).applyQuaternion(frame).multiplyScalar(config.torsoForward);
  const top = pos(chest).clone().add(forward);
  const bottom = pos(low).clone().add(forward);
  const set = (k: number, a: Vector3, b: Vector3, radius: number) => {
    const c = out[k] ?? { a: new Vector3(), b: new Vector3(), radius };
    c.a.copy(a);
    c.b.copy(b);
    c.radius = radius;
    out[k] = c;
  };
  set(0, bottom.clone().add(lateral), top.clone().add(lateral), config.torsoRadius);
  set(1, bottom.clone().sub(lateral), top.clone().sub(lateral), config.torsoRadius);
  set(2, pos(r.upperArm.left), pos(r.lowerArm.left), config.armRadius);
  set(3, pos(r.upperArm.right), pos(r.lowerArm.right), config.armRadius);
  out.length = 4;
  return out;
}

/** Capsule centre, rotation (local +Y along the segment) and half height, for the physics engine. */
export function capsulePose(c: Capsule, center: Vector3, rotation: Quaternion): number {
  center.copy(c.a).add(c.b).multiplyScalar(0.5);
  const dir = new Vector3().subVectors(c.b, c.a);
  const len = dir.length();
  if (len > 1e-6) rotation.setFromUnitVectors(Y, dir.multiplyScalar(1 / len));
  else rotation.identity();
  return Math.max(1e-3, len / 2);
}

/** Signed distance from `p` to the capsule surface (negative inside). */
export function capsuleDistance(c: Capsule, x: number, y: number, z: number): number {
  const abx = c.b.x - c.a.x;
  const aby = c.b.y - c.a.y;
  const abz = c.b.z - c.a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  const t =
    len2 > 0
      ? Math.max(0, Math.min(1, ((x - c.a.x) * abx + (y - c.a.y) * aby + (z - c.a.z) * abz) / len2))
      : 0;
  return Math.hypot(x - (c.a.x + t * abx), y - (c.a.y + t * aby), z - (c.a.z + t * abz)) - c.radius;
}
