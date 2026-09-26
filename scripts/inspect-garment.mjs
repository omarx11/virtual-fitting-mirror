#!/usr/bin/env node
// Prints the complete node hierarchy of a rigged garment GLB: every node (weighted joints AND
// unweighted parents), local TRS, world-space bind position, which nodes are skin joints, and how
// many vertices each joint influences. Used to author src/garments/rigs/*.ts; read-only.
//
// Usage: node scripts/inspect-garment.mjs public/garments/3d/vneck/shirt-male.glb [--json]

import { readFileSync } from 'node:fs';
import { Matrix4, Quaternion, Vector3 } from 'three';

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/inspect-garment.mjs <file.glb> [--json]');
  process.exit(1);
}
const asJson = process.argv.includes('--json');

/** Minimal GLB container parse: JSON chunk + BIN chunk. */
function readGlb(file) {
  const buf = readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB file');
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < buf.length) {
    const length = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const chunk = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004e4942) bin = chunk;
    offset += 8 + length;
  }
  return { json, bin };
}

const COMPONENTS = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
};
const SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function accessor(gltf, bin, index) {
  const a = gltf.accessors[index];
  const view = gltf.bufferViews[a.bufferView];
  const Ctor = COMPONENTS[a.componentType];
  const n = SIZES[a.type];
  const byteOffset = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = view.byteStride ?? 0;
  const elementBytes = Ctor.BYTES_PER_ELEMENT * n;
  const out = new Ctor(a.count * n);
  for (let i = 0; i < a.count; i++) {
    const start = bin.byteOffset + byteOffset + i * (stride || elementBytes);
    const src = new Ctor(bin.buffer.slice(start, start + elementBytes));
    out.set(src, i * n);
  }
  return { data: out, count: a.count, n, min: a.min, max: a.max };
}

const { json: gltf, bin } = readGlb(path);
const nodes = gltf.nodes ?? [];
const parent = new Map();
nodes.forEach((node, i) => {
  for (const c of node.children ?? []) parent.set(c, i);
});

const local = nodes.map((node) => {
  const m = new Matrix4();
  if (node.matrix) m.fromArray(node.matrix);
  else
    m.compose(
      new Vector3(...(node.translation ?? [0, 0, 0])),
      new Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
      new Vector3(...(node.scale ?? [1, 1, 1])),
    );
  return m;
});
const world = [];
function worldOf(i) {
  if (world[i]) return world[i];
  const p = parent.get(i);
  world[i] = p === undefined ? local[i].clone() : worldOf(p).clone().multiply(local[i]);
  return world[i];
}
for (let i = 0; i < nodes.length; i++) worldOf(i);

const skin = gltf.skins?.[0];
const jointSet = new Map((skin?.joints ?? []).map((node, j) => [node, j]));
const influence = new Map();
const mesh = gltf.meshes?.[0];
const prim = mesh?.primitives?.[0];
if (prim?.attributes.JOINTS_0 !== undefined && prim.attributes.WEIGHTS_0 !== undefined) {
  const joints = accessor(gltf, bin, prim.attributes.JOINTS_0);
  const weights = accessor(gltf, bin, prim.attributes.WEIGHTS_0);
  for (let v = 0; v < joints.count; v++) {
    for (let k = 0; k < 4; k++) {
      const w = weights.data[v * 4 + k];
      if (w > 0.01) {
        const j = joints.data[v * 4 + k];
        influence.set(j, (influence.get(j) ?? 0) + 1);
      }
    }
  }
}

// Bind world positions via inverse bind matrices (the pose the mesh was skinned in).
const bindWorld = new Map();
if (skin?.inverseBindMatrices !== undefined) {
  const ibm = accessor(gltf, bin, skin.inverseBindMatrices);
  skin.joints.forEach((node, j) => {
    const m = new Matrix4().fromArray(ibm.data.slice(j * 16, j * 16 + 16)).invert();
    bindWorld.set(node, new Vector3().setFromMatrixPosition(m));
  });
}

const rows = [];
const roots = nodes.map((_, i) => i).filter((i) => !parent.has(i));
function walk(i, depth) {
  const node = nodes[i];
  const p = new Vector3();
  const q = new Quaternion();
  const s = new Vector3();
  world[i].decompose(p, q, s);
  const j = jointSet.get(i);
  rows.push({
    index: i,
    depth,
    name: node.name ?? `node_${i}`,
    joint: j ?? null,
    weightedVertices: j === undefined ? 0 : (influence.get(j) ?? 0),
    mesh: node.mesh ?? null,
    skin: node.skin ?? null,
    localT: node.translation ?? null,
    localR: node.rotation ?? null,
    localS: node.scale ?? null,
    worldPos: p.toArray().map((v) => +v.toFixed(4)),
    worldScale: s.toArray().map((v) => +v.toFixed(4)),
    bindPos:
      bindWorld
        .get(i)
        ?.toArray()
        .map((v) => +v.toFixed(4)) ?? null,
  });
  for (const c of node.children ?? []) walk(c, depth + 1);
}
for (const r of roots) walk(r, 0);

if (asJson) {
  console.log(JSON.stringify({ rows, skinJoints: skin?.joints, skeletonRoot: skin?.skeleton }, null, 2));
} else {
  const pos = prim ? accessor(gltf, bin, prim.attributes.POSITION) : null;
  console.log(`file: ${path}`);
  console.log(
    `nodes: ${nodes.length}, skins: ${gltf.skins?.length ?? 0}, skin joints: ${skin?.joints.length ?? 0}`,
  );
  if (pos)
    console.log(`mesh POSITION bounds (mesh-local): min ${pos.min} max ${pos.max}, vertices ${pos.count}`);
  for (const r of rows) {
    const tag = r.joint !== null ? ` [joint ${r.joint}, ${r.weightedVertices} verts]` : '';
    const m = r.mesh !== null ? ` [mesh ${r.mesh}${r.skin !== null ? `, skin ${r.skin}` : ''}]` : '';
    const bind = r.bindPos ? ` bind=${r.bindPos.join(',')}` : '';
    console.log(
      `${'  '.repeat(r.depth)}${r.index}: ${r.name}${tag}${m} world=${r.worldPos.join(',')} s=${r.worldScale.join(',')}${bind}`,
    );
  }
}
