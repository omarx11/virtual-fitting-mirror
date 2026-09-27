import { useCallback, useEffect, useRef, useState } from 'react';
import { loadPhotoFile } from '../ai/capture';
import { useAiTryOn } from '../ai/useAiTryOn';
import { AiResultView } from '../components/AiResultView';
import { AiTryOnPanel } from '../components/AiTryOnPanel';
import { DiagnosticsPanel } from '../components/DiagnosticsPanel';
import { FitControls } from '../components/FitControls';
import { GarmentPicker } from '../components/GarmentPicker';
import { SourceControls } from '../components/SourceControls';
import { StageOverlay } from '../components/StageOverlay';
import { Transport } from '../components/Transport';
import { TryOnModeSelector } from '../components/TryOnModeSelector';
import { ViewControls } from '../components/ViewControls';
import { AI_GARMENTS, findAiGarment } from '../garments/aiCatalogue';
import { findGarment, GARMENTS } from '../garments/catalogue';
import type { EngineSettings } from './MirrorEngine';
import {
  liveGarmentPatch,
  loadPreferences,
  modePatch,
  type Preferences,
  savePreferences,
  type TryOnMode,
  UI_PREFERENCE_KEYS,
} from './preferences';
import { useMirrorEngine } from './useMirrorEngine';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName);
}

const now = () => performance.now();

export function App() {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const [prefs, setPrefs] = useState<Preferences>(loadPreferences);
  const { engine, snapshot, initError } = useMirrorEngine(canvasRef, stageRef, prefs);
  const [fullscreen, setFullscreen] = useState(false);
  const [showRig, setShowRig] = useState(false);
  const aiActive = prefs.tryOnMode === 'ai';
  const { state: ai, controller } = useAiTryOn(aiActive);
  const [captureError, setCaptureError] = useState<string | null>(null);
  /** A file video paused by Capture resumes on Retake / End session / leaving AI mode. */
  const resumeOnRetake = useRef(false);

  const update = useCallback(
    (patch: Partial<Preferences>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...patch };
        savePreferences(next);
        return next;
      });
      const enginePatch: Record<string, unknown> = { ...patch };
      for (const key of UI_PREFERENCE_KEYS) delete enginePatch[key];
      if (Object.keys(enginePatch).length > 0) engine?.updateSettings(enginePatch as Partial<EngineSettings>);
    },
    [engine],
  );

  const resumePlayback = useCallback(() => {
    if (resumeOnRetake.current) void engine?.play();
    resumeOnRetake.current = false;
  }, [engine]);

  // The engine draws plain video in AI mode and pauses tracking/rendering while a still is shown.
  const stillShown = aiActive && ai.capture !== null;
  useEffect(() => {
    engine?.setAiView(!aiActive ? 'off' : stillShown ? 'still' : 'live');
  }, [engine, aiActive, stillShown]);

  useEffect(() => {
    if (!aiActive) {
      setCaptureError(null);
      resumePlayback();
    }
  }, [aiActive, resumePlayback]);

  // The AI garment choice follows the remembered preference (a catalogue ID, never an upload).
  useEffect(() => {
    if (!aiActive || !controller || ai.garment) return;
    const g = findAiGarment(prefs.aiGarmentId) ?? AI_GARMENTS[0];
    if (g) controller.selectCatalogueGarment(g.id, g.label);
  }, [aiActive, controller, ai.garment, prefs.aiGarmentId]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void appRef.current?.requestFullscreen?.().catch(() => undefined);
  }, []);

  const selectMode = useCallback((mode: TryOnMode) => update(modePatch(prefs, mode)), [prefs, update]);

  const selectLiveGarment = useCallback((id: string) => update(liveGarmentPatch(id)), [update]);

  const selectGarmentOffset = useCallback(
    (delta: number) => {
      // Steps through the current live mode's shirts (in 2D: its colours).
      const list = GARMENTS.filter((g) => g.kind === findGarment(prefs.garmentId).kind);
      const index = list.findIndex((g) => g.id === prefs.garmentId);
      const next = list[(index + delta + list.length) % list.length];
      if (next) selectLiveGarment(next.id);
    },
    [prefs.garmentId, selectLiveGarment],
  );

  const selectAiGarment = useCallback(
    (id: string) => {
      const g = findAiGarment(id);
      if (!g || !controller) return;
      update({ aiGarmentId: g.id });
      controller.selectCatalogueGarment(g.id, g.label);
    },
    [controller, update],
  );

  const capture = useCallback(async () => {
    if (!engine || !controller?.canCapture()) return;
    setCaptureError(null);
    const s = engine.snapshot();
    // A file video is paused on the captured frame, so Retake continues from the same moment.
    const wasPlaying = s.source.state === 'ready' && s.source.kind === 'file' && !s.playback.paused;
    if (wasPlaying) engine.pause();
    const frame = await engine.captureSourceFrame();
    if (!frame) {
      if (wasPlaying) void engine.play();
      setCaptureError('No video frame is available yet. Start the camera or open a video, then try again.');
      return;
    }
    resumeOnRetake.current = wasPlaying;
    controller.setCapture(frame);
  }, [engine, controller]);

  const retake = useCallback(() => {
    controller?.retake();
    resumePlayback();
  }, [controller, resumePlayback]);

  const endSession = useCallback(() => {
    controller?.endSession();
    setCaptureError(null);
    resumePlayback();
  }, [controller, resumePlayback]);

  const openPhotoFile = useCallback(
    async (file: File) => {
      if (!controller) return;
      setCaptureError(null);
      try {
        const image = await loadPhotoFile(file, ai.capabilities?.limits.maxUploadBytes ?? 8 * 1024 * 1024);
        controller.setCapture(image);
      } catch (error) {
        setCaptureError(error instanceof Error ? error.message : String(error));
      }
    },
    [controller, ai.capabilities],
  );

  // Keyboard shortcuts (ignored while typing in a form control; buttons keep Space/Enter).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && aiActive && ai.phase === 'consent') {
        controller?.declineConsent();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      const onButton =
        e.target instanceof HTMLButtonElement ||
        (e.target instanceof HTMLElement && e.target.tagName === 'SUMMARY');
      switch (e.key) {
        case ' ':
          if (onButton) return;
          e.preventDefault();
          engine?.togglePlay();
          break;
        case 'm':
        case 'M':
          update({ mirror: !prefs.mirror });
          break;
        case 'g':
        case 'G':
          if (!aiActive) update({ showGarment: !prefs.showGarment });
          break;
        case 'f':
        case 'F':
          toggleFullscreen();
          break;
        case 'd':
        case 'D':
          update({ diagnosticsOpen: !prefs.diagnosticsOpen });
          break;
        case ']':
          if (!aiActive) selectGarmentOffset(1);
          break;
        case '[':
          if (!aiActive) selectGarmentOffset(-1);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine, prefs, update, toggleFullscreen, selectGarmentOffset, aiActive, ai.phase, controller]);

  const hasSource = snapshot?.source.state === 'ready' || snapshot?.source.state === 'loading';
  const sourceReady = snapshot?.source.state === 'ready';
  const isFile = snapshot?.source.state === 'ready' && snapshot.source.kind === 'file';
  const selectedGarment = findGarment(prefs.garmentId);

  return (
    <div className="app" ref={appRef} data-mode={prefs.tryOnMode}>
      <main className="stage" ref={stageRef} aria-label="Mirror view">
        <canvas ref={canvasRef} className="stage-canvas" aria-hidden />
        {initError && (
          <div className="empty-state">
            <h1>Cannot start</h1>
            <p className="error-text">{initError}</p>
          </div>
        )}
        {snapshot && engine && !stillShown && (
          <StageOverlay
            snapshot={snapshot}
            onRetryTracker={() => void engine.initTracker()}
            onOpenFile={(file) => void engine.openFile(file)}
            onOpenCamera={(id) => void engine.openCamera(id)}
          />
        )}
        {aiActive && controller && (hasSource || stillShown) && (
          <AiResultView
            state={
              captureError && !ai.capture
                ? { ...ai, error: { code: 'invalid-image', message: captureError } }
                : ai
            }
            controller={controller}
            mirror={prefs.mirror}
            canCapture={sourceReady === true && controller.canCapture()}
            onCapture={() => void capture()}
            onRetake={retake}
            onEndSession={endSession}
            now={now}
          />
        )}
      </main>
      <aside className="panel" aria-label="Controls">
        {snapshot && engine && (
          <>
            <section className="panel-section">
              <TryOnModeSelector mode={prefs.tryOnMode} onChange={selectMode} />
            </section>
            {hasSource && (
              <section className="panel-section">
                <h2 className="section-title">Source</h2>
                <SourceControls
                  compact
                  status={snapshot.source}
                  onOpenFile={(file) => void engine.openFile(file)}
                  onOpenCamera={(id) => void engine.openCamera(id)}
                />
                {isFile && <Transport engine={engine} playback={snapshot.playback} />}
              </section>
            )}
            {aiActive && controller ? (
              <section className="panel-section">
                <AiTryOnPanel
                  state={ai}
                  controller={controller}
                  onSelectGarment={selectAiGarment}
                  onPhotoFile={(file) => void openPhotoFile(file)}
                  onEndSession={endSession}
                />
                {captureError && (
                  <p className="error-text" role="alert">
                    {captureError}
                  </p>
                )}
              </section>
            ) : (
              <>
                <section className="panel-section">
                  <GarmentPicker
                    kind={selectedGarment.kind}
                    garments={GARMENTS}
                    selectedId={prefs.garmentId}
                    onSelect={selectLiveGarment}
                    materialId={prefs.materialId}
                    onMaterial={(id) => update({ materialId: id })}
                    status3d={snapshot.garment3d}
                    onRetry3d={() => engine.retryGarment()}
                  />
                  {snapshot.garmentError && (
                    <p className="error-text" role="alert">
                      {snapshot.garmentError}
                    </p>
                  )}
                </section>
                <section className="panel-section">
                  <FitControls fit={prefs.fit} onChange={(fit) => update({ fit })} />
                </section>
              </>
            )}
            <section className="panel-section">
              <ViewControls
                showGarment={prefs.showGarment}
                mirror={prefs.mirror}
                occlusion={prefs.occlusion}
                fabricMotion={
                  selectedGarment.kind === '3d' && selectedGarment.simulation
                    ? prefs.motion === 'cloth'
                    : null
                }
                fullscreen={fullscreen}
                fitMode={prefs.fitMode}
                garmentToggles={!aiActive}
                onToggleGarment={() => update({ showGarment: !prefs.showGarment })}
                onToggleMirror={() => update({ mirror: !prefs.mirror })}
                onToggleOcclusion={() => update({ occlusion: !prefs.occlusion })}
                onToggleFabricMotion={() =>
                  update({ motion: prefs.motion === 'cloth' ? 'skeletal' : 'cloth' })
                }
                onToggleFullscreen={toggleFullscreen}
                onToggleFitMode={() => update({ fitMode: prefs.fitMode === 'contain' ? 'cover' : 'contain' })}
              />
            </section>
            <section className="panel-section">
              <DiagnosticsPanel
                snapshot={snapshot}
                open={prefs.diagnosticsOpen}
                onToggleOpen={(open) => open !== prefs.diagnosticsOpen && update({ diagnosticsOpen: open })}
                showLandmarks={prefs.showLandmarks}
                onToggleLandmarks={() => update({ showLandmarks: !prefs.showLandmarks })}
                preset={prefs.preset}
                onPreset={(preset) => update({ preset })}
                delegate={prefs.delegate}
                onDelegate={(delegate) => update({ delegate })}
                tuning={engine.getClothTuning()}
                onTuning={(patch) => engine.setClothTuning(patch)}
                showRig={showRig}
                ai={aiActive ? ai : null}
                onAiPreset={(id) => controller?.setPreset(id)}
                {...(import.meta.env.DEV
                  ? {
                      onToggleRig: () => {
                        engine.setDebugHelpers(!showRig);
                        setShowRig(!showRig);
                      },
                    }
                  : {})}
              />
            </section>
            <p className="footnote">
              {aiActive
                ? 'AI mode: a captured photo is uploaded to the cloud service FASHN only after you agree. '
                : 'Approximate visual preview — not a size or fit measurement, and your own clothing may show at the edges. '}
              2D and 3D video stays on this device; the page itself only talks to this computer, and outgoing
              requests (including MediaPipe usage metrics) are blocked. Shortcuts: Space play/pause · [ ]
              shirts · G shirt · M mirror · F fullscreen · D diagnostics.
            </p>
          </>
        )}
      </aside>
    </div>
  );
}
