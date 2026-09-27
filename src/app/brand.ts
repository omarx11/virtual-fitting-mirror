import universityLogo from '../assets/brand/qassim-university-logo.webp';
import universityMark from '../assets/brand/qassim-university-mark.webp';
import type { ShortcutId } from '../i18n/en';

/**
 * Project identity images shown in the sidebar credits, the welcome screen and the About dialog. The
 * names (app, builder, university) are translated: see `brand` in src/i18n/en.ts.
 */
export const BRAND = {
  universityLogo,
  universityMark,
} as const;

/**
 * Keyboard shortcuts (App's key handler is the source of truth; keep this list in step with it).
 * Descriptions live in the messages (`shortcuts.actions`); key names in `keys` are translated where a
 * language has its own name for them (e.g. Space).
 */
export const SHORTCUTS: readonly { keys: readonly string[]; id: ShortcutId }[] = [
  { keys: ['Space'], id: 'play' },
  { keys: ['[', ']'], id: 'shirtStep' },
  { keys: ['G'], id: 'shirtToggle' },
  { keys: ['M'], id: 'mirror' },
  { keys: ['F'], id: 'fullscreen' },
  { keys: ['S'], id: 'sidebar' },
  { keys: ['D'], id: 'diagnostics' },
  { keys: ['L'], id: 'language' },
  { keys: ['?'], id: 'help' },
  { keys: ['Esc'], id: 'close' },
];
