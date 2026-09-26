/**
 * Physics tests with the Node-compatible Jolt build (embedded WASM). Deterministic: the simulation
 * clock is driven with explicit media times, never wall-clock timing.
 */
import initJolt from 'jolt-physics/wasm-compat';
import { Quaternion, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  applyToBones,
  type BodyPose3D,
  createBoneTransforms,
  neutralPose,
  Retargeter,
} from '../../src/fitting/retargeter';
import { VNECK_3D } from '../../src/garments/catalogue';
import { instantiate, type PreparedGarmentModel } from '../../src/garments/modelLoader';
import { ClothSimulation } from '../../src/physics/ClothSimulation';
import type { Jolt } from '../../src/physics/joltCloth';
import { CpuSkinner } from '../../src/rendering/three/cpuSkinning';
import { loadVneck } from './garmentModel';

let J: Jolt;
let model: PreparedGarmentModel;

beforeAll(async () => {
  J = (await initJolt()) as unknown as Jolt;
  model = await loadVneck();
}, 60_000);

describe('Jolt capability proof (small cloth)', () => {
  it('moving skinned/pinned targets, bounded free vertices, stretch resistance, moving capsule collision', () => {
    const N = 8;
    const S = 0.05;
    const filter = new J.ObjectLayerPairFilterTable(2);
    filter.EnableCollision(1, 1);
    const bp = new J.BroadPhaseLayerInterfaceTable(2, 2);
    const l0 = new J.BroadPhaseLayer(0);
    const l1 = new J.BroadPhaseLayer(1);
    bp.MapObjectToBroadPhaseLayer(0, l0);
    bp.MapObjectToBroadPhaseLayer(1, l1);
    const settings = new J.JoltSettings();
    settings.mMaxWorkerThreads = 1;
    settings.mObjectLayerPairFilter = filter;
    settings.mBroadPhaseLayerInterface = bp;
    settings.mObjectVsBroadPhaseLayerFilter = new J.ObjectVsBroadPhaseLayerFilterTable(bp, 2, filter, 2);
    const jolt = new J.JoltInterface(settings);
    J.destroy(settings);
    const bi = jolt.GetPhysicsSystem().GetBodyInterface();

    const shared = new J.SoftBodySharedSettings();
    const v = new J.SoftBodySharedSettingsVertex();
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) {
        v.mPosition = new J.Float3(c * S, -r * S, 0);
        v.mInvMass = r === 0 ? 0 : 1;
        shared.mVertices.push_back(v);
      }
    J.destroy(v);
    const f = new J.SoftBodySharedSettingsFace(0, 0, 0, 0);
    for (let r = 0; r < N - 1; r++)
      for (let c = 0; c < N - 1; c++) {
        const i = r * N + c;
        f.set_mVertex(0, i);
        f.set_mVertex(1, i + N);
        f.set_mVertex(2, i + 1);
        shared.AddFace(f);
        f.set_mVertex(0, i + 1);
        f.set_mVertex(1, i + N);
        f.set_mVertex(2, i + N + 1);
        shared.AddFace(f);
      }
    J.destroy(f);
    const attr = new J.SoftBodySharedSettingsVertexAttributes();
    attr.mCompliance = 0;
    attr.mShearCompliance = 0;
    attr.mBendCompliance = 1e-3;
    shared.CreateConstraints(attr, 1, J.SoftBodySharedSettings_EBendType_Distance);
    J.destroy(attr);
    shared.mInvBindMatrices.resize(1);
    shared.mInvBindMatrices.at(0).mJointIndex = 0;
    shared.mInvBindMatrices.at(0).mInvBind = J.Mat44.prototype.sIdentity();
    shared.mSkinnedConstraints.resize(N * N);
    for (let i = 0; i < N * N; i++) {
      const sk = shared.mSkinnedConstraints.at(i);
      sk.mVertex = i;
      for (let k = 0; k < 4; k++) {
        sk.get_mWeights(k).mInvBindIndex = 0;
        sk.get_mWeights(k).mWeight = k === 0 ? 1 : 0;
      }
      sk.mMaxDistance = 0.02 * Math.floor(i / N);
    }
    shared.CalculateSkinnedConstraintNormals();
    shared.Optimize();
    const cs = new J.SoftBodyCreationSettings(shared, new J.RVec3(0, 0, 0), J.Quat.prototype.sIdentity(), 1);
    cs.mNumIterations = 8;
    cs.mUpdatePosition = false;
    cs.mAllowSleeping = false;
    const body = bi.CreateSoftBody(cs);
    J.destroy(cs);
    bi.AddBody(body.GetID(), J.EActivation_Activate);
    const mp = J.castObject(body.GetMotionProperties(), J.SoftBodyMotionProperties);

    const capRot = J.Quat.prototype.sRotation(new J.Vec3(0, 0, 1), Math.PI / 2);
    const bcs = new J.BodyCreationSettings(
      new J.CapsuleShape(0.1, 0.04),
      new J.RVec3(0.17, -0.2, 0.2),
      capRot,
      J.EMotionType_Kinematic,
      1,
    );
    const cap = bi.CreateBody(bcs);
    J.destroy(bcs);
    bi.AddBody(cap.GetID(), J.EActivation_Activate);

    const joints = new J.ArrayMat44();
    joints.resize(1);
    const root = J.RMat44.prototype.sIdentity();
    const dt = 1 / 60;
    let topError = 0;
    let beyondLimit = 0;
    let minCapsule = Number.POSITIVE_INFINITY;
    let hangStrain = 0;
    for (let step = 0; step < 150; step++) {
      const t = step * dt;
      const jx = Math.min(1, t) * 0.3; // the attachment joint moves 30 cm
      const m = joints.at(0);
      m.SetColumn4(0, new J.Vec4(1, 0, 0, 0));
      m.SetColumn4(1, new J.Vec4(0, 1, 0, 0));
      m.SetColumn4(2, new J.Vec4(0, 0, 1, 0));
      m.SetColumn4(3, new J.Vec4(jx, 0, 0, 1));
      mp.SkinVertices(root, joints.data(), 1, step === 0, jolt.GetTempAllocator());
      const cz = 0.2 - Math.min(1, Math.max(0, (t - 1.2) / 1.2)) * 0.35; // capsule sweeps in after 1.2 s
      bi.MoveKinematic(cap.GetID(), new J.RVec3(0.17 + jx, -0.2, cz), capRot, dt);
      jolt.Step(dt, 1);
      const verts = mp.GetVertices();
      for (let i = 0; i < N * N; i++) {
        const p = verts.at(i).mPosition;
        const [x, y, z] = [p.GetX(), p.GetY(), p.GetZ()];
        const row = Math.floor(i / N);
        const col = i % N;
        const d = Math.hypot(x - (col * S + jx), y + row * S, z);
        if (row === 0) topError = Math.max(topError, d);
        else if (d > 0.02 * row + 0.03) beyondLimit++;
        const ax = Math.max(0.07 + jx, Math.min(0.27 + jx, x));
        minCapsule = Math.min(minCapsule, Math.hypot(x - ax, y + 0.2, z - cz));
        if (t > 1 && t < 1.2 && row < N - 1) {
          // Hanging, before the capsule arrives: vertical neighbours keep their spacing.
          const q = verts.at(i + N).mPosition;
          hangStrain = Math.max(hangStrain, Math.hypot(q.GetX() - x, q.GetY() - y, q.GetZ() - z) / S - 1);
        }
      }
    }
    expect(topError).toBeLessThan(1e-4); // pinned vertices follow the moving skinned joint exactly
    expect(beyondLimit).toBe(0); // free vertices stay within max distance (+ collision slack)
    expect(hangStrain).toBeLessThan(0.05); // stretch resistance
    expect(minCapsule).toBeGreaterThan(0.04 - 0.005); // no penetration of the moving capsule
    bi.RemoveBody(cap.GetID());
    bi.DestroyBody(cap.GetID());
    bi.RemoveBody(body.GetID());
    bi.DestroyBody(body.GetID());
    J.destroy(joints);
    J.destroy(jolt);
  });
});

/** Mirrors GarmentRenderer's per-frame flow without WebGL. */
function harness() {
  const instance = instantiate(model);
  const retargeter = new Retargeter(model.rig, VNECK_3D.rig);
  const bones = createBoneTransforms(model.rig);
  const skinner = new CpuSkinner(
    model.geometry,
    instance.mesh.skeleton.bones,
    instance.mesh.skeleton.boneInverses,
  );
  const positions = new Float32Array(skinner.count * 3);
  const sim = ClothSimulation.createWith(J, {
    definition: VNECK_3D,
    model,
    boneCount: instance.mesh.skeleton.bones.length,
  });
  const frame = (pose: BodyPose3D, mediaMs: number, playing = true) => {
    retargeter.solve(pose, bones);
    applyToBones(instance.bones, bones);
    instance.root.updateMatrixWorld(true);
    skinner.updateMatrices(instance.root.matrixWorld);
    skinner.skin(positions, null);
    const skinned = positions.slice();
    sim.advanceClock(mediaMs, playing, 0);
    const ok = sim.deform({ skinner, positions, bones });
    let maxDisp = 0;
    for (let i = 0; i < positions.length; i += 3) {
      maxDisp = Math.max(
        maxDisp,
        Math.hypot(
          (positions[i] ?? 0) - (skinned[i] ?? 0),
          (positions[i + 1] ?? 0) - (skinned[i + 1] ?? 0),
          (positions[i + 2] ?? 0) - (skinned[i + 2] ?? 0),
        ),
      );
    }
    return { ok, maxDisp, positions: positions.slice(), skinned };
  };
  return { sim, frame };
}

const yaw = (deg: number) => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (deg * Math.PI) / 180);

function turning(t: number): BodyPose3D {
  const p = neutralPose(model.rig);
  const q = yaw(40 * Math.sin(2 * Math.PI * 1.5 * t));
  p.chest.copy(q);
  p.hips.copy(q);
  const a = Math.sin(2 * Math.PI * t);
  p.arms.left.upper.set(0.6 + 0.3 * a, -0.7 + 0.5 * a, 0.2).normalize();
  p.arms.left.lower.copy(p.arms.left.upper);
  return p;
}

describe('garment cloth simulation (actual V-neck, Jolt)', () => {
  it('builds a topology-following proxy in the profiling range with explicit seam welds', () => {
    const { sim } = harness();
    const proxy = sim.proxy;
    expect(proxy.particleCount).toBeGreaterThanOrEqual(500);
    expect(proxy.particleCount).toBeLessThanOrEqual(1500);
    expect(proxy.weldCount).toBeLessThan(7717); // UV-seam duplicates joined by the explicit weld map
    let pinned = 0;
    for (const m of proxy.invMass) if (m === 0) pinned++;
    expect(pinned).toBeGreaterThan(proxy.particleCount * 0.08);
    expect(pinned).toBeLessThan(proxy.particleCount * 0.4);
    // Mapping weights are normalized and never reference an unconnected surface.
    const neighbours = new Map<number, Set<number>>();
    for (let e = 0; e < proxy.edges.length; e += 2) {
      const a = proxy.edges[e] as number;
      const b = proxy.edges[e + 1] as number;
      if (!neighbours.has(a)) neighbours.set(a, new Set());
      if (!neighbours.has(b)) neighbours.set(b, new Set());
      neighbours.get(a)?.add(b);
      neighbours.get(b)?.add(a);
    }
    for (let v = 0; v < proxy.particleOf.length; v++) {
      let sum = 0;
      const own = proxy.particleOf[v] as number;
      for (let k = 0; k < 4; k++) {
        const w = proxy.mapWeights[v * 4 + k] as number;
        sum += w;
        const q = proxy.mapParticles[v * 4 + k] as number;
        if (w > 0) expect(q === own || neighbours.get(own)?.has(q)).toBe(true);
      }
      expect(sum).toBeCloseTo(1, 5);
    }
    // No particle merges distant surfaces (front/back panels are ≥ 0.2 m apart).
    const pos = model.geometry.getAttribute('position');
    const reach = new Float32Array(proxy.particleCount);
    for (let v = 0; v < pos.count; v++) {
      const p = proxy.particleOf[v] as number;
      const d = Math.hypot(
        pos.getX(v) - (proxy.rest[p * 3] as number),
        pos.getY(v) - (proxy.rest[p * 3 + 1] as number),
        pos.getZ(v) - (proxy.rest[p * 3 + 2] as number),
      );
      reach[p] = Math.max(reach[p] as number, d);
    }
    expect(Math.max(...reach)).toBeLessThan(VNECK_3D.simulation?.voxelSize ?? 0);
    sim.dispose();
  });

  it('gives real, bounded secondary motion; pinned regions follow the skin; finite throughout', () => {
    const { sim, frame } = harness();
    const pinned: number[] = [];
    sim.proxy.invMass.forEach((m, p) => {
      if (m === 0) pinned.push(p);
    });
    let peak = 0;
    let stretchP99 = 1;
    let pinnedError = 0;
    for (let k = 0; k <= 180; k++) {
      const t = k / 60;
      const r = frame(turning(t), t * 1000);
      expect(r.ok).toBe(true);
      let finite = true;
      for (const x of r.positions) finite &&= Number.isFinite(x);
      expect(finite).toBe(true);
      if (k > 30) {
        stretchP99 = Math.max(stretchP99, sim.stats.stretchP99);
        for (const p of pinned) {
          const i = p * 3;
          const d = Math.hypot(
            ((sim as unknown as { simPos: Float32Array }).simPos[i] ?? 0) -
              ((sim as unknown as { target: Float32Array }).target[i] ?? 0),
            ((sim as unknown as { simPos: Float32Array }).simPos[i + 1] ?? 0) -
              ((sim as unknown as { target: Float32Array }).target[i + 1] ?? 0),
            ((sim as unknown as { simPos: Float32Array }).simPos[i + 2] ?? 0) -
              ((sim as unknown as { target: Float32Array }).target[i + 2] ?? 0),
          );
          pinnedError = Math.max(pinnedError, d);
        }
      }
      if (k > 30) peak = Math.max(peak, r.maxDisp);
    }
    const s = sim.stats;
    expect(peak).toBeGreaterThan(0.005); // fabric actually lags/drapes (not a toggle-only mode)
    expect(peak).toBeLessThan((VNECK_3D.simulation?.maxDeviation ?? 0) + 0.021); // bounded
    expect(stretchP99).toBeLessThan(1.3); // no rubbery stretching of the free fabric
    expect(pinnedError).toBeLessThan(1e-4); // attachment regions follow the live skinned targets
    expect(s.resets).toBe(1); // only the initial snap; no instability resets
    expect(s.substepsLastFrame).toBeGreaterThanOrEqual(1);
    sim.dispose();
  });

  it('freezes on pause and resumes without a catch-up burst', () => {
    const { sim, frame } = harness();
    let t = 0;
    for (let k = 0; k < 60; k++, t += 1 / 60) frame(turning(t), t * 1000);
    const pausedA = frame(turning(t), t * 1000, false);
    const pausedB = frame(turning(t), t * 1000 + 5000, false); // wall time passes, media time does not
    expect(sim.stats.state).toBe('frozen');
    expect(sim.stats.substepsLastFrame).toBe(0);
    for (let i = 0; i < pausedA.positions.length; i++)
      expect(pausedB.positions[i]).toBe(pausedA.positions[i]);
    const resumed = frame(turning(t + 1 / 60), (t + 1 / 60) * 1000, true);
    expect(sim.stats.substepsLastFrame).toBeLessThanOrEqual(1);
    expect(resumed.ok).toBe(true);
    sim.dispose();
  });

  it('resets onto the skinned pose after seeks, long gaps and reacquisition', () => {
    const { sim, frame } = harness();
    let t = 0;
    for (let k = 0; k < 60; k++, t += 1 / 60) frame(turning(t), t * 1000);
    // Seek backwards.
    frame(turning(0.2), 200);
    let r = frame(turning(0.2), 200);
    expect(sim.stats.lastResetReason).toMatch(/backwards/);
    expect(r.maxDisp).toBeLessThan(1e-6);
    // Hidden tab: 3 s gap in one frame → reset, not 180 catch-up steps.
    for (let k = 0; k < 30; k++) frame(turning(0.2 + k / 60), 200 + (k * 1000) / 60);
    r = frame(turning(4), 3700);
    expect(sim.stats.lastResetReason).toMatch(/gap/);
    r = frame(turning(4), 3700);
    expect(sim.stats.substepsLastFrame).toBe(0);
    expect(r.maxDisp).toBeLessThan(1e-6);
    // Reacquisition (engine calls reset).
    const before = sim.stats.resets;
    sim.reset('reacquired');
    r = frame(turning(4.1), 3800);
    expect(sim.stats.resets).toBe(before + 1);
    expect(r.maxDisp).toBeLessThan(1e-6);
    sim.dispose();
  });

  it('is deterministic for the same input sequence', () => {
    const a = harness();
    const b = harness();
    let ra = null as ReturnType<typeof a.frame> | null;
    let rb = null as ReturnType<typeof b.frame> | null;
    for (let k = 0; k < 90; k++) {
      ra = a.frame(turning(k / 60), (k * 1000) / 60);
      rb = b.frame(turning(k / 60), (k * 1000) / 60);
    }
    expect(ra?.positions).toEqual(rb?.positions);
    a.sim.dispose();
    b.sim.dispose();
  });

  it('tuning rebuilds safely and disposal is idempotent', () => {
    const { sim, frame } = harness();
    frame(turning(0), 0);
    sim.setTuning({ bendCompliance: 1e-2, colliders: false });
    const r = frame(turning(1 / 60), 1000 / 60);
    expect(r.ok).toBe(true);
    expect(sim.stats.colliders).toBe(0);
    sim.dispose();
    sim.dispose();
  });
});
