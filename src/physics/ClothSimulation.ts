/**
 * Experimental cloth mode: bounded secondary motion ON TOP of skeletal tracking.
 *
 * Tracking (retargeted bones) stays the motion driver. Each rendered frame:
 * 1. the renderer poses the bones and CPU-skins the render vertices (no GPU skinning in this mode);
 * 2. this class advances a FIXED-STEP solver toward the new skinned targets, interpolating the joint
 *    matrices and body colliders from the previous frame's values across substeps;
 * 3. the per-particle displacement (simulated − skinned target, same space) is mapped onto the
 *    render vertices and ADDED to their skinned positions. Vertices are never skinned twice.
 *
 * Clock: the simulation follows the displayed MEDIA time (so 0.5× playback gives slow-motion
 * fabric consistent with the slowed person; a camera's media time runs in real time). Paused video
 * freezes the solver. Backward jumps, seeks, gaps over `MAX_FRAME_GAP_S`, reacquisitions and garment
 * changes reset the fabric onto the current skinned pose instead of catching up. At most
 * `maxSubsteps` fixed steps run per frame; extra time is dropped and reported.
 *
 * Safety: NaNs, particles far beyond their allowed deviation, runaway stretch or deep collider
 * penetration trigger a reset (reason recorded). Sustained solver overload first reduces work, then
 * disables the cloth layer while skeletal motion continues.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import { RollingStats } from '../app/metrics';
import type { BoneTransforms } from '../fitting/retargeter';
import type { PreparedGarmentModel } from '../garments/modelLoader';
import type { Garment3DDefinition, GarmentSimulationConfig } from '../garments/types';
import type { CpuSkinner } from '../rendering/three/cpuSkinning';
import type { GarmentDeformer } from '../rendering/three/GarmentRenderer';
import { type Capsule, capsuleDistance, capsulePose, computeColliders } from './bodyColliders';
import { type CapsuleState, type Jolt, JoltClothWorld } from './joltCloth';
import { buildClothProxy, type ClothProxy } from './proxy';
import { type ClothStats, type ClothTuning, DEFAULT_CLOTH_STATS } from './types';

/** Longer gaps between frames (media time) reset the fabric instead of catching up. */
export const MAX_FRAME_GAP_S = 0.25;
/** Overload policy (median solver ms per frame over the recent window). */
export const BUDGET = { degradeMs: 6, disableMs: 10, windowFrames: 45 } as const;

export function defaultTuning(sim: GarmentSimulationConfig): ClothTuning {
  return {
    deviationScale: 1,
    stretchCompliance: sim.stretchCompliance,
    bendCompliance: sim.bendCompliance,
    linearDamping: sim.linearDamping,
    iterations: sim.iterations,
    gravityFactor: sim.gravityFactor,
    fixedStep: 1 / 60,
    maxSubsteps: 3,
    colliders: true,
  };
}

export function buildProxyForModel(model: PreparedGarmentModel, sim: GarmentSimulationConfig): ClothProxy {
  const g = model.geometry;
  const rig = model.rig;
  const at = (i: number | null) => {
    const b = i === null ? undefined : rig.bones[i];
    if (!b) throw new Error('Rig bone for the cloth anchor line is missing');
    return [b.bindPosition.x, b.bindPosition.y, b.bindPosition.z] as const;
  };
  // Body region per skin joint: the upper arm and everything below it in the rig (twist joints,
  // lower arm) is an arm region; all other joints are torso.
  const regionOfRigBone = rig.bones.map((_, i) => {
    for (let b = i; b >= 0; b = rig.bones[b]?.parent ?? -1) {
      if (b === rig.roles.upperArm.left) return 1;
      if (b === rig.roles.upperArm.right) return 2;
    }
    return 0;
  });
  const regionByName = new Map(rig.bones.map((b, i) => [b.name, regionOfRigBone[i] ?? 0]));
  let jointNames: string[] = [];
  model.template.traverse((o) => {
    const mesh = o as unknown as { isSkinnedMesh?: boolean; skeleton?: { bones: Array<{ name: string }> } };
    if (mesh.isSkinnedMesh && mesh.skeleton) jointNames = mesh.skeleton.bones.map((b) => b.name);
  });
  const jointRegion = jointNames.map((name) => regionByName.get(name) ?? 0);
  return buildClothProxy({
    jointRegion,
    positions: g.getAttribute('position').array,
    normals: g.getAttribute('normal').array,
    index: g.getIndex()?.array ?? [],
    skinIndex: g.getAttribute('skinIndex').array,
    skinWeight: g.getAttribute('skinWeight').array,
    vertexCount: g.getAttribute('position').count,
    anchorLine: [
      at(rig.roles.upperArm.left),
      at(rig.roles.neck ?? rig.roles.spine.at(-1) ?? null),
      at(rig.roles.upperArm.right),
    ],
    config: sim,
  });
}

interface Decomposed {
  p: Vector3;
  q: Quaternion;
  s: Vector3;
}

export interface ClothOptions {
  definition: Garment3DDefinition;
  model: PreparedGarmentModel;
  boneCount: number;
}

let joltPromise: Promise<Jolt> | null = null;

/** Loads the single-threaded WASM build from a local, Vite-resolved URL (no CDN). */
async function loadJolt(): Promise<Jolt> {
  if (!joltPromise) {
    joltPromise = import('./joltLoader').then((m) => m.loadJoltWasm());
    joltPromise.catch(() => {
      joltPromise = null;
    });
  }
  return joltPromise;
}

export class ClothSimulation implements GarmentDeformer {
  readonly proxy: ClothProxy;
  tuning: ClothTuning;
  private world: JoltClothWorld;
  private readonly sim: GarmentSimulationConfig;
  private readonly rig: PreparedGarmentModel['rig'];
  private readonly n: number;
  // Buffers (allocated once).
  private simPos: Float32Array;
  private target: Float32Array;
  private disp: Float32Array;
  private prevMats: Decomposed[];
  private curMats: Decomposed[];
  private interp: Float32Array;
  private m = new Matrix4();
  private prevCapsules: Capsule[] = [];
  private curCapsules: Capsule[] = [];
  private capsuleStates: CapsuleState[];
  // Clock.
  private accumulator = 0;
  private lastMediaMs: number | null = null;
  private frozen = false;
  private needsReset = true;
  private pendingReason: string | null = 'start';
  // Stats.
  private stepStats = new RollingStats(BUDGET.windowFrames);
  private mapStats = new RollingStats(60);
  private overloadFrames = 0;
  private state: ClothStats['state'] = 'settling';
  private substepsLast = 0;
  private droppedMs = 0;
  private resets = 0;
  private lastReason: string | null = null;
  private maxDev = 0;
  private maxStretch = 1;
  private stretchP99 = 1;
  private stretchScratch: Float32Array = new Float32Array(0);
  private message: string | null = null;
  private disposed = false;

  static async create(options: ClothOptions): Promise<ClothSimulation> {
    return ClothSimulation.createWith(await loadJolt(), options);
  }

  /** Dependency-injected construction (tests use the Node-compatible Jolt build). */
  static createWith(J: Jolt, options: ClothOptions): ClothSimulation {
    const sim = options.definition.simulation;
    if (!sim) throw new Error(`${options.definition.name} has no simulation config`);
    return new ClothSimulation(J, options, sim);
  }

  private constructor(
    private readonly J: Jolt,
    private readonly options: ClothOptions,
    sim: GarmentSimulationConfig,
  ) {
    this.sim = sim;
    this.rig = options.model.rig;
    this.tuning = defaultTuning(sim);
    this.proxy = buildProxyForModel(options.model, sim);
    this.n = this.proxy.particleCount;
    this.simPos = new Float32Array(this.n * 3);
    this.target = new Float32Array(this.n * 3);
    this.disp = new Float32Array(this.n * 3);
    const dec = () => ({ p: new Vector3(), q: new Quaternion(), s: new Vector3(1, 1, 1) });
    this.prevMats = Array.from({ length: options.boneCount }, dec);
    this.curMats = Array.from({ length: options.boneCount }, dec);
    this.interp = new Float32Array(options.boneCount * 16);
    this.capsuleStates = Array.from({ length: 4 }, () => ({
      center: new Vector3(),
      rotation: new Quaternion(),
      halfHeight: 0.1,
      radius: 0.05,
    }));
    this.world = this.createWorld(this.initialCapsules());
  }

  /** Capsule shapes are sized from the bind pose (bone lengths are rigid in the retargeter). */
  private initialCapsules(): CapsuleState[] {
    const rig = this.rig;
    const bones = {
      worldPosition: rig.bones.map((b) => b.bindPosition.clone()),
      worldQuaternion: rig.bones.map((b) => b.bindQuaternion.clone()),
    } as unknown as BoneTransforms;
    computeColliders(rig, bones, this.sim.colliders, this.curCapsules);
    this.curCapsules.forEach((c, i) => {
      const s = this.capsuleStates[i] as CapsuleState;
      s.halfHeight = capsulePose(c, s.center, s.rotation);
      s.radius = c.radius;
    });
    return this.capsuleStates;
  }

  private createWorld(capsules: CapsuleState[]): JoltClothWorld {
    return new JoltClothWorld(
      this.J,
      this.proxy,
      this.options.boneCount,
      this.tuning,
      this.tuning.deviationScale,
      this.tuning.colliders ? capsules : [],
      this.sim.vertexRadius,
    );
  }

  get stats(): ClothStats {
    return {
      ...DEFAULT_CLOTH_STATS,
      state: this.state,
      engine: 'Jolt 1.1.0 (WASM, 1 thread)',
      particles: this.n,
      edges: this.proxy.edges.length / 2,
      colliders: this.tuning.colliders ? 4 : 0,
      stepMs: { median: this.stepStats.percentile(0.5), p95: this.stepStats.percentile(0.95) },
      mapMs: this.mapStats.percentile(0.5),
      substepsLastFrame: this.substepsLast,
      droppedTimeMs: this.droppedMs,
      resets: this.resets,
      lastResetReason: this.lastReason,
      maxDeviationM: this.maxDev,
      maxStretch: this.maxStretch,
      stretchP99: this.stretchP99,
      message: this.message,
    };
  }

  setTuning(patch: Partial<ClothTuning>): void {
    const prev = this.tuning;
    this.tuning = { ...prev, ...patch };
    const rebuild =
      patch.stretchCompliance !== undefined ||
      patch.bendCompliance !== undefined ||
      patch.linearDamping !== undefined ||
      patch.gravityFactor !== undefined ||
      patch.colliders !== undefined;
    if (rebuild) {
      this.world.dispose();
      this.world = this.createWorld(this.capsuleStates);
      this.reset('tuning');
    } else {
      this.world.setMaxDistanceScale(this.tuning.deviationScale);
      this.world.setIterations(this.tuning.iterations);
    }
    if (this.state === 'disabled' || this.state === 'degraded') {
      this.state = 'settling';
      this.overloadFrames = 0;
      this.message = null;
    }
  }

  /** Forget motion; the next frame snaps the fabric onto the skinned pose. */
  reset(reason: string): void {
    this.needsReset = true;
    this.pendingReason = reason;
    this.accumulator = 0;
    this.lastMediaMs = null;
  }

  /**
   * Advances the simulation clock from the displayed frame's media time. Call once per rendered
   * frame before `deform`.
   */
  advanceClock(mediaTimeMs: number | null, playing: boolean, wallNowMs: number): void {
    const now = mediaTimeMs ?? wallNowMs;
    if (!playing) {
      this.frozen = true;
      this.lastMediaMs = now;
      return;
    }
    this.frozen = false;
    if (this.lastMediaMs === null) {
      this.lastMediaMs = now;
      return;
    }
    const dt = (now - this.lastMediaMs) / 1000;
    this.lastMediaMs = now;
    if (dt < 0) {
      this.reset('time went backwards (seek/loop)');
      return;
    }
    if (dt > MAX_FRAME_GAP_S) {
      this.reset(`frame gap ${(dt * 1000).toFixed(0)} ms (hidden tab / stall)`);
      return;
    }
    this.accumulator += dt;
  }

  deform(input: { skinner: CpuSkinner; positions: Float32Array; bones: BoneTransforms }): boolean {
    if (this.disposed || this.state === 'disabled') return false;
    const started = performance.now();
    const mats = input.skinner.currentMatrices;
    this.decompose(mats, this.curMats);
    computeColliders(this.rig, input.bones, this.sim.colliders, this.curCapsules);

    if (this.needsReset) {
      this.hardReset(mats);
      this.state = 'settling';
    }

    // Fixed steps with interpolated targets; excess time is dropped (never caught up).
    const h = this.tuning.fixedStep;
    // Epsilon: 1/60 s of media time must count as exactly one 1/60 s step despite rounding.
    let steps = Math.floor(this.accumulator / h + 1e-6);
    if (steps > this.tuning.maxSubsteps) {
      this.droppedMs += (this.accumulator - this.tuning.maxSubsteps * h) * 1000;
      steps = this.tuning.maxSubsteps;
      this.accumulator = 0;
    } else {
      this.accumulator -= steps * h;
    }
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      this.interpolateMatrices(t);
      this.world.setJointMatrices(this.interp);
      this.world.skin(false);
      if (this.tuning.colliders) this.world.moveCapsules(this.interpolateCapsules(t), h, false);
      this.world.step(h);
    }
    this.substepsLast = steps;
    if (steps > 0 && !this.frozen) this.state = this.state === 'degraded' ? 'degraded' : 'running';
    if (this.frozen) this.state = 'frozen';
    const stepMs = performance.now() - started;
    const mapStart = performance.now();
    if (steps === 0) {
      // No solver step this frame (paused, or less than one fixed step of media time): the solver's
      // targets are still last frame's, so keep last frame's displacement on the new skinned pose.
      // History is not advanced, so the next step interpolates from the last stepped pose.
      this.applyToRender(input.positions);
      this.mapStats.push(performance.now() - mapStart);
      return true;
    }
    this.swapHistory();

    // Read back, compute displacement against the JS-skinned targets (same matrices).
    this.world.readPositions(this.simPos);
    this.skinTargets(input.skinner);
    const verdict = this.checkAndDisplace();
    if (verdict) {
      this.reset(verdict);
      return false;
    }
    this.applyToRender(input.positions);
    this.mapStats.push(performance.now() - mapStart);
    if (steps > 0) this.trackLoad(stepMs);
    return true;
  }

  private hardReset(mats: Float32Array): void {
    this.world.setJointMatrices(mats);
    this.world.skin(true);
    this.curCapsules.forEach((c, i) => {
      const s = this.capsuleStates[i] as CapsuleState;
      capsulePose(c, s.center, s.rotation);
    });
    if (this.tuning.colliders) this.world.moveCapsules(this.capsuleStates, this.tuning.fixedStep, true);
    this.copyDecomposed(this.curMats, this.prevMats);
    this.prevCapsules = this.curCapsules.map((c) => ({ a: c.a.clone(), b: c.b.clone(), radius: c.radius }));
    this.disp.fill(0);
    this.accumulator = 0;
    this.needsReset = false;
    this.resets++;
    this.lastReason = this.pendingReason;
    this.pendingReason = null;
  }

  private decompose(mats: Float32Array, out: Decomposed[]): void {
    for (let j = 0; j < out.length; j++) {
      const d = out[j] as Decomposed;
      this.m.fromArray(mats, j * 16).decompose(d.p, d.q, d.s);
    }
  }

  private copyDecomposed(from: Decomposed[], to: Decomposed[]): void {
    for (let j = 0; j < from.length; j++) {
      const a = from[j] as Decomposed;
      const b = to[j] as Decomposed;
      b.p.copy(a.p);
      b.q.copy(a.q);
      b.s.copy(a.s);
    }
  }

  private tmpP = new Vector3();
  private tmpQ = new Quaternion();
  private tmpS = new Vector3();

  private interpolateMatrices(t: number): void {
    for (let j = 0; j < this.curMats.length; j++) {
      const a = this.prevMats[j] as Decomposed;
      const b = this.curMats[j] as Decomposed;
      this.tmpP.lerpVectors(a.p, b.p, t);
      this.tmpQ.slerpQuaternions(a.q, b.q, t);
      this.tmpS.lerpVectors(a.s, b.s, t);
      this.m.compose(this.tmpP, this.tmpQ, this.tmpS).toArray(this.interp, j * 16);
    }
  }

  private interpolateCapsules(t: number): CapsuleState[] {
    this.curCapsules.forEach((c, i) => {
      const p = this.prevCapsules[i] ?? c;
      const s = this.capsuleStates[i] as CapsuleState;
      const a = this.tmpP.lerpVectors(p.a, c.a, t).clone();
      const b = this.tmpS.lerpVectors(p.b, c.b, t).clone();
      capsulePose({ a, b, radius: c.radius }, s.center, s.rotation);
    });
    return this.capsuleStates;
  }

  private swapHistory(): void {
    this.copyDecomposed(this.curMats, this.prevMats);
    this.curCapsules.forEach((c, i) => {
      const p = this.prevCapsules[i];
      if (p) {
        p.a.copy(c.a);
        p.b.copy(c.b);
        p.radius = c.radius;
      } else this.prevCapsules[i] = { a: c.a.clone(), b: c.b.clone(), radius: c.radius };
    });
  }

  private skinTargets(skinner: CpuSkinner): void {
    const { rest, joints, weights } = this.proxy;
    for (let p = 0; p < this.n; p++) {
      skinner.skinPoint(
        rest.subarray(p * 3, p * 3 + 3),
        joints.subarray(p * 4, p * 4 + 4),
        weights.subarray(p * 4, p * 4 + 4),
        this.target,
        p * 3,
      );
    }
  }

  /** Displacement + stability checks. Returns a reset reason, or null when healthy. */
  private checkAndDisplace(): string | null {
    const scale = this.tuning.deviationScale;
    let maxDev = 0;
    let violations = 0;
    let deep = 0;
    for (let p = 0; p < this.n; p++) {
      const dx = (this.simPos[p * 3] as number) - (this.target[p * 3] as number);
      const dy = (this.simPos[p * 3 + 1] as number) - (this.target[p * 3 + 1] as number);
      const dz = (this.simPos[p * 3 + 2] as number) - (this.target[p * 3 + 2] as number);
      if (!Number.isFinite(dx + dy + dz)) return 'non-finite particle position';
      let d = Math.hypot(dx, dy, dz);
      const allowed = (this.proxy.maxDistance[p] as number) * scale;
      if (d > allowed * 2 + 0.04) violations++;
      // Never render more than the allowed deviation (+2 cm slack for collision pushes).
      const limit = allowed + 0.02;
      const k = d > limit ? limit / d : 1;
      if (k < 1) d = limit;
      this.disp[p * 3] = dx * k;
      this.disp[p * 3 + 1] = dy * k;
      this.disp[p * 3 + 2] = dz * k;
      maxDev = Math.max(maxDev, d);
      if (this.tuning.colliders) {
        for (const c of this.curCapsules) {
          if (
            capsuleDistance(
              c,
              this.simPos[p * 3] as number,
              this.simPos[p * 3 + 1] as number,
              this.simPos[p * 3 + 2] as number,
            ) < -0.03
          ) {
            deep++;
            break;
          }
        }
      }
    }
    this.maxDev = maxDev;
    // Brief lag during very fast limb motion is absorbed by the render clamp above; only a large
    // share of particles far beyond their limit (a genuinely unstable state) triggers a reset.
    if (violations > this.n * 0.15) return `diverged (${violations} particles beyond their limit)`;
    if (deep > this.n * 0.1) return `deep collider penetration (${deep} particles)`;
    // Rubbery stretch: a FREE edge longer than both its fabric rest length and its skinned length.
    // (Edges between pinned particles follow linear-blend skinning, which is not the solver's doing.)
    let maxStretch = 1;
    let stretched = 0;
    let counted = 0;
    const e = this.proxy.edges;
    if (this.stretchScratch.length < e.length / 2) this.stretchScratch = new Float32Array(e.length / 2);
    const rest = this.proxy.rest;
    const inv = this.proxy.invMass;
    for (let i = 0; i < e.length; i += 2) {
      if (inv[e[i] as number] === 0 && inv[e[i + 1] as number] === 0) continue;
      const a = (e[i] as number) * 3;
      const b = (e[i + 1] as number) * 3;
      const r = Math.hypot(
        (rest[a] as number) - (rest[b] as number),
        (rest[a + 1] as number) - (rest[b + 1] as number),
        (rest[a + 2] as number) - (rest[b + 2] as number),
      );
      const t0 = Math.hypot(
        (this.target[a] as number) - (this.target[b] as number),
        (this.target[a + 1] as number) - (this.target[b + 1] as number),
        (this.target[a + 2] as number) - (this.target[b + 2] as number),
      );
      const t = Math.max(r, t0);
      if (t < 1e-4) continue;
      const s =
        Math.hypot(
          (this.simPos[a] as number) - (this.simPos[b] as number),
          (this.simPos[a + 1] as number) - (this.simPos[b + 1] as number),
          (this.simPos[a + 2] as number) - (this.simPos[b + 2] as number),
        ) / t;
      if (s > maxStretch) maxStretch = s;
      if (s > 1.5) stretched++;
      this.stretchScratch[counted++] = s;
    }
    this.maxStretch = maxStretch;
    const sorted = this.stretchScratch.subarray(0, counted).sort();
    this.stretchP99 = counted > 0 ? (sorted[Math.floor(counted * 0.99)] as number) : 1;
    if (stretched > (e.length / 2) * 0.03) return `excessive stretch (${stretched} edges > 1.5×)`;
    return null;
  }

  private applyToRender(positions: Float32Array): void {
    const { mapParticles: mp, mapWeights: mw } = this.proxy;
    const count = positions.length / 3;
    for (let v = 0; v < count; v++) {
      let x = 0;
      let y = 0;
      let z = 0;
      for (let k = 0; k < 4; k++) {
        const w = mw[v * 4 + k] as number;
        if (w === 0) continue;
        const p = (mp[v * 4 + k] as number) * 3;
        x += w * (this.disp[p] as number);
        y += w * (this.disp[p + 1] as number);
        z += w * (this.disp[p + 2] as number);
      }
      positions[v * 3] = (positions[v * 3] as number) + x;
      positions[v * 3 + 1] = (positions[v * 3 + 1] as number) + y;
      positions[v * 3 + 2] = (positions[v * 3 + 2] as number) + z;
    }
  }

  private trackLoad(stepMs: number): void {
    this.stepStats.push(stepMs);
    const median = this.stepStats.count >= BUDGET.windowFrames ? (this.stepStats.percentile(0.5) ?? 0) : 0;
    if (median > BUDGET.disableMs && this.state === 'degraded') {
      this.overloadFrames++;
      if (this.overloadFrames > BUDGET.windowFrames) {
        this.state = 'disabled';
        this.message = `Cloth disabled: solver took ${median.toFixed(1)} ms/frame (budget ${BUDGET.disableMs} ms). Skeletal motion continues.`;
      }
    } else if (median > BUDGET.degradeMs && this.state !== 'degraded') {
      this.state = 'degraded';
      this.tuning = { ...this.tuning, maxSubsteps: 1, iterations: Math.max(3, this.tuning.iterations - 2) };
      this.world.setIterations(this.tuning.iterations);
      this.message = `Reduced cloth quality: solver took ${median.toFixed(1)} ms/frame.`;
      this.stepStats.reset();
      this.overloadFrames = 0;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.world.dispose();
  }
}
