import { ChevronUp, Expand, FlipHorizontal2, Keyboard, Minimize, PanelRightOpen } from 'lucide-react';
import { motion } from 'motion/react';
import { BRAND } from '../app/brand';
import type { TryOnMode } from '../app/preferences';
import { withKey } from '../i18n/format';
import { useI18n } from '../i18n/I18nProvider';
import { LanguageToggle } from './LanguageToggle';
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
  /** Null where the browser cannot go fullscreen (iPhone). */
  onToggleFullscreen: (() => void) | null;
  onExpand: () => void;
  onShortcuts: () => void;
  onAbout: () => void;
}) {
  const { m } = useI18n();
  const expandLabel = narrow ? m.app.showAllControls : m.app.unfoldSidebar;
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
        aria-label={expandLabel}
        aria-expanded={false}
        title={withKey(expandLabel, 'S')}
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
          aria-label={m.app.mirrorView}
          title={withKey(m.app.mirrorView, 'M')}
        >
          <FlipHorizontal2 aria-hidden size={19} />
        </button>
        {onToggleFullscreen && (
          <button
            type="button"
            className="icon-button"
            aria-pressed={fullscreen}
            onClick={onToggleFullscreen}
            aria-label={m.app.fullscreenView}
            title={withKey(m.view.fullscreen, 'F')}
          >
            {fullscreen ? <Minimize aria-hidden size={19} /> : <Expand aria-hidden size={19} />}
          </button>
        )}
        <button
          type="button"
          className="icon-button keyboard-only"
          onClick={onShortcuts}
          aria-label={m.common.keyboardShortcuts}
          title={withKey(m.common.keyboardShortcuts, '?')}
        >
          <Keyboard aria-hidden size={19} />
        </button>
        <LanguageToggle className="icon-button lang-toggle" />
      </div>
      <button
        type="button"
        className="rail-mark"
        onClick={onAbout}
        aria-label={m.common.aboutWith(m.brand.university)}
        title={m.brand.kindBy(m.brand.projectKind, m.brand.builder, m.brand.university)}
      >
        <img src={BRAND.universityMark} alt="" width={40} height={25} />
      </button>
    </motion.div>
  );
}
