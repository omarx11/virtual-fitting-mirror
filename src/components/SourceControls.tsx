import { Camera, FileVideo } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { SourceStatus } from '../app/MirrorEngine';
import { listCameras } from '../media/cameraSource';

export function SourceControls({
  status,
  onOpenFile,
  onOpenCamera,
  compact = false,
}: {
  status: SourceStatus;
  onOpenFile: (file: File) => void;
  onOpenCamera: (deviceId?: string) => void;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');

  // Device labels are only available after permission; refresh the list when the camera starts
  // and when devices are plugged in or removed. This never requests permission by itself.
  const cameraActive = status.state === 'ready' && status.kind === 'camera';
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-list when the camera starts, because device labels only appear after permission is granted.
  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      listCameras()
        .then((list) => {
          if (!cancelled) setCameras(list);
        })
        .catch(() => undefined);
    void refresh();
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.('devicechange', refresh);
    };
  }, [cameraActive]);

  const busy = status.state === 'loading';
  const labelled = cameras.filter((c) => c.label);
  return (
    <div className={compact ? 'source-controls compact' : 'source-controls'}>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden
        data-testid="file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onOpenFile(file);
          e.target.value = '';
        }}
      />
      <button type="button" className="button" onClick={() => inputRef.current?.click()} disabled={busy}>
        <FileVideo aria-hidden size={18} />
        {compact ? 'Open video' : 'Open a video file'}
      </button>
      <button
        type="button"
        className="button"
        onClick={() => onOpenCamera(deviceId || undefined)}
        disabled={busy}
      >
        <Camera aria-hidden size={18} />
        {cameraActive ? 'Restart camera' : 'Use camera'}
      </button>
      {labelled.length > 1 && (
        <label className="camera-select">
          <span>Camera</span>
          <select
            value={deviceId}
            onChange={(e) => {
              setDeviceId(e.target.value);
              if (cameraActive) onOpenCamera(e.target.value || undefined);
            }}
          >
            <option value="">Default</option>
            {labelled.map((c) => (
              <option key={c.deviceId} value={c.deviceId}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {status.state === 'error' && (
        <p className="error-text" role="alert">
          {status.message}
        </p>
      )}
      {status.state === 'ready' && (
        <p className="hint source-label" title={status.label}>
          {status.kind === 'camera' ? 'Live: ' : 'Playing: '}
          {status.label} · {status.width}×{status.height}
        </p>
      )}
    </div>
  );
}
