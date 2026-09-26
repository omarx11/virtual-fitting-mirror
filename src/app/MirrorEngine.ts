/**
 * MirrorEngine: the non-React core. Owns the frame source, inference backend + scheduler,
 * interpretation, smoothing and rendering. High-frequency data (frames, landmarks, poses) never
 * enters React state; the UI subscribes to low-rate snapshots.
 */
import {
  type DelegatePreference,
  MAIN_THREAD_FALLBACK_HZ,
  QUALITY_PRESETS,
  type QualityPreset,
  UI_UPDATE_HZ,
} from '../config/performance';
import { TRACKING_CONFIG } from '../config/tracking';
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
import { type GarmentPose, PoseSmoother } from '../fitting/smoother';
import { findGarment, GARMENTS } from '../garments/catalogue';
import { GarmentLibrary } from '../garments/loader';
import { CameraSource } from '../media/cameraSource';
import { type FrameInfo, FrameLoop } from '../media/frameLoop';
import { type FrameSource, SourceError, type SourceErrorKind, type SourceKind } from '../media/frameSource';
import { VideoFileSource } from '../media/videoFileSource';
import { drawFrame } from '../rendering/compositor';
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
  showGarment: boolean;
  mirror: boolean;
  fit: UserFitAdjustment;
  fitMode: FitMode;
  showLandmarks: boolean;
  occlusion: boolean;
  preset: QualityPreset['id'];
  delegate: DelegatePreference;
}

export type TrackerStatus =
  | { state: 'idle' }
  | { state: 'loading'; message: string; progress: number | null }
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
}

export interface EngineSnapshot {
  tracker: TrackerStatus;
  source: SourceStatus;
  playback: PlaybackState;
  phase: TrackingPhase;
  garmentsReady: boolean;
  garmentError: string | null;
  diagnostics: Diagnostics;
}

export const DEFAULT_SETTINGS: EngineSettings = {
  garmentId: GARMENTS[0]?.id ?? '',
  showGarment: true,
  mirror: true,
  fit: DEFAULT_USER_FIT,
  fitMode: 'contain',
  showLandmarks: false,
  // Experimental and not validated on real crossed-arm footage, so off by default.
  occlusion: false,
  preset: 'balanced',
  delegate: 'GPU',
};

const BACKGROUND = '#0d0f12';
/** Opacity easing time constants (ms). Functional feedback, kept short. */
const FADE_IN_TAU = 90;
const FADE_OUT_TAU = 120;

export class MirrorEngine {
  private settings: EngineSettings;
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

    void this.garments
      .preload(GARMENTS, () => {
        this.garmentsReady = GARMENTS.some((g) => this.garments.get(g.id));
        this.requestRender();
        this.emit();
      })
      .then(() => this.emit());
    void this.initTracker();
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
      },
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
              message: 'Downloading tracking model…',
              progress: p.totalBytes ? p.loadedBytes / p.totalBytes : null,
            }
          : { state: 'loading', message: 'Starting tracking runtime…', progress: null };
    };
    this.trackerStatus = { state: 'loading', message: 'Loading tracking model…', progress: 0 };
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
    this.trackerStatus = { state: 'loading', message: 'Preparing tracker…', progress: null };
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
    this.scheduler.setPaused(document.hidden);
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
          toObservation(p, ticket.sourceWidth, ticket.sourceHeight),
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
    this.lastObservation = result.subjectIndex !== null ? (observations[result.subjectIndex] ?? null) : null;
    if (result.resetFilters) {
      this.smoother.reset();
      // Start invisible after a reacquisition so it fades in at the new place (no snap/glide).
      this.opacity = 0;
    }
    if (result.torso) {
      this.garmentPose = this.smoother.update(result.torso, ticket.frameTimeMs / 1000);
      this.currentTorso = result.torso;
      this.poseFrameTimeMs = ticket.frameTimeMs;
    } else {
      this.currentTorso = null;
    }
    this.targetOpacity = result.targetOpacity;
    if (still) {
      // A paused frame should show the garment immediately rather than fading in.
      this.opacity = this.targetOpacity;
      this.requestRender();
    }
  }

  private resetTemporalState(): void {
    this.interpreter.reset();
    this.smoother.reset();
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

  // ---- Settings -----------------------------------------------------------------------------------

  updateSettings(patch: Partial<EngineSettings>): void {
    const prev = this.settings;
    const next: EngineSettings = { ...prev, ...patch };
    if (patch.fit) next.fit = clampUserFit(patch.fit);
    if (patch.garmentId) next.garmentId = findGarment(patch.garmentId).id;
    this.settings = next;
    // Only model-related settings rebuild the tracker; garments/fit/mirror never do.
    if (next.preset !== prev.preset || next.delegate !== prev.delegate) void this.initTracker();
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
    let target = this.settings.showGarment ? this.targetOpacity : 0;
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

    const garment = this.garments.get(this.settings.garmentId);
    const placement =
      garment && this.garmentPose
        ? computeGarmentPlacement(garment.definition, this.garmentPose, this.settings.fit)
        : null;

    drawFrame(this.ctx, {
      view,
      source: video && sw > 0 ? video : null,
      sourceWidth: sw,
      sourceHeight: sh,
      garment,
      placement,
      opacity: this.opacity,
      occlusion: this.settings.occlusion && this.currentTorso ? { torso: this.currentTorso } : null,
      debug: this.settings.showLandmarks
        ? { observation: this.lastObservation, torso: this.currentTorso }
        : null,
      background: BACKGROUND,
    });

    // Keep animating a fade while no new video frames arrive (paused, stalled).
    const settling = Math.abs(target - this.opacity) > 0.005;
    const playing = video ? !video.paused && !video.ended : false;
    if (settling && !playing) this.requestRender();
  }

  // ---- Lifecycle ----------------------------------------------------------------------------------

  private onVisibilityChange = () => {
    const hidden = document.hidden;
    this.scheduler?.setPaused(hidden);
    if (!hidden) this.discontinuity();
  };

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
    this.listeners.clear();
  }

  /** Test/diagnostic hook: current view transform. */
  get viewTransform(): ViewTransform | null {
    return this.view;
  }
}
