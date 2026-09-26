/**
 * Three.js garment renderer. Owns ONE WebGLRenderer on its own offscreen canvas (the visible canvas
 * already owns a 2D context), one scene, one orthographic camera and at most one garment instance.
 * There is no render loop here: MirrorEngine calls `render()` from its existing frame callback.
 *
 * Scene space (see src/fitting/pose3d.ts): X = source px, Y = −source px (up), Z toward camera.
 * The orthographic camera covers exactly [0, sourceWidth] × [−sourceHeight, 0], so the canvas is a
 * source-frame-aligned layer: the compositor draws it with the video's source→canvas transform.
 *
 * GPU resource ownership:
 * - geometry of the skinned mesh: owned by the model cache (shared between instances);
 * - materials, the dynamic cloth mesh geometry, helpers: owned and disposed here;
 * - the WebGL context: released with forceContextLoss() on dispose (Strict Mode remounts).
 */
import {
  AxesHelper,
  Box3,
  Box3Helper,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshPhysicalMaterial,
  NoToneMapping,
  OrthographicCamera,
  Scene,
  SkeletonHelper,
  SRGBColorSpace,
  type Vector3,
  WebGLRenderer,
} from 'three';
import { RENDER_3D } from '../../config/rendering3d';
import { type GarmentRootPlacement, placeGarmentRoot, type SmoothedFit3D } from '../../fitting/fit3d';
import type { UserFitAdjustment } from '../../fitting/garmentFit';
import {
  applyToBones,
  type BoneTransforms,
  createBoneTransforms,
  Retargeter,
  shoulderAnchor,
} from '../../fitting/retargeter';
import { type GarmentInstance, instantiate, type PreparedGarmentModel } from '../../garments/modelLoader';
import type { Garment3DDefinition, GarmentMaterialOption } from '../../garments/types';
import type { Point } from '../matrix';
import { CpuSkinner, computeWeldedNormals, positionWeldGroups } from './cpuSkinning';

export class RendererInitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RendererInitError';
  }
}

/** Optional secondary deformation (cloth mode). Works in rig-root space, metres. */
export interface GarmentDeformer {
  /**
   * Adds displacement to `positions` (already CPU-skinned). Returns false to render plain skeletal
   * deformation this frame (e.g. simulation reset or unstable).
   */
  deform(input: {
    skinner: CpuSkinner;
    positions: Float32Array;
    bones: BoneTransforms;
    placement: GarmentRootPlacement;
  }): boolean;
}

export interface RenderGarmentInput {
  sourceWidth: number;
  sourceHeight: number;
  /** Backing-store size to render at (same aspect as the source). */
  renderWidth: number;
  renderHeight: number;
  fit: SmoothedFit3D;
  user: UserFitAdjustment;
  deformer: GarmentDeformer | null;
}

export interface RenderGarmentResult {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  placement: GarmentRootPlacement;
  /** Garment shoulder bone heads projected to source px (registration overlay). */
  shoulders: { left: Point; right: Point };
  mode: 'skeletal' | 'cloth';
  renderMs: number;
}

interface ActiveGarment {
  definition: Garment3DDefinition;
  model: PreparedGarmentModel;
  instance: GarmentInstance;
  material: MeshPhysicalMaterial;
  retargeter: Retargeter;
  bones: BoneTransforms;
  cloth: {
    mesh: Mesh;
    geometry: BufferGeometry;
    positions: Float32Array;
    normals: Float32Array;
    skinner: CpuSkinner;
    groups: Uint32Array;
    groupCount: number;
    scratch: Float32Array;
  } | null;
}

export class GarmentRenderer {
  readonly canvas: HTMLCanvasElement;
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new OrthographicCamera(0, 1, 0, -1, 1, 200_000);
  private garmentRoot = new Group();
  private active: ActiveGarment | null = null;
  private helpers: { group: Group; skeleton: SkeletonHelper } | null = null;
  private helpersOn = false;
  private size = { width: 0, height: 0 };
  private disposed = false;
  contextLost = false;
  onContextChange: ((lost: boolean) => void) | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.addEventListener('webglcontextlost', this.onLost, false);
    this.canvas.addEventListener('webglcontextrestored', this.onRestored, false);
    try {
      this.renderer = new WebGLRenderer({
        canvas: this.canvas,
        alpha: true,
        premultipliedAlpha: true,
        antialias: RENDER_3D.antialias,
        powerPreference: 'high-performance',
        // Not needed: the canvas is read by drawImage() in the same task, right after render().
        preserveDrawingBuffer: false,
      });
    } catch (error) {
      throw new RendererInitError(
        `WebGL could not start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = SRGBColorSpace;
    // The video is drawn by the 2D canvas and never passes through this renderer; the garment gets
    // no filmic tone mapping either, so fabric colours stay as specified.
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.shadowMap.enabled = false;

    const l = RENDER_3D.lights;
    this.scene.add(
      new HemisphereLight(
        new Color(l.hemisphere.sky),
        new Color(l.hemisphere.ground),
        l.hemisphere.intensity,
      ),
    );
    const key = new DirectionalLight(new Color(l.key.color), l.key.intensity);
    key.position.set(...l.key.direction);
    const fill = new DirectionalLight(new Color(l.fill.color), l.fill.intensity);
    fill.position.set(...l.fill.direction);
    this.scene.add(key, key.target, fill, fill.target);
    this.scene.add(this.garmentRoot);
    this.camera.position.set(0, 0, 100_000);
  }

  private onLost = (event: Event) => {
    event.preventDefault(); // allow restoration
    this.contextLost = true;
    this.onContextChange?.(true);
  };

  private onRestored = () => {
    this.contextLost = false;
    this.onContextChange?.(false);
  };

  get garmentId(): string | null {
    return this.active?.definition.id ?? null;
  }

  get triangles(): number {
    return this.active?.model.stats.triangles ?? 0;
  }

  /** Replaces the current garment instance (the previous one's materials/meshes are released). */
  setGarment(
    definition: Garment3DDefinition,
    model: PreparedGarmentModel,
    material: GarmentMaterialOption,
  ): void {
    this.releaseActive();
    const instance = instantiate(model);
    const mat = new MeshPhysicalMaterial({ side: DoubleSide, metalness: 0 });
    applyMaterialOption(mat, material);
    instance.mesh.material = mat;
    this.garmentRoot.add(instance.root);
    this.active = {
      definition,
      model,
      instance,
      material: mat,
      retargeter: new Retargeter(model.rig, definition.rig),
      bones: createBoneTransforms(model.rig),
      cloth: null,
    };
    if (this.helpersOn) this.setDebugHelpers(true);
  }

  setMaterial(option: GarmentMaterialOption): void {
    if (this.active) applyMaterialOption(this.active.material, option);
  }

  /** Development inspection: skeleton, axes and bounding box of the garment. */
  setDebugHelpers(on: boolean): void {
    this.helpersOn = on;
    if (this.helpers) {
      this.garmentRoot.remove(this.helpers.group);
      this.scene.remove(this.helpers.skeleton);
      for (const o of [...this.helpers.group.children, this.helpers.skeleton]) {
        const m = o as unknown as { geometry?: BufferGeometry; material?: { dispose(): void } };
        m.geometry?.dispose();
        m.material?.dispose();
      }
      this.helpers = null;
    }
    if (!on || !this.active) return;
    // Axes and rest bounding box live in rest space under the garment root (scaled with it); the
    // skeleton helper reads bone world matrices itself, so it is added at scene level.
    const group = new Group();
    const box = new Box3().setFromBufferAttribute(
      this.active.model.geometry.getAttribute('position') as BufferAttribute,
    );
    const axes = new AxesHelper(0.25);
    axes.position.copy(this.active.model.rig.shoulderMid); // origin is at floor level: show at the shoulders
    group.add(axes, new Box3Helper(box, new Color('#f0c040')));
    this.garmentRoot.add(group);
    const skeleton = new SkeletonHelper(this.active.instance.root);
    this.scene.add(skeleton);
    this.helpers = { group, skeleton };
  }

  /**
   * Poses and renders the garment. Returns null when nothing can be drawn (no garment, lost
   * context). Never throws for per-frame problems; the caller keeps drawing the video.
   */
  render(input: RenderGarmentInput): RenderGarmentResult | null {
    const a = this.active;
    if (!a || this.disposed || this.contextLost) return null;
    const started = performance.now();
    const w = Math.max(1, Math.round(input.renderWidth));
    const h = Math.max(1, Math.round(input.renderHeight));
    if (w !== this.size.width || h !== this.size.height) {
      this.renderer.setSize(w, h, false);
      this.size = { width: w, height: h };
    }
    this.camera.left = 0;
    this.camera.right = input.sourceWidth;
    this.camera.top = 0;
    this.camera.bottom = -input.sourceHeight;
    this.camera.updateProjectionMatrix();

    // 1. Bones from the tracked pose (fresh from bind data every frame).
    a.retargeter.solve(input.fit.pose, a.bones);
    applyToBones(a.instance.bones, a.bones);
    const anchor = shoulderAnchor(a.model.rig, a.bones);
    const placement = placeGarmentRoot(input.fit, anchor.mid, a.model.rig, a.definition.rig, input.user);
    this.garmentRoot.position.copy(placement.position);
    this.garmentRoot.scale.setScalar(placement.scale);
    this.garmentRoot.updateMatrixWorld(true);

    // 2. Optional cloth displacement on CPU-skinned vertices (no double skinning).
    let mode: RenderGarmentResult['mode'] = 'skeletal';
    if (input.deformer) {
      const cloth = this.ensureCloth(a);
      cloth.skinner.updateMatrices(a.instance.root.matrixWorld);
      cloth.skinner.skin(cloth.positions, null);
      const ok = input.deformer.deform({
        skinner: cloth.skinner,
        positions: cloth.positions,
        bones: a.bones,
        placement,
      });
      if (ok) {
        const index = a.model.geometry.getIndex()?.array as ArrayLike<number>;
        computeWeldedNormals(
          cloth.positions,
          index,
          cloth.groups,
          cloth.groupCount,
          cloth.scratch,
          cloth.normals,
        );
        (cloth.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
        (cloth.geometry.getAttribute('normal') as BufferAttribute).needsUpdate = true;
        mode = 'cloth';
      }
    }
    a.instance.mesh.visible = mode === 'skeletal';
    if (a.cloth) a.cloth.mesh.visible = mode === 'cloth';

    this.renderer.render(this.scene, this.camera);

    const toPx = (v: Vector3) => ({
      x: placement.position.x + placement.scale * v.x,
      y: -(placement.position.y + placement.scale * v.y),
    });
    const rig = a.model.rig;
    return {
      canvas: this.canvas,
      placement,
      shoulders: {
        left: toPx(a.bones.worldPosition[rig.roles.upperArm.left] as Vector3),
        right: toPx(a.bones.worldPosition[rig.roles.upperArm.right] as Vector3),
      },
      mode,
      renderMs: performance.now() - started,
    };
  }

  private ensureCloth(a: ActiveGarment): NonNullable<ActiveGarment['cloth']> {
    if (a.cloth) return a.cloth;
    const src = a.model.geometry;
    const count = src.getAttribute('position').count;
    const geometry = new BufferGeometry();
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    geometry.setAttribute(
      'position',
      new BufferAttribute(positions, 3).setUsage(35048 /* DynamicDrawUsage */),
    );
    geometry.setAttribute('normal', new BufferAttribute(normals, 3).setUsage(35048));
    const uv = src.getAttribute('uv');
    if (uv) geometry.setAttribute('uv', uv);
    const index = src.getIndex();
    if (index) geometry.setIndex(index);
    const mesh = new Mesh(geometry, a.material);
    mesh.frustumCulled = false;
    mesh.visible = false;
    a.instance.root.add(mesh); // rig-root space: same transform as the skinned result
    const skinner = new CpuSkinner(
      src,
      a.instance.mesh.skeleton.bones,
      a.instance.mesh.skeleton.boneInverses,
    );
    const rest = src.getAttribute('position').array as Float32Array;
    const groups = positionWeldGroups(rest, count);
    let groupCount = 0;
    for (const g of groups) groupCount = Math.max(groupCount, g + 1);
    a.cloth = {
      mesh,
      geometry,
      positions,
      normals,
      skinner,
      groups,
      groupCount,
      scratch: new Float32Array(groupCount * 3),
    };
    return a.cloth;
  }

  /** The active instance (inspection view / physics setup). */
  get instance(): GarmentInstance | null {
    return this.active?.instance ?? null;
  }

  get model(): PreparedGarmentModel | null {
    return this.active?.model ?? null;
  }

  private releaseActive(): void {
    const a = this.active;
    if (!a) return;
    const helpersOn = this.helpersOn;
    this.setDebugHelpers(false);
    this.helpersOn = helpersOn;
    this.garmentRoot.remove(a.instance.root);
    a.material.dispose();
    if (a.cloth) {
      // Index/uv attributes belong to the shared model geometry; only this geometry's own GPU
      // buffers are released here.
      a.cloth.geometry.dispose();
    }
    this.active = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseActive();
    this.canvas.removeEventListener('webglcontextlost', this.onLost, false);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored, false);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

function applyMaterialOption(mat: MeshPhysicalMaterial, option: GarmentMaterialOption): void {
  mat.color.set(option.color); // sRGB hex → linear working space (three.js colour management)
  mat.roughness = option.roughness;
  mat.metalness = 0;
  mat.sheen = option.sheen;
  mat.sheenRoughness = 0.85;
  mat.sheenColor.set('#ffffff');
  mat.needsUpdate = true;
}
