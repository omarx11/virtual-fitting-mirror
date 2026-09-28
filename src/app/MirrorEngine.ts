/**
 * MirrorEngine: the non-React core. Owns the frame source, inference backend + scheduler,
 * interpretation, smoothing and rendering. High-frequency data (frames, landmarks, poses) never
 * enters React state; the UI subscribes to low-rate snapshots.
 */

import { type CapturedImage, captureVideoFrame } from '../ai/capture';
import {
  DEFAULT_PRESET,
  type DelegatePreference,
  MAIN_THREAD_FALLBACK_HZ,
  QUALITY_PRESETS,
  type QualityPreset,
  UI_UPDATE_HZ,
} from '../config/performance';
import { RENDER_3D } from '../config/rendering3d';
import { TRACKING_CONFIG, trackingConfigFor3D } from '../config/tracking';
import { BodyEstimator3D, defaultSmootherParams, Fit3DSmoother, type SmoothedFit3D } from '../fitting/fit3d';
import {
  clampUserFit,
  computeGarmentPlacement,
  DEFAULT_USER_FIT,
  type UserFitAdjustment,
} from '../fitting/garmentFit';
import {
  type InterpretationDiagnostics,
  type TorsoEstimate,
  TrackingInterpreter,
  type TrackingPhase,
} from '../fitting/interpreter';
import { type PoseObservation, toObservation } from '../fitting/observation';
import { type ForearmCutout, forearmCutouts } from '../fitting/occlusion';
import { type GarmentPose, PoseSmoother } from '../fitting/smoother';
import { DEFAULT_GARMENT_ID, findGarment, findMaterial, GARMENTS, isGarment3D } from '../garments/catalogue';
import { GarmentLibrary } from '../garments/loader';
import { GarmentModelCache, type PreparedGarmentModel } from '../garments/modelLoader';
import type { Garment2DDefinition, Garment3DDefinition } from '../garments/types';
import { CameraSource } from '../media/cameraSource';
import { type FrameInfo, FrameLoop } from '../media/frameLoop';
import { type FrameSource, SourceError, type SourceErrorKind, type SourceKind } from '../media/frameSource';
import { VideoFileSource } from '../media/videoFileSource';
import type { ClothSimulation } from '../physics/ClothSimulation';
import { type ClothStats, type ClothTuning, DEFAULT_CLOTH_STATS, type MotionMode } from '../physics/types';
import { drawFrame } from '../rendering/compositor';
import type { Point } from '../rendering/matrix';
import { GarmentRenderer, RendererInitError } from '../rendering/three/GarmentRenderer';
import { computeViewTransform, type FitMode, type ViewTransform } from '../rendering/viewTransform';
import { type BackendKind, MainThreadBackend, type PoseBackend, WorkerBackend } from '../tracking/backends';
import {
  type EngineInfo,
  EngineInitError,
  type InitErrorKind,
  type LoadProgress,
} from '../tracking/protocol';
import { type FrameTicket, InferenceScheduler, type SchedulerStats } from '../tracking/scheduler';
import { RateMeter, RollingStats } from './metrics';

export interface EngineSettings {
  garmentId: string;
  /** Fabric option of a 3D garment ('' = the garment's default). */
  materialId: string;
  /** 3D garments: skeletal deformation only, or experimental cloth simulation on top. */
  motion: MotionMode;
  showGarment: boolean;
  mirror: boolean;
  fit: UserFitAdjustment;
  fitMode: FitMode;
  showLandmarks: boolean;
  occlusion: boolean;
  preset: QualityPreset['id'];
  delegate: DelegatePreference;
}

/** What the tracker is doing while it loads (the UI words it). */
export type TrackerLoadingStep = 'model' | 'download' | 'runtime' | 'prepare';

export type TrackerStatus =
  | { state: 'idle' }
  | { state: 'loading'; step: TrackerLoadingStep; progress: number | null }
  | { state: 'ready'; info: EngineInfo; backend: BackendKind; note: string | null }
  | { state: 'error'; kind: InitErrorKind; message: string };

export type SourceStatus =
  | { state: 'none' }
  | { state: 'loading'; kind: SourceKind }
  | { state: 'ready'; kind: SourceKind; label: string; width: number; height: number }
  | { state: 'error'; kind: SourceKind; errorKind: SourceErrorKind; message: string };

export interface PlaybackState {
  paused: boolean;
  ended: boolean;
  loop: boolean;
  rate: number;
  duration: number | null;
}

export interface Diagnostics {
  videoFps: number;
  renderFps: number;
  inferenceFps: number;
  inferenceMs: { median: number | null; p95: number | null };
  /** Frame presented → pose result available (includes capture, transfer, queueing, inference). */
  resultLatencyMs: { median: number | null; p95: number | null };
  /** Media-time gap between the displayed frame and the frame the pose came from. */
  poseAgeMs: { median: number | null; p95: number | null };
  processingSize: { width: number; height: number } | null;
  sourceSize: { width: number; height: number } | null;
  canvasSize: { width: number; height: number };
  frameLoop: 'rvfc' | 'raf' | null;
  scheduler: SchedulerStats | null;
  interpretation: InterpretationDiagnostics | null;
  opacity: number;
  generation: number;
  garment3d: Diagnostics3D | null;
}

/** State of the selected 3D garment (the 'inactive' state means a 2D garment is selected). */
export type Garment3DStatus =
  | { state: 'inactive' }
  | { state: 'loading'; name: string }
  | { state: 'ready'; name: string }
  | {
      state: 'error';
      name: string;
      message: string;
      /** 'legacy-2d': the development fallback draws a flat 2D image instead (labelled as such). */
      fallback: 'legacy-2d' | null;
    };

export interface Diagnostics3D {
  variant: string;
  vertices: number;
  triangles: number;
  joints: number;
  /** Garment render (bones + draw) wall time, ms. */
  renderMs: { median: number | null; p95: number | null };
  /** 3D layer → visible canvas copy, ms. */
  copyMs: { median: number | null; p95: number | null };
  occlusionMs: number | null;
  renderSize: { width: number; height: number } | null;
  mode: 'skeletal' | 'cloth' | 'none';
  orientation: 'world' | 'image' | null;
  yawDeg: number | null;
  pxPerMetre: number | null;
  torsoLength: number | null;
  armState: string | null;
  contextLost: boolean;
  cloth: ClothStats;
}

/**
 * AI photo mode display state. 'off': live 2D/3D try-on. 'live': plain video (no garment, no
 * overlays) with tracking kept for framing guidance. 'still': a captured/generated still covers the
 * stage, so pose inference and garment/cloth rendering pause; the camera stream keeps running.
 */
export type AiView = 'off' | 'live' | 'still';

export interface EngineSnapshot {
  aiView: AiView;
  tracker: TrackerStatus;
  source: SourceStatus;
  playback: PlaybackState;
  phase: TrackingPhase;
  garmentsReady: boolean;
  garmentError: string | null;
  garment3d: Garment3DStatus;
  diagnostics: Diagnostics;
}

export const DEFAULT_SETTINGS: EngineSettings = {
  garmentId: DEFAULT_GARMENT_ID,
  materialId: '',
  motion: 'skeletal',
  showGarment: true,
  mirror: true,
  fit: DEFAULT_USER_FIT,
  fitMode: 'contain',
  showLandmarks: false,
  // Experimental and not validated on real crossed-arm footage, so off by default.
  occlusion: false,
  preset: DEFAULT_PRESET,
  delegate: 'GPU',
};

/** Letterbox colour around the video; matches --bg in styles.css. */
const BACKGROUND = '#0b0918';

/**
 * WebGL backing-store size for the garment layer: source aspect ratio, never more pixels than the
 * layer occupies on screen, capped by RENDER_3D.maxRenderPixels.
 */
export function renderSize(sw: number, sh: number, viewScale: number): { width: number; height: number } {
  const cap = Math.sqrt(RENDER_3D.maxRenderPixels / (sw * sh));
  const s = Math.max(0.05, Math.min(viewScale, cap));
  return { width: Math.max(1, Math.round(sw * s)), height: Math.max(1, Math.round(sh * s)) };
}
/** Opacity easing time constants (ms). Functional feedback, kept short. */
const FADE_IN_TAU = 90;
const FADE_OUT_TAU = 120;

export class MirrorEngine {
  private settings: EngineSettings;
  private aiView: AiView = 'off';
  private ctx: CanvasRenderingContext2D;
  private listeners = new Set<(s: EngineSnapshot) => void>();
  private disposed = false;

  // tracking
  private backend: PoseBackend | null = null;
  private scheduler: InferenceScheduler | null = null;
  private trackerToken = 0;
  private trackerStatus: TrackerStatus = { state: 'idle' };
  private interpreter = new TrackingInterpreter(TRACKING_CONFIG);
  private smoother = new PoseSmoother();
  private phase: TrackingPhase = 'searching';
  private lastInterpretation: InterpretationDiagnostics | null = null;
  private garmentPose: GarmentPose | null = null;
  private currentTorso: TorsoEstimate | null = null;
  private poseFrameTimeMs: number | null = null;
  private targetOpacity = 0;
  private opacity = 0;
  private lastObservation: PoseObservation | null = null;

  // source
  private source: FrameSource | null = null;
  private sourceToken = 0;
  private sourceStatus: SourceStatus = { state: 'none' };
  private frameLoop: FrameLoop | null = null;
  private latestFrame: FrameInfo | null = null;
  private sourceCleanup: (() => void) | null = null;
  private processingSize: { width: number; height: number } | null = null;

  // rendering
  private view: ViewTransform | null = null;
  private stageSize = { width: 1, height: 1 };
  private resizeObserver: ResizeObserver;
  private renderRequested: number | null = null;
  private lastRenderAt: number | null = null;

  // garments
  private garments = new GarmentLibrary();
  private garmentsReady = false;

  // 3D garments
  private models = new GarmentModelCache();
  private renderer3d: GarmentRenderer | null = null;
  private rendererError: string | null = null;
  private garment3dStatus: Garment3DStatus = { state: 'inactive' };
  private garment3dToken = 0;
  private active3d: { definition: Garment3DDefinition; model: PreparedGarmentModel } | null = null;
  private estimator3d: BodyEstimator3D | null = null;
  private smoother3d: Fit3DSmoother | null = null;
  private fit3d: SmoothedFit3D | null = null;
  private fit3dConfidence = 1;
  private garmentShoulders: { left: Point; right: Point } | null = null;
  private cutouts: ForearmCutout[] = [];
  private render3dMs = new RollingStats();
  private copyMs = new RollingStats();
  private lastOcclusionMs: number | null = null;
  private lastRenderSize: { width: number; height: number } | null = null;
  private lastMode: Diagnostics3D['mode'] = 'none';

  // cloth (lazy-loaded physics module)
  private cloth: ClothSimulation | null = null;
  private clothFor: string | null = null;
  private clothToken = 0;
  private clothStats: ClothStats = DEFAULT_CLOTH_STATS;

  // metrics
  private videoRate = new RateMeter();
  private renderRate = new RateMeter();
  private inferenceRate = new RateMeter();
  private inferenceMs = new RollingStats();
  private resultLatency = new RollingStats();
  private poseAge = new RollingStats();
  private uiTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    stage: HTMLElement,
    settings: Partial<EngineSettings> = {},
  ) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings, fit: clampUserFit(settings.fit ?? DEFAULT_USER_FIT) };
    this.settings.garmentId = findGarment(this.settings.garmentId).id;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: false });
    if (!ctx) throw new Error('Canvas 2D is not available in this browser.');
    this.ctx = ctx;
    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      this.stageSize = { width: entry.contentRect.width, height: entry.contentRect.height };
      this.requestRender();
    });
    this.resizeObserver.observe(stage);
    const rect = stage.getBoundingClientRect();
    this.stageSize = { width: rect.width, height: rect.height };
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.uiTimer = setInterval(() => this.emit(), 1000 / UI_UPDATE_HZ);

    const flat = GARMENTS.filter((g): g is Garment2DDefinition => g.kind === '2d');
    void this.garments
      .preload(flat, () => {
        this.garmentsReady = GARMENTS.some((g) => this.garments.get(g.id));
        this.requestRender();
        this.emit();
      })
      .then(() => this.emit());
    this.activateGarment();
    void this.initTracker();
    this.requestRender();
  }

  // ---- 3D garment lifecycle ---------------------------------------------------------------------

  /**
   * Applies the selected garment: interpreter limits for its kind, and for 3D garments the
   * renderer + cached model load. Stale loads (the user switched again) are ignored.
   */
  private activateGarment(): void {
    const def = findGarment(this.settings.garmentId);
    const token = ++this.garment3dToken;
    this.interpreter.setConfig(isGarment3D(def) ? trackingConfigFor3D(def.rig.limits) : TRACKING_CONFIG);
    this.resetFit3d();
    this.resetCloth('garment-changed');
    if (!isGarment3D(def)) {
      this.garment3dStatus = { state: 'inactive' };
      this.active3d = null;
      this.emit();
      return;
    }
    if (this.active3d?.definition.id === def.id && this.renderer3d?.garmentId === def.id) {
      this.garment3dStatus = { state: 'ready', name: def.name };
      this.emit();
      return;
    }
    this.active3d = null;
    const renderer = this.ensureRenderer();
    if (!renderer) {
      this.garment3dStatus = {
        state: 'error',
        name: def.name,
        message: this.rendererError ?? '3D rendering is unavailable.',
        fallback: RENDER_3D.webglFailureFallback === 'legacy-2d' ? 'legacy-2d' : null,
      };
      this.emit();
      return;
    }
    this.garment3dStatus = { state: 'loading', name: def.name };
    this.emit();
    const url = `${import.meta.env.BASE_URL}${def.model}`;
    this.models
      .load(url, def.rig)
      .then((model) => {
        if (token !== this.garment3dToken || this.disposed || !this.renderer3d) return;
        this.renderer3d.setGarment(def, model, findMaterial(def, this.settings.materialId));
        this.active3d = { definition: def, model };
        this.estimator3d = new BodyEstimator3D(def.rig, model.rig);
        this.smoother3d = new Fit3DSmoother(
          defaultSmootherParams(def.rig),
          Math.max(this.source?.video.videoWidth ?? 0, this.source?.video.videoHeight ?? 0) || 1000,
        );
        this.garment3dStatus = { state: 'ready', name: def.name };
        if (this.settings.motion === 'cloth') void this.ensureCloth();
        this.requestRender();
        this.emit();
      })
      .catch((error: unknown) => {
        if (token !== this.garment3dToken || this.disposed) return;
        this.garment3dStatus = {
          state: 'error',
          name: def.name,
          message: error instanceof Error ? error.message : String(error),
          fallback: null,
        };
        this.emit();
      });
  }

  /** Creates the WebGL renderer once; returns null (and remembers why) when WebGL is unavailable. */
  private ensureRenderer(): GarmentRenderer | null {
    if (this.renderer3d) return this.renderer3d;
    if (this.rendererError) return null;
    try {
      const renderer = new GarmentRenderer();
      renderer.onContextChange = (lost) => {
        if (lost) console.warn('[3d] WebGL context lost; the garment is hidden until it is restored.');
        this.requestRender();
        this.emit();
      };
      this.renderer3d = renderer;
      return renderer;
    } catch (error) {
      this.rendererError =
        error instanceof RendererInitError
          ? error.message
          : `3D rendering failed to start: ${error instanceof Error ? error.message : String(error)}`;
      console.warn(`[3d] ${this.rendererError}`);
      return null;
    }
  }

  /** Retry after a 3D load failure (e.g. model file missing). */
  retryGarment(): void {
    this.rendererError = null;
    this.activateGarment();
  }

  private resetFit3d(): void {
    this.estimator3d?.reset();
    this.smoother3d?.reset();
    this.fit3d = null;
    this.fit3dConfidence = 1;
    this.garmentShoulders = null;
  }

  // ---- Cloth mode ---------------------------------------------------------------------------------

  private async ensureCloth(): Promise<void> {
    const active = this.active3d;
    const renderer = this.renderer3d;
    if (!active || !renderer?.instance || this.settings.motion !== 'cloth') return;
    const sim = active.definition.simulation;
    if (!sim) {
      this.clothStats = {
        ...DEFAULT_CLOTH_STATS,
        state: 'error',
        message: 'This garment has no cloth setup.',
      };
      return;
    }
    if (this.cloth && this.clothFor === active.definition.id) return;
    this.disposeCloth();
    const token = ++this.clothToken;
    this.clothStats = { ...DEFAULT_CLOTH_STATS, state: 'loading', message: 'Loading cloth physics…' };
    this.emit();
    try {
      const { ClothSimulation } = await import('../physics/ClothSimulation');
      const created = await ClothSimulation.create({
        definition: active.definition,
        model: active.model,
        boneCount: renderer.instance.mesh.skeleton.bones.length,
      });
      if (token !== this.clothToken || this.disposed || this.active3d !== active) {
        created.dispose();
        return;
      }
      this.cloth = created;
      this.clothFor = active.definition.id;
      this.clothStats = created.stats;
    } catch (error) {
      if (token !== this.clothToken) return;
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[cloth] could not start; skeletal motion continues.', error);
      this.clothStats = { ...DEFAULT_CLOTH_STATS, state: 'error', message };
    }
    this.requestRender();
    this.emit();
  }

  private resetCloth(reason: string): void {
    this.cloth?.reset(reason);
  }

  private disposeCloth(): void {
    this.clothToken++;
    this.cloth?.dispose();
    this.cloth = null;
    this.clothFor = null;
    this.clothStats = DEFAULT_CLOTH_STATS;
  }

  /** Developer tuning for the cloth solver (diagnostics panel only). */
  setClothTuning(patch: Partial<ClothTuning>): void {
    this.cloth?.setTuning(patch);
    this.emit();
  }

  getClothTuning(): ClothTuning | null {
    return this.cloth?.tuning ?? null;
  }

  /** Development inspection: skeleton/axes/bounds helpers on the live garment. */
  setDebugHelpers(on: boolean): void {
    this.renderer3d?.setDebugHelpers(on);
    this.requestRender();
  }

  // ---- Subscriptions ----------------------------------------------------------------------------

  subscribe(listener: (s: EngineSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    if (this.disposed || this.listeners.size === 0) return;
    const snap = this.snapshot();
    for (const l of this.listeners) l(snap);
  }

  snapshot(): EngineSnapshot {
    const now = performance.now();
    const video = this.source?.video;
    return {
      aiView: this.aiView,
      tracker: this.trackerStatus,
      source: this.sourceStatus,
      playback: {
        paused: video ? video.paused : true,
        ended: video ? video.ended : false,
        loop: video ? video.loop : true,
        rate: video ? video.playbackRate : 1,
        duration: video && Number.isFinite(video.duration) ? video.duration : null,
      },
      phase: this.phase,
      garmentsReady: this.garmentsReady,
      garmentError: this.garments.error(this.settings.garmentId),
      garment3d: this.garment3dStatus,
      diagnostics: {
        videoFps: this.videoRate.rate(now),
        renderFps: this.renderRate.rate(now),
        inferenceFps: this.inferenceRate.rate(now),
        inferenceMs: { median: this.inferenceMs.percentile(0.5), p95: this.inferenceMs.percentile(0.95) },
        resultLatencyMs: {
          median: this.resultLatency.percentile(0.5),
          p95: this.resultLatency.percentile(0.95),
        },
        poseAgeMs: { median: this.poseAge.percentile(0.5), p95: this.poseAge.percentile(0.95) },
        processingSize: this.processingSize,
        sourceSize: video ? { width: video.videoWidth, height: video.videoHeight } : null,
        canvasSize: { width: this.canvas.width, height: this.canvas.height },
        frameLoop: this.frameLoop?.mode ?? null,
        scheduler: this.scheduler ? { ...this.scheduler.stats } : null,
        interpretation: this.lastInterpretation,
        opacity: this.opacity,
        generation: this.scheduler?.generation ?? 0,
        garment3d: this.diagnostics3d(),
      },
    };
  }

  private diagnostics3d(): Diagnostics3D | null {
    const active = this.active3d;
    if (!active) return null;
    const fit = this.fit3d;
    return {
      variant: active.definition.variant,
      vertices: active.model.stats.vertices,
      triangles: active.model.stats.triangles,
      joints: active.model.stats.joints,
      renderMs: { median: this.render3dMs.percentile(0.5), p95: this.render3dMs.percentile(0.95) },
      copyMs: { median: this.copyMs.percentile(0.5), p95: this.copyMs.percentile(0.95) },
      occlusionMs: this.lastOcclusionMs,
      renderSize: this.lastRenderSize,
      mode: this.lastMode,
      orientation: fit?.orientation ?? null,
      yawDeg: fit?.yawDeg ?? null,
      pxPerMetre: fit?.pxPerMetre ?? null,
      torsoLength: fit?.pose.torsoLength ?? null,
      armState: fit ? `${fit.armState.left} / ${fit.armState.right}` : null,
      contextLost: this.renderer3d?.contextLost ?? false,
      cloth: this.cloth ? this.cloth.stats : this.clothStats,
    };
  }

  getSettings(): EngineSettings {
    return this.settings;
  }

  /** Direct read for the scrubber's own animation loop (kept out of React state). */
  get currentTime(): number {
    return this.source?.video.currentTime ?? 0;
  }

  // ---- Tracker lifecycle ------------------------------------------------------------------------

  async initTracker(): Promise<void> {
    const token = ++this.trackerToken;
    this.scheduler?.dispose();
    this.scheduler = null;
    this.backend?.dispose();
    this.backend = null;
    this.resetTemporalState();

    const preset = QUALITY_PRESETS[this.settings.preset];
    const request = { model: preset.model, delegate: this.settings.delegate };
    const onProgress = (p: LoadProgress) => {
      if (token !== this.trackerToken) return;
      this.trackerStatus =
        p.stage === 'model'
          ? {
              state: 'loading',
              step: 'download',
              progress: p.totalBytes ? p.loadedBytes / p.totalBytes : null,
            }
          : { state: 'loading', step: 'runtime', progress: null };
    };
    this.trackerStatus = { state: 'loading', step: 'model', progress: 0 };
    this.emit();

    let backend: PoseBackend | null = null;
    let info: EngineInfo;
    let note: string | null = null;
    try {
      backend = new WorkerBackend(request);
      info = await backend.init(onProgress);
    } catch (error) {
      backend?.dispose();
      backend = null;
      if (token !== this.trackerToken) return;
      if (
        error instanceof EngineInitError &&
        (error.kind === 'model-missing' || error.kind === 'model-download')
      ) {
        this.trackerStatus = { state: 'error', kind: error.kind, message: error.message };
        this.emit();
        return;
      }
      // Worker path unavailable: controlled fallback on the main thread at a reduced rate.
      const reason = error instanceof Error ? error.message : String(error);
      note = `Worker tracking failed (${reason}). Running on the main thread at up to ${MAIN_THREAD_FALLBACK_HZ} inferences/s.`;
      try {
        backend = new MainThreadBackend(request);
        info = await backend.init(onProgress);
      } catch (fallbackError) {
        backend?.dispose();
        if (token !== this.trackerToken) return;
        const kind = fallbackError instanceof EngineInitError ? fallbackError.kind : 'unknown';
        this.trackerStatus = {
          state: 'error',
          kind,
          message: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        };
        this.emit();
        return;
      }
    }
    if (token !== this.trackerToken || this.disposed) {
      backend.dispose();
      return;
    }

    // Warm-up: the first GPU inference compiles shaders (seconds). Do it now, not on the user.
    this.trackerStatus = { state: 'loading', step: 'prepare', progress: null };
    this.emit();
    try {
      const blank = await createImageBitmap(new ImageData(64, 64));
      await backend.detect(blank, performance.now());
      await backend.reset();
    } catch (error) {
      if (token !== this.trackerToken) return;
      backend.dispose();
      this.trackerStatus = {
        state: 'error',
        kind: 'runtime',
        message: `Tracker warm-up failed: ${error instanceof Error ? error.message : String(error)}`,
      };
      this.emit();
      return;
    }
    if (token !== this.trackerToken || this.disposed) {
      backend.dispose();
      return;
    }

    this.backend = backend;
    this.scheduler = this.createScheduler(backend);
    if (backend.kind === 'main-thread') this.scheduler.minIntervalMs = 1000 / MAIN_THREAD_FALLBACK_HZ;
    if (info.delegateFallbackReason) {
      note = `${note ? `${note} ` : ''}GPU unavailable (${info.delegateFallbackReason}); using CPU.`;
    }
    this.trackerStatus = { state: 'ready', info, backend: backend.kind, note };
    this.scheduler.setPaused(this.inferencePaused());
    this.offerLatestFrame();
    this.emit();
  }

  private createScheduler(backend: PoseBackend): InferenceScheduler {
    const preset = QUALITY_PRESETS[this.settings.preset];
    const scheduler = new InferenceScheduler({
      backend,
      capture: (ticket) => this.captureFrame(ticket),
      onResult: (ticket, output) => {
        const now = performance.now();
        this.inferenceRate.tick(now);
        this.inferenceMs.push(output.inferenceMs);
        this.resultLatency.push(now - ticket.receivedAt);
        const observations = output.poses.map((p) =>
          toObservation(p.image, ticket.sourceWidth, ticket.sourceHeight, p.world),
        );
        this.applyObservations(observations, ticket);
      },
      onError: (_ticket, error) => {
        console.warn('[tracking] inference failed', error);
      },
    });
    scheduler.minIntervalMs = preset.maxInferenceHz > 0 ? 1000 / preset.maxInferenceHz : 0;
    return scheduler;
  }

  private async captureFrame(ticket: FrameTicket): Promise<ImageBitmap | null> {
    const video = this.source?.video;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0)
      return null;
    if (ticket.generation !== this.scheduler?.generation) return null;
    const preset = QUALITY_PRESETS[this.settings.preset];
    const long = Math.max(video.videoWidth, video.videoHeight);
    const scale = Math.min(1, preset.processingLongSide / long);
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    this.processingSize = { width, height };
    // Same aspect ratio as the source, so normalized landmarks map back to source pixels exactly.
    return createImageBitmap(video, { resizeWidth: width, resizeHeight: height, resizeQuality: 'low' });
  }

  private applyObservations(observations: PoseObservation[], ticket: FrameTicket): void {
    const still = this.source?.video.paused ?? false;
    const result = this.interpreter.update(observations, ticket.frameTimeMs, still);
    this.phase = result.phase;
    this.lastInterpretation = result.diagnostics;
    // The subject's image AND world landmarks travel together in one observation (same MediaPipe
    // result index), so the 3D path can never pair one person's world pose with another's image.
    this.lastObservation = result.subjectIndex !== null ? (observations[result.subjectIndex] ?? null) : null;
    if (result.resetFilters) {
      this.smoother.reset();
      this.resetFit3d();
      this.resetCloth('reacquired');
      // Start invisible after a reacquisition so it fades in at the new place (no snap/glide).
      this.opacity = 0;
    }
    if (result.torso) {
      this.garmentPose = this.smoother.update(result.torso, ticket.frameTimeMs / 1000);
      this.currentTorso = result.torso;
      this.poseFrameTimeMs = ticket.frameTimeMs;
      this.update3d(result.torso, ticket.frameTimeMs);
      this.cutouts = forearmCutouts(this.lastObservation, result.torso);
    } else {
      this.currentTorso = null;
      this.cutouts = [];
    }
    this.targetOpacity = result.targetOpacity * (this.active3d ? this.fit3dConfidence : 1);
    if (still) {
      // A paused frame should show the garment immediately rather than fading in.
      this.opacity = this.targetOpacity;
      this.requestRender();
    }
  }

  /** 3D targets from the interpreted subject; bridged (one-shoulder) frames hold the last pose. */
  private update3d(torso: TorsoEstimate, frameTimeMs: number): void {
    const obs = this.lastObservation;
    if (!this.active3d || !this.estimator3d || !this.smoother3d || !obs) return;
    if (torso.source === 'bridged' && this.fit3d) return;
    const target = this.estimator3d.estimate(obs, torso, frameTimeMs);
    if (!target) return;
    this.fit3d = this.smoother3d.update(target, frameTimeMs / 1000);
    this.fit3dConfidence = target.confidence;
  }

  private resetTemporalState(): void {
    this.interpreter.reset();
    this.smoother.reset();
    this.resetFit3d();
    this.resetCloth('discontinuity');
    this.cutouts = [];
    this.garmentPose = null;
    this.currentTorso = null;
    this.poseFrameTimeMs = null;
    this.targetOpacity = 0;
    this.opacity = 0;
    this.phase = 'searching';
    this.lastObservation = null;
    this.lastInterpretation = null;
  }

  /** Seek / loop / source switch / resume: new timeline, no carry-over of any pose state. */
  private discontinuity(): void {
    this.resetTemporalState();
    this.scheduler?.newGeneration();
    this.latestFrame = null;
    this.poseAge.reset();
    this.requestRender();
  }

  // ---- Sources ------------------------------------------------------------------------------------

  async openFile(file: File): Promise<void> {
    await this.openSource(new VideoFileSource(file));
  }

  async openCamera(deviceId?: string): Promise<void> {
    await this.openSource(new CameraSource(deviceId));
  }

  closeSource(): void {
    this.sourceToken++;
    this.teardownSource();
    this.sourceStatus = { state: 'none' };
    this.discontinuity();
    this.emit();
  }

  private teardownSource(): void {
    this.frameLoop?.stop();
    this.frameLoop = null;
    this.sourceCleanup?.();
    this.sourceCleanup = null;
    this.source?.dispose();
    this.source = null;
    this.latestFrame = null;
    this.processingSize = null;
    this.videoRate.reset();
    this.renderRate.reset();
  }

  private async openSource(source: FrameSource): Promise<void> {
    const token = ++this.sourceToken;
    this.teardownSource();
    this.discontinuity();
    this.sourceStatus = { state: 'loading', kind: source.kind };
    this.emit();
    try {
      await source.start();
    } catch (error) {
      source.dispose();
      if (token !== this.sourceToken) return;
      const e = error instanceof SourceError ? error : new SourceError('unknown', String(error));
      this.sourceStatus = { state: 'error', kind: source.kind, errorKind: e.kind, message: e.message };
      this.emit();
      return;
    }
    if (token !== this.sourceToken || this.disposed) {
      source.dispose();
      return;
    }
    this.source = source;
    const video = source.video;
    video.loop = source.kind === 'file';
    source.onInterrupted = (error) => {
      if (this.source !== source) return;
      this.teardownSource();
      this.discontinuity();
      this.sourceStatus = {
        state: 'error',
        kind: source.kind,
        errorKind: error.kind,
        message: error.message,
      };
      this.emit();
    };

    const onSeeking = () => this.discontinuity();
    const onStateChange = () => {
      this.emit();
      this.requestRender();
    };
    const onResize = () => {
      if (this.sourceStatus.state === 'ready') {
        this.sourceStatus = { ...this.sourceStatus, width: video.videoWidth, height: video.videoHeight };
      }
      this.smoother.setScaleReference(Math.max(video.videoWidth, video.videoHeight));
      this.smoother3d?.setScaleReference(Math.max(video.videoWidth, video.videoHeight));
      this.discontinuity();
      this.emit();
    };
    video.addEventListener('seeking', onSeeking);
    video.addEventListener('resize', onResize);
    for (const type of ['play', 'pause', 'ended', 'ratechange', 'durationchange']) {
      video.addEventListener(type, onStateChange);
    }
    this.sourceCleanup = () => {
      video.removeEventListener('seeking', onSeeking);
      video.removeEventListener('resize', onResize);
      for (const type of ['play', 'pause', 'ended', 'ratechange', 'durationchange']) {
        video.removeEventListener(type, onStateChange);
      }
    };

    this.smoother.setScaleReference(Math.max(video.videoWidth, video.videoHeight));
    this.smoother3d?.setScaleReference(Math.max(video.videoWidth, video.videoHeight));
    this.sourceStatus = {
      state: 'ready',
      kind: source.kind,
      label: source.label,
      width: video.videoWidth,
      height: video.videoHeight,
    };
    this.frameLoop = new FrameLoop(video, (info) => this.onVideoFrame(info));
    this.frameLoop.start();
    if (source.kind === 'file') {
      try {
        await video.play();
      } catch {
        // Autoplay can be refused; the user presses Play. The first frame is still shown.
      }
    }
    this.requestRender();
    this.emit();
  }

  private onVideoFrame(info: FrameInfo): void {
    const prev = this.latestFrame;
    if (prev && (info.mediaTimeMs < prev.mediaTimeMs - 1 || info.mediaTimeMs - prev.mediaTimeMs > 1500)) {
      // Missed a seek event (or resumed after a long background pause): new timeline.
      this.discontinuity();
    }
    this.latestFrame = info;
    this.videoRate.tick(info.receivedAt);
    this.offerLatestFrame();
    this.renderNow();
  }

  private offerLatestFrame(): void {
    const video = this.source?.video;
    const frame = this.latestFrame;
    if (!this.scheduler || !video || !frame || video.videoWidth === 0) return;
    this.scheduler.offer({
      frameTimeMs: frame.mediaTimeMs,
      receivedAt: frame.receivedAt,
      sourceWidth: video.videoWidth,
      sourceHeight: video.videoHeight,
    });
  }

  // ---- Playback -----------------------------------------------------------------------------------

  async play(): Promise<void> {
    const video = this.source?.video;
    if (!video) return;
    try {
      await video.play();
    } catch (error) {
      console.warn('play() failed', error);
    }
  }

  pause(): void {
    this.source?.video.pause();
  }

  togglePlay(): void {
    const video = this.source?.video;
    if (!video || this.source?.kind !== 'file') return;
    if (video.paused || video.ended) void this.play();
    else video.pause();
  }

  restart(): void {
    const video = this.source?.video;
    if (!video || this.source?.kind !== 'file') return;
    video.currentTime = 0;
    void this.play();
  }

  seek(seconds: number): void {
    const video = this.source?.video;
    if (!video || this.source?.kind !== 'file' || !Number.isFinite(seconds)) return;
    const duration = Number.isFinite(video.duration) ? video.duration : seconds;
    video.currentTime = Math.min(Math.max(0, seconds), duration);
  }

  setLoop(loop: boolean): void {
    if (this.source) this.source.video.loop = loop;
    this.emit();
  }

  setPlaybackRate(rate: number): void {
    if (this.source && Number.isFinite(rate) && rate > 0) this.source.video.playbackRate = rate;
  }

  // ---- AI photo mode ------------------------------------------------------------------------------

  setAiView(view: AiView): void {
    if (view === this.aiView) return;
    const wasStill = this.aiView === 'still';
    this.aiView = view;
    if (view !== 'off') this.resetCloth('ai-mode');
    this.scheduler?.setPaused(this.inferencePaused());
    // Resuming live tracking after a still: start a fresh timeline (no stale pose carry-over).
    if (wasStill) this.discontinuity();
    this.requestRender();
    this.emit();
  }

  /**
   * Clean capture for AI mode: the current decoded frame of the underlying video element at its
   * native size, unmirrored — never the stage canvas (no garment, landmarks, status or letterbox).
   * Returns null when no frame is available or the source changed during capture.
   */
  async captureSourceFrame(): Promise<CapturedImage | null> {
    const source = this.source;
    if (!source || this.disposed) return null;
    const token = this.sourceToken;
    const frame = await captureVideoFrame(source.video);
    if (!frame || token !== this.sourceToken || this.source !== source || this.disposed) return null;
    return { ...frame, source: source.kind };
  }

  // ---- Settings -----------------------------------------------------------------------------------

  updateSettings(patch: Partial<EngineSettings>): void {
    const prev = this.settings;
    const next: EngineSettings = { ...prev, ...patch };
    if (patch.fit) next.fit = clampUserFit(patch.fit);
    if (patch.garmentId) next.garmentId = findGarment(patch.garmentId).id;
    if (next.motion !== 'cloth') next.motion = 'skeletal';
    this.settings = next;
    // Only model-related settings rebuild the tracker; garments/fit/mirror never do.
    if (next.preset !== prev.preset || next.delegate !== prev.delegate) void this.initTracker();
    if (next.garmentId !== prev.garmentId) this.activateGarment();
    if (next.materialId !== prev.materialId && this.active3d) {
      this.renderer3d?.setMaterial(findMaterial(this.active3d.definition, next.materialId));
    }
    if (next.motion !== prev.motion) {
      if (next.motion === 'cloth') void this.ensureCloth();
      else this.disposeCloth();
    }
    this.requestRender();
    this.emit();
  }

  // ---- Rendering ----------------------------------------------------------------------------------

  requestRender(): void {
    if (this.renderRequested !== null || this.disposed) return;
    this.renderRequested = requestAnimationFrame(() => {
      this.renderRequested = null;
      this.renderNow();
    });
  }

  private renderNow(): void {
    if (this.disposed) return;
    // A still image covers the stage: skip compositing, garment and cloth work entirely.
    if (this.aiView === 'still') return;
    const now = performance.now();
    const dt = this.lastRenderAt === null ? 16 : Math.min(200, now - this.lastRenderAt);
    this.lastRenderAt = now;
    this.renderRate.tick(now);

    const video = this.source?.video ?? null;
    const sw = video?.videoWidth ?? 0;
    const sh = video?.videoHeight ?? 0;
    const view = computeViewTransform({
      sourceWidth: sw,
      sourceHeight: sh,
      viewportCssWidth: this.stageSize.width,
      viewportCssHeight: this.stageSize.height,
      devicePixelRatio: window.devicePixelRatio || 1,
      fit: this.settings.fitMode,
      mirror: this.settings.mirror,
    });
    if (this.canvas.width !== view.canvasWidth || this.canvas.height !== view.canvasHeight) {
      this.canvas.width = view.canvasWidth;
      this.canvas.height = view.canvasHeight;
    }
    this.view = view;

    // Reject stale poses: if the displayed frame is far ahead of the pose, fade out instead of
    // drawing a lagging shirt.
    const liveGarment = this.aiView === 'off';
    let target = this.settings.showGarment && liveGarment ? this.targetOpacity : 0;
    const frameTime = this.latestFrame?.mediaTimeMs;
    if (this.poseFrameTimeMs !== null && frameTime !== undefined) {
      const age = frameTime - this.poseFrameTimeMs;
      // Only measure while a pose is actually being shown.
      if (age >= 0 && this.targetOpacity > 0) this.poseAge.push(age);
      const rate = video?.playbackRate || 1;
      if (age > TRACKING_CONFIG.maxPoseAgeMs * Math.max(1, rate)) target = 0;
    }
    const tau = target > this.opacity ? FADE_IN_TAU : FADE_OUT_TAU;
    this.opacity += (target - this.opacity) * (1 - Math.exp(-dt / tau));
    if (Math.abs(target - this.opacity) < 0.005) this.opacity = target;

    const playing = video ? !video.paused && !video.ended : false;
    const selected = findGarment(this.settings.garmentId);
    // 2D path: a legacy garment, or the labelled development fallback when 3D cannot run.
    const flatId = isGarment3D(selected)
      ? this.garment3dStatus.state === 'error' && this.garment3dStatus.fallback === 'legacy-2d'
        ? RENDER_3D.fallbackGarmentId
        : null
      : selected.id;
    const garment = flatId && liveGarment ? this.garments.get(flatId) : null;
    const placement =
      garment && this.garmentPose
        ? computeGarmentPlacement(garment.definition, this.garmentPose, this.settings.fit)
        : null;

    // 3D path: pose + render into the source-aligned WebGL layer.
    let layer3d: { canvas: CanvasImageSource } | null = null;
    this.garmentShoulders = null;
    this.lastMode = 'none';
    if (
      liveGarment &&
      this.active3d &&
      this.renderer3d &&
      this.fit3d &&
      this.opacity > 0.01 &&
      sw > 0 &&
      sh > 0
    ) {
      const size = renderSize(sw, sh, view.scale);
      const cloth =
        this.settings.motion === 'cloth' && this.cloth && this.clothFor === this.active3d.definition.id;
      if (cloth && this.cloth) this.cloth.advanceClock(frameTime ?? null, playing, now);
      const result = this.renderer3d.render({
        sourceWidth: sw,
        sourceHeight: sh,
        renderWidth: size.width,
        renderHeight: size.height,
        fit: this.fit3d,
        user: this.settings.fit,
        deformer: cloth ? this.cloth : null,
      });
      if (result) {
        layer3d = { canvas: result.canvas as CanvasImageSource };
        this.garmentShoulders = result.shoulders;
        this.render3dMs.push(result.renderMs);
        this.lastRenderSize = size;
        this.lastMode = result.mode;
      }
    }

    const cutouts = liveGarment && this.settings.occlusion && this.currentTorso ? this.cutouts : [];
    const timings = drawFrame(this.ctx, {
      view,
      source: video && sw > 0 ? video : null,
      sourceWidth: sw,
      sourceHeight: sh,
      garment,
      placement,
      layer3d,
      opacity: this.opacity,
      occlusion: cutouts.length > 0 ? { cutouts } : null,
      // Landmarks show in AI mode's live preview too: they tell the shopper they are tracked before
      // taking the photo (garment-only parts are empty there).
      debug: this.settings.showLandmarks
        ? {
            observation: this.lastObservation,
            torso: this.currentTorso,
            garmentShoulders: this.garmentShoulders,
            cutouts,
          }
        : null,
      background: BACKGROUND,
    });
    if (layer3d) this.copyMs.push(timings.layerCopyMs);
    this.lastOcclusionMs = cutouts.length > 0 ? timings.occlusionMs : null;

    // Keep animating a fade while no new video frames arrive (paused, stalled).
    const settling = Math.abs(target - this.opacity) > 0.005;
    if (settling && !playing) this.requestRender();
  }

  // ---- Lifecycle ----------------------------------------------------------------------------------

  private onVisibilityChange = () => {
    const hidden = document.hidden;
    this.scheduler?.setPaused(this.inferencePaused());
    if (!hidden) this.discontinuity();
  };

  private inferencePaused(): boolean {
    return document.hidden || this.aiView === 'still';
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.trackerToken++;
    this.sourceToken++;
    clearInterval(this.uiTimer);
    if (this.renderRequested !== null) cancelAnimationFrame(this.renderRequested);
    this.renderRequested = null;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.resizeObserver.disconnect();
    this.teardownSource();
    this.scheduler?.dispose();
    this.scheduler = null;
    this.backend?.dispose();
    this.backend = null;
    this.garments.dispose();
    this.garment3dToken++;
    this.disposeCloth();
    this.renderer3d?.dispose();
    this.renderer3d = null;
    this.models.dispose();
    this.listeners.clear();
  }

  /** Test/diagnostic hook: current view transform. */
  get viewTransform(): ViewTransform | null {
    return this.view;
  }
}
