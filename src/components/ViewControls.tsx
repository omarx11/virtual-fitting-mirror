import { Expand, FlipHorizontal2, Hand, Minimize, Shirt, Wind } from 'lucide-react';
import { motion } from 'motion/react';
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
    <motion.button
      type="button"
      className="toggle"
      aria-pressed={pressed}
      onClick={onToggle}
      title={shortcut ? `${label} (${shortcut})` : label}
      whileTap={{ scale: 0.96 }}
    >
      <span className="toggle-icon">{icon}</span>
      <span className="toggle-label">{label}</span>
      <span className="switch" aria-hidden>
        <motion.span
          className="switch-knob"
          initial={false}
          animate={{ x: pressed ? 12 : 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 32 }}
        />
      </span>
    </motion.button>
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
  garmentToggles = true,
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
  /** False in AI mode, where no live garment is drawn. */
  garmentToggles?: boolean;
}) {
  return (
    <fieldset className="view-controls">
      <legend className="visually-hidden">View</legend>
      <div className="toggle-grid">
        {garmentToggles && (
          <Toggle
            pressed={showGarment}
            onToggle={onToggleGarment}
            icon={<Shirt aria-hidden size={18} />}
            label="Shirt"
            shortcut="G"
          />
        )}
        <Toggle
          pressed={mirror}
          onToggle={onToggleMirror}
          icon={<FlipHorizontal2 aria-hidden size={18} />}
          label="Mirror"
          shortcut="M"
        />
        {garmentToggles && (
          <Toggle
            pressed={occlusion}
            onToggle={onToggleOcclusion}
            icon={<Hand aria-hidden size={18} />}
            label="Arms in front (beta)"
          />
        )}
        {garmentToggles && fabricMotion !== null && (
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
