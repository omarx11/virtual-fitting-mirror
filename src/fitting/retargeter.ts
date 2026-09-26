/**
 * Retargets a tracked body pose onto a garment skeleton.
 *
 * Every frame starts from the inspected BIND pose (never from last frame's bones), so rotations
 * cannot accumulate drift. Desired rotations are formed in REST SPACE (see rigModel.ts) and then
 * converted to parent-local rotations in parent-before-child order:
 *
 *   local_q = inverse(parent_world_q) · desired_world_q
 *
 * - pelvis/thighs follow the hip frame (legs are not driven: they stay anatomically stable even when
 *   the legs are off-screen);
 * - the spine chain interpolates hip → chest rotation (distributed torso twist/lean);
 * - neck follows the chest; clavicles follow the chest plus a small lift for raised arms;
 * - upper/lower arms are AIMED at the tracked directions with the smallest swing from where the
 *   parent would carry them, which leaves axial twist unchanged (pose landmarks do not observe it);
 * - twist and other bones keep their rest relation to their parent.
 */
import { Quaternion, Vector3 } from 'three';
import type { RigModel } from '../garments/rigModel';
import type { GarmentRigConfig, SidePair } from '../garments/types';

export interface ArmTarget {
  /** Unit direction shoulder → elbow in rest space. */
  upper: Vector3;
  /** Unit direction elbow → wrist in rest space. */
  lower: Vector3;
}

export interface BodyPose3D {
  /** Upper-torso (shoulder frame) rotation relative to the front-facing rest frame. */
  chest: Quaternion;
  /** Lower-torso (hip frame) rotation. */
  hips: Quaternion;
  arms: SidePair<ArmTarget>;
  /** Spine offsets × this factor (visual torso-length adaptation, clamped by the rig config). */
  torsoLength: number;
}

export interface BoneTransforms {
  /** Parent-local transforms in RigModel order. */
  localPosition: Vector3[];
  localQuaternion: Quaternion[];
  /** Rest-space world transforms (for anchors, colliders and tests). */
  worldPosition: Vector3[];
  worldQuaternion: Quaternion[];
  worldScale: number[];
}

export function neutralPose(rig: RigModel): BodyPose3D {
  return {
    chest: new Quaternion(),
    hips: new Quaternion(),
    arms: {
      left: { upper: rig.restAim.upperArm.left.clone(), lower: rig.restAim.lowerArm.left.clone() },
      right: { upper: rig.restAim.upperArm.right.clone(), lower: rig.restAim.lowerArm.right.clone() },
    },
    torsoLength: 1,
  };
}

export function createBoneTransforms(rig: RigModel): BoneTransforms {
  const n = rig.bones.length;
  return {
    localPosition: Array.from({ length: n }, () => new Vector3()),
    localQuaternion: Array.from({ length: n }, () => new Quaternion()),
    worldPosition: Array.from({ length: n }, () => new Vector3()),
    worldQuaternion: Array.from({ length: n }, () => new Quaternion()),
    worldScale: new Array<number>(n).fill(1),
  };
}

const Z_AXIS = new Vector3(0, 0, 1);

export class Retargeter {
  private readonly roleOf: Array<
    | { kind: 'pelvis' | 'thigh' | 'neck' | 'other' }
    | { kind: 'spine'; t: number }
    | { kind: 'clavicle' | 'upperArm' | 'lowerArm'; side: 'left' | 'right' }
  >;
  private readonly stretch: boolean[];
  private readonly parentBindInv: Quaternion[];
  // Scratch objects (no per-frame allocation).
  private q = new Quaternion();
  private q2 = new Quaternion();
  private v = new Vector3();
  private aim = new Vector3();

  constructor(
    readonly rig: RigModel,
    private readonly config: GarmentRigConfig,
  ) {
    const r = rig.roles;
    this.roleOf = rig.bones.map((_, i) => {
      if (i === r.pelvis) return { kind: 'pelvis' as const };
      const s = r.spine.indexOf(i);
      if (s >= 0) return { kind: 'spine' as const, t: (s + 1) / r.spine.length };
      if (i === r.neck) return { kind: 'neck' as const };
      for (const side of ['left', 'right'] as const) {
        if (i === r.clavicle[side]) return { kind: 'clavicle' as const, side };
        if (i === r.upperArm[side]) return { kind: 'upperArm' as const, side };
        if (i === r.lowerArm[side]) return { kind: 'lowerArm' as const, side };
        if (i === r.thigh[side]) return { kind: 'thigh' as const };
      }
      return { kind: 'other' as const };
    });
    // Spine offsets that may stretch: spine bones and the neck (not clavicles/arms).
    this.stretch = rig.bones.map((_, i) => r.spine.includes(i) || i === r.neck);
    this.parentBindInv = rig.bones.map((b) => {
      const parent = rig.bones[b.parent];
      return parent ? parent.bindQuaternion.clone().invert() : rig.rootQuaternion.clone().invert();
    });
  }

  /** Computes all bone transforms for `pose` into `out` (parents before children). */
  solve(pose: BodyPose3D, out: BoneTransforms): BoneTransforms {
    const { rig } = this;
    const [minLen, maxLen] = this.config.fit.torsoLengthRange;
    const torsoLength = Math.min(
      maxLen,
      Math.max(minLen, Number.isFinite(pose.torsoLength) ? pose.torsoLength : 1),
    );
    for (let i = 0; i < rig.bones.length; i++) {
      const bone = rig.bones[i];
      if (!bone) continue;
      const role = this.roleOf[i] ?? { kind: 'other' as const };
      const parentQ =
        bone.parent >= 0 ? (out.worldQuaternion[bone.parent] as Quaternion) : rig.rootQuaternion;
      const parentP = bone.parent >= 0 ? (out.worldPosition[bone.parent] as Vector3) : null;
      const parentS = bone.parent >= 0 ? (out.worldScale[bone.parent] as number) : 1;
      const worldQ = out.worldQuaternion[i] as Quaternion;

      // How the parent has rotated relative to its bind orientation.
      const parentDelta = this.q2.copy(parentQ).multiply(this.parentBindInv[i] as Quaternion);

      switch (role.kind) {
        case 'pelvis':
        case 'thigh':
          worldQ.copy(pose.hips).multiply(bone.bindQuaternion);
          break;
        case 'spine':
          worldQ.copy(pose.hips).slerp(pose.chest, role.t).multiply(bone.bindQuaternion);
          break;
        case 'neck':
          worldQ.copy(pose.chest).multiply(bone.bindQuaternion);
          break;
        case 'clavicle': {
          const lift = this.clavicleLift(pose, role.side);
          // Rotate about the chest's forward axis: left raises with +angle, right with −angle.
          const axis = this.v.copy(Z_AXIS).applyQuaternion(pose.chest);
          this.q.setFromAxisAngle(axis, role.side === 'left' ? lift : -lift);
          worldQ.copy(this.q).multiply(pose.chest).multiply(bone.bindQuaternion);
          break;
        }
        case 'upperArm':
        case 'lowerArm': {
          const restAim = (role.kind === 'upperArm' ? this.rig.restAim.upperArm : this.rig.restAim.lowerArm)[
            role.side
          ];
          const target = role.kind === 'upperArm' ? pose.arms[role.side].upper : pose.arms[role.side].lower;
          // Where the bone would point if it only followed its parent.
          worldQ.copy(parentDelta).multiply(bone.bindQuaternion);
          this.aim.copy(restAim).applyQuaternion(parentDelta);
          if (target.lengthSq() > 1e-8 && Number.isFinite(target.x + target.y + target.z)) {
            this.v.copy(target).normalize();
            this.q.setFromUnitVectors(this.aim, this.v);
            worldQ.premultiply(this.q);
          }
          break;
        }
        default:
          worldQ.copy(parentDelta).multiply(bone.bindQuaternion);
      }
      worldQ.normalize();

      // Local rotation relative to the parent's CURRENT world rotation.
      const localQ = out.localQuaternion[i] as Quaternion;
      localQ.copy(parentQ).invert().multiply(worldQ).normalize();

      const localP = out.localPosition[i] as Vector3;
      localP.copy(bone.restLocalPosition);
      if (this.stretch[i]) localP.multiplyScalar(torsoLength);

      const worldP = out.worldPosition[i] as Vector3;
      if (parentP) {
        worldP.copy(localP).multiplyScalar(parentS).applyQuaternion(parentQ).add(parentP);
      } else {
        worldP.copy(localP).applyQuaternion(rig.rootQuaternion);
      }
      out.worldScale[i] = parentS * bone.restLocalScale.x;
    }
    return out;
  }

  private clavicleLift(pose: BodyPose3D, side: 'left' | 'right'): number {
    const { startDeg, factor, maxDeg } = this.config.clavicleLift;
    // Elevation of the upper arm from hanging, measured in the chest frame.
    const down = this.v.set(0, -1, 0).applyQuaternion(pose.chest);
    const upper = pose.arms[side].upper;
    const len = upper.length();
    if (!(len > 1e-6)) return 0;
    const elevationDeg = (Math.acos(Math.min(1, Math.max(-1, down.dot(upper) / len))) * 180) / Math.PI;
    const liftDeg = Math.min(maxDeg, Math.max(0, (elevationDeg - startDeg) * factor));
    return (liftDeg * Math.PI) / 180;
  }
}

/** Rest-space midpoint of the upper-arm heads and the shoulder vector for the current solve. */
export function shoulderAnchor(rig: RigModel, t: BoneTransforms): { mid: Vector3; span: Vector3 } {
  const l = t.worldPosition[rig.roles.upperArm.left] as Vector3;
  const r = t.worldPosition[rig.roles.upperArm.right] as Vector3;
  return { mid: l.clone().add(r).multiplyScalar(0.5), span: l.clone().sub(r) };
}

/** Writes solved parent-local transforms onto scene-graph bones (same order as the RigModel). */
export function applyToBones(
  bones: ReadonlyArray<{ position: Vector3; quaternion: Quaternion }>,
  t: BoneTransforms,
): void {
  for (let i = 0; i < bones.length; i++) {
    const bone = bones[i];
    const p = t.localPosition[i];
    const q = t.localQuaternion[i];
    if (!bone || !p || !q) continue;
    bone.position.copy(p);
    bone.quaternion.copy(q);
  }
}
