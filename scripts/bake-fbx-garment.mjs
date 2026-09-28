#!/usr/bin/env node
// Bakes an FBX2glTF conversion (Z-up, FBX centimetre units) into the layout the app's garment loader
// expects (the same as the Fab-converted male V-neck): metres, +Y up, one primitive with an opaque
// material, an identity mesh node, and bone bind poses without scale. Skinning is preserved exactly:
// vertices move by T = rotateX(-90°)·scale(100), and each bind pose B becomes [R·rot(B), T·pos(B)].
//
// Usage (see assets/garments/vneck/SOURCE.md):
//   npx -y fbx2gltf@0.9.7-p1 --binary --input <file.fbx> --output <tmp>
//   node scripts/bake-fbx-garment.mjs <tmp>.glb public/garments/3d/<garment>/<name>.glb
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(join(process.cwd(), 'package.json'));
const load = (m) => import(pathToFileURL(require.resolve(m)).href);
const { NodeIO } = await load('@gltf-transform/core');
const three = await load('three');
const { Matrix4, Vector3, Quaternion } = three.Matrix4 ? three : three.default;
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node scripts/bake-fbx-garment.mjs <in.glb> <out.glb>');
const SCALE = 100;
const R = new Matrix4().makeRotationX(-Math.PI / 2);
const T = new Matrix4().multiplyMatrices(R, new Matrix4().makeScale(SCALE, SCALE, SCALE));

const io = new NodeIO();
const doc = await io.read(input);
const root = doc.getRoot();
for (const mesh of root.listMeshes()) {
  const prims = mesh.listPrimitives();
  const main = prims.reduce((a, b) =>
    b.getAttribute('POSITION').getCount() > a.getAttribute('POSITION').getCount() ? b : a,
  );
  for (const p of prims)
    if (p !== main) {
      mesh.removePrimitive(p);
      p.dispose();
    }
  if (main.getAttribute('COLOR_0')) main.setAttribute('COLOR_0', null);
  main.getMaterial()?.setAlphaMode('OPAQUE').setDoubleSided(true);
  const pos = main.getAttribute('POSITION');
  const nor = main.getAttribute('NORMAL');
  const v = new Vector3();
  for (let i = 0; i < pos.getCount(); i++) {
    pos.setElement(i, v.fromArray(pos.getElement(i, [])).applyMatrix4(T).toArray());
    if (nor) nor.setElement(i, v.fromArray(nor.getElement(i, [])).applyMatrix4(R).normalize().toArray());
  }
}
for (const node of root.listNodes())
  if (node.getMesh()) node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
for (const skin of root.listSkins()) {
  // FBX2glTF names a skeleton node that is not the joints' common root (invalid glTF); it is optional.
  skin.setSkeleton(null);
  const ibm = skin.getInverseBindMatrices();
  const m = new Matrix4();
  const t = new Vector3();
  const q = new Quaternion();
  const s = new Vector3();
  for (let i = 0; i < ibm.getCount(); i++) {
    const bind = m.fromArray(ibm.getElement(i, [])).invert(); // bone world at bind (old space)
    bind.decompose(t, q, s);
    t.applyMatrix4(T);
    q.premultiply(new Quaternion().setFromRotationMatrix(R));
    const next = new Matrix4().compose(t, q, new Vector3(1, 1, 1)).invert();
    ibm.setElement(i, next.toArray());
  }
}
await io.write(output, doc);
console.log('wrote', output);
