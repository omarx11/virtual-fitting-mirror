import { CircleCheck, Info, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';
import type { EngineSnapshot } from '../app/MirrorEngine';
import { describeStatus, type StatusMessage } from '../app/statusMessages';
import { SourceControls } from './SourceControls';

function ToneIcon({ tone, loading }: { tone: StatusMessage['tone']; loading: boolean }) {
  if (loading) return <LoaderCircle aria-hidden size={18} className="spin" />;
  if (tone === 'ok') return <CircleCheck aria-hidden size={18} />;
  if (tone === 'info') return <Info aria-hidden size={18} />;
  return <TriangleAlert aria-hidden size={18} />;
}

export function StageOverlay({
  snapshot,
  onRetryTracker,
  onOpenFile,
  onOpenCamera,
}: {
  snapshot: EngineSnapshot;
  onRetryTracker: () => void;
  onOpenFile: (file: File) => void;
  onOpenCamera: (deviceId?: string) => void;
}) {
  const status = describeStatus(snapshot);
  const loading = snapshot.tracker.state === 'loading' || snapshot.source.state === 'loading';
  const noSource = snapshot.source.state === 'none' || snapshot.source.state === 'error';
  return (
    <>
      {status && (
        <div
          className={`status-pill tone-${status.tone}`}
          role="status"
          aria-live="polite"
          data-testid="status"
        >
          <ToneIcon tone={status.tone} loading={loading} />
          <div>
            <strong>{status.title}</strong>
            {status.detail && <span className="status-detail">{status.detail}</span>}
          </div>
          {snapshot.tracker.state === 'error' && (
            <button type="button" className="button small" onClick={onRetryTracker}>
              <RefreshCw aria-hidden size={16} /> Retry
            </button>
          )}
        </div>
      )}
      {noSource && (
        <div className="empty-state">
          <h1>Virtual fitting mirror</h1>
          <p>
            Choose a video of a person facing the camera, or use a webcam. Video is processed on this device
            and is never uploaded.
          </p>
          <SourceControls status={snapshot.source} onOpenFile={onOpenFile} onOpenCamera={onOpenCamera} />
          {snapshot.tracker.state === 'error' && (
            <p className="error-text">
              Tracking could not start: {snapshot.tracker.message}{' '}
              <button type="button" className="text-button" onClick={onRetryTracker}>
                Retry
              </button>
            </p>
          )}
        </div>
      )}
    </>
  );
}
