/**
 * Jolt (jolt-physics 1.1.0, single-threaded WASM) soft-body world for one garment proxy.
 *
 * Verified capabilities used (see tests/unit/joltCloth.test.ts): SoftBodySharedSettings with
 * faces + CreateConstraints (edge/shear/bend), per-vertex skinned constraints with max distance,
 * inverse-bind matrices, SoftBodyMotionProperties.SkinVertices (moving skinned targets; invMass 0
 * vertices are hard-skinned), and collisions with kinematic capsule bodies moved by MoveKinematic.
 *
 * Space: garment rest space (metres, +Y up). The soft body sits at the origin with identity
 * rotation, so body space = rest space; skinning matrices are passed as the "joint matrices" and
 * every inverse bind is identity.
 *
 * WASM ownership: objects created with `new` here are destroyed here, EXCEPT ref-counted objects
 * handed to Jolt (shared settings, shapes) — the bodies own those and release them when destroyed.
 * Borrowed wrappers (GetVertices(), at(i), GetMotionProperties()) are never destroyed.
 * Per-frame I/O goes through the WASM heap (HEAPF32) at offsets measured once: no per-particle
 * JS/WASM allocations.
 */
import type JoltModule from 'jolt-physics/wasm';
import type { Quaternion, Vector3 } from 'three';
import type { ClothProxy } from './proxy';
import type { ClothTuning } from './types';

export type Jolt = typeof JoltModule;
type JoltInterface = InstanceType<Jolt['JoltInterface']>;
type Body = InstanceType<Jolt['Body']>;
type SoftBodyMotionProperties = InstanceType<Jolt['SoftBodyMotionProperties']>;
type ArrayMat44 = InstanceType<Jolt['ArrayMat44']>;
type RMat44 = InstanceType<Jolt['RMat44']>;
type RVec3 = InstanceType<Jolt['RVec3']>;
type Quat = InstanceType<Jolt['Quat']>;

const LAYER_STATIC = 0;
const LAYER_MOVING = 1;

export interface CapsuleState {
  center: Vector3;
  rotation: Quaternion;
  halfHeight: number;
  radius: number;
}

export class JoltClothWorld {
  private jolt: JoltInterface;
  private body: Body;
  private motion: SoftBodyMotionProperties;
  private joints: ArrayMat44;
  private root: RMat44;
  private tmpPos: RVec3;
  private tmpRot: Quat;
  private capsules: Body[] = [];
  private vertexBase = 0;
  private vertexStride = 0;
  private positionOffset = 0;
  private velocityOffset = 0;
  private jointBase = 0;
  private disposed = false;
  readonly particleCount: number;

  constructor(
    private readonly J: Jolt,
    proxy: ClothProxy,
    private readonly jointCount: number,
    tuning: ClothTuning,
    maxDistanceScale: number,
    capsules: readonly CapsuleState[],
    vertexRadius: number,
  ) {
    this.particleCount = proxy.particleCount;
    // --- System (filters are owned by the JoltInterface after construction) ---------------------
    const objectFilter = new J.ObjectLayerPairFilterTable(2);
    objectFilter.EnableCollision(LAYER_MOVING, LAYER_STATIC);
    objectFilter.EnableCollision(LAYER_MOVING, LAYER_MOVING);
    const bpInterface = new J.BroadPhaseLayerInterfaceTable(2, 2);
    const bpStatic = new J.BroadPhaseLayer(0);
    const bpMoving = new J.BroadPhaseLayer(1);
    bpInterface.MapObjectToBroadPhaseLayer(LAYER_STATIC, bpStatic);
    bpInterface.MapObjectToBroadPhaseLayer(LAYER_MOVING, bpMoving);
    J.destroy(bpStatic);
    J.destroy(bpMoving);
    const settings = new J.JoltSettings();
    settings.mMaxWorkerThreads = 1;
    settings.mMaxBodies = 16;
    settings.mMaxBodyPairs = 64;
    settings.mMaxContactConstraints = 64;
    settings.mObjectLayerPairFilter = objectFilter;
    settings.mBroadPhaseLayerInterface = bpInterface;
    settings.mObjectVsBroadPhaseLayerFilter = new J.ObjectVsBroadPhaseLayerFilterTable(
      bpInterface,
      2,
      objectFilter,
      2,
    );
    this.jolt = new J.JoltInterface(settings);
    J.destroy(settings);
    const system = this.jolt.GetPhysicsSystem();
    const gravity = new J.Vec3(0, -9.81, 0);
    system.SetGravity(gravity);
    J.destroy(gravity);

    // --- Soft body --------------------------------------------------------------------------------
    const shared = new J.SoftBodySharedSettings();
    const vertex = new J.SoftBodySharedSettingsVertex();
    const f3 = new J.Float3(0, 0, 0);
    for (let p = 0; p < proxy.particleCount; p++) {
      f3.x = proxy.rest[p * 3] as number;
      f3.y = proxy.rest[p * 3 + 1] as number;
      f3.z = proxy.rest[p * 3 + 2] as number;
      vertex.mPosition = f3;
      vertex.mInvMass = proxy.invMass[p] as number;
      shared.mVertices.push_back(vertex);
    }
    J.destroy(vertex);
    J.destroy(f3);
    const face = new J.SoftBodySharedSettingsFace(0, 0, 0, 0);
    for (let f = 0; f < proxy.faces.length; f += 3) {
      face.set_mVertex(0, proxy.faces[f] as number);
      face.set_mVertex(1, proxy.faces[f + 1] as number);
      face.set_mVertex(2, proxy.faces[f + 2] as number);
      shared.AddFace(face);
    }
    J.destroy(face);
    const attributes = new J.SoftBodySharedSettingsVertexAttributes();
    attributes.mCompliance = tuning.stretchCompliance;
    attributes.mShearCompliance = tuning.stretchCompliance > 0 ? tuning.stretchCompliance : 1e-5;
    attributes.mBendCompliance = tuning.bendCompliance;
    // Distance-based bending is robust on a coarse, partly non-manifold proxy.
    shared.CreateConstraints(attributes, 1, J.SoftBodySharedSettings_EBendType_Distance);
    J.destroy(attributes);

    shared.mInvBindMatrices.resize(jointCount);
    for (let j = 0; j < jointCount; j++) {
      const ib = shared.mInvBindMatrices.at(j);
      ib.mJointIndex = j;
      ib.mInvBind = J.Mat44.prototype.sIdentity();
    }
    shared.mSkinnedConstraints.resize(proxy.particleCount);
    for (let p = 0; p < proxy.particleCount; p++) {
      const sk = shared.mSkinnedConstraints.at(p);
      sk.mVertex = p;
      for (let k = 0; k < 4; k++) {
        const w = sk.get_mWeights(k);
        w.mInvBindIndex = proxy.joints[p * 4 + k] as number;
        w.mWeight = proxy.weights[p * 4 + k] as number;
      }
      sk.mMaxDistance = proxy.maxDistance[p] as number;
      sk.mBackStopDistance = 0;
      sk.mBackStopRadius = 0;
    }
    shared.CalculateSkinnedConstraintNormals();
    shared.Optimize();

    const position = new J.RVec3(0, 0, 0);
    const rotation = new J.Quat(0, 0, 0, 1);
    const creation = new J.SoftBodyCreationSettings(shared, position, rotation, LAYER_MOVING);
    creation.mNumIterations = tuning.iterations;
    creation.mLinearDamping = tuning.linearDamping;
    creation.mGravityFactor = tuning.gravityFactor;
    creation.mVertexRadius = vertexRadius;
    creation.mUpdatePosition = false;
    creation.mAllowSleeping = false;
    creation.mFacesDoubleSided = true;
    const bodyInterface = system.GetBodyInterface();
    this.body = bodyInterface.CreateSoftBody(creation);
    J.destroy(creation);
    J.destroy(position);
    J.destroy(rotation);
    bodyInterface.AddBody(this.body.GetID(), J.EActivation_Activate);
    this.motion = J.castObject(this.body.GetMotionProperties(), J.SoftBodyMotionProperties);
    this.motion.SetSkinnedMaxDistanceMultiplier(maxDistanceScale);

    // --- Kinematic capsules ------------------------------------------------------------------------
    this.tmpPos = new J.RVec3(0, 0, 0);
    this.tmpRot = new J.Quat(0, 0, 0, 1);
    for (const c of capsules) {
      const shape = new J.CapsuleShape(c.halfHeight, c.radius);
      this.setTmp(c);
      const bcs = new J.BodyCreationSettings(
        shape,
        this.tmpPos,
        this.tmpRot,
        J.EMotionType_Kinematic,
        LAYER_MOVING,
      );
      const b = bodyInterface.CreateBody(bcs);
      J.destroy(bcs);
      bodyInterface.AddBody(b.GetID(), J.EActivation_Activate);
      this.capsules.push(b);
    }

    // --- Heap offsets (measured once) ------------------------------------------------------------
    const vertices = this.motion.GetVertices();
    const v0 = vertices.at(0);
    this.vertexBase = J.getPointer(v0);
    this.vertexStride = proxy.particleCount > 1 ? J.getPointer(vertices.at(1)) - this.vertexBase : 0;
    this.positionOffset = J.getPointer(v0.mPosition) - this.vertexBase;
    this.velocityOffset = J.getPointer(v0.mVelocity) - this.vertexBase;
    this.joints = new J.ArrayMat44();
    this.joints.resize(jointCount);
    this.jointBase = J.getPointer(this.joints.at(0));
    // By-value static returns are Emscripten-owned temporaries: borrowed, never destroyed. Nothing
    // else calls RMat44.sIdentity, so this identity stays valid for the world's lifetime.
    this.root = J.RMat44.prototype.sIdentity();
    if (
      J.getPointer(this.joints.at(Math.max(0, jointCount - 1))) - this.jointBase !==
      (jointCount - 1) * 64
    ) {
      throw new Error('Unexpected Mat44 layout in this Jolt build');
    }
  }

  private setTmp(c: CapsuleState): void {
    this.tmpPos.Set(c.center.x, c.center.y, c.center.z);
    this.tmpRot.Set(c.rotation.x, c.rotation.y, c.rotation.z, c.rotation.w);
  }

  /** Writes column-major 4×4 skinning matrices (three.js element order) into the joint array. */
  setJointMatrices(matrices: Float32Array): void {
    this.J.HEAPF32.set(matrices.subarray(0, this.jointCount * 16), this.jointBase >> 2);
  }

  /** Moves skinned targets; `hardAll` snaps EVERY particle onto its target (reset). */
  skin(hardAll: boolean): void {
    this.motion.SkinVertices(
      this.root,
      this.joints.data(),
      this.jointCount,
      hardAll,
      this.jolt.GetTempAllocator(),
    );
    if (hardAll) this.zeroVelocities();
  }

  private zeroVelocities(): void {
    const heap = this.J.HEAPF32;
    for (let p = 0; p < this.particleCount; p++) {
      const o = (this.vertexBase + p * this.vertexStride + this.velocityOffset) >> 2;
      heap[o] = 0;
      heap[o + 1] = 0;
      heap[o + 2] = 0;
    }
  }

  moveCapsules(capsules: readonly CapsuleState[], dt: number, teleport: boolean): void {
    const bi = this.jolt.GetPhysicsSystem().GetBodyInterface();
    capsules.forEach((c, i) => {
      const body = this.capsules[i];
      if (!body) return;
      this.setTmp(c);
      if (teleport)
        bi.SetPositionAndRotation(body.GetID(), this.tmpPos, this.tmpRot, this.J.EActivation_Activate);
      else bi.MoveKinematic(body.GetID(), this.tmpPos, this.tmpRot, dt);
    });
  }

  step(dt: number): void {
    this.jolt.Step(dt, 1);
  }

  readPositions(out: Float32Array): void {
    const heap = this.J.HEAPF32;
    for (let p = 0; p < this.particleCount; p++) {
      const o = (this.vertexBase + p * this.vertexStride + this.positionOffset) >> 2;
      out[p * 3] = heap[o] as number;
      out[p * 3 + 1] = heap[o + 1] as number;
      out[p * 3 + 2] = heap[o + 2] as number;
    }
  }

  setMaxDistanceScale(scale: number): void {
    this.motion.SetSkinnedMaxDistanceMultiplier(scale);
  }

  setIterations(n: number): void {
    this.motion.SetNumIterations(n);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const bi = this.jolt.GetPhysicsSystem().GetBodyInterface();
    for (const b of [...this.capsules, this.body]) {
      bi.RemoveBody(b.GetID());
      bi.DestroyBody(b.GetID()); // releases the ref-counted shapes / shared settings
    }
    this.capsules = [];
    this.J.destroy(this.joints);
    this.J.destroy(this.tmpPos);
    this.J.destroy(this.tmpRot);
    this.J.destroy(this.jolt);
  }
}
