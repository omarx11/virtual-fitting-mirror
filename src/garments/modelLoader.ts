/**
 * Loads a rigged garment glTF, repairs/validates its rig and prepares it for live bone driving.
 *
 * Asset-independent steps:
 * 1. Find exactly one SkinnedMesh with position/normal/skin attributes.
 * 2. Rebuild bone REST transforms from the inverse bind matrices. Some exporters (including the
 *    Fab conversion of the V-neck) write identity node transforms for every joint, so the node
 *    hierarchy alone collapses the mesh; the inverse bind matrices are the authoritative bind pose.
 * 3. Move the complete bone hierarchy (weighted joints AND unweighted parents/children such as
 *    hands and helpers) under a clean rig root, re-bind the mesh with an identity bind matrix, and
 *    verify on the CPU that the repaired rest pose reproduces the original vertex positions.
 *
 * Ownership: a PreparedGarmentModel (template) owns the shared BufferGeometry. Instances made with
 * `instantiate()` share that geometry (SkeletonUtils.clone keeps references) but own their bones and
 * any materials the renderer assigns. Dispose instances' materials in the renderer; dispose the
 * geometry once via `disposePreparedModel` when the cache entry is dropped.
 */
import {
  type Bone,
  type BufferGeometry,
  Euler,
  Group,
  Matrix4,
  type Object3D,
  Quaternion,
  type SkinnedMesh,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { aimFromParentAxis, aimToChild, findBone, type RigBone, type RigModel } from './rigModel';
import type { GarmentRigConfig } from './types';

export interface PreparedGarmentModel {
  /** Rig root holding the bone hierarchy and the skinned mesh (rest pose). Never rendered. */
  template: Group;
  rig: RigModel;
  geometry: BufferGeometry;
  stats: {
    vertices: number;
    triangles: number;
    joints: number;
    nodes: number;
    /** Largest rest-pose reconstruction error (m) found by the CPU check. */
    restError: number;
  };
}

export interface GarmentInstance {
  root: Group;
  mesh: SkinnedMesh;
  /** Bones in RigModel order (same index as rig.bones). */
  bones: Bone[];
}

const DEG = Math.PI / 180;

export class GarmentModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GarmentModelError';
  }
}

function findSkinnedMeshes(root: Object3D): SkinnedMesh[] {
  const out: SkinnedMesh[] = [];
  root.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh) out.push(o as SkinnedMesh);
  });
  return out;
}

/** Parses GLB bytes (used by tests and by the fetch path). */
export async function parseGarmentModel(
  data: ArrayBuffer,
  rigConfig: GarmentRigConfig,
): Promise<PreparedGarmentModel> {
  const gltf = await new GLTFLoader().parseAsync(data, '');
  return prepareGarmentModel(gltf.scene, rigConfig);
}

export function prepareGarmentModel(scene: Group, rigConfig: GarmentRigConfig): PreparedGarmentModel {
  scene.updateMatrixWorld(true);
  const meshes = findSkinnedMeshes(scene);
  if (meshes.length !== 1) {
    throw new GarmentModelError(`Expected exactly one skinned mesh, found ${meshes.length}`);
  }
  const mesh = meshes[0] as SkinnedMesh;
  const geometry = mesh.geometry;
  for (const name of ['position', 'normal', 'skinIndex', 'skinWeight']) {
    if (!geometry.getAttribute(name)) throw new GarmentModelError(`Skinned mesh has no ${name} attribute`);
  }
  const skeleton = mesh.skeleton;
  const joints = skeleton.bones;
  if (joints.length === 0) throw new GarmentModelError('Skin has no joints');

  // --- Complete hierarchy under the skeleton's common ancestor. ---------------------------------
  const jointSet = new Set<Object3D>(joints);
  const topJoints = joints.filter((b) => !b.parent || !jointSet.has(b.parent));
  const container = topJoints[0]?.parent;
  if (!container || topJoints.some((b) => b.parent !== container)) {
    throw new GarmentModelError('Skin joints do not share one root container');
  }
  let nodeCount = 0;
  scene.traverse(() => {
    nodeCount++;
  });

  const restQuat = new Quaternion().setFromEuler(
    new Euler(
      rigConfig.restRotationDeg[0] * DEG,
      rigConfig.restRotationDeg[1] * DEG,
      rigConfig.restRotationDeg[2] * DEG,
    ),
  );
  const rigRoot = new Group();
  rigRoot.name = 'garment-rig-root';
  rigRoot.quaternion.copy(restQuat);

  // Bind world (in rig-root space) of every joint = inverse(inverse bind matrix).
  const bindWorld = new Map<Object3D, Matrix4>();
  joints.forEach((bone, j) => {
    const inverse = skeleton.boneInverses[j];
    if (!inverse) throw new GarmentModelError(`Joint ${bone.name} has no inverse bind matrix`);
    const m = inverse.clone().invert();
    const e = m.elements;
    if (e.some((v) => !Number.isFinite(v))) {
      throw new GarmentModelError(`Joint ${bone.name} has a non-invertible bind matrix`);
    }
    bindWorld.set(bone, m);
  });

  // Re-parent every child of the container (bone roots and unweighted helpers) to the rig root,
  // keeping their subtrees intact.
  for (const child of [...container.children]) rigRoot.add(child);
  rigRoot.add(mesh);
  mesh.position.set(0, 0, 0);
  mesh.quaternion.identity();
  mesh.scale.set(1, 1, 1);

  // Rebuild local transforms top-down: joints from their bind worlds, other nodes unchanged.
  const worldOf = new Map<Object3D, Matrix4>();
  worldOf.set(rigRoot, new Matrix4());
  const visit = (node: Object3D) => {
    for (const child of node.children) {
      const parentWorld = worldOf.get(node) as Matrix4;
      const bind = bindWorld.get(child);
      if (bind) {
        const local = parentWorld.clone().invert().multiply(bind);
        local.decompose(child.position, child.quaternion, child.scale);
        worldOf.set(child, bind.clone());
      } else {
        child.updateMatrix();
        worldOf.set(child, parentWorld.clone().multiply(child.matrix));
      }
      visit(child);
    }
  };
  visit(rigRoot);
  rigRoot.updateMatrixWorld(true);
  // Bind with identity bind matrix: rig-root space == the space the inverse bind matrices expect.
  mesh.bind(skeleton, new Matrix4());
  mesh.frustumCulled = false;

  // --- Rig model (topological order) ------------------------------------------------------------
  const ordered: Bone[] = [];
  rigRoot.traverse((o) => {
    if ((o as Bone).isBone) ordered.push(o as Bone);
  });
  const indexOf = new Map<Object3D, number>(ordered.map((b, i) => [b, i]));
  const restInv = restQuat.clone();
  const rigBones: RigBone[] = ordered.map((bone) => {
    const world = (worldOf.get(bone) as Matrix4).clone();
    const p = new Vector3();
    const q = new Quaternion();
    const s = new Vector3();
    world.decompose(p, q, s);
    // Express in rest space: rest = rootRotation * rig-root space.
    p.applyQuaternion(restInv);
    q.premultiply(restInv);
    const parentIndex = bone.parent ? (indexOf.get(bone.parent) ?? -1) : -1;
    return {
      name: bone.name,
      parent: parentIndex,
      bindPosition: p,
      bindQuaternion: q,
      bindScale: s.x,
      restLocalPosition: bone.position.clone(),
      restLocalQuaternion: bone.quaternion.clone(),
      restLocalScale: bone.scale.clone(),
      weighted: jointSet.has(bone),
    };
  });

  const b = rigConfig.bones;
  const roles = {
    pelvis: findBone(rigBones, b.pelvis, 'pelvis'),
    spine: b.spine.map((re, i) => findBone(rigBones, re, `spine ${i + 1}`)),
    neck: b.neck ? findBone(rigBones, b.neck, 'neck') : null,
    clavicle: {
      left: findBone(rigBones, b.clavicle.left, 'left clavicle'),
      right: findBone(rigBones, b.clavicle.right, 'right clavicle'),
    },
    upperArm: {
      left: findBone(rigBones, b.upperArm.left, 'left upper arm'),
      right: findBone(rigBones, b.upperArm.right, 'right upper arm'),
    },
    lowerArm: {
      left: findBone(rigBones, b.lowerArm.left, 'left lower arm'),
      right: findBone(rigBones, b.lowerArm.right, 'right lower arm'),
    },
    thigh: {
      left: findBone(rigBones, b.thigh.left, 'left thigh'),
      right: findBone(rigBones, b.thigh.right, 'right thigh'),
    },
  };
  const upperAimL = aimToChild(rigBones, roles.upperArm.left, roles.lowerArm.left);
  const upperAimR = aimToChild(rigBones, roles.upperArm.right, roles.lowerArm.right);
  if (!upperAimL || !upperAimR) throw new GarmentModelError('Upper-arm bones have zero length at bind');
  const lu = rigBones[roles.upperArm.left]?.bindPosition as Vector3;
  const ru = rigBones[roles.upperArm.right]?.bindPosition as Vector3;
  if (lu.x <= ru.x) {
    throw new GarmentModelError(
      'Left upper arm is not on +X in rest space; set restRotationDeg so +X is the wearer’s left',
    );
  }
  const shoulderMid = lu.clone().add(ru).multiplyScalar(0.5);
  const thighL = rigBones[roles.thigh.left] as RigBone;
  const thighR = rigBones[roles.thigh.right] as RigBone;
  const thighMid = thighL.bindPosition.clone().add(thighR.bindPosition).multiplyScalar(0.5);
  const rig: RigModel = {
    bones: rigBones,
    roles,
    rootQuaternion: restQuat.clone(),
    restAim: {
      upperArm: { left: upperAimL, right: upperAimR },
      lowerArm: {
        left: aimFromParentAxis(rigBones, roles.lowerArm.left, upperAimL),
        right: aimFromParentAxis(rigBones, roles.lowerArm.right, upperAimR),
      },
    },
    shoulderSpan: lu.distanceTo(ru),
    shoulderMid,
    torsoDrop: shoulderMid.y - thighMid.y,
  };

  // --- Validate the repaired rest pose on the CPU. -----------------------------------------------
  const restError = maxRestError(mesh);
  if (!(restError < 1e-3)) {
    throw new GarmentModelError(`Repaired rest pose does not reproduce the mesh (error ${restError} m)`);
  }
  const index = geometry.getIndex();
  const position = geometry.getAttribute('position');
  return {
    template: rigRoot,
    rig,
    geometry,
    stats: {
      vertices: position.count,
      triangles: (index ? index.count : position.count) / 3,
      joints: joints.length,
      nodes: nodeCount,
      restError,
    },
  };
}

/** Largest distance between skinned rest positions and the raw vertex positions (m). */
export function maxRestError(mesh: SkinnedMesh): number {
  mesh.parent?.updateMatrixWorld(true);
  mesh.skeleton.update();
  const pos = mesh.geometry.getAttribute('position');
  const v = new Vector3();
  const raw = new Vector3();
  let worst = 0;
  const step = Math.max(1, Math.floor(pos.count / 2000));
  for (let i = 0; i < pos.count; i += step) {
    raw.fromBufferAttribute(pos, i);
    v.copy(raw);
    mesh.applyBoneTransform(i, v);
    worst = Math.max(worst, v.distanceTo(raw));
  }
  return worst;
}

/** Independent copy with its own skeleton (SkeletonUtils.clone keeps bone references correct). */
export function instantiate(model: PreparedGarmentModel): GarmentInstance {
  const root = cloneSkinned(model.template) as Group;
  const byName = new Map<string, Bone>();
  let mesh: SkinnedMesh | null = null;
  root.traverse((o) => {
    if ((o as Bone).isBone) byName.set(o.name, o as Bone);
    if ((o as SkinnedMesh).isSkinnedMesh) mesh = o as SkinnedMesh;
  });
  if (!mesh) throw new GarmentModelError('Cloned garment lost its skinned mesh');
  const bones = model.rig.bones.map((b) => {
    const bone = byName.get(b.name);
    if (!bone) throw new GarmentModelError(`Cloned garment lost bone ${b.name}`);
    return bone;
  });
  return { root, mesh, bones };
}

export function disposePreparedModel(model: PreparedGarmentModel): void {
  model.geometry.dispose();
  model.template.traverse((o) => {
    const material = (o as SkinnedMesh).material;
    if (material && !Array.isArray(material)) material.dispose();
  });
}

/**
 * Caches prepared models per URL. Loads are shared; a failed load is not cached so Retry works.
 * `dispose()` releases every geometry this cache created.
 */
export class GarmentModelCache {
  private entries = new Map<string, Promise<PreparedGarmentModel>>();
  private ready = new Set<PreparedGarmentModel>();
  private disposed = false;

  constructor(private readonly fetchBytes: (url: string) => Promise<ArrayBuffer> = defaultFetch) {}

  load(url: string, rig: GarmentRigConfig): Promise<PreparedGarmentModel> {
    const cached = this.entries.get(url);
    if (cached) return cached;
    const promise = this.fetchBytes(url)
      .then((bytes) => parseGarmentModel(bytes, rig))
      .then((model) => {
        if (this.disposed) {
          disposePreparedModel(model);
          throw new Error('Garment model cache disposed');
        }
        this.ready.add(model);
        return model;
      });
    promise.catch(() => {
      if (this.entries.get(url) === promise) this.entries.delete(url);
    });
    this.entries.set(url, promise);
    return promise;
  }

  dispose(): void {
    this.disposed = true;
    for (const model of this.ready) disposePreparedModel(model);
    this.ready.clear();
    this.entries.clear();
  }
}

async function defaultFetch(url: string): Promise<ArrayBuffer> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new GarmentModelError(
      `Could not load the 3D garment (${url}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const type = response.headers.get('content-type') ?? '';
  if (response.status === 404 || type.includes('text/html')) {
    throw new GarmentModelError(`3D garment file not found at ${url}`);
  }
  if (!response.ok) throw new GarmentModelError(`3D garment download failed: HTTP ${response.status}`);
  return response.arrayBuffer();
}
