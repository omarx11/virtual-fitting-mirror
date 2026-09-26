import { Box3, type Quaternion, type SkinnedMesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  applyToBones,
  type BodyPose3D,
  createBoneTransforms,
  neutralPose,
  Retargeter,
} from '../../src/fitting/retargeter';
import { VNECK_3D } from '../../src/garments/catalogue';
import { instantiate } from '../../src/garments/modelLoader';
import { loadVneck } from './garmentModel';

const DEG = Math.PI / 180;

async function setup() {
  const model = await loadVneck();
  const instance = instantiate(model);
  const retargeter = new Retargeter(model.rig, VNECK_3D.rig);
  const out = createBoneTransforms(model.rig);
  const pose = (edit: (p: BodyPose3D) => void = () => undefined) => {
    const p = neutralPose(model.rig);
    edit(p);
    retargeter.solve(p, out);
    applyToBones(instance.bones, out);
    instance.root.updateMatrixWorld(true);
    return out;
  };
  return { model, instance, retargeter, out, pose };
}

/** CPU-skinned positions of the instance (rest-space metres). */
function skinned(mesh: SkinnedMesh): Float32Array {
  mesh.skeleton.update();
  const pos = mesh.geometry.getAttribute('position');
  const out = new Float32Array(pos.count * 3);
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    mesh.applyBoneTransform(i, v);
    out.set([v.x, v.y, v.z], i * 3);
  }
  return out;
}

/** Vertices whose dominant joint is `boneName`. */
function dominated(mesh: SkinnedMesh, pattern: RegExp): number[] {
  const idx = mesh.geometry.getAttribute('skinIndex');
  const w = mesh.geometry.getAttribute('skinWeight');
  const bones = mesh.skeleton.bones;
  const out: number[] = [];
  for (let i = 0; i < idx.count; i++) {
    let best = 0;
    let bestW = -1;
    for (let k = 0; k < 4; k++) {
      const wk = w.getComponent(i, k);
      if (wk > bestW) {
        bestW = wk;
        best = idx.getComponent(i, k);
      }
    }
    if (pattern.test(bones[best]?.name ?? '')) out.push(i);
  }
  return out;
}

describe('retargeter on the real V-neck rig', () => {
  it('neutral pose preserves the bind/rest pose exactly', async () => {
    const { model, pose, instance } = await setup();
    const t = pose();
    model.rig.bones.forEach((b, i) => {
      // float32 inverse bind matrices: ~0.01° round-off between decomposition paths.
      expect(t.localQuaternion[i]?.angleTo(b.restLocalQuaternion)).toBeLessThan(1e-3);
      expect(t.localPosition[i]?.distanceTo(b.restLocalPosition)).toBeLessThan(1e-6);
      expect(t.worldPosition[i]?.distanceTo(b.bindPosition)).toBeLessThan(1e-5);
    });
    const rest = model.geometry.getAttribute('position').array as Float32Array;
    const s = skinned(instance.mesh);
    let worst = 0;
    for (let i = 0; i < s.length; i++) worst = Math.max(worst, Math.abs((s[i] ?? 0) - (rest[i] ?? 0)));
    expect(worst).toBeLessThan(1e-4);
  });

  it('aims each upper arm at its target (world direction → parent-local rotation)', async () => {
    const { model, pose } = await setup();
    const up = new Vector3(0.3, 0.9, 0.2).normalize();
    const t = pose((p) => {
      p.arms.left.upper.copy(up);
      p.arms.left.lower.copy(up);
    });
    const rig = model.rig;
    const i = rig.roles.upperArm.left;
    const aim = rig.restAim.upperArm.left
      .clone()
      .applyQuaternion((rig.bones[i] as { bindQuaternion: Quaternion }).bindQuaternion.clone().invert())
      .applyQuaternion(t.worldQuaternion[i] as Quaternion);
    expect(aim.angleTo(up)).toBeLessThan(1e-4);
    // Parent-local = inverse(parent world) · world.
    const parent = rig.bones[i]?.parent ?? -1;
    const recomposed = (t.worldQuaternion[parent] as Quaternion)
      .clone()
      .multiply(t.localQuaternion[i] as Quaternion);
    expect(recomposed.angleTo(t.worldQuaternion[i] as Quaternion)).toBeLessThan(1e-5);
  });

  it('left/right are anatomical: raising the LEFT arm moves only the wearer-left (+X) sleeve', async () => {
    const { instance, pose } = await setup();
    const rest = skinned(instance.mesh);
    const leftSleeve = dominated(instance.mesh, /^upperarm(_twist_0\d)?_l/);
    const rightSleeve = dominated(instance.mesh, /^upperarm(_twist_0\d)?_r/);
    expect(leftSleeve.length).toBeGreaterThan(200);
    pose((p) => {
      p.arms.left.upper.set(1, 0.15, 0).normalize();
      p.arms.left.lower.set(1, 0.15, 0).normalize();
    });
    const raised = skinned(instance.mesh);
    const meanDy = (ids: number[]) =>
      ids.reduce((s, i) => s + ((raised[i * 3 + 1] ?? 0) - (rest[i * 3 + 1] ?? 0)), 0) / ids.length;
    expect(meanDy(leftSleeve)).toBeGreaterThan(0.05);
    expect(Math.abs(meanDy(rightSleeve))).toBeLessThan(1e-4);
    // The sleeve is on the wearer's left, i.e. +X in rest space.
    const meanX = leftSleeve.reduce((s, i) => s + (raised[i * 3] ?? 0), 0) / leftSleeve.length;
    expect(meanX).toBeGreaterThan(0.2);
  });

  it('keeps torso and sleeves connected when both arms rise (bounded skinning stretch)', async () => {
    const { instance, pose, model } = await setup();
    const rest = skinned(instance.mesh);
    const index = model.geometry.getIndex()?.array as ArrayLike<number>;
    const stretch = (elevationDeg: number) => {
      const e = elevationDeg * DEG;
      pose((p) => {
        for (const [side, sx] of [
          ['left', 1],
          ['right', -1],
        ] as const) {
          p.arms[side].upper.set(sx * Math.sin(e), -Math.cos(e), 0.05).normalize();
          p.arms[side].lower.copy(p.arms[side].upper);
        }
        p.chest.setFromAxisAngle(new Vector3(0, 1, 0), 20 * DEG);
        p.hips.setFromAxisAngle(new Vector3(0, 1, 0), 8 * DEG);
      });
      const posed = skinned(instance.mesh);
      const ratios: number[] = [];
      let longest = 0;
      for (let f = 0; f < index.length; f += 3) {
        for (const [a, b] of [
          [index[f], index[f + 1]],
          [index[f + 1], index[f + 2]],
          [index[f + 2], index[f]],
        ] as const) {
          const ia = (a ?? 0) * 3;
          const ib = (b ?? 0) * 3;
          const d = (arr: Float32Array) =>
            Math.hypot(
              (arr[ia] ?? 0) - (arr[ib] ?? 0),
              (arr[ia + 1] ?? 0) - (arr[ib + 1] ?? 0),
              (arr[ia + 2] ?? 0) - (arr[ib + 2] ?? 0),
            );
          const l1 = d(posed);
          expect(Number.isFinite(l1)).toBe(true);
          longest = Math.max(longest, l1);
          if (d(rest) > 1e-4) ratios.push(l1 / d(rest));
        }
      }
      ratios.sort((x, y) => y - x);
      return { p99: ratios[Math.floor(ratios.length * 0.01)] ?? 0, longest, posed };
    };
    // Sideways to horizontal: the bulk of the mesh keeps its edge lengths.
    const horizontal = stretch(90);
    expect(horizontal.p99).toBeLessThan(3);
    // Arms high above the head: the armpit stretches (linear-blend skinning on an A-pose rig —
    // documented in LIMITATIONS.md) but the single connected mesh never tears apart.
    const high = stretch(150);
    expect(high.longest).toBeLessThan(0.2);
    const box = new Box3();
    const p = high.posed;
    for (let i = 0; i < p.length; i += 3) box.expandByPoint(new Vector3(p[i], p[i + 1], p[i + 2]));
    expect(box.max.y).toBeGreaterThan(1.7); // raised sleeves now reach above the collar
  });

  it('produces finite, normalized quaternions for random and degenerate targets', async () => {
    const { model, retargeter, out } = await setup();
    let seed = 7;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647 - 0.5;
    };
    for (let k = 0; k < 200; k++) {
      const p = neutralPose(model.rig);
      p.chest.set(rnd(), rnd(), rnd(), rnd()).normalize();
      p.hips.set(rnd(), rnd(), rnd(), rnd()).normalize();
      p.arms.left.upper.set(rnd(), rnd(), rnd());
      p.arms.right.lower.set(0, 0, 0); // degenerate: keeps the parent-carried direction
      p.arms.right.upper.set(Number.NaN, 0, 0); // invalid: ignored
      p.torsoLength = k % 2 ? 5 : Number.NaN; // clamped
      retargeter.solve(p, out);
      for (const q of out.localQuaternion) {
        expect(Number.isFinite(q.x + q.y + q.z + q.w)).toBe(true);
        expect(Math.abs(q.length() - 1)).toBeLessThan(1e-6);
      }
      for (const v of out.worldPosition) expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
    }
  });

  it('thighs follow the pelvis only (stable hem even when legs are not tracked)', async () => {
    const { model, pose } = await setup();
    const t = pose((p) => {
      p.hips.setFromAxisAngle(new Vector3(0, 1, 0), 20 * DEG);
      p.chest.copy(p.hips);
      p.arms.left.upper.set(0, 1, 0);
    });
    const rig = model.rig;
    for (const side of ['left', 'right'] as const) {
      const i = rig.roles.thigh[side];
      expect(t.localQuaternion[i]?.angleTo(rig.bones[i]?.restLocalQuaternion as Quaternion)).toBeLessThan(
        1e-5,
      );
    }
  });
});
