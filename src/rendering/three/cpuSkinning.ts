/**
 * CPU linear-blend skinning of the garment's REST geometry into rig-root space (rest-space metres).
 *
 * Used only by the cloth mode: the physics displacement is added to these skinned positions and the
 * result is drawn by a plain (non-skinned) mesh, so vertices are never skinned twice. The GPU path
 * (SkinnedMesh) is used in skeletal mode.
 */
import { type Bone, type BufferGeometry, Matrix4 } from 'three';

export class CpuSkinner {
  readonly count: number;
  private readonly restPos: Float32Array;
  private readonly restNrm: Float32Array;
  private readonly joints: Uint16Array;
  private readonly weights: Float32Array;
  private readonly matrices: Float32Array;
  private readonly m = new Matrix4();
  private readonly rootInv = new Matrix4();

  constructor(
    geometry: BufferGeometry,
    private readonly bones: readonly Bone[],
    private readonly boneInverses: readonly Matrix4[],
  ) {
    const pos = geometry.getAttribute('position');
    const nrm = geometry.getAttribute('normal');
    const si = geometry.getAttribute('skinIndex');
    const sw = geometry.getAttribute('skinWeight');
    this.count = pos.count;
    this.restPos = new Float32Array(pos.count * 3);
    this.restNrm = new Float32Array(pos.count * 3);
    this.joints = new Uint16Array(pos.count * 4);
    this.weights = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      this.restPos[i * 3] = pos.getX(i);
      this.restPos[i * 3 + 1] = pos.getY(i);
      this.restPos[i * 3 + 2] = pos.getZ(i);
      this.restNrm[i * 3] = nrm.getX(i);
      this.restNrm[i * 3 + 1] = nrm.getY(i);
      this.restNrm[i * 3 + 2] = nrm.getZ(i);
      for (let k = 0; k < 4; k++) {
        this.joints[i * 4 + k] = si.getComponent(i, k);
        this.weights[i * 4 + k] = sw.getComponent(i, k);
      }
    }
    this.matrices = new Float32Array(bones.length * 16);
  }

  /** Matrices from the last updateMatrices() call (16 floats per joint, column-major). */
  get currentMatrices(): Float32Array {
    return this.matrices;
  }

  /**
   * Skinning matrices relative to `rigRoot` (bone world · inverse bind, expressed in rig-root
   * space). Bones' world matrices must be current.
   */
  updateMatrices(rigRootWorld: Matrix4): Float32Array {
    this.rootInv.copy(rigRootWorld).invert();
    for (let j = 0; j < this.bones.length; j++) {
      const bone = this.bones[j];
      const inverse = this.boneInverses[j];
      if (!bone || !inverse) continue;
      this.m.multiplyMatrices(this.rootInv, bone.matrixWorld).multiply(inverse);
      this.matrices.set(this.m.elements, j * 16);
    }
    return this.matrices;
  }

  /** Skins every vertex; normals use the matrix 3×3 (uniform scale) and are renormalized. */
  skin(outPos: Float32Array, outNrm: Float32Array | null): void {
    const M = this.matrices;
    const { restPos: P, restNrm: N, joints: J, weights: W } = this;
    for (let i = 0; i < this.count; i++) {
      const px = P[i * 3] as number;
      const py = P[i * 3 + 1] as number;
      const pz = P[i * 3 + 2] as number;
      const nx = N[i * 3] as number;
      const ny = N[i * 3 + 1] as number;
      const nz = N[i * 3 + 2] as number;
      let x = 0;
      let y = 0;
      let z = 0;
      let a = 0;
      let b = 0;
      let c = 0;
      for (let k = 0; k < 4; k++) {
        const w = W[i * 4 + k] as number;
        if (w === 0) continue;
        const o = (J[i * 4 + k] as number) * 16;
        const e0 = M[o] as number;
        const e1 = M[o + 1] as number;
        const e2 = M[o + 2] as number;
        const e4 = M[o + 4] as number;
        const e5 = M[o + 5] as number;
        const e6 = M[o + 6] as number;
        const e8 = M[o + 8] as number;
        const e9 = M[o + 9] as number;
        const e10 = M[o + 10] as number;
        x += w * (e0 * px + e4 * py + e8 * pz + (M[o + 12] as number));
        y += w * (e1 * px + e5 * py + e9 * pz + (M[o + 13] as number));
        z += w * (e2 * px + e6 * py + e10 * pz + (M[o + 14] as number));
        a += w * (e0 * nx + e4 * ny + e8 * nz);
        b += w * (e1 * nx + e5 * ny + e9 * nz);
        c += w * (e2 * nx + e6 * ny + e10 * nz);
      }
      outPos[i * 3] = x;
      outPos[i * 3 + 1] = y;
      outPos[i * 3 + 2] = z;
      if (outNrm) {
        const len = Math.hypot(a, b, c) || 1;
        outNrm[i * 3] = a / len;
        outNrm[i * 3 + 1] = b / len;
        outNrm[i * 3 + 2] = c / len;
      }
    }
  }

  /** Skinned position of an arbitrary rest point with explicit joint weights (for proxies). */
  skinPoint(
    rest: ArrayLike<number>,
    joints: ArrayLike<number>,
    weights: ArrayLike<number>,
    out: Float32Array,
    offset: number,
  ): void {
    const M = this.matrices;
    const px = rest[0] as number;
    const py = rest[1] as number;
    const pz = rest[2] as number;
    let x = 0;
    let y = 0;
    let z = 0;
    for (let k = 0; k < 4; k++) {
      const w = weights[k] as number;
      if (!w) continue;
      const o = (joints[k] as number) * 16;
      x +=
        w *
        ((M[o] as number) * px +
          (M[o + 4] as number) * py +
          (M[o + 8] as number) * pz +
          (M[o + 12] as number));
      y +=
        w *
        ((M[o + 1] as number) * px +
          (M[o + 5] as number) * py +
          (M[o + 9] as number) * pz +
          (M[o + 13] as number));
      z +=
        w *
        ((M[o + 2] as number) * px +
          (M[o + 6] as number) * py +
          (M[o + 10] as number) * pz +
          (M[o + 14] as number));
    }
    out[offset] = x;
    out[offset + 1] = y;
    out[offset + 2] = z;
  }
}

/**
 * Groups vertices that share a position (UV-seam duplicates) so recomputed normals stay smooth
 * across seams. Explicit mapping, exact positions only (quantized to 1e-6 m).
 */
export function positionWeldGroups(position: ArrayLike<number>, count: number): Uint32Array {
  const map = new Map<string, number>();
  const groups = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const key = `${Math.round((position[i * 3] as number) * 1e6)},${Math.round(
      (position[i * 3 + 1] as number) * 1e6,
    )},${Math.round((position[i * 3 + 2] as number) * 1e6)}`;
    let g = map.get(key);
    if (g === undefined) {
      g = map.size;
      map.set(key, g);
    }
    groups[i] = g;
  }
  return groups;
}

/** Area-weighted vertex normals, accumulated per weld group (smooth across UV seams). */
export function computeWeldedNormals(
  position: Float32Array,
  index: ArrayLike<number>,
  groups: Uint32Array,
  groupCount: number,
  scratch: Float32Array,
  out: Float32Array,
): void {
  scratch.fill(0, 0, groupCount * 3);
  for (let f = 0; f < index.length; f += 3) {
    const a = index[f] as number;
    const b = index[f + 1] as number;
    const c = index[f + 2] as number;
    const ax = position[a * 3] as number;
    const ay = position[a * 3 + 1] as number;
    const az = position[a * 3 + 2] as number;
    const e1x = (position[b * 3] as number) - ax;
    const e1y = (position[b * 3 + 1] as number) - ay;
    const e1z = (position[b * 3 + 2] as number) - az;
    const e2x = (position[c * 3] as number) - ax;
    const e2y = (position[c * 3 + 1] as number) - ay;
    const e2z = (position[c * 3 + 2] as number) - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) {
      const g = (groups[v] as number) * 3;
      scratch[g] = (scratch[g] as number) + nx;
      scratch[g + 1] = (scratch[g + 1] as number) + ny;
      scratch[g + 2] = (scratch[g + 2] as number) + nz;
    }
  }
  const n = groups.length;
  for (let i = 0; i < n; i++) {
    const g = (groups[i] as number) * 3;
    const x = scratch[g] as number;
    const y = scratch[g + 1] as number;
    const z = scratch[g + 2] as number;
    const len = Math.hypot(x, y, z) || 1;
    out[i * 3] = x / len;
    out[i * 3 + 1] = y / len;
    out[i * 3 + 2] = z / len;
  }
}
