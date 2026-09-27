import { useCallback, useEffect, useState } from 'react';
import { fetchAiUsage } from '../ai/client';
import type { AiViewState } from '../ai/controller';
import type { AiPresetId, AiUsageView } from '../ai/types';
import type { EngineSnapshot } from '../app/MirrorEngine';
import type { DelegatePreference, QualityPreset } from '../config/performance';
import { QUALITY_PRESETS } from '../config/performance';
import type { ClothTuning } from '../physics/types';
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
  tuning,
  onTuning,
  showRig,
  onToggleRig,
  ai,
  onAiPreset,
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
  /** Cloth solver tuning (developer controls), null when cloth is not running. */
  tuning: ClothTuning | null;
  onTuning?: (patch: Partial<ClothTuning>) => void;
  showRig: boolean;
  /** Development builds only. */
  onToggleRig?: () => void;
  /** AI mode state (operator view: provider, model, preset). Null outside AI mode. */
  ai?: AiViewState | null;
  onAiPreset?: (id: AiPresetId) => void;
}) {
  const d = snapshot.diagnostics;
  const t = snapshot.tracker;
  const i = d.interpretation;
  const g3 = d.garment3d;
  const cloth = g3?.cloth;
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
      {g3 && (
        <>
          <h3 className="diag-subtitle">3D garment</h3>
          <dl className="diag-grid" data-testid="diagnostics-3d">
            <dt>Model</dt>
            <dd title={g3.variant}>
              {g3.triangles.toLocaleString()} tris · {g3.vertices.toLocaleString()} verts · {g3.joints} joints
            </dd>
            <dt>Mode</dt>
            <dd>
              {g3.mode}
              {g3.contextLost ? ' (WebGL context lost)' : ''}
            </dd>
            <dt>Orientation</dt>
            <dd>
              {g3.orientation ?? '—'} · yaw {g3.yawDeg === null ? '—' : `${fmt(g3.yawDeg, 0)}°`}
            </dd>
            <dt>Arms L/R</dt>
            <dd>{g3.armState ?? '—'}</dd>
            <dt>Scale / torso</dt>
            <dd>
              {fmt(g3.pxPerMetre, 0)} px/m · ×{fmt(g3.torsoLength, 2)}
            </dd>
            <dt>Render ms</dt>
            <dd>
              {fmt(g3.renderMs.median, 2)} (p95 {fmt(g3.renderMs.p95, 2)})
            </dd>
            <dt>Layer copy ms</dt>
            <dd>
              {fmt(g3.copyMs.median, 2)} (p95 {fmt(g3.copyMs.p95, 2)})
            </dd>
            <dt>Render size</dt>
            <dd>{g3.renderSize ? `${g3.renderSize.width}×${g3.renderSize.height}` : '—'}</dd>
            <dt>Arm cutout ms</dt>
            <dd>{fmt(g3.occlusionMs, 2)}</dd>
          </dl>
          <h3 className="diag-subtitle">Cloth (experimental)</h3>
          <dl className="diag-grid" data-testid="diagnostics-cloth">
            <dt>State</dt>
            <dd className={cloth?.state === 'error' || cloth?.state === 'disabled' ? 'warn-text' : undefined}>
              {cloth?.state ?? 'off'}
            </dd>
            {cloth?.message && (
              <>
                <dt>Note</dt>
                <dd className="warn-text">{cloth.message}</dd>
              </>
            )}
            <dt>Engine</dt>
            <dd>{cloth?.engine ?? '—'}</dd>
            <dt>Particles / edges</dt>
            <dd>
              {cloth?.particles ?? 0} / {cloth?.edges ?? 0} · {cloth?.colliders ?? 0} colliders
            </dd>
            <dt>Solver ms</dt>
            <dd>
              {fmt(cloth?.stepMs.median, 2)} (p95 {fmt(cloth?.stepMs.p95, 2)}) · map {fmt(cloth?.mapMs, 2)}
            </dd>
            <dt>Substeps / dropped</dt>
            <dd>
              {cloth?.substepsLastFrame ?? 0} / {fmt(cloth?.droppedTimeMs, 0)} ms
            </dd>
            <dt>Resets</dt>
            <dd>
              {cloth?.resets ?? 0} {cloth?.lastResetReason ? `(${cloth.lastResetReason})` : ''}
            </dd>
            <dt>Max dev / stretch</dt>
            <dd>
              {fmt((cloth?.maxDeviationM ?? 0) * 100, 1)} cm · ×{fmt(cloth?.stretchP99, 2)} p99 (max ×
              {fmt(cloth?.maxStretch, 2)})
            </dd>
          </dl>
          {tuning && onTuning && (
            <div className="diag-controls" data-testid="cloth-tuning">
              <TuningRow
                label="Max deviation ×"
                value={tuning.deviationScale}
                min={0}
                max={2}
                step={0.05}
                onChange={(v) => onTuning({ deviationScale: v })}
              />
              <TuningRow
                label="Iterations"
                value={tuning.iterations}
                min={2}
                max={16}
                step={1}
                onChange={(v) => onTuning({ iterations: v })}
              />
              <TuningRow
                label="Bend compliance"
                value={tuning.bendCompliance}
                min={0}
                max={0.02}
                step={0.0005}
                onChange={(v) => onTuning({ bendCompliance: v })}
              />
              <TuningRow
                label="Damping"
                value={tuning.linearDamping}
                min={0}
                max={3}
                step={0.05}
                onChange={(v) => onTuning({ linearDamping: v })}
              />
              <TuningRow
                label="Gravity ×"
                value={tuning.gravityFactor}
                min={0}
                max={2}
                step={0.05}
                onChange={(v) => onTuning({ gravityFactor: v })}
              />
              <TuningRow
                label="Max substeps"
                value={tuning.maxSubsteps}
                min={1}
                max={6}
                step={1}
                onChange={(v) => onTuning({ maxSubsteps: v })}
              />
              <label className="check">
                <input
                  type="checkbox"
                  checked={tuning.colliders}
                  onChange={() => onTuning({ colliders: !tuning.colliders })}
                />{' '}
                Body colliders
              </label>
            </div>
          )}
          {onToggleRig && (
            <label className="check">
              <input type="checkbox" checked={showRig} onChange={onToggleRig} /> Show rig helpers (dev)
            </label>
          )}
        </>
      )}
      {ai && ai.phase !== 'inactive' && <AiDiagnostics ai={ai} onPreset={onAiPreset} />}
      <p className="hint">
        Frame→pose: time from a video frame being presented to its pose result (capture, transfer, inference).
        Pose age: media-time gap between the displayed frame and the frame the pose came from. With landmarks
        on, magenta crosses mark the garment's shoulder anchors (registration check) and yellow capsules the
        forearm cutouts.
      </p>
    </details>
  );
}

function TuningRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="tuning-row">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output>{step < 1 ? value.toFixed(step < 0.01 ? 4 : 2) : value}</output>
    </label>
  );
}

function AiDiagnostics({
  ai,
  onPreset,
}: {
  ai: AiViewState;
  onPreset?: ((id: AiPresetId) => void) | undefined;
}) {
  const caps = ai.capabilities;
  const preset = caps?.presets.find((p) => p.id === ai.preset);
  const busy = ai.phase === 'submitting' || ai.phase === 'queued' || ai.phase === 'generating';
  return (
    <>
      <h3 className="diag-subtitle">AI photo (operator)</h3>
      <dl className="diag-grid" data-testid="diagnostics-ai">
        <dt>State</dt>
        <dd>{ai.phase}</dd>
        <dt>Provider</dt>
        <dd className={caps?.testProvider ? 'warn-text' : undefined}>
          {caps?.provider ? (caps.testProvider ? 'fake (offline test — not AI)' : caps.provider) : '—'}
        </dd>
        <dt>Model / credits</dt>
        <dd>{preset ? `${preset.model} · ${preset.credits} credit per output` : '—'}</dd>
        <dt>Local result TTL</dt>
        <dd>{caps ? `${caps.localResultTtlSeconds} s · job deadline ${caps.jobDeadlineSeconds} s` : '—'}</dd>
        {ai.unavailable && (
          <>
            <dt>Unavailable</dt>
            <dd className="warn-text">{ai.unavailable.reason}</dd>
          </>
        )}
      </dl>
      {caps && caps.presets.length > 1 && onPreset && (
        <label className="inline-select">
          <span>AI preset</span>
          <select
            value={ai.preset ?? ''}
            disabled={busy}
            onChange={(e) => onPreset(e.target.value as AiPresetId)}
          >
            {caps.presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <AiUsage />
    </>
  );
}

/** AI usage for staff: this server's local ledger plus the FASHN account balance. */
function AiUsage() {
  const [usage, setUsage] = useState<AiUsageView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    fetchAiUsage()
      .then((u) => {
        setUsage(u);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(load, [load]);
  const b = usage?.balance;
  return (
    <>
      <h3 className="diag-subtitle">AI usage</h3>
      {error && <p className="warn-text">{error}</p>}
      {usage && (
        <>
          <dl className="diag-grid" data-testid="diagnostics-ai-usage">
            <dt>Today (UTC)</dt>
            <dd>
              {usage.today.used} / {usage.today.cap} credits · {usage.today.remaining} left
              {usage.today.uncertain > 0 ? ` · ${usage.today.uncertain} uncertain` : ''}
            </dd>
            <dt>FASHN balance</dt>
            <dd className={b ? undefined : 'warn-text'}>
              {b
                ? `${b.total} credits (subscription ${b.subscription}, on-demand ${b.onDemand})`
                : (usage.balanceError ?? '—')}
            </dd>
          </dl>
          {usage.days.length > 0 && (
            <table className="usage-table">
              <thead>
                <tr>
                  <th>Day (UTC)</th>
                  <th>Images</th>
                  <th>Credits</th>
                  <th>Failed</th>
                  <th>Uncertain</th>
                </tr>
              </thead>
              <tbody>
                {usage.days.map((d) => (
                  <tr key={d.day}>
                    <td>{d.day}</td>
                    <td>{d.generations}</td>
                    <td>{d.credits}</td>
                    <td>{d.failed}</td>
                    <td>{d.uncertain}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="hint">
            History counts this computer only (last 30 days). The FASHN dashboard is the official billing
            record.
          </p>
        </>
      )}
      <button type="button" className="button small" onClick={load}>
        Refresh usage
      </button>
    </>
  );
}
