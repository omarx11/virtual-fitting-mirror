import { useCallback, useEffect, useRef, useState } from 'react';
import { DiagnosticsPanel } from '../components/DiagnosticsPanel';
import { FitControls } from '../components/FitControls';
import { GarmentPicker } from '../components/GarmentPicker';
import { SourceControls } from '../components/SourceControls';
import { StageOverlay } from '../components/StageOverlay';
import { Transport } from '../components/Transport';
import { ViewControls } from '../components/ViewControls';
import { GARMENTS } from '../garments/catalogue';
import type { EngineSettings } from './MirrorEngine';
import { loadPreferences, type Preferences, savePreferences } from './preferences';
import { useMirrorEngine } from './useMirrorEngine';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName);
}

export function App() {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const [prefs, setPrefs] = useState<Preferences>(loadPreferences);
  const { engine, snapshot, initError } = useMirrorEngine(canvasRef, stageRef, prefs);
  const [fullscreen, setFullscreen] = useState(false);

  const update = useCallback(
    (patch: Partial<Preferences>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...patch };
        savePreferences(next);
        return next;
      });
      const { diagnosticsOpen: _ignored, ...enginePatch } = patch;
      if (Object.keys(enginePatch).length > 0) engine?.updateSettings(enginePatch as Partial<EngineSettings>);
    },
    [engine],
  );

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void appRef.current?.requestFullscreen?.().catch(() => undefined);
  }, []);

  const selectGarmentOffset = useCallback(
    (delta: number) => {
      const index = GARMENTS.findIndex((g) => g.id === prefs.garmentId);
      const next = GARMENTS[(index + delta + GARMENTS.length) % GARMENTS.length];
      if (next) update({ garmentId: next.id });
    },
    [prefs.garmentId, update],
  );

  // Keyboard shortcuts (ignored while typing in a form control; buttons keep Space/Enter).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
          update({ showGarment: !prefs.showGarment });
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
          selectGarmentOffset(1);
          break;
        case '[':
          selectGarmentOffset(-1);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine, prefs, update, toggleFullscreen, selectGarmentOffset]);

  const hasSource = snapshot?.source.state === 'ready' || snapshot?.source.state === 'loading';
  const isFile = snapshot?.source.state === 'ready' && snapshot.source.kind === 'file';

  return (
    <div className="app" ref={appRef}>
      <main className="stage" ref={stageRef} aria-label="Mirror view">
        <canvas ref={canvasRef} className="stage-canvas" aria-hidden />
        {initError && (
          <div className="empty-state">
            <h1>Cannot start</h1>
            <p className="error-text">{initError}</p>
          </div>
        )}
        {snapshot && engine && (
          <StageOverlay
            snapshot={snapshot}
            onRetryTracker={() => void engine.initTracker()}
            onOpenFile={(file) => void engine.openFile(file)}
            onOpenCamera={(id) => void engine.openCamera(id)}
          />
        )}
      </main>
      <aside className="panel" aria-label="Controls">
        {snapshot && engine && (
          <>
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
            <section className="panel-section">
              <GarmentPicker
                garments={GARMENTS}
                selectedId={prefs.garmentId}
                onSelect={(id) => update({ garmentId: id })}
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
            <section className="panel-section">
              <ViewControls
                showGarment={prefs.showGarment}
                mirror={prefs.mirror}
                occlusion={prefs.occlusion}
                fullscreen={fullscreen}
                fitMode={prefs.fitMode}
                onToggleGarment={() => update({ showGarment: !prefs.showGarment })}
                onToggleMirror={() => update({ mirror: !prefs.mirror })}
                onToggleOcclusion={() => update({ occlusion: !prefs.occlusion })}
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
              />
            </section>
            <p className="footnote">
              Approximate 2D preview — not a size or fit measurement. Video stays on this device, and outgoing
              requests (including MediaPipe usage metrics) are blocked. Shortcuts: Space play/pause · [ ]
              shirts · G shirt · M mirror · F fullscreen · D diagnostics.
            </p>
          </>
        )}
      </aside>
    </div>
  );
}
