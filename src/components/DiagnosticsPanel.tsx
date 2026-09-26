import type { EngineSnapshot } from '../app/MirrorEngine';
import type { DelegatePreference, QualityPreset } from '../config/performance';
import { QUALITY_PRESETS } from '../config/performance';
import { TASKS_VISION_VERSION } from '../tracking/assets';

const fmt = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(digits);

export function DiagnosticsPanel({
  snapshot,
  open,
  onToggleOpen,
  showLandmarks,
  onToggleLandmarks,
  preset,
  onPreset,
  delegate,
  onDelegate,
}: {
  snapshot: EngineSnapshot;
  open: boolean;
  onToggleOpen: (open: boolean) => void;
  showLandmarks: boolean;
  onToggleLandmarks: () => void;
  preset: QualityPreset['id'];
  onPreset: (id: QualityPreset['id']) => void;
  delegate: DelegatePreference;
  onDelegate: (d: DelegatePreference) => void;
}) {
  const d = snapshot.diagnostics;
  const t = snapshot.tracker;
  const i = d.interpretation;
  return (
    <details
      className="diagnostics"
      open={open}
      onToggle={(e) => onToggleOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="section-title">Diagnostics</summary>
      <div className="diag-controls">
        <label className="check">
          <input type="checkbox" checked={showLandmarks} onChange={onToggleLandmarks} /> Show landmarks
        </label>
        <label className="inline-select">
          <span>Quality</span>
          <select value={preset} onChange={(e) => onPreset(e.target.value as QualityPreset['id'])}>
            {Object.values(QUALITY_PRESETS).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-select">
          <span>Delegate</span>
          <select value={delegate} onChange={(e) => onDelegate(e.target.value as DelegatePreference)}>
            <option value="GPU">GPU (WebGL)</option>
            <option value="CPU">CPU (WASM)</option>
          </select>
        </label>
        <p className="hint">Changing quality or delegate reloads the model.</p>
      </div>
      <dl className="diag-grid" data-testid="diagnostics">
        <dt>Tracker</dt>
        <dd>
          {t.state === 'ready'
            ? `${t.info.model} · ${t.info.delegate} · ${t.backend}`
            : t.state === 'error'
              ? `error (${t.kind})`
              : t.state}
        </dd>
        {t.state === 'ready' && t.note && (
          <>
            <dt>Note</dt>
            <dd className="warn-text">{t.note}</dd>
          </>
        )}
        <dt>tasks-vision</dt>
        <dd>{TASKS_VISION_VERSION}</dd>
        <dt>Phase</dt>
        <dd>
          {snapshot.phase}
          {i && i.rawPhase !== snapshot.phase ? ` (raw ${i.rawPhase})` : ''}
        </dd>
        <dt>People</dt>
        <dd>{i?.personCount ?? 0}</dd>
        <dt>Shoulder vis L/R</dt>
        <dd>
          {fmt(i?.shoulderVisibility[0], 2)} / {fmt(i?.shoulderVisibility[1], 2)}
        </dd>
        <dt>Hip vis L/R</dt>
        <dd>
          {fmt(i?.hipVisibility[0], 2)} / {fmt(i?.hipVisibility[1], 2)}
        </dd>
        <dt>Yaw est.</dt>
        <dd>{i?.yawDeg === null || i?.yawDeg === undefined ? '—' : `${fmt(i.yawDeg, 0)}°`}</dd>
        <dt>Torso ratio</dt>
        <dd>
          {fmt(i?.torsoRatio, 2)} {i?.learnedRatio ? '(learned)' : '(default)'}
        </dd>
        <dt>Video frames/s</dt>
        <dd>{fmt(d.videoFps)}</dd>
        <dt>Render/s</dt>
        <dd>{fmt(d.renderFps)}</dd>
        <dt>Inference/s</dt>
        <dd>{fmt(d.inferenceFps)}</dd>
        <dt>Inference ms</dt>
        <dd>
          {fmt(d.inferenceMs.median)} (p95 {fmt(d.inferenceMs.p95)})
        </dd>
        <dt>Frame→pose ms</dt>
        <dd>
          {fmt(d.resultLatencyMs.median)} (p95 {fmt(d.resultLatencyMs.p95)})
        </dd>
        <dt>Pose age ms</dt>
        <dd>
          {fmt(d.poseAgeMs.median, 0)} (p95 {fmt(d.poseAgeMs.p95, 0)})
        </dd>
        <dt>Source</dt>
        <dd>{d.sourceSize ? `${d.sourceSize.width}×${d.sourceSize.height}` : '—'}</dd>
        <dt>Processing</dt>
        <dd>{d.processingSize ? `${d.processingSize.width}×${d.processingSize.height}` : '—'}</dd>
        <dt>Canvas</dt>
        <dd>
          {d.canvasSize.width}×{d.canvasSize.height}
        </dd>
        <dt>Frame loop</dt>
        <dd>{d.frameLoop ?? '—'}</dd>
        <dt>Frames sent/done</dt>
        <dd>{d.scheduler ? `${d.scheduler.submitted} / ${d.scheduler.completed}` : '—'}</dd>
        <dt>Dropped/stale</dt>
        <dd>{d.scheduler ? `${d.scheduler.superseded} / ${d.scheduler.stale}` : '—'}</dd>
        <dt>Opacity</dt>
        <dd>{fmt(d.opacity, 2)}</dd>
      </dl>
      <p className="hint">
        Frame→pose: time from a video frame being presented to its pose result (capture, transfer, inference).
        Pose age: media-time gap between the displayed frame and the frame the pose came from.
      </p>
    </details>
  );
}
