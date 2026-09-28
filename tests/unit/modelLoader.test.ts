import { Box3, type Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { instantiate, maxRestError } from '../../src/garments/modelLoader';
import { loadVneck, loadVneckFemale } from './garmentModel';

describe('garment model loader (actual local GLB)', () => {
  it('finds one skinned mesh, keeps the full rig hierarchy and repairs the bind pose', async () => {
    const model = await loadVneck();
    expect(model.stats.vertices).toBe(7717);
    expect(model.stats.triangles).toBe(14079);
    expect(model.stats.joints).toBe(19);
    // Unweighted parents/children (hands, fingers, calves, neck_02, head…) are retained.
    expect(model.rig.bones.length).toBe(19);
    const names: string[] = [];
    model.template.traverse((o) => names.push(o.name));
    for (const re of [/^hand_l/, /^index_03_r/, /^head_08/, /^calf_l/, /^ik_hand_root/]) {
      expect(names.some((n) => re.test(n))).toBe(true);
    }
    expect(names.length).toBeGreaterThanOrEqual(model.stats.nodes - 6);
    // Rest pose rebuilt from inverse bind matrices reproduces the vertex positions.
    expect(model.stats.restError).toBeLessThan(1e-4);
  });

  it('uses rest space with +X = wearer left, +Y up and the front toward +Z', async () => {
    const { rig } = await loadVneck();
    const l = rig.bones[rig.roles.upperArm.left]?.bindPosition as Vector3;
    const r = rig.bones[rig.roles.upperArm.right]?.bindPosition as Vector3;
    expect(l.x).toBeGreaterThan(0.15);
    expect(r.x).toBeLessThan(-0.15);
    expect(rig.shoulderSpan).toBeCloseTo(0.38, 2);
    const pelvis = rig.bones[rig.roles.pelvis]?.bindPosition as Vector3;
    expect(rig.shoulderMid.y).toBeGreaterThan(pelvis.y);
    // Arms hang down and outward at bind (A-pose).
    expect(rig.restAim.upperArm.left.y).toBeLessThan(-0.5);
    expect(rig.restAim.upperArm.left.x).toBeGreaterThan(0.3);
    expect(rig.restAim.upperArm.right.x).toBeLessThan(-0.3);
  });

  it('instances have independent skeletons that deform the shared rest geometry', async () => {
    const model = await loadVneck();
    const a = instantiate(model);
    const b = instantiate(model);
    expect(a.mesh.geometry).toBe(b.mesh.geometry);
    expect(a.mesh.skeleton.bones[0]).not.toBe(b.mesh.skeleton.bones[0]);
    expect(maxRestError(a.mesh)).toBeLessThan(1e-4);
    const box = new Box3().setFromBufferAttribute(a.mesh.geometry.getAttribute('position') as never);
    expect(box.max.y - box.min.y).toBeGreaterThan(0.6);
  });
});

describe("women's V-neck (baked FBX2glTF conversion)", () => {
  it('loads in the same layout as the male model: metres, +Y up, A-pose, exact rest pose', async () => {
    const { stats, rig } = await loadVneckFemale();
    expect(stats.triangles).toBe(14007);
    expect(stats.restError).toBeLessThan(1e-4);
    // Narrower than the male shirt (0.38 m), at a plausible shoulder height.
    expect(rig.shoulderSpan).toBeCloseTo(0.354, 2);
    expect(rig.shoulderMid.y).toBeGreaterThan(1.2);
    expect(rig.shoulderMid.y).toBeLessThan(1.45);
    const l = rig.bones[rig.roles.upperArm.left]?.bindPosition as Vector3;
    expect(l.x).toBeGreaterThan(0.15);
    expect(rig.restAim.upperArm.left.y).toBeLessThan(-0.5);
    expect(rig.restAim.upperArm.right.x).toBeLessThan(-0.3);
  });
});
