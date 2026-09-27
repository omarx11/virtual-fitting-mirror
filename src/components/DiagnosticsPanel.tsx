import { Activity, ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { fetchAiUsage } from '../ai/client';
import type { AiViewState } from '../ai/controller';
import type { AiPresetId, AiUsageView } from '../ai/types';
import type { EngineSnapshot } from '../app/MirrorEngine';
import type { DelegatePreference, QualityPreset } from '../config/performance';
import { QUALITY_PRESETS } from '../config/performance';
import { useI18n } from '../i18n/I18nProvider';
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
  const { m } = useI18n();
  const x = m.diag;
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
      <summary className="card-title diag-summary">
        <span className="section-icon" aria-hidden>
          <Activity size={17} />
        </span>
        <span className="section-name">{x.title}</span>
        <ChevronDown aria-hidden size={18} className="card-chevron" />
      </summary>
      <div className="diag-controls">
        <label className="check">
          <input type="checkbox" checked={showLandmarks} onChange={onToggleLandmarks} /> {x.showLandmarks}
        </label>
        <label className="inline-select">
          <span>{x.quality}</span>
          <select value={preset} onChange={(e) => onPreset(e.target.value as QualityPreset['id'])}>
            {Object.values(QUALITY_PRESETS).map((p) => (
              <option key={p.id} value={p.id}>
                {x.presets[p.id] ?? p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-select">
          <span>{x.delegate}</span>
          <select value={delegate} onChange={(e) => onDelegate(e.target.value as DelegatePreference)}>
            <option value="GPU">GPU (WebGL)</option>
            <option value="CPU">CPU (WASM)</option>
          </select>
        </label>
        <p className="hint">{x.reloadHint}</p>
      </div>
      <dl className="diag-grid" data-testid="diagnostics">
        <dt>{x.tracker}</dt>
        <dd>
          {t.state === 'ready'
            ? `${t.info.model} · ${t.info.delegate} · ${t.backend}`
            : t.state === 'error'
              ? `error (${t.kind})`
              : t.state}
        </dd>
        {t.state === 'ready' && t.note && (
          <>
            <dt>{x.note}</dt>
            <dd className="warn-text">{t.note}</dd>
          </>
        )}
        <dt>tasks-vision</dt>
        <dd>{TASKS_VISION_VERSION}</dd>
        <dt>{x.phase}</dt>
        <dd>
          {snapshot.phase}
          {i && i.rawPhase !== snapshot.phase ? ` (${x.raw} ${i.rawPhase})` : ''}
        </dd>
        <dt>{x.people}</dt>
        <dd>{i?.personCount ?? 0}</dd>
        <dt>{x.shoulderVis}</dt>
        <dd>
          {fmt(i?.shoulderVisibility[0], 2)} / {fmt(i?.shoulderVisibility[1], 2)}
        </dd>
        <dt>{x.hipVis}</dt>
        <dd>
          {fmt(i?.hipVisibility[0], 2)} / {fmt(i?.hipVisibility[1], 2)}
        </dd>
        <dt>{x.yaw}</dt>
        <dd>{i?.yawDeg === null || i?.yawDeg === undefined ? '—' : `${fmt(i.yawDeg, 0)}°`}</dd>
        <dt>{x.torsoRatio}</dt>
        <dd>
          {fmt(i?.torsoRatio, 2)} {i?.learnedRatio ? x.learned : x.defaultValue}
        </dd>
        <dt>{x.videoFps}</dt>
        <dd>{fmt(d.videoFps)}</dd>
        <dt>{x.renderFps}</dt>
        <dd>{fmt(d.renderFps)}</dd>
        <dt>{x.inferenceFps}</dt>
        <dd>{fmt(d.inferenceFps)}</dd>
        <dt>{x.inferenceMs}</dt>
        <dd>
          {fmt(d.inferenceMs.median)} (p95 {fmt(d.inferenceMs.p95)})
        </dd>
        <dt>{x.latency}</dt>
        <dd>
          {fmt(d.resultLatencyMs.median)} (p95 {fmt(d.resultLatencyMs.p95)})
        </dd>
        <dt>{x.poseAge}</dt>
        <dd>
          {fmt(d.poseAgeMs.median, 0)} (p95 {fmt(d.poseAgeMs.p95, 0)})
        </dd>
        <dt>{x.source}</dt>
        <dd>{d.sourceSize ? `${d.sourceSize.width}×${d.sourceSize.height}` : '—'}</dd>
        <dt>{x.processing}</dt>
        <dd>{d.processingSize ? `${d.processingSize.width}×${d.processingSize.height}` : '—'}</dd>
        <dt>{x.canvas}</dt>
        <dd>
          {d.canvasSize.width}×{d.canvasSize.height}
        </dd>
        <dt>{x.frameLoop}</dt>
        <dd>{d.frameLoop ?? '—'}</dd>
        <dt>{x.framesSent}</dt>
        <dd>{d.scheduler ? `${d.scheduler.submitted} / ${d.scheduler.completed}` : '—'}</dd>
        <dt>{x.dropped}</dt>
        <dd>{d.scheduler ? `${d.scheduler.superseded} / ${d.scheduler.stale}` : '—'}</dd>
        <dt>{x.opacity}</dt>
        <dd>{fmt(d.opacity, 2)}</dd>
      </dl>
      {g3 && (
        <>
          <h3 className="diag-subtitle">{x.garment3d}</h3>
          <dl className="diag-grid" data-testid="diagnostics-3d">
            <dt>{x.model}</dt>
            <dd title={g3.variant}>
              {x.modelSize(g3.triangles.toLocaleString('en'), g3.vertices.toLocaleString('en'), g3.joints)}
            </dd>
            <dt>{x.mode}</dt>
            <dd>
              {g3.mode}
              {g3.contextLost ? x.contextLost : ''}
            </dd>
            <dt>{x.orientation}</dt>
            <dd>
              {g3.orientation ?? '—'} · yaw {g3.yawDeg === null ? '—' : `${fmt(g3.yawDeg, 0)}°`}
            </dd>
            <dt>{x.arms}</dt>
            <dd>{g3.armState ?? '—'}</dd>
            <dt>{x.scale}</dt>
            <dd>
              {fmt(g3.pxPerMetre, 0)} px/m · ×{fmt(g3.torsoLength, 2)}
            </dd>
            <dt>{x.renderMs}</dt>
            <dd>
              {fmt(g3.renderMs.median, 2)} (p95 {fmt(g3.renderMs.p95, 2)})
            </dd>
            <dt>{x.copyMs}</dt>
            <dd>
              {fmt(g3.copyMs.median, 2)} (p95 {fmt(g3.copyMs.p95, 2)})
            </dd>
            <dt>{x.renderSize}</dt>
            <dd>{g3.renderSize ? `${g3.renderSize.width}×${g3.renderSize.height}` : '—'}</dd>
            <dt>{x.cutoutMs}</dt>
            <dd>{fmt(g3.occlusionMs, 2)}</dd>
          </dl>
          <h3 className="diag-subtitle">{x.cloth}</h3>
          <dl className="diag-grid" data-testid="diagnostics-cloth">
            <dt>{x.state}</dt>
            <dd className={cloth?.state === 'error' || cloth?.state === 'disabled' ? 'warn-text' : undefined}>
              {cloth?.state ?? 'off'}
            </dd>
            {cloth?.message && (
              <>
                <dt>{x.note}</dt>
                <dd className="warn-text">{cloth.message}</dd>
              </>
            )}
            <dt>{x.engine}</dt>
            <dd>{cloth?.engine ?? '—'}</dd>
            <dt>{x.particles}</dt>
            <dd>
              {cloth?.particles ?? 0} / {cloth?.edges ?? 0} · {cloth?.colliders ?? 0} {x.colliders}
            </dd>
            <dt>{x.solverMs}</dt>
            <dd>
              {fmt(cloth?.stepMs.median, 2)} (p95 {fmt(cloth?.stepMs.p95, 2)}) · map {fmt(cloth?.mapMs, 2)}
            </dd>
            <dt>{x.substeps}</dt>
            <dd>
              {cloth?.substepsLastFrame ?? 0} / {fmt(cloth?.droppedTimeMs, 0)} ms
            </dd>
            <dt>{x.resets}</dt>
            <dd>
              {cloth?.resets ?? 0} {cloth?.lastResetReason ? `(${cloth.lastResetReason})` : ''}
            </dd>
            <dt>{x.deviation}</dt>
            <dd>
              {fmt((cloth?.maxDeviationM ?? 0) * 100, 1)} cm · ×{fmt(cloth?.stretchP99, 2)} p99 (max ×
              {fmt(cloth?.maxStretch, 2)})
            </dd>
          </dl>
          {tuning && onTuning && (
            <div className="diag-controls" data-testid="cloth-tuning">
              <TuningRow
                label={x.tuning.deviation}
                value={tuning.deviationScale}
                min={0}
                max={2}
                step={0.05}
                onChange={(v) => onTuning({ deviationScale: v })}
              />
              <TuningRow
                label={x.tuning.iterations}
                value={tuning.iterations}
                min={2}
                max={16}
                step={1}
                onChange={(v) => onTuning({ iterations: v })}
              />
              <TuningRow
                label={x.tuning.bend}
                value={tuning.bendCompliance}
                min={0}
                max={0.02}
                step={0.0005}
                onChange={(v) => onTuning({ bendCompliance: v })}
              />
              <TuningRow
                label={x.tuning.damping}
                value={tuning.linearDamping}
                min={0}
                max={3}
                step={0.05}
                onChange={(v) => onTuning({ linearDamping: v })}
              />
              <TuningRow
                label={x.tuning.gravity}
                value={tuning.gravityFactor}
                min={0}
                max={2}
                step={0.05}
                onChange={(v) => onTuning({ gravityFactor: v })}
              />
              <TuningRow
                label={x.tuning.substeps}
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
                {x.tuning.colliders}
              </label>
            </div>
          )}
          {onToggleRig && (
            <label className="check">
              <input type="checkbox" checked={showRig} onChange={onToggleRig} /> {x.showRig}
            </label>
          )}
        </>
      )}
      {ai && ai.phase !== 'inactive' && <AiDiagnostics ai={ai} onPreset={onAiPreset} />}
      <p className="hint">{x.footnote}</p>
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
  const x = useI18n().m.diag;
  const caps = ai.capabilities;
  const preset = caps?.presets.find((p) => p.id === ai.preset);
  const busy = ai.phase === 'submitting' || ai.phase === 'queued' || ai.phase === 'generating';
  return (
    <>
      <h3 className="diag-subtitle">{x.aiTitle}</h3>
      <dl className="diag-grid" data-testid="diagnostics-ai">
        <dt>{x.state}</dt>
        <dd>{ai.phase}</dd>
        <dt>{x.provider}</dt>
        <dd className={caps?.testProvider ? 'warn-text' : undefined}>
          {caps?.provider ? (caps.testProvider ? x.fakeProvider : caps.provider) : '—'}
        </dd>
        <dt>{x.modelCredits}</dt>
        <dd>{preset ? x.perOutput(preset.model, preset.credits) : '—'}</dd>
        <dt>{x.resultTtl}</dt>
        <dd>{caps ? x.ttl(caps.localResultTtlSeconds, caps.jobDeadlineSeconds) : '—'}</dd>
        {ai.unavailable && (
          <>
            <dt>{x.unavailable}</dt>
            <dd className="warn-text">{ai.unavailable.reason}</dd>
          </>
        )}
      </dl>
      {caps && caps.presets.length > 1 && onPreset && (
        <label className="inline-select">
          <span>{x.aiPreset}</span>
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
      {/* Usage lives on the local AI server: nothing to ask while it is not running (or not deployed). */}
      {(!ai.unavailable || ai.unavailable.cause === 'disabled') && <AiUsage />}
    </>
  );
}

/** AI usage for staff: this server's local ledger plus the FASHN account balance. */
function AiUsage() {
  const x = useI18n().m.diag;
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
      <h3 className="diag-subtitle">{x.usageTitle}</h3>
      {error && <p className="warn-text">{error}</p>}
      {usage && (
        <>
          <dl className="diag-grid" data-testid="diagnostics-ai-usage">
            <dt>{x.today}</dt>
            <dd>
              {x.todayValue(usage.today.used, usage.today.cap, usage.today.remaining, usage.today.uncertain)}
            </dd>
            <dt>{x.balance}</dt>
            <dd className={b ? undefined : 'warn-text'}>
              {b ? x.balanceValue(b.total, b.subscription, b.onDemand) : (usage.balanceError ?? '—')}
            </dd>
          </dl>
          {usage.days.length > 0 && (
            <table className="usage-table">
              <thead>
                <tr>
                  <th>{x.day}</th>
                  <th>{x.images}</th>
                  <th>{x.credits}</th>
                  <th>{x.failed}</th>
                  <th>{x.uncertain}</th>
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
          <p className="hint">{x.usageHint}</p>
        </>
      )}
      <button type="button" className="button small" onClick={load}>
        {x.refreshUsage}
      </button>
    </>
  );
}
