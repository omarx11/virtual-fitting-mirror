import { ChevronUp, Expand, FlipHorizontal2, Keyboard, Minimize, PanelRightOpen } from 'lucide-react';
import { motion } from 'motion/react';
import { BRAND } from '../app/brand';
import type { TryOnMode } from '../app/preferences';
import { TryOnModeSelector } from './TryOnModeSelector';

/**
 * The folded sidebar: an icon rail beside the stage on wide screens, a slim bar under it on phones
 * and portrait tablets. Keeps the essentials one tap away while the mirror gets the space.
 */
export function SidebarRail({
  narrow,
  mode,
  onMode,
  mirror,
  onToggleMirror,
  fullscreen,
  onToggleFullscreen,
  onExpand,
  onShortcuts,
  onAbout,
}: {
  narrow: boolean;
  mode: TryOnMode;
  onMode: (mode: TryOnMode) => void;
  mirror: boolean;
  onToggleMirror: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onExpand: () => void;
  onShortcuts: () => void;
  onAbout: () => void;
}) {
  return (
    <motion.div
      className="rail"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
    >
      <button
        type="button"
        className="icon-button accent"
        onClick={onExpand}
        aria-label={narrow ? 'Show all controls' : 'Unfold sidebar'}
        aria-expanded={false}
        title={narrow ? 'Show all controls (S)' : 'Unfold sidebar (S)'}
      >
        {narrow ? <ChevronUp aria-hidden size={20} /> : <PanelRightOpen aria-hidden size={20} />}
      </button>
      <TryOnModeSelector mode={mode} onChange={onMode} compact />
      <div className="rail-tools">
        <button
          type="button"
          className="icon-button"
          aria-pressed={mirror}
          onClick={onToggleMirror}
          aria-label="Mirror view"
          title="Mirror view (M)"
        >
          <FlipHorizontal2 aria-hidden size={19} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-pressed={fullscreen}
          onClick={onToggleFullscreen}
          aria-label="Fullscreen view"
          title="Fullscreen (F)"
        >
          {fullscreen ? <Minimize aria-hidden size={19} /> : <Expand aria-hidden size={19} />}
        </button>
        <button
          type="button"
          className="icon-button keyboard-only"
          onClick={onShortcuts}
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
        >
          <Keyboard aria-hidden size={19} />
        </button>
      </div>
      <button
        type="button"
        className="rail-mark"
        onClick={onAbout}
        aria-label={`About this project — ${BRAND.university}`}
        title={`${BRAND.projectKind} by ${BRAND.builder} · ${BRAND.university}`}
      >
        <img src={BRAND.universityMark} alt="" width={40} height={25} />
      </button>
    </motion.div>
  );
}
