/**
 * Pure description of a garment skeleton, extracted once from the loaded model. The retargeter only
 * works on this data (no scene graph), so it is unit-testable without WebGL.
 *
 * "Rest space" is the garment rest space from GarmentRigConfig: metres, +Y up, +X = wearer's left,
 * +Z = garment front. Bind transforms are expressed in rest space.
 */
import type { Quaternion, Vector3 } from 'three';
import type { SidePair } from './types';

export interface RigBone {
  name: string;
  /** Index of the parent in RigModel.bones, or -1 when the parent is the rig root. */
  parent: number;
  /** Bind (rest) transform of the bone in rest space. Scale is uniform. */
  bindPosition: Vector3;
  bindQuaternion: Quaternion;
  bindScale: number;
  /** Rest local transform relative to the parent (what the bone node holds at rest). */
  restLocalPosition: Vector3;
  restLocalQuaternion: Quaternion;
  restLocalScale: Vector3;
  /** True when the bone influences vertices (it is a joint of the skin). */
  weighted: boolean;
}

export interface RigRoles {
  pelvis: number;
  spine: number[];
  neck: number | null;
  clavicle: SidePair<number>;
  upperArm: SidePair<number>;
  lowerArm: SidePair<number>;
  thigh: SidePair<number>;
}

export interface RigModel {
  /** Topologically ordered: every parent precedes its children. */
  bones: RigBone[];
  roles: RigRoles;
  /** Rotation of the rig root relative to rest space (the documented rest adapter). */
  rootQuaternion: Quaternion;
  /** Unit bone directions (rest space) at bind, used to aim limbs. */
  restAim: {
    upperArm: SidePair<Vector3>;
    lowerArm: SidePair<Vector3>;
  };
  /** Garment shoulder span (m) between the upper-arm bone heads at bind. */
  shoulderSpan: number;
  /** Midpoint of the upper-arm heads at bind (rest space). */
  shoulderMid: Vector3;
  /** Vertical distance from the shoulder midpoint to the thigh-joint midpoint at bind (m). */
  torsoDrop: number;
}

/** Finds the bone playing `role`, preferring weighted bones; throws a descriptive error if absent. */
export function findBone(bones: readonly RigBone[], pattern: RegExp, role: string): number {
  const matches = bones.map((b, i) => (pattern.test(b.name) ? i : -1)).filter((i) => i >= 0);
  const weighted = matches.filter((i) => bones[i]?.weighted);
  const index = weighted[0] ?? matches[0];
  if (index === undefined) throw new Error(`Rig bone for "${role}" (${pattern}) not found in the model`);
  return index;
}

/** Aim of a bone toward its first weighted child's bind position, or null. */
export function aimToChild(bones: readonly RigBone[], index: number, childIndex: number): Vector3 | null {
  const a = bones[index]?.bindPosition;
  const b = bones[childIndex]?.bindPosition;
  if (!a || !b) return null;
  const d = b.clone().sub(a);
  return d.lengthSq() > 1e-10 ? d.normalize() : null;
}

/**
 * Aim of a bone without a weighted child (e.g. the lower arm): assumes the same bone-local axis as
 * its parent's aim (exporters use one bone-axis convention per skeleton).
 */
export function aimFromParentAxis(bones: readonly RigBone[], index: number, parentAim: Vector3): Vector3 {
  const bone = bones[index];
  const parent = bone ? bones[bone.parent] : undefined;
  if (!bone || !parent) return parentAim.clone();
  const localAxis = parentAim.clone().applyQuaternion(parent.bindQuaternion.clone().invert());
  return localAxis.applyQuaternion(bone.bindQuaternion).normalize();
}
