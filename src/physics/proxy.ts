/**
 * Coarse cloth-simulation proxy built from the ACTUAL render topology of a garment. Deterministic
 * (same asset + config ⇒ same proxy), computed at load; the source asset is never modified.
 *
 * Coordinate space: garment REST space (metres, +Y up, +X wearer's left, +Z front) = rig-root
 * space, the same space as the CPU-skinned render vertices and the skinning matrices.
 *
 * Steps:
 * 1. Seam welding (explicit mapping): render vertices with exactly equal positions (UV-seam
 *    duplicates) form one weld vertex. Nothing else is merged by proximity.
 * 2. Topology-aware clustering: weld vertices are bucketed into voxels; inside each voxel only
 *    vertices CONNECTED by mesh edges within that voxel form a particle. Surfaces that are near
 *    each other but not connected (front/back panels, the inside of a sleeve) stay separate, so the
 *    neckline, armholes, sleeve openings and front/back separation survive.
 * 3. Edges = render edges between different particles (stretch/shear); faces = render triangles
 *    spanning three particles (used for bending constraints). Rest lengths are computed by the
 *    solver from rest positions.
 * 4. Skin weights per particle = average of its members' weights (top 4, normalized).
 * 5. Anchor weights: distance from the neck/shoulder line → pinned (follows the skin exactly), then a
 *    smooth transition to free fabric (hem, sleeve ends) with a bounded maximum deviation. Particles
 *    whose skin weights are split between body regions (torso vs. an arm: the armpit and shoulder
 *    seams) stay pinned too: linear-blend skinning distorts those areas far beyond what any cloth
 *    rest length can follow, so simulating them only fights the skin.
 * 6. Render mapping: each render vertex takes an inverse-distance blend of its own particle and the
 *    proxy-edge neighbours of that particle (never an unconnected surface).
 */
import type { GarmentSimulationConfig } from '../garments/types';

export interface ProxyInput {
  /** Rest positions of the render vertices (x, y, z per vertex). */
  positions: ArrayLike<number>;
  normals: ArrayLike<number>;
  index: ArrayLike<number>;
  /** 4 joint indices + 4 weights per render vertex. */
  skinIndex: ArrayLike<number>;
  skinWeight: ArrayLike<number>;
  vertexCount: number;
  /** Rest-space polyline of attachment anchors (e.g. left shoulder → neck → right shoulder). */
  anchorLine: ReadonlyArray<readonly [number, number, number]>;
  /** Body region per skin joint index (e.g. 0 torso, 1 left arm, 2 right arm). */
  jointRegion: ArrayLike<number>;
  config: GarmentSimulationConfig;
}

export interface ClothProxy {
  particleCount: number;
  /** Rest positions (3 per particle). */
  rest: Float32Array;
  /** Mean rest normal (3 per particle), used for diagnostics/tests. */
  normals: Float32Array;
  joints: Uint16Array;
  weights: Float32Array;
  /** 0 = pinned to the skinned pose; 1 = free (within maxDistance). */
  freeness: Float32Array;
  invMass: Float32Array;
  /** Allowed deviation from the skinned position (m). */
  maxDistance: Float32Array;
  edges: Uint32Array;
  faces: Uint32Array;
  /** Render vertex → particle (the vertex's own cluster). */
  particleOf: Uint32Array;
  /** Render mapping: up to 4 (particle, weight) pairs per render vertex; unused weights are 0. */
  mapParticles: Uint32Array;
  mapWeights: Float32Array;
  /** Render vertex → weld vertex (seam duplicates share one weld id). */
  weldOf: Uint32Array;
  weldCount: number;
}

class UnionFind {
  private parent: Uint32Array;
  constructor(n: number) {
    this.parent = new Uint32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(a: number): number {
    const p = this.parent;
    let r = a;
    while (p[r] !== r) r = p[r] as number;
    while (p[a] !== r) {
      const next = p[a] as number;
      p[a] = r;
      a = next;
    }
    return r;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) {
      if (ra < rb) this.parent[rb] = ra;
      else this.parent[ra] = rb;
    }
  }
}

function distanceToPolyline(p: readonly [number, number, number], line: ProxyInput['anchorLine']): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i] as readonly [number, number, number];
    const b = line[i + 1] as readonly [number, number, number];
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const len2 = (ab[0] ?? 0) ** 2 + (ab[1] ?? 0) ** 2 + (ab[2] ?? 0) ** 2;
    const t =
      len2 > 0
        ? Math.max(
            0,
            Math.min(
              1,
              ((ap[0] ?? 0) * (ab[0] ?? 0) + (ap[1] ?? 0) * (ab[1] ?? 0) + (ap[2] ?? 0) * (ab[2] ?? 0)) /
                len2,
            ),
          )
        : 0;
    const d = Math.hypot(
      (ap[0] ?? 0) - t * (ab[0] ?? 0),
      (ap[1] ?? 0) - t * (ab[1] ?? 0),
      (ap[2] ?? 0) - t * (ab[2] ?? 0),
    );
    best = Math.min(best, d);
  }
  return best;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function buildClothProxy(input: ProxyInput): ClothProxy {
  const { positions: P, normals: N, index, vertexCount: n, config } = input;

  // 1. Weld exact duplicates (explicit seam mapping).
  const weldMap = new Map<string, number>();
  const weldOf = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const key = `${Math.round((P[i * 3] as number) * 1e6)},${Math.round((P[i * 3 + 1] as number) * 1e6)},${Math.round(
      (P[i * 3 + 2] as number) * 1e6,
    )}`;
    let w = weldMap.get(key);
    if (w === undefined) {
      w = weldMap.size;
      weldMap.set(key, w);
    }
    weldOf[i] = w;
  }
  const weldCount = weldMap.size;
  const weldPos = new Float64Array(weldCount * 3);
  for (let i = 0; i < n; i++) {
    const w = weldOf[i] as number;
    weldPos[w * 3] = P[i * 3] as number;
    weldPos[w * 3 + 1] = P[i * 3 + 1] as number;
    weldPos[w * 3 + 2] = P[i * 3 + 2] as number;
  }

  // Weld-level edges (deduplicated).
  const edgeSet = new Set<number>();
  const weldEdges: number[] = [];
  const addEdge = (a: number, b: number) => {
    if (a === b) return;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = lo * weldCount + hi;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    weldEdges.push(lo, hi);
  };
  for (let f = 0; f < index.length; f += 3) {
    const a = weldOf[index[f] as number] as number;
    const b = weldOf[index[f + 1] as number] as number;
    const c = weldOf[index[f + 2] as number] as number;
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }

  // 2. Voxel + connectivity clustering.
  const s = config.voxelSize;
  const voxel = new Array<string>(weldCount);
  for (let w = 0; w < weldCount; w++) {
    voxel[w] =
      `${Math.floor((weldPos[w * 3] as number) / s)},${Math.floor((weldPos[w * 3 + 1] as number) / s)},${Math.floor(
        (weldPos[w * 3 + 2] as number) / s,
      )}`;
  }
  const uf = new UnionFind(weldCount);
  for (let e = 0; e < weldEdges.length; e += 2) {
    const a = weldEdges[e] as number;
    const b = weldEdges[e + 1] as number;
    if (voxel[a] === voxel[b]) uf.union(a, b);
  }
  const particleOfWeld = new Uint32Array(weldCount);
  const rootToParticle = new Map<number, number>();
  for (let w = 0; w < weldCount; w++) {
    const r = uf.find(w);
    let p = rootToParticle.get(r);
    if (p === undefined) {
      p = rootToParticle.size;
      rootToParticle.set(r, p);
    }
    particleOfWeld[w] = p;
  }
  const count = rootToParticle.size;

  // Particle rest position / normal / weights (accumulated over render vertices).
  const rest = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const members = new Uint32Array(count);
  const jointWeights: Array<Map<number, number>> = Array.from({ length: count }, () => new Map());
  const particleOf = new Uint32Array(n);
  const weldCounted = new Uint8Array(weldCount);
  for (let i = 0; i < n; i++) {
    const w = weldOf[i] as number;
    const p = particleOfWeld[w] as number;
    particleOf[i] = p;
    normals[p * 3] = (normals[p * 3] as number) + (N[i * 3] as number);
    normals[p * 3 + 1] = (normals[p * 3 + 1] as number) + (N[i * 3 + 1] as number);
    normals[p * 3 + 2] = (normals[p * 3 + 2] as number) + (N[i * 3 + 2] as number);
    const jw = jointWeights[p] as Map<number, number>;
    for (let k = 0; k < 4; k++) {
      const wk = input.skinWeight[i * 4 + k] as number;
      if (wk <= 0) continue;
      const j = input.skinIndex[i * 4 + k] as number;
      jw.set(j, (jw.get(j) ?? 0) + wk);
    }
    if (!weldCounted[w]) {
      weldCounted[w] = 1;
      members[p] = (members[p] as number) + 1;
      rest[p * 3] = (rest[p * 3] as number) + (weldPos[w * 3] as number);
      rest[p * 3 + 1] = (rest[p * 3 + 1] as number) + (weldPos[w * 3 + 1] as number);
      rest[p * 3 + 2] = (rest[p * 3 + 2] as number) + (weldPos[w * 3 + 2] as number);
    }
  }
  const joints = new Uint16Array(count * 4);
  const weights = new Float32Array(count * 4);
  for (let p = 0; p < count; p++) {
    const m = members[p] as number;
    for (let k = 0; k < 3; k++) rest[p * 3 + k] = (rest[p * 3 + k] as number) / m;
    const nl =
      Math.hypot(normals[p * 3] as number, normals[p * 3 + 1] as number, normals[p * 3 + 2] as number) || 1;
    for (let k = 0; k < 3; k++) normals[p * 3 + k] = (normals[p * 3 + k] as number) / nl;
    const top = [...(jointWeights[p] as Map<number, number>).entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, 4);
    const sum = top.reduce((acc, [, w]) => acc + w, 0) || 1;
    top.forEach(([j, w], k) => {
      joints[p * 4 + k] = j;
      weights[p * 4 + k] = w / sum;
    });
  }

  // 3. Proxy edges and faces.
  const pEdgeSet = new Set<number>();
  const pEdges: number[] = [];
  for (let e = 0; e < weldEdges.length; e += 2) {
    const a = particleOfWeld[weldEdges[e] as number] as number;
    const b = particleOfWeld[weldEdges[e + 1] as number] as number;
    if (a === b) continue;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = lo * count + hi;
    if (pEdgeSet.has(key)) continue;
    pEdgeSet.add(key);
    pEdges.push(lo, hi);
  }
  const faceSet = new Set<string>();
  const pFaces: number[] = [];
  for (let f = 0; f < index.length; f += 3) {
    const a = particleOf[index[f] as number] as number;
    const b = particleOf[index[f + 1] as number] as number;
    const c = particleOf[index[f + 2] as number] as number;
    if (a === b || b === c || a === c) continue;
    const key = [a, b, c].sort((x, y) => x - y).join(',');
    if (faceSet.has(key)) continue;
    faceSet.add(key);
    pFaces.push(a, b, c);
  }

  // 5. Anchoring.
  const regionMix = new Float32Array(count);
  for (let p = 0; p < count; p++) {
    const sums = new Map<number, number>();
    for (let k = 0; k < 4; k++) {
      const w = weights[p * 4 + k] as number;
      if (w <= 0) continue;
      const region = input.jointRegion[joints[p * 4 + k] as number] ?? 0;
      sums.set(region, (sums.get(region) ?? 0) + w);
    }
    regionMix[p] = 1 - Math.max(0, ...sums.values());
  }
  const freeness = new Float32Array(count);
  const invMass = new Float32Array(count);
  const maxDistance = new Float32Array(count);
  for (let p = 0; p < count; p++) {
    const d = distanceToPolyline(
      [rest[p * 3] as number, rest[p * 3 + 1] as number, rest[p * 3 + 2] as number],
      input.anchorLine,
    );
    const f =
      smoothstep(config.pinnedRadius, config.freeRadius, d) *
      (1 - smoothstep(0.08, 0.3, regionMix[p] as number));
    freeness[p] = f;
    invMass[p] = f <= 0.001 ? 0 : 1;
    maxDistance[p] = f * config.maxDeviation;
  }

  // 6. Render mapping over own particle + proxy-edge neighbours.
  const neighbours: number[][] = Array.from({ length: count }, () => []);
  for (let e = 0; e < pEdges.length; e += 2) {
    const a = pEdges[e] as number;
    const b = pEdges[e + 1] as number;
    (neighbours[a] as number[]).push(b);
    (neighbours[b] as number[]).push(a);
  }
  const mapParticles = new Uint32Array(n * 4);
  const mapWeights = new Float32Array(n * 4);
  const eps = s * 0.15;
  const radius = s * 1.5;
  for (let i = 0; i < n; i++) {
    const own = particleOf[i] as number;
    const px = P[i * 3] as number;
    const py = P[i * 3 + 1] as number;
    const pz = P[i * 3 + 2] as number;
    const cands: Array<[number, number]> = [];
    for (const q of [own, ...(neighbours[own] as number[])]) {
      const d = Math.hypot(
        px - (rest[q * 3] as number),
        py - (rest[q * 3 + 1] as number),
        pz - (rest[q * 3 + 2] as number),
      );
      if (q !== own && d > radius) continue;
      cands.push([q, 1 / (d + eps) ** 2]);
    }
    cands.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const top = cands.slice(0, 4);
    const sum = top.reduce((acc, [, w]) => acc + w, 0);
    top.forEach(([q, w], k) => {
      mapParticles[i * 4 + k] = q;
      mapWeights[i * 4 + k] = w / sum;
    });
  }

  return {
    particleCount: count,
    rest,
    normals,
    joints,
    weights,
    freeness,
    invMass,
    maxDistance,
    edges: Uint32Array.from(pEdges),
    faces: Uint32Array.from(pFaces),
    particleOf,
    mapParticles,
    mapWeights,
    weldOf,
    weldCount,
  };
}
