# Source: "Shirt V-neck with rolled sleeves"

Third-party asset. It is **not** covered by the CC0 licence of the demo shirt art
(`public/garments/LICENSE.md`), and nothing in this repository grants redistribution rights beyond
the licence it was obtained under.

| Field | Value |
| --- | --- |
| Title | Shirt V-neck with rolled sleeves |
| Source URL | https://www.fab.com/listings/c4079e06-cef5-440c-8963-e05fd9462828 |
| Creator / seller | **Not recorded yet.** The downloaded files carry no author metadata, and the listing page could not be read automatically (HTTP 403 on 2026-09-26). Fill this in from the Fab listing or the download receipt. |
| Licence label | **Not recorded yet.** Copy the licence exactly as Fab shows it for this download (for example the Fab Standard License or a Personal licence). Redistribution, hosting on a public kiosk and use in marketing depend on that licence. |
| Obtained | Downloaded by the project owner before 2026-09-26 (files dated 2026-03-13; GLB converted 2026-09-26) |
| Variants used at runtime | Male source model (`SM_Shirt_01_man`, the Fab conversion) and, since 2026-09-28, the female source model (`SM_Shirt_01_woman`, converted here; see "Female variant"). |

## Files and hashes (SHA-256)

Hashes were identical before and after the move (verified 2026-09-26).

| Path | Bytes | SHA-256 | Role |
| --- | --- | --- | --- |
| `public/garments/3d/vneck/shirt-male.glb` | 610,068 | `c6e9cedbf3116f631929872ffb62e0e8ca238155c569abe47b2a8928924da8f5` | Runtime model (served by Vite) |
| `assets/garments/vneck/source/SM_Shirt_01_man.fbx` | 955,724 | `8ad871c5186ae44681c5182ebe88625edbc8c68ed0716c6603dcbf2882dcfcda` | Authoring source (not shipped) |
| `assets/garments/vneck/source/SM_Shirt_01_woman.fbx` | 883,084 | `7d56d364203c4b3cb52676d7b555d5f9d0a597669519319c2a2d917302c02528` | Authoring source (not shipped) |
| `public/garments/3d/vneck/shirt-female.glb` | 999,980 | `4dd55c9b6d557b85ede4b689446f0de9db2c2c7f47ba65d57906dbf1df1b64fd` | Runtime model, female variant (converted and baked, see below) |
| `public/garments/3d/vneck/preview.png`, `preview-female.png` | — | — | Catalogue thumbnails rendered from the GLBs (`npm run generate:3d-thumbnail`) |

## Transformation steps

1. Downloaded from Fab. The files were placed untracked in `tests/cloths/vneck/`: `source.glb`
   (glTF generator string `fab-model-conversion`, a Fab conversion of the male FBX) and the two FBX
   files. The FBX files were written by Blender's FBX exporter ("Blender (stable FBX IO) – 5.0.0").
2. **Moved and renamed. The binary content was not changed:**
   `source.glb` → `public/garments/3d/vneck/shirt-male.glb`, and the FBX files →
   `assets/garments/vneck/source/`. Hashes were checked before and after, and the empty
   `tests/cloths/vneck` and `tests/cloths` directories were removed.
3. Inspected with `npm run inspect:garment` and `npx gltf-transform validate` (0 errors).
   - 130 nodes, 1 mesh, 7,717 vertices, 14,079 triangles.
   - 1 skin with 19 weighted joints.
   - No textures and no animations.
   - Material `M_Shirt_Vneck_rolled`: double-sided, metallic 0, roughness 0.855.
   - Validator notes: a warning that the skinned mesh node is not at the root (harmless), 36 empty
     helper nodes, and an unused `TEXCOORD_0` notice (no texture is attached).
4. **At load time only (in memory; the file is untouched):**
   - Every joint node in the GLB has an identity local transform. The bind pose exists only in the
     inverse bind matrices, so loaded as-is the shirt collapses into a ~35 cm blob. The loader
     rebuilds bone rest transforms from the inverse bind matrices, keeps the full hierarchy, and
     checks that the rest pose reproduces the vertex positions. The measured error is below 0.1 mm.
   - The GLB material is replaced by a neutral fabric material with selectable colours.
5. No simplification, welding, pruning or re-export was applied. The cloth-simulation proxy is
   derived at runtime (`src/physics/proxy.ts`) and never written back.

## Female variant (converted 2026-09-28)

Fab shipped no GLB of the female model, so it was converted from the FBX:

1. `npx -y fbx2gltf@0.9.7-p1 --binary --input assets/garments/vneck/source/SM_Shirt_01_woman.fbx
   --output <tmp>/woman` (FBX2glTF 0.9.7). The result is Z-up in FBX centimetre units, has a second
   50-vertex primitive, vertex colours, a mesh node scaled ×100 and a `skin.skeleton` that is not the
   joints' common root (a glTF validation error).
2. `node scripts/bake-fbx-garment.mjs <tmp>/woman.glb public/garments/3d/vneck/shirt-female.glb`:
   keeps the main primitive (12,966 vertices, 14,007 triangles), drops vertex colours, sets the
   material opaque and double-sided, bakes rotateX(−90°)·scale(100) into the vertices, normals and
   inverse bind matrices (bone bind poses keep unit scale), resets the mesh node and clears
   `skin.skeleton`. Skinning is unchanged: the loader's rest-pose check measures < 0.1 mm.
3. `npx gltf-transform validate`: 0 errors (the same "skinned mesh node is not root" warning as the
   male file). 88 skin joints, the same 19 weighted bones and bone names as the male model, so it
   reuses `VNECK_RIG`; shoulder span 0.354 m (male 0.380 m). Covered by `tests/unit/modelLoader.test.ts`.

The same licence applies as to the male model (see the table above).

## Materials and textures

No fabric texture maps matched this model in the download, so no other shirt's texture has been
substituted. The runtime uses flat, neutral colours (`FABRIC_COLOURS` in
`src/garments/catalogue.ts`). When matching maps become available:

- put them beside the GLB (`public/garments/3d/vneck/`), or embed them in a re-exported GLB;
- load the base colour as sRGB and the normal/roughness maps as linear;
- extend `GarmentMaterialOption` with the map URLs and apply them in
  `applyMaterialOption()` (`src/rendering/three/GarmentRenderer.ts`).

## Future conversions

Keep the FBX files for re-exports, for example a female-variant GLB or baked maps. A new GLB needs
its own entry here with hashes, plus a rig/calibration file in `src/garments/rigs/`.
