import { Pause, Play, Repeat, RotateCcw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { MirrorEngine, PlaybackState } from '../app/MirrorEngine';

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const RATES = [0.5, 1, 1.5] as const;

export function Transport({ engine, playback }: { engine: MirrorEngine; playback: PlaybackState }) {
  const rangeRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const dragging = useRef(false);
  const duration = playback.duration ?? 0;

  // The playhead is animated directly (rAF → DOM) instead of through React state.
  useEffect(() => {
    let handle = 0;
    const tick = () => {
      const t = engine.currentTime;
      if (rangeRef.current && !dragging.current) rangeRef.current.value = String(t);
      if (timeRef.current) timeRef.current.textContent = formatTime(t);
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [engine]);

  const playing = !playback.paused && !playback.ended;
  return (
    <div className="transport">
      <div className="transport-buttons">
        <button
          type="button"
          className="icon-button primary"
          onClick={() => engine.togglePlay()}
          aria-label={playing ? 'Pause' : 'Play'}
          title={playing ? 'Pause (Space)' : 'Play (Space)'}
        >
          {playing ? <Pause aria-hidden size={20} /> : <Play aria-hidden size={20} />}
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => engine.restart()}
          aria-label="Restart"
          title="Restart"
        >
          <RotateCcw aria-hidden size={18} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-pressed={playback.loop}
          onClick={() => engine.setLoop(!playback.loop)}
          aria-label="Loop"
          title={playback.loop ? 'Loop on' : 'Loop off'}
        >
          <Repeat aria-hidden size={18} />
        </button>
        <label className="rate">
          <span className="visually-hidden">Playback speed</span>
          <select value={playback.rate} onChange={(e) => engine.setPlaybackRate(Number(e.target.value))}>
            {RATES.map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="scrubber">
        <span ref={timeRef} className="time" aria-hidden>
          0:00
        </span>
        <input
          ref={rangeRef}
          type="range"
          min={0}
          max={duration || 0}
          step={0.01}
          defaultValue={0}
          aria-label="Seek"
          disabled={!duration}
          onPointerDown={() => {
            dragging.current = true;
          }}
          onPointerUp={() => {
            dragging.current = false;
          }}
          onBlur={() => {
            dragging.current = false;
          }}
          onChange={(e) => engine.seek(Number(e.target.value))}
        />
        <span className="time">{formatTime(duration)}</span>
      </div>
    </div>
  );
}
