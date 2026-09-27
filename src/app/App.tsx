import {
  ChevronDown,
  Eye,
  EyeOff,
  FlipHorizontal2,
  Info,
  Keyboard,
  PanelRightClose,
  PanelsTopLeft,
  Ruler,
  ShieldCheck,
  Shirt,
  Sparkles,
  Video,
} from 'lucide-react';
import { AnimatePresence, MotionConfig, motion, type PanInfo } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadPhotoFile } from '../ai/capture';
import { useAiTryOn } from '../ai/useAiTryOn';
import { AboutDialog } from '../components/AboutDialog';
import { AiResultView } from '../components/AiResultView';
import { AiTryOnPanel } from '../components/AiTryOnPanel';
import { CreditsCard } from '../components/Credits';
import { DiagnosticsPanel } from '../components/DiagnosticsPanel';
import { FitControls } from '../components/FitControls';
import { GarmentPicker } from '../components/GarmentPicker';
import { ShortcutsDialog } from '../components/ShortcutsDialog';
import { SidebarRail } from '../components/SidebarRail';
import { SourceControls } from '../components/SourceControls';
import { StageOverlay } from '../components/StageOverlay';
import { Transport } from '../components/Transport';
import { TryOnModeSelector } from '../components/TryOnModeSelector';
import { PanelSection } from '../components/ui/PanelSection';
import { ToastViewport, useToasts } from '../components/ui/Toasts';
import { ViewControls } from '../components/ViewControls';
import { AI_GARMENTS, findAiGarment } from '../garments/aiCatalogue';
import { findGarment, GARMENTS } from '../garments/catalogue';
import { BRAND } from './brand';
import type { EngineSettings } from './MirrorEngine';
import {
  liveGarmentPatch,
  loadPreferences,
  modePatch,
  type PanelSectionId,
  type Preferences,
  savePreferences,
  type TryOnMode,
  UI_PREFERENCE_KEYS,
} from './preferences';
import { COMPACT_SIDEBAR_QUERY, NARROW_LAYOUT_QUERY, useMediaQuery } from './useMediaQuery';
import { useMirrorEngine } from './useMirrorEngine';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName);
}

const now = () => performance.now();

/** Sidebar widths in CSS px: the folded icon rail, and the full panel on compact / wide screens. */
const RAIL_WIDTH = 76;
const PANEL_WIDTH = { compact: 320, wide: 368 } as const;
/** A vertical swipe this long (px) on the bottom sheet's grip folds or unfolds it. */
const SWIPE_PX = 36;

type DialogId = 'about' | 'shortcuts';

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
  const [dialog, setDialog] = useState<DialogId | null>(null);
  const { toasts, show: toast } = useToasts();
  const narrow = useMediaQuery(NARROW_LAYOUT_QUERY);
  const compactSidebar = useMediaQuery(COMPACT_SIDEBAR_QUERY);
  const collapsed = prefs.sidebarCollapsed;
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
      return next ?? null;
    },
    [prefs.garmentId, selectLiveGarment],
  );

  const setSidebarCollapsed = useCallback(
    (value: boolean) => {
      if (value !== prefs.sidebarCollapsed) update({ sidebarCollapsed: value });
    },
    [prefs.sidebarCollapsed, update],
  );

  const toggleSection = useCallback(
    (id: PanelSectionId) => {
      const folded = prefs.collapsedSections.includes(id);
      update({
        collapsedSections: folded
          ? prefs.collapsedSections.filter((s) => s !== id)
          : [...prefs.collapsedSections, id],
      });
    },
    [prefs.collapsedSections, update],
  );

  /** Swipe up on the bottom sheet's grip to unfold it, down to fold it. */
  const onSheetPan = useCallback(
    (_: PointerEvent, info: PanInfo) => {
      if (info.offset.y < -SWIPE_PX) setSidebarCollapsed(false);
      else if (info.offset.y > SWIPE_PX) setSidebarCollapsed(true);
    },
    [setSidebarCollapsed],
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
  // Keep src/app/brand.ts SHORTCUTS in step with this handler.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // An open dialog owns the keyboard: Escape closes it (as does ? for the shortcut list).
      if (dialog) {
        if (e.key === 'Escape' || (e.key === '?' && dialog === 'shortcuts')) {
          e.preventDefault();
          setDialog(null);
        }
        return;
      }
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
          toast(prefs.mirror ? 'Mirror off' : 'Mirror on', <FlipHorizontal2 aria-hidden size={16} />);
          break;
        case 'g':
        case 'G':
          if (aiActive) break;
          update({ showGarment: !prefs.showGarment });
          toast(
            prefs.showGarment ? 'Shirt hidden' : 'Shirt shown',
            prefs.showGarment ? <EyeOff aria-hidden size={16} /> : <Eye aria-hidden size={16} />,
          );
          break;
        case 'f':
        case 'F':
          toggleFullscreen();
          break;
        case 'd':
        case 'D':
          update({ diagnosticsOpen: !prefs.diagnosticsOpen });
          if (prefs.sidebarCollapsed) setSidebarCollapsed(false);
          break;
        case 's':
        case 'S':
          setSidebarCollapsed(!prefs.sidebarCollapsed);
          toast(
            prefs.sidebarCollapsed ? 'Sidebar unfolded' : 'Sidebar folded',
            <PanelsTopLeft aria-hidden size={16} />,
          );
          break;
        case '?':
          setDialog('shortcuts');
          break;
        case ']':
        case '[': {
          if (aiActive) break;
          const next = selectGarmentOffset(e.key === ']' ? 1 : -1);
          if (next) toast(next.name, <Shirt aria-hidden size={16} />);
          break;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    engine,
    prefs,
    update,
    toggleFullscreen,
    selectGarmentOffset,
    setSidebarCollapsed,
    aiActive,
    ai.phase,
    controller,
    dialog,
    toast,
  ]);

  const hasSource = snapshot?.source.state === 'ready' || snapshot?.source.state === 'loading';
  const sourceReady = snapshot?.source.state === 'ready';
  const isFile = snapshot?.source.state === 'ready' && snapshot.source.kind === 'file';
  const liveSource = snapshot?.source.state === 'ready' ? snapshot.source : null;
  const selectedGarment = findGarment(prefs.garmentId);
  const panelWidth = collapsed ? RAIL_WIDTH : compactSidebar ? PANEL_WIDTH.compact : PANEL_WIDTH.wide;

  return (
    <MotionConfig reducedMotion="user">
      <div
        className="app"
        ref={appRef}
        data-mode={prefs.tryOnMode}
        data-sidebar={collapsed ? 'folded' : 'open'}
        data-layout={narrow ? 'sheet' : 'side'}
      >
        <main className="stage" ref={stageRef} aria-label="Mirror view">
          <canvas ref={canvasRef} className="stage-canvas" aria-hidden />
          {initError && (
            <div className="empty-state">
              <div className="hero">
                <h1>Cannot start</h1>
                <p className="error-text">{initError}</p>
              </div>
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
          <ToastViewport toasts={toasts} />
        </main>
        <motion.aside
          // Remounted when the layout switches, so no inline width carries over into the bottom sheet.
          key={narrow ? 'sheet' : 'side'}
          className="panel"
          aria-label="Controls"
          initial={false}
          animate={narrow ? {} : { width: panelWidth }}
          transition={{ type: 'spring', stiffness: 300, damping: 34 }}
        >
          {narrow && (
            <motion.div
              className="sheet-grip"
              aria-hidden
              onPanEnd={onSheetPan}
              onTap={() => setSidebarCollapsed(!collapsed)}
            >
              <span />
            </motion.div>
          )}
          {snapshot && engine && (
            <AnimatePresence mode="wait" initial={false}>
              {collapsed ? (
                <SidebarRail
                  key="rail"
                  narrow={narrow}
                  mode={prefs.tryOnMode}
                  onMode={selectMode}
                  mirror={prefs.mirror}
                  onToggleMirror={() => update({ mirror: !prefs.mirror })}
                  fullscreen={fullscreen}
                  onToggleFullscreen={toggleFullscreen}
                  onExpand={() => setSidebarCollapsed(false)}
                  onShortcuts={() => setDialog('shortcuts')}
                  onAbout={() => setDialog('about')}
                />
              ) : (
                <motion.div
                  key="full"
                  className="panel-inner"
                  initial={{ opacity: 0, x: narrow ? 0 : 16, y: narrow ? 16 : 0 }}
                  animate={{ opacity: 1, x: 0, y: 0 }}
                  exit={{ opacity: 0, transition: { duration: 0.12 } }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                >
                  <header className="panel-header">
                    <div className="brand">
                      <span className="brand-logo" aria-hidden>
                        <Shirt size={20} />
                        <Sparkles size={11} className="brand-spark" />
                      </span>
                      <span className="brand-text">
                        <span className="brand-name">
                          Fitting <span className="gradient-text">Mirror</span>
                        </span>
                        <span className="brand-tagline">
                          {BRAND.tagline} · by {BRAND.builder}
                        </span>
                      </span>
                    </div>
                    <div className="panel-actions">
                      <button
                        type="button"
                        className="icon-button ghost keyboard-only"
                        onClick={() => setDialog('shortcuts')}
                        aria-label="Keyboard shortcuts"
                        title="Keyboard shortcuts (?)"
                      >
                        <Keyboard aria-hidden size={19} />
                      </button>
                      <button
                        type="button"
                        className="icon-button ghost"
                        onClick={() => setDialog('about')}
                        aria-label="About this project"
                        title="About this project"
                      >
                        <Info aria-hidden size={19} />
                      </button>
                      <button
                        type="button"
                        className="icon-button ghost"
                        onClick={() => setSidebarCollapsed(true)}
                        aria-label={narrow ? 'Fold controls' : 'Fold sidebar'}
                        aria-expanded
                        title={narrow ? 'Fold controls (S)' : 'Fold sidebar (S)'}
                      >
                        {narrow ? (
                          <ChevronDown aria-hidden size={20} />
                        ) : (
                          <PanelRightClose aria-hidden size={20} />
                        )}
                      </button>
                    </div>
                  </header>

                  {/* layoutScroll: the shirt ring's layout animation accounts for this scroll offset. */}
                  <motion.div className="panel-body" layoutScroll>
                    <div className="card mode-card">
                      <TryOnModeSelector mode={prefs.tryOnMode} onChange={selectMode} />
                    </div>
                    {hasSource && (
                      <PanelSection
                        title="Source"
                        icon={<Video size={17} />}
                        tone="blue"
                        collapsed={prefs.collapsedSections.includes('source')}
                        onToggle={() => toggleSection('source')}
                        aside={
                          liveSource && (
                            <span className={liveSource.kind === 'camera' ? 'chip chip-live' : 'chip'}>
                              {liveSource.kind === 'camera' ? 'Live' : 'Video'}
                            </span>
                          )
                        }
                      >
                        <SourceControls
                          compact
                          status={snapshot.source}
                          onOpenFile={(file) => void engine.openFile(file)}
                          onOpenCamera={(id) => void engine.openCamera(id)}
                        />
                        {isFile && <Transport engine={engine} playback={snapshot.playback} />}
                      </PanelSection>
                    )}
                    {aiActive && controller ? (
                      <PanelSection
                        title="AI photo preview"
                        icon={<Sparkles size={17} />}
                        tone="teal"
                        collapsed={prefs.collapsedSections.includes('garments')}
                        onToggle={() => toggleSection('garments')}
                      >
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
                      </PanelSection>
                    ) : (
                      <>
                        <PanelSection
                          title="Shirts"
                          icon={<Shirt size={17} />}
                          tone="pink"
                          collapsed={prefs.collapsedSections.includes('garments')}
                          onToggle={() => toggleSection('garments')}
                          aside={<span className="chip">{selectedGarment.kind.toUpperCase()}</span>}
                        >
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
                        </PanelSection>
                        <PanelSection
                          title="Adjust fit"
                          icon={<Ruler size={17} />}
                          tone="amber"
                          collapsed={prefs.collapsedSections.includes('fit')}
                          onToggle={() => toggleSection('fit')}
                        >
                          <FitControls fit={prefs.fit} onChange={(fit) => update({ fit })} />
                        </PanelSection>
                      </>
                    )}
                    <PanelSection
                      title="View"
                      icon={<Eye size={17} />}
                      tone="violet"
                      collapsed={prefs.collapsedSections.includes('view')}
                      onToggle={() => toggleSection('view')}
                    >
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
                        onToggleFitMode={() =>
                          update({ fitMode: prefs.fitMode === 'contain' ? 'cover' : 'contain' })
                        }
                      />
                    </PanelSection>
                    <section className="card" data-tone="blue">
                      <DiagnosticsPanel
                        snapshot={snapshot}
                        open={prefs.diagnosticsOpen}
                        onToggleOpen={(open) =>
                          open !== prefs.diagnosticsOpen && update({ diagnosticsOpen: open })
                        }
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
                    <div className="privacy-note">
                      <ShieldCheck aria-hidden size={18} />
                      <p>
                        {aiActive
                          ? 'AI mode: a captured photo is uploaded to the cloud service FASHN only after you agree. '
                          : 'Approximate visual preview — not a size or fit measurement, and your own clothing may show at the edges. '}
                        2D and 3D video stays on this device; the page itself only talks to this computer, and
                        outgoing requests (including MediaPipe usage metrics) are blocked.{' '}
                        <button
                          type="button"
                          className="text-button keyboard-only"
                          onClick={() => setDialog('shortcuts')}
                        >
                          Keyboard shortcuts
                        </button>
                      </p>
                    </div>
                    <CreditsCard onOpenAbout={() => setDialog('about')} />
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </motion.aside>
        <AboutDialog open={dialog === 'about'} onClose={() => setDialog(null)} />
        <ShortcutsDialog open={dialog === 'shortcuts'} onClose={() => setDialog(null)} />
      </div>
    </MotionConfig>
  );
}
