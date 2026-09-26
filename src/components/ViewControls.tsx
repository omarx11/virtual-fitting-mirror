import { Expand, FlipHorizontal2, Hand, Minimize, Shirt, Wind } from 'lucide-react';
import type { ReactNode } from 'react';

function Toggle({
  pressed,
  onToggle,
  icon,
  label,
  shortcut,
}: {
  pressed: boolean;
  onToggle: () => void;
  icon: ReactNode;
  label: string;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      className="toggle"
      aria-pressed={pressed}
      onClick={onToggle}
      title={shortcut ? `${label} (${shortcut})` : label}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function ViewControls({
  showGarment,
  mirror,
  occlusion,
  fabricMotion,
  fullscreen,
  fitMode,
  onToggleGarment,
  onToggleMirror,
  onToggleOcclusion,
  onToggleFabricMotion,
  onToggleFullscreen,
  onToggleFitMode,
}: {
  showGarment: boolean;
  mirror: boolean;
  occlusion: boolean;
  /** null when the selected garment has no fabric-motion mode. */
  fabricMotion: boolean | null;
  fullscreen: boolean;
  fitMode: 'contain' | 'cover';
  onToggleGarment: () => void;
  onToggleMirror: () => void;
  onToggleOcclusion: () => void;
  onToggleFabricMotion: () => void;
  onToggleFullscreen: () => void;
  onToggleFitMode: () => void;
}) {
  return (
    <fieldset className="view-controls">
      <legend className="section-title">View</legend>
      <div className="toggle-grid">
        <Toggle
          pressed={showGarment}
          onToggle={onToggleGarment}
          icon={<Shirt aria-hidden size={18} />}
          label="Shirt"
          shortcut="G"
        />
        <Toggle
          pressed={mirror}
          onToggle={onToggleMirror}
          icon={<FlipHorizontal2 aria-hidden size={18} />}
          label="Mirror"
          shortcut="M"
        />
        <Toggle
          pressed={occlusion}
          onToggle={onToggleOcclusion}
          icon={<Hand aria-hidden size={18} />}
          label="Arms in front (beta)"
        />
        {fabricMotion !== null && (
          <Toggle
            pressed={fabricMotion}
            onToggle={onToggleFabricMotion}
            icon={<Wind aria-hidden size={18} />}
            label="Fabric motion (beta)"
          />
        )}
        <Toggle
          pressed={fullscreen}
          onToggle={onToggleFullscreen}
          icon={fullscreen ? <Minimize aria-hidden size={18} /> : <Expand aria-hidden size={18} />}
          label="Fullscreen"
          shortcut="F"
        />
      </div>
      <label className="inline-select">
        <span>Framing</span>
        <select value={fitMode} onChange={onToggleFitMode}>
          <option value="contain">Show whole video</option>
          <option value="cover">Fill screen (crop)</option>
        </select>
      </label>
    </fieldset>
  );
}
